/**
 * Aritech ATS Panel Client
 *
 * Protocol details:
 * - Session key = [8 zeros from client][8 bytes from panel]
 * - Key exchange uses initial key for all 4 messages
 * - Session key activates AFTER enableEncryptionKey completes
 */

import net from 'net';
import { parseEvent } from './event-parser.js';
import { createHelperMethods } from './message-helpers.js';
import { messageTemplates } from './messages.js';
import {
    SLIP_END,
    slipEncode,
    slipDecode,
    appendCrc,
    verifyCrc,
    makeEncryptionKey,
    makeEncryptionKeyPBKDF2,
    decodeSerial,
    calculateProtocolVersion,
    encryptMessage,
    decryptMessage
} from './aritech-utils.js';
import AreaState from './AreaState.js';
import ZoneState from './ZoneState.js';
import TriggerState from './TriggerState.js';
import OutputState from './OutputState.js';
import DoorState from './DoorState.js';
import FilterState from './FilterState.js';

// Create bound message helpers for this template set
const {
    constructMessage,
    getProperty,
    splitBatchResponse,
    buildGetStatRequest,
    buildBatchStatRequest,
    buildGetValidZonesMessage,
    checkResponseError,
    isMessageType,
    parseCreateCCResponse,
    parseReturnBool,
    buildGetEventLogMessage
} = createHelperMethods(messageTemplates);

// ============================================================================
// PROTOCOL CONSTANTS
// ============================================================================

// Protocol header constant (for local use in checkForCOSEvent and response handling)
const HEADER = {
    REQUEST: 0xC0,   // Client → Panel
    RESPONSE: 0xA0,  // Panel → Client (success)
    ERROR: 0xF0      // Panel → Client (error)
};

// Event log direction constants
const EVENT_LOG_DIRECTION = {
    FIRST: 0x00,
    NEXT: 0x03,
};

export const LOGIN_TYPE = {
    INSTALLER: 0x01,
    USER: 0x03,
}

// Control context status codes for arm operations
const CC_STATUS = {
    // Part set statuses (0x04xx)
    PartSetFault: 0x0401,
    PartSetActiveStates: 0x0402,
    PartSetInhibited: 0x0403,
    PartSetSetting: 0x0404,
    PartSetSet: 0x0405,
    // Full set statuses (0x05xx)
    FullSetFault: 0x0501,
    FullSetActiveStates: 0x0502,
    FullSetInhibited: 0x0503,
    FullSetSetting: 0x0504,
    FullSetSet: 0x0505,
    // Part set 2 statuses (0x10xx)
    PartSet2Fault: 0x1001,
    PartSet2ActiveStates: 0x1002,
    PartSet2Inhibited: 0x1003,
    PartSet2Setting: 0x1004,
    PartSet2Set: 0x1005,
};

// Response parsing constants for standard format (x500 panels with protocol < 4.4)
const NAMES_START_OFFSET = 6;  // Offset where names begin in getName responses
const NAME_LENGTH = 16;        // Each name is 16 bytes, null-padded
const NAMES_PER_PAGE = 16;     // Panel returns 16 names per request

// Response parsing constants for extended format (x700 panels and x500 panels with protocol 4.4+)
const EXTENDED_NAME_LENGTH = 30;   // Extended format uses 30-byte names
const EXTENDED_NAMES_PER_PAGE = 4; // Extended format returns 4 names per request

// Debug logging helper
const DEBUG = process.env.LOG_LEVEL === 'debug';
const debug = (...args) => {
    if (DEBUG) console.debug(...args);
};

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * Custom error class for Aritech client operations.
 * Provides structured error information for consistent error handling.
 */
export class AritechError extends Error {
    /**
     * @param {string} message - Human-readable error message
     * @param {Object} options - Error details
     * @param {string} [options.code] - Error code (e.g., 'ARM_FAILED', 'ZONE_FAULT')
     * @param {number} [options.status] - Panel status code if applicable
     * @param {number} [options.panelError] - Raw panel error code (from 0xF0 response)
     * @param {Object} [options.details] - Additional structured details (e.g., faults, activeZones)
     */
    constructor(message, { code, status, panelError, details } = {}) {
        super(message);
        this.name = 'AritechError';
        this.code = code || 'UNKNOWN';
        this.status = status;
        this.panelError = panelError;
        this.details = details || {};
    }
}

// Error codes for common scenarios
export const ErrorCodes = {
    // Connection/Protocol errors
    CONNECTION_FAILED: 'CONNECTION_FAILED',
    PROTOCOL_ERROR: 'PROTOCOL_ERROR',
    CRC_ERROR: 'CRC_ERROR',
    DECRYPT_FAILED: 'DECRYPT_FAILED',

    // Authentication errors
    LOGIN_FAILED: 'LOGIN_FAILED',
    KEY_EXCHANGE_FAILED: 'KEY_EXCHANGE_FAILED',

    // Panel errors (from 0xF0 response)
    PANEL_ERROR: 'PANEL_ERROR',

    // Arm/Disarm errors
    ARM_FAILED: 'ARM_FAILED',
    ARM_FAULTS: 'ARM_FAULTS',
    ARM_ACTIVE_ZONES: 'ARM_ACTIVE_ZONES',
    ARM_INHIBITED: 'ARM_INHIBITED',
    FORCE_ARM_FAILED: 'FORCE_ARM_FAILED',
    DISARM_FAILED: 'DISARM_FAILED',

    // Zone control errors
    ZONE_INHIBIT_FAILED: 'ZONE_INHIBIT_FAILED',
    ZONE_UNINHIBIT_FAILED: 'ZONE_UNINHIBIT_FAILED',

    // Output control errors
    OUTPUT_ACTIVATE_FAILED: 'OUTPUT_ACTIVATE_FAILED',
    OUTPUT_DEACTIVATE_FAILED: 'OUTPUT_DEACTIVATE_FAILED',
    OUTPUT_CANCEL_FORCE_FAILED: 'OUTPUT_CANCEL_FORCE_FAILED',

    // Trigger control errors
    TRIGGER_ACTIVATE_FAILED: 'TRIGGER_ACTIVATE_FAILED',
    TRIGGER_DEACTIVATE_FAILED: 'TRIGGER_DEACTIVATE_FAILED',

    // Door control errors
    DOOR_LOCK_FAILED: 'DOOR_LOCK_FAILED',
    DOOR_UNLOCK_FAILED: 'DOOR_UNLOCK_FAILED',
    DOOR_UNLOCK_STANDARD_TIME_FAILED: 'DOOR_UNLOCK_STANDARD_TIME_FAILED',
    DOOR_UNLOCK_TIME_FAILED: 'DOOR_UNLOCK_TIME_FAILED',
    DOOR_DISABLE_FAILED: 'DOOR_DISABLE_FAILED',
    DOOR_ENABLE_FAILED: 'DOOR_ENABLE_FAILED',

    // Control context errors
    CREATE_CC_FAILED: 'CREATE_CC_FAILED',
};

// ============================================================================
// CLIENT
// ============================================================================

export class AritechClient {
    constructor(config) {
        this.config = config;
        this.socket = null;
        this.receiveBuffer = Buffer.alloc(0);
        this.pendingResolve = null;
        this.eventListeners = [];  // For COS events
        this.responseQueue = [];   // Queue for non-COS responses
        this._commandLock = Promise.resolve();

        this.initialKey = makeEncryptionKey(config.encryptionKey);
        this.serialBytes = null;  // Set after getDescription
        this.sessionKey = null;   // Set after key exchange

        // Panel model info (set after getDescription)
        this.panelModel = null;   // e.g., "ATS1500"
        this.panelName = null;    // e.g., "Paneel"
        this.firmwareVersion = null;
        this.protocolVersion = null;  // Calculated from firmware version
        this.encryptionMode = null;   // 1=AES-128, 2=AES-256, 5=PBKDF2+AES-256

        // Monitoring mode state
        this.monitoringActive = false;
        this.lastAreaStates = {};
        this.lastZoneStates = {};
        this.processingCOS = false;  // Prevent concurrent COS handling

        // Cached valid area numbers (populated by getValidAreaNumbers or area stat queries)
        this.validAreaNumbers = null;

        // Cached configured trigger numbers. x000 panels expose generated names
        // for every trigger slot, so this is inferred from non-generated names.
        this.validTriggerNumbers = null;

        // Zone to areas mapping: { zoneNum: [areaNum, ...] }
        // Populated by getValidZoneNumbers when querying per-area
        this.zoneAreas = {};

        // Keep-alive interval (started after login, stopped on disconnect)
        this.keepAliveInterval = null;
    }

    /**
     * Get the maximum number of areas for this panel model.
     * @returns {number} Maximum area count
     */
    getMaxAreaCount() {
        switch (this.panelModel) {
            case 'ATS1000':
            case 'ATS1500':
            case 'ATS1700':
                return 4;
            case 'ATS2000':
            case 'ATS3500':
            case 'ATS3700':
                return 8;
            case 'ATS4500':
            case 'ATS4700':
                return 64;
            default:
                return 4; // Default fallback
        }
    }

    /**
     * Get the maximum number of zones for this panel model.
     * @returns {number} Maximum zone count
     */
    getMaxZoneCount() {
        switch (this.panelModel) {
            case 'ATS1000':
            case 'ATS2000':
                return 368;
            case 'ATS1500':
            case 'ATS1700':
                return 240;
            case 'ATS3500':
            case 'ATS3700':
                return 496;
            case 'ATS4500':
            case 'ATS4700':
                return 976;
            default:
                return 240; // Default fallback
        }
    }

    /**
     * Check if this is an x700 series panel.
     * x700 panels (ATS1700, ATS3700, ATS4700) use different message formats.
     * @returns {boolean} True if x700 panel
     */
    isX700Panel() {
        return this.panelModel && /ATS\d700/.test(this.panelModel);
    }

    /**
     * Check if this is an older x000 series panel.
     * x000 panels use legacy login/control/status messages in the mobile app logs.
     * @returns {boolean} True if x000 panel
     */
    isX000Panel() {
        // Detection is firmware-version based: x000 panels report MR_028.x → 28,
        // x500 firmware MR_4.x → 4011, x700 firmware similar. We deliberately
        // do NOT fall back to encryptionMode (x500 also uses AES-128 = mode 1)
        // or panelModel (ATS2000A is shared between x000 and x500 lineups).
        return typeof this.protocolVersion === 'number' && this.protocolVersion < 1000;
    }

    /**
     * Check if this panel uses PBKDF2 key derivation.
     * Encryption mode 5 uses PBKDF2 + AES-256 with 32-byte session keys.
     * Other modes (1, 2) use grayPack key derivation with 16-byte session keys.
     * @returns {boolean} True if PBKDF2 mode
     */
    usesPBKDF2() {
        return this.encryptionMode === 5;
    }

    _usesLegacyPinLogin() {
        return this.isX000Panel();
    }

    _usesLegacyControlSessionFormat() {
        return this.isX000Panel();
    }

    _supportsBatchStatusRequests() {
        return !this.isX000Panel();
    }

    _getCreateSessionMessageName(msgName) {
        const legacyName = `${msgName}Legacy`;
        if (this._usesLegacyControlSessionFormat() && messageTemplates[legacyName]) {
            return legacyName;
        }
        return msgName;
    }

    _isPanelError(err) {
        return err instanceof AritechError && err.code === ErrorCodes.PANEL_ERROR;
    }

    _isKnownAreaState(areaState) {
        const state = areaState?.state || areaState;
        return !!state && state.toString() !== 'Unknown';
    }

    _getNumberedNamePrefix(entity) {
        const match = entity?.name?.match(/^(.+?)\s+(\d+)$/);
        if (!match || Number(match[2]) !== Number(entity.number)) {
            return null;
        }

        const prefix = match[1].trim().toLowerCase();
        return prefix || null;
    }

    _getDominantNumberedNamePrefix(entities) {
        const prefixCounts = new Map();

        for (const entity of entities) {
            const prefix = this._getNumberedNamePrefix(entity);
            if (!prefix) continue;
            prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
        }

        let dominantPrefix = null;
        let dominantCount = 0;
        for (const [prefix, count] of prefixCounts.entries()) {
            if (count > dominantCount) {
                dominantPrefix = prefix;
                dominantCount = count;
            }
        }

        const minimumCount = Math.max(16, Math.ceil(entities.length * 0.75));
        return dominantCount >= minimumCount ? dominantPrefix : null;
    }

    _filterGeneratedX000TriggerNames(triggerNames) {
        const generatedPrefix = this._getDominantNumberedNamePrefix(triggerNames);
        if (!generatedPrefix) {
            return triggerNames;
        }

        const filtered = triggerNames.filter(trigger => this._getNumberedNamePrefix(trigger) !== generatedPrefix);
        debug(`x000 panel: filtered ${triggerNames.length - filtered.length} generated trigger placeholder names`);
        return filtered;
    }

    _toEntityNumbers(value, defaultMax = 0) {
        if (Array.isArray(value)) {
            return value
                .map(item => (typeof item === 'object' && item !== null) ? item.number : item)
                .map(Number)
                .filter(Number.isFinite);
        }
        return Array.from({ length: value ?? defaultMax }, (_, i) => i + 1);
    }

    /**
     * Connect to the panel via TCP socket.
     * @returns {Promise<void>} Resolves when connection is established
     * @throws {Error} If connection fails
     */
    async connect() {
        return new Promise((resolve, reject) => {
            debug(`Connecting to ${this.config.host}:${this.config.port}...`);

            this.socket = net.createConnection({
                host: this.config.host,
                port: this.config.port
            });

            this.socket.on('connect', () => {
                debug('Socket connected');
                resolve();
            });

            this.socket.on('data', (data) => this.handleData(data));
            this.socket.on('error', (err) => reject(err));
            this.socket.setTimeout(10000);
        });
    }

    /**
     * Disconnect from the panel gracefully.
     * Sends logout message before closing the socket.
     */
    async disconnect() {
        if (!this.socket) return;

        // Stop keep-alive first
        this._stopKeepAlive();

        try {
            // Send logout message if we have a session
            if (this.sessionKey) {
                debug('Sending logout...');
                const disconnectMsg = constructMessage('logout', {});
                await this.callEncrypted(disconnectMsg, this.sessionKey);
                this.sessionKey = null;
            }
        } catch (err) {
            debug(`Disconnect message failed: ${err.message}`);
        }

        // Close the socket
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        debug('Disconnected from panel');
    }

    /**
     * Handle incoming data from the socket.
     * Buffers data, extracts SLIP frames, and routes them to handlers.
     * @private
     * @param {Buffer} data - Raw data received from socket
     */
    handleData(data) {
        this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);
        while (true) {
            const startIdx = this.receiveBuffer.indexOf(SLIP_END);
            if (startIdx === -1) break;
            const endIdx = this.receiveBuffer.indexOf(SLIP_END, startIdx + 1);
            if (endIdx === -1) break;
            const frame = this.receiveBuffer.slice(startIdx, endIdx + 1);
            this.receiveBuffer = this.receiveBuffer.slice(endIdx + 1);

            // Debug: log all incoming frames in monitor mode
            if (this.monitoringActive && frame.length > 10) {
                const decoded = slipDecode(frame);
                if (decoded && decoded.length > 8) {
                    const nonce = decoded.slice(0, 8);
                    debug(`[RECV] Frame ${decoded.length} bytes, nonce: ${nonce.toString('hex').substring(0, 8)}...`);
                }
            }

            // Check if this is an unsolicited message (COS or other panel notification)
            // Unsolicited messages have header 0xC0 - don't treat them as responses
            const isUnsolicited = this.checkForUnsolicitedMessage(frame);

            if (isUnsolicited) {
                // Unsolicited message handled (or logged), don't queue it as a response
                continue;
            }

            // Queue the response
            this.responseQueue.push(frame);

            // Deliver to pending resolver if waiting
            if (this.pendingResolve) {
                const resolve = this.pendingResolve;
                this.pendingResolve = null;
                const responseFrame = this.responseQueue.shift();
                resolve(responseFrame);
            }
        }
    }

    /**
     * Check if a received frame is an unsolicited message from the panel.
     * Unsolicited messages have header 0xC0 (request from panel to client).
     * If it's a COS event, notifies all registered event listeners.
     * If it's another unsolicited message type, logs a warning.
     * @private
     * @param {Buffer} frame - SLIP-encoded frame to check
     * @returns {boolean} True if frame was an unsolicited message (not a response)
     */
    checkForUnsolicitedMessage(frame) {
        if (!this.sessionKey) return false;

        try {
            const decrypted = decryptMessage(frame, this.sessionKey, this.serialBytes);
            if (!decrypted || decrypted.length < 2) {
                return false;
            }

            // Check if this is an unsolicited message (header 0xC0 = request from panel)
            // Responses have header 0xA0, errors have 0xF0
            if (decrypted[0] !== HEADER.REQUEST) {
                return false; // This is a response (0xA0) or error (0xF0), not unsolicited
            }

            // This is an unsolicited message from the panel (header 0xC0)
            // Check if it's a COS message (0xCA prefix = COS message type)
            if (decrypted.length >= 3 && decrypted[1] === 0xCA) {
                const cosType = decrypted[2];
                const payload = decrypted.slice(3);
                const statusByte = payload.length >= 3 ? payload[2] : null;

                debug(`\n━━━ COS Event Received ━━━`);
                debug(`Time: ${new Date().toISOString()}`);
                debug(`COS type: 0x${cosType.toString(16).padStart(2, '0')}`);
                debug(`Status byte: 0x${statusByte ? statusByte.toString(16).padStart(2, '0') : '??'}`);
                debug(`Full payload: ${payload.toString('hex')}`);

                // Notify listeners (async handling with concurrency protection)
                this.eventListeners.forEach(listener => {
                    // Run listener async to not block receiving more frames
                    setImmediate(async () => {
                        if (this.processingCOS) {
                            debug('⚠️  COS handler already running, skipping duplicate');
                            return;
                        }

                        try {
                            this.processingCOS = true;
                            await listener(statusByte, payload);
                        } catch (err) {
                            console.error('Error in event listener:', err);
                        } finally {
                            this.processingCOS = false;
                        }
                    });
                });

                return true; // This was an unsolicited COS event
            }

            // Unsolicited message but not a COS - log it
            const msgIdByte = decrypted[1];
            console.warn(`Received unsolicited message from panel (no handler): msgId=0x${msgIdByte.toString(16).padStart(2, '0')}, data=${decrypted.toString('hex')}`);
            return true; // Still unsolicited, don't treat as response

        } catch (err) {
            // Decryption failed - might be using wrong key or corrupted frame
            // Don't treat as unsolicited
        }

        return false;
    }

    /**
     * Register a callback for Change of State (COS) events.
     * @param {Function} callback - Async function(statusByte, payload) called on COS events
     */
    onCOSEvent(callback) {
        this.eventListeners.push(callback);
    }

    /**
     * Serialize command traffic to avoid interleaved writes/responses.
     * @private
     */
    async _withCommandLock(fn) {
        const previous = this._commandLock;
        let release;
        this._commandLock = new Promise((resolve) => { release = resolve; });
        await previous.catch(() => undefined);
        try {
            return await fn();
        } finally {
            release();
        }
    }

    /**
     * Create a response waiter before sending a request.
     * @private
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<Buffer>} Received frame
     * @throws {Error} If timeout expires
     */
    _createResponseWaiter(timeout = 5000) {
        if (this.pendingResolve) {
            throw new Error('Response already pending');
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingResolve = null;
                reject(new Error('Receive timeout'));
            }, timeout);
            this.pendingResolve = (frame) => {
                clearTimeout(timer);
                resolve(frame);
            };

            if (this.responseQueue.length > 0 && this.pendingResolve) {
                const responseFrame = this.responseQueue.shift();
                const pending = this.pendingResolve;
                this.pendingResolve = null;
                pending(responseFrame);
            }
        });
    }

    /**
     * Send an encrypted message without waiting for response.
     * @private
     * @param {Buffer} payload - Message payload to send
     * @param {Buffer} key - Encryption key (16 bytes)
     */
    _sendEncryptedUnlocked(payload, key) {
        const frame = slipEncode(encryptMessage(payload, key, this.serialBytes));
        debug(`SEND (${frame.length} bytes): ${frame.toString('hex')}`);
        this.socket.write(frame);
    }

    /**
     * Send an encrypted message without waiting for response.
     * @private
     * @param {Buffer} payload - Message payload to send
     * @param {Buffer} key - Encryption key (16 bytes)
     */
    sendEncrypted(payload, key) {
        return this._withCommandLock(async () => {
            this._sendEncryptedUnlocked(payload, key);
        });
    }

    /**
     * Send an encrypted message and wait for response.
     * @private
     * @param {Buffer} payload - Message payload to send
     * @param {Buffer} key - Encryption key (16 bytes)
     * @param {Object} options - Options
     * @param {boolean} [options.throwOnError=true] - Throw on panel error response
     * @returns {Promise<Buffer>} Decrypted response payload
     * @throws {AritechError} If panel returns error and throwOnError is true
     */
    async callEncrypted(payload, key, { throwOnError = true } = {}) {
        return this._withCommandLock(async () => {
            const responsePromise = this._createResponseWaiter();
            this._sendEncryptedUnlocked(payload, key);
            const response = await responsePromise;
            debug(`RECV (${response.length} bytes): ${response.toString('hex')}`);
            const decrypted = decryptMessage(response, key, this.serialBytes);
            debug(`Decrypted response: ${decrypted.toString('hex')}`);
            if (throwOnError) {
                try {
                    checkResponseError(decrypted);
                } catch (err) {
                    // Convert plain Error from checkResponseError to AritechError
                    const errorCode = decrypted.length > 1 ? decrypted.slice(1).toString('hex') : 'unknown';
                    throw new AritechError(err.message, {
                        code: ErrorCodes.PANEL_ERROR,
                        panelError: errorCode,
                        details: { response: decrypted.toString('hex') }
                    });
                }
            }
            return decrypted;
        });
    }

    /**
     * Send a plain (unencrypted) message. Used before key exchange.
     * @private
     * @param {Buffer} payload - Message payload to send
     */
    _sendPlainUnlocked(payload) {
        const frame = slipEncode(appendCrc(payload));
        debug(`SEND (${frame.length} bytes): ${frame.toString('hex')}`);
        this.socket.write(frame);
    }

    /**
     * Send a plain (unencrypted) message and wait for response.
     * Used before key exchange (e.g., getDescription).
     * @private
     * @param {Buffer} payload - Message payload to send
     * @param {Object} options - Options
     * @param {boolean} [options.throwOnError=true] - Throw on panel error response
     * @returns {Promise<Buffer>} Response payload (CRC stripped)
     * @throws {AritechError} If CRC invalid or panel returns error
     */
    async callPlain(payload, { throwOnError = true } = {}) {
        return this._withCommandLock(async () => {
            const responsePromise = this._createResponseWaiter();
            this._sendPlainUnlocked(payload);
            const response = await responsePromise;
            debug(`RECV (${response.length} bytes): ${response.toString('hex')}`);
            const decoded = slipDecode(response);
            if (!verifyCrc(decoded)) {
                throw new AritechError('Invalid CRC in plain response', {
                    code: ErrorCodes.CRC_ERROR,
                    details: { response: response.toString('hex') }
                });
            }
            const result = decoded.slice(0, -2);  // Strip CRC
            if (throwOnError) {
                try {
                    checkResponseError(result);
                } catch (err) {
                    // Convert plain Error from checkResponseError to AritechError
                    const errorCode = result.length > 1 ? result.slice(1).toString('hex') : 'unknown';
                    throw new AritechError(err.message, {
                        code: ErrorCodes.PANEL_ERROR,
                        panelError: errorCode,
                        details: { response: result.toString('hex') }
                    });
                }
            }
            return result;
        });
    }



    // ============================================================================
    // PROTOCOL MESSAGES
    // ============================================================================

    /**
     * Get panel description including model, firmware, and serial number.
     * This is called before encryption is enabled.
     * @returns {Promise<Object>} Panel description object
     */
    async getDescription() {
        debug('\n=== Getting Panel Description ===');

        // Unencrypted: getDeviceInfo message
        const message = constructMessage('getDeviceInfo', {});
        const payload = await this.callPlain(message);
        // Note: callPlain already strips CRC, so payload is ready to use

        // Parse panel description using DRV byte offsets from deviceDescription template
        try {
            // Panel name
            this.panelName = getProperty('deviceDescription', payload, 'deviceName');

            // Product name - contains model like "ATS1500AIP"
            const productName = getProperty('deviceDescription', payload, 'productName');
            const modelMatch = productName.match(/ATS\d+/);
            if (modelMatch) {
                this.panelModel = modelMatch[0];
            }

            // Firmware version
            this.firmwareVersion = getProperty('deviceDescription', payload, 'firmwareVersion');
            if (this.firmwareVersion) {
                this.protocolVersion = calculateProtocolVersion(this.firmwareVersion);
            }

            // Serial number
            const serial = getProperty('deviceDescription', payload, 'serialNumber');
            const cleanSerial = serial ? serial.replace(/\0/g, '').trim() : '';
            if (cleanSerial.match(/^[A-Za-z0-9_+-]{16}$/)) {
                this.config.serial = cleanSerial;
                this.serialBytes = decodeSerial(cleanSerial);
            } else if (cleanSerial.match(/^[0-9A-Fa-f]{12}$/)) {
                this.config.serial = cleanSerial.toUpperCase();
                this.serialBytes = Buffer.from(cleanSerial, 'hex');
            }

            // Encryption mode - byte 79 from start of response (callPlain returns full response without CRC)
            // Mode 1/2: grayPack + AES-128/192/256 with 16-byte session key
            // Mode 5: PBKDF2 + AES-256 with 32-byte session key
            this.encryptionMode = payload[79];

            debug(`Panel: ${this.panelName || 'unknown'}`);
            debug(`Model: ${this.panelModel || 'unknown'} (${this.getMaxAreaCount()} areas, ${this.getMaxZoneCount()} zones max)`);
            debug(`Firmware: ${this.firmwareVersion || 'unknown'}`);
            debug(`Protocol: ${this.protocolVersion || 'unknown'}`);
            debug(`Encryption mode: ${this.encryptionMode}`);
        } catch (e) {
            debug('Could not parse panel description fields:', e.message);
        }

        // Derive encryption key from serial if available
        if (this.serialBytes) {
            debug(`Serial: ${this.config.serial}`);
            debug(`Serial bytes: ${this.serialBytes.toString('hex')}`);
        }

        // Encryption mode 5 uses PBKDF2 key derivation with AES-256
        // Other modes (1, 2) use grayPack with AES-128/192/256
        if (this.usesPBKDF2()) {
            debug(`Encryption mode ${this.encryptionMode} - using PBKDF2 key derivation (AES-256)`);
            this.initialKey = makeEncryptionKeyPBKDF2(this.config.encryptionKey);
            debug(`New initial key (32 bytes): ${this.initialKey.toString('hex')}`);
        }

        return {
            rawHex: payload.toString('hex'),
            panelName: this.panelName,
            panelModel: this.panelModel,
            serial: this.config.serial,
            firmwareVersion: this.firmwareVersion,
            protocolVersion: this.protocolVersion
        };
    }

    /**
     * Perform key exchange to establish session key.
     * Called after getDescription, before login.
     * @returns {Promise<void>}
     * @throws {Error} If key exchange fails
     */
    async changeSessionKey() {
        debug('\n=== Key Exchange ===');
        debug(`Initial key: ${this.initialKey.toString('hex')}`);

        // 1. Send createSession with client key contribution
        // PBKDF2 mode (5): 16-byte client key → 32-byte session key (AES-256)
        // Other modes: 8-byte client key + 8-byte padding → 16-byte session key (AES-128)
        const clientKeyBytes = this.usesPBKDF2() ? Buffer.alloc(16) : Buffer.alloc(8);
        const beginPayload = constructMessage('createSession', {
            typeId: 0x09,
            data: this.usesPBKDF2()
                ? clientKeyBytes  // PBKDF2: full 16 bytes
                : Buffer.concat([clientKeyBytes, Buffer.alloc(8)])  // grayPack: 8-byte key + 8-byte padding
        });

        debug('\n1. Sending createSession...');
        const beginResponse = await this.callEncrypted(beginPayload, this.initialKey);

        if (!beginResponse) {
            throw new Error('Failed to decrypt createSession response');
        }

        // 2. Extract panel's key contribution and build session key
        // Response format: [0xA0 header][0x00 0x09 msgId + data][panel key bytes]
        if (this.usesPBKDF2()) {
            // PBKDF2 mode: extract 16-byte panel key, build 32-byte session key
            const panelKeyBytes = beginResponse.slice(3, 19);
            debug(`Panel key bytes (16): ${panelKeyBytes.toString('hex')}`);
            this.sessionKey = Buffer.concat([clientKeyBytes, panelKeyBytes]);
            debug(`Session key (32 bytes): ${this.sessionKey.toString('hex')}`);
        } else {
            // grayPack mode: extract 8-byte panel key, build 16-byte session key
            const panelKeyBytes = beginResponse.slice(3, 11);
            debug(`Panel key bytes (8): ${panelKeyBytes.toString('hex')}`);
            this.sessionKey = Buffer.concat([clientKeyBytes, panelKeyBytes]);
            debug(`Session key (16 bytes): ${this.sessionKey.toString('hex')}`);
        }

        // 3. Send enableEncryptionKey (still with initial key!)
        const endPayload = constructMessage('enableEncryptionKey', {
            typeId: 0x00
        });

        debug('\n2. Sending enableEncryptionKey...');
        const endResponse = await this.callEncrypted(endPayload, this.initialKey);

        if (!endResponse) {
            throw new Error('Failed to decrypt enableEncryptionKey response');
        }

        debug('\n✓ Key exchange complete - session key now active');
    }

    /**
     * Login to the panel - auto-selects method based on config.
     * Uses loginWithAccount if username is configured, otherwise loginWithPin.
     * Starts keep-alive timer on success.
     * @param {number} loginType - Login type (from LOGIN_TYPE enum)
     * @returns {Promise<boolean>} True if login successful
     */
    async login(loginType) {
        if (this.config.username) {
            return this.loginWithAccount(loginType);
        }
        return this.loginWithPin(loginType);
    }

    /**
     * Login to the panel with configured PIN (x500 panels).
     * Starts keep-alive timer on success.
     * @param {number} loginType - Login type (from LOGIN_TYPE enum)
     * @returns {Promise<boolean>} True if login successful
     */
    async loginWithPin(loginType = LOGIN_TYPE.USER) {
        debug('\n=== Login (PIN) ===');
        debug(`PIN: ${this.config.pin}`);

        const msgName = this._usesLegacyPinLogin() ? 'loginWithPinLegacy' : 'loginWithPin';

        // Login message for PIN panels
        // Panel automatically sends COS events to all connected clients
        // userAction flags indicate requested permissions
        // connectionMethod: 3 = MobileApps (from ConnectionMethod enum)
        const loginProps = {
            canUpload: true,
            canDownload: false,
            canControl: true,
            canMonitor: true,
            canDiagnose: true,
            canReadLogs: true,
            pinCode: this.config.pin.toString()
        };

        if (!this._usesLegacyPinLogin()) {
            loginProps.connectionMethod = loginType;
        }

        const loginPayload = constructMessage(msgName, loginProps);

        const response = await this.callEncrypted(loginPayload, this.sessionKey);

        if (!response) {
            throw new Error('Failed to decrypt login response');
        }

        // Check response code
        // Success: a0 00 00 (header + msgId 0 + status 0)
        if (response[0] === HEADER.RESPONSE && response.length >= 3) {
            if (response[2] === 0x00) {
                debug('✓ Login successful!');

                try {
                    await this._getUserInfo();
                } catch (err) {
                    debug(`getUserInfo after PIN login failed: ${err.message}`);
                }

                this._startKeepAlive();
                return true;
            } else {
                debug(`Login failed with code: ${response[2]}`);
                return false;
            }
        }

        return false;
    }

    /**
     * Login to the panel with username/password (x700 panels).
     * Starts keep-alive timer on success.
     * @param {number} loginType - Login type (from LOGIN_TYPE enum)
     * @returns {Promise<boolean>} True if login successful
     */
    async loginWithAccount(loginType = LOGIN_TYPE.USER) {
        debug('\n=== Login (Account) ===');
        debug(`Username: ${this.config.username}`);

        // Login message for x700 panels
        // Uses username/password instead of PIN
        // connectionMethod: 3 = MobileApps (matches mobile app capture)
        // All permissions set to true except canDownload (matches mobile app for zone control)
        const loginPayload = constructMessage('loginWithAccount', {
            canUpload: true,
            canDownload: false,
            canControl: true,
            canMonitor: true,
            canDiagnose: true,
            canReadLogs: true,
            username: this.config.username,
            password: this.config.password || this.config.username,  // Default password to username if not set
            connectionMethod: loginType
        });

        const response = await this.callEncrypted(loginPayload, this.sessionKey);

        if (!response) {
            throw new Error('Failed to decrypt login response');
        }

        // Check response code
        // Success: a0 00 00 (header + msgId 0 + status 0)
        if (response[0] === HEADER.RESPONSE && response.length >= 3) {
            if (response[2] === 0x00) {
                debug('✓ Login successful!');

                // x700 panels require getUserInfo call after login to activate session permissions
                await this._getUserInfo();

                this._startKeepAlive();
                return true;
            } else {
                debug(`Login failed with code: ${response[2]}`);
                return false;
            }
        }

        return false;
    }

    /**
     * Get user info from panel - required on x700 after login to activate permissions.
     * @private
     */
    async _getUserInfo() {
        debug('\n=== Getting User Info ===');
        const payload = constructMessage('getUserInfo', {});
        const response = await this.callEncrypted(payload, this.sessionKey);

        if (response && response[0] === HEADER.RESPONSE) {
            // Response contains user name at offset 6, 16 bytes
            if (response.length >= 22) {
                const userName = response.slice(6, 22).toString('latin1').replace(/\0+$/, '').trim();
                if (userName) {
                    debug(`Logged in as: ${userName}`);
                }
            }
            debug('✓ User session activated');
        }
    }

    /**
     * Start keep-alive timer to maintain the session.
     * Sends ping message every 30 seconds.
     * @private
     */
    _startKeepAlive() {
        if (this.keepAliveInterval) return; // Already running

        this.keepAliveInterval = setInterval(async () => {
            if (!this.sessionKey || !this.socket) return;

            try {
                const aliveMsg = constructMessage('ping', {});
                await this.callEncrypted(aliveMsg, this.sessionKey);
            } catch (err) {
                debug(`Keep-alive failed: ${err.message}`);
            }
        }, 30000); // Every 30 seconds
    }

    /**
     * Stop keep-alive timer.
     * @private
     */
    _stopKeepAlive() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
    }

    /**
     * Generic helper for fetching entity names from the panel.
     * Handles pagination in batches (16 for x500, 4 for x700).
     * @private
     * @param {string} msgName - Message name for the request (e.g., 'getAreaNames')
     * @param {string} responseName - Response message name (e.g., 'areaNames')
     * @param {Object} options - Configuration options
     * @param {number} [options.maxCount] - Maximum entity count (stops pagination)
     * @param {number[]} [options.validNumbers] - Only include these entity numbers
     * @param {string} options.entityName - Entity type name for logging
     * @returns {Promise<Array>} Array of {number, name} objects
     */
    async _getNames(msgName, responseName, { maxCount, validNumbers, entityName }) {
        debug(`\n=== Querying ${entityName} Names ===`);

        const results = [];

        // Use extended format parameters if applicable
        // x700 panels and x500 panels with protocol 4.4+ use "Ext" format for areas and zones (30-byte names, 4 per page)
        // Outputs and triggers use the standard format (16-byte names, 16 per page)
        const supportsExtendedNames = this.isX700Panel() || (this.protocolVersion && this.protocolVersion >= 4004);  // Protocol 4.4+
        const hasExtendedFormat = supportsExtendedNames && (msgName === 'getAreaNames' || msgName === 'getZoneNames');
        const nameLength = hasExtendedFormat ? EXTENDED_NAME_LENGTH : NAME_LENGTH;
        const namesPerPage = hasExtendedFormat ? EXTENDED_NAMES_PER_PAGE : NAMES_PER_PAGE;
        const actualMsgName = hasExtendedFormat ? msgName + 'Extended' : msgName;

        if (hasExtendedFormat) {
            debug(`Using extended format: ${actualMsgName}, ${nameLength}-byte names, ${namesPerPage} per page`);
        }

        // Determine which pages to request
        let pagesToRequest = [];
        if (validNumbers && validNumbers.length > 0) {
            // Only request pages containing valid numbers
            const pageSet = new Set();
            for (const num of validNumbers) {
                const pageStart = Math.floor((num - 1) / namesPerPage) * namesPerPage + 1;
                pageSet.add(pageStart);
            }
            pagesToRequest = Array.from(pageSet).sort((a, b) => a - b);
        } else if (maxCount) {
            // Request pages up to maxCount
            for (let i = 1; i <= maxCount; i += namesPerPage) {
                pagesToRequest.push(i);
            }
        } else {
            // Request pages until empty (output/trigger style)
            for (let i = 1; i <= 256; i += namesPerPage) {
                pagesToRequest.push(i);
            }
        }

        for (const startIndex of pagesToRequest) {
            const payload = constructMessage(actualMsgName, { index: startIndex });
            const response = await this.callEncrypted(payload, this.sessionKey);

            if (!response) {
                debug(`No response for ${entityName} page starting at ${startIndex}`);
                if (!maxCount && !validNumbers) break; // Stop pagination on no response
                continue;
            }

            if (response[0] === HEADER.RESPONSE && isMessageType(response, responseName, 1)) {
                let foundAny = false;

                for (let i = 0; i < namesPerPage; i++) {
                    const offset = NAMES_START_OFFSET + i * nameLength;
                    if (offset + nameLength > response.length) break;

                    const entityNum = startIndex + i;
                    if (maxCount && entityNum > maxCount) break;

                    const nameBytes = response.slice(offset, offset + nameLength);
                    const name = nameBytes.toString('latin1').replace(/\0+$/, '').trim();

                    if (name) {
                        // Filter by validNumbers if provided
                        if (!validNumbers || validNumbers.includes(entityNum)) {
                            results.push({ number: entityNum, name });
                            foundAny = true;
                        }
                    }
                }

                // Stop pagination if no entities found and not using validNumbers/maxCount
                if (!foundAny && !validNumbers && !maxCount) {
                    debug(`No ${entityName}s found starting at index ${startIndex}, stopping pagination`);
                    break;
                }

                debug(`Found ${results.length} ${entityName}s so far (page starting at ${startIndex})`);
            } else {
                debug(`Unexpected response format for ${entityName} page at ${startIndex}`);
                if (!maxCount && !validNumbers) break;
            }
        }

        debug(`Total ${entityName}s found: ${results.length}`);
        return results;
    }

    async _getEntityStatesBatch(entityType, entityNumbers, responseName, StateClass, resultKey) {
        const batchPayload = buildBatchStatRequest(entityType, entityNumbers);

        debug(`Batch requesting ${entityNumbers.length} ${resultKey} states`);
        debug(`Batch request (${batchPayload.length} bytes): ${batchPayload.toString('hex')}`);

        const response = await this.callEncrypted(batchPayload, this.sessionKey);

        if (!response || response.length < 4) {
            debug(`No valid batch response for ${resultKey} states`);
            return [];
        }

        const messages = splitBatchResponse(response, responseName);
        if (messages.length === 0) {
            debug(`No ${resultKey} messages parsed from batch response`);
            return [];
        }

        const states = [];
        for (const msg of messages) {
            states.push({
                [resultKey]: msg.objectId,
                state: StateClass.fromBytes(msg.bytes),
                rawHex: msg.bytes.toString('hex')
            });
        }

        debug(`Batch received ${states.length} ${resultKey} states`);
        return states;
    }

    async _getEntityStatesIndividual(entityType, entityNumbers, responseName, StateClass, resultKey) {
        debug(`Using individual ${resultKey} state queries`);

        const states = [];
        for (const entityNum of entityNumbers) {
            const payload = Buffer.concat([
                Buffer.from([HEADER.REQUEST]),
                buildGetStatRequest(entityType, entityNum, false)
            ]);

            let response;
            try {
                response = await this.callEncrypted(payload, this.sessionKey);
            } catch (err) {
                if (this._isPanelError(err)) {
                    debug(`Panel rejected ${resultKey} ${entityNum} status: ${err.message}`);
                    continue;
                }
                throw err;
            }

            if (!response || response[0] !== HEADER.RESPONSE || !isMessageType(response, responseName, 1)) {
                debug(`Unexpected ${resultKey} ${entityNum} status response: ${response ? response.toString('hex') : 'none'}`);
                continue;
            }

            const msgBytes = response.slice(1);
            const objectId = msgBytes[3] || entityNum;
            states.push({
                [resultKey]: objectId,
                state: StateClass.fromBytes(msgBytes),
                rawHex: msgBytes.toString('hex')
            });
        }

        debug(`Individual queries received ${states.length} ${resultKey} states`);
        return states;
    }

    async _getEntityStatesWithFallback(entityType, entityNumbers, responseName, StateClass, resultKey) {
        if (entityNumbers.length === 0) {
            return [];
        }

        if (!this._supportsBatchStatusRequests()) {
            return this._getEntityStatesIndividual(entityType, entityNumbers, responseName, StateClass, resultKey);
        }

        try {
            const states = await this._getEntityStatesBatch(entityType, entityNumbers, responseName, StateClass, resultKey);
            if (states.length > 0) {
                return states;
            }
            debug(`Falling back to individual ${resultKey} status queries`);
        } catch (err) {
            if (!this._isPanelError(err)) {
                throw err;
            }
            debug(`Batch ${resultKey} status request rejected, falling back to individual queries: ${err.message}`);
        }

        return this._getEntityStatesIndividual(entityType, entityNumbers, responseName, StateClass, resultKey);
    }

    /**
     * Get area names from the panel.
     * @returns {Promise<Array>} Array of area objects with {number, name}
     */
    async getAreaNames() {
        let validNumbers = null;
        if (this.isX000Panel()) {
            validNumbers = await this.getValidAreaNumbers();
            if (!validNumbers || validNumbers.length === 0) {
                return [];
            }
        }

        return this._getNames('getAreaNames', 'areaNames', {
            maxCount: this.getMaxAreaCount(),
            validNumbers,
            entityName: 'Area'
        });
    }

    /**
     * Get area states using batch request (like mobile app)
     * Uses Message ID -166 (cb02) = getAreaStatus for area ready/armed status
     *
     * @param {number} maxAreas - Maximum number of areas to query (default: 4)
     * @returns {Promise<Array>} Array of area state objects
     */
    async getAreaStates(areasOrMax = 4) {
        debug('\n=== Querying Area States ===');

        // Accept either:
        // - A number (max areas to query, 1 to N)
        // - An array of area numbers [1, 2, 3]
        // - An array of area objects [{number: 1, name: "..."}, ...]
        const areaNumbers = this._toEntityNumbers(areasOrMax);
        const areaStates = await this._getEntityStatesWithFallback('AREA', areaNumbers, 'areaStatus', AreaState, 'area');

        if (this.isX000Panel()) {
            return areaStates.filter(areaState => this._isKnownAreaState(areaState));
        }

        return areaStates;
    }

    /**
     * Get the list of valid/configured area numbers from the panel.
     * Uses cached value if available.
     * x700 panels don't support getValidAreas - use all areas 1-N based on panel model.
     */
    async getValidAreaNumbers() {
        // Return cached value if available
        if (this.validAreaNumbers) {
            debug(`Using cached valid areas: ${this.validAreaNumbers.join(', ')}`);
            return this.validAreaNumbers;
        }

        debug('\n=== Querying Valid Area Numbers ===');

        // x000 panels return a broad valid-area bitmap. Probe status instead and
        // keep only areas that respond with a meaningful state.
        if (this.isX000Panel()) {
            const areaNumbers = Array.from({ length: this.getMaxAreaCount() }, (_, i) => i + 1);
            const areaStates = await this._getEntityStatesIndividual('AREA', areaNumbers, 'areaStatus', AreaState, 'area');
            const validAreas = areaStates
                .filter(areaState => this._isKnownAreaState(areaState))
                .map(areaState => areaState.area);

            debug(`x000 panel: found ${validAreas.length} valid areas by status: ${validAreas.join(', ')}`);
            this.validAreaNumbers = validAreas;
            return validAreas;
        }

        // x700 panels don't support getValidAreas command - use all areas based on model
        if (this.isX700Panel()) {
            const maxAreas = this.getMaxAreaCount();
            const validAreas = Array.from({ length: maxAreas }, (_, i) => i + 1);
            debug(`x700 panel: using all ${maxAreas} areas: ${validAreas.join(', ')}`);
            this.validAreaNumbers = validAreas;
            return validAreas;
        }

        const payload = constructMessage('getValidAreas', {});
        const response = await this.callEncrypted(payload, this.sessionKey);

        if (!response) {
            debug('No response for getValidAreas');
            return null;
        }

        // bitset: each bit = one area (bit 0 = area 1, etc.)
        if (response[0] === HEADER.RESPONSE && isMessageType(response, 'validAreas', 1)) {
            const bitsetStart = 3; // Skip a0 1b 02 (typeId)
            const bitset = response.slice(bitsetStart);
            const validAreas = [];

            for (let byteIdx = 0; byteIdx < bitset.length; byteIdx++) {
                for (let bit = 0; bit < 8; bit++) {
                    if (bitset[byteIdx] & (1 << bit)) {
                        const areaNum = byteIdx * 8 + bit + 1;
                        validAreas.push(areaNum);
                    }
                }
            }

            debug(`Found ${validAreas.length} valid areas: ${validAreas.join(', ')}`);
            this.validAreaNumbers = validAreas;
            return validAreas;
        }

        debug(`Unexpected response format: ${response.toString('hex')}`);
        return null;
    }

    /**
     * Get the list of valid/configured zone numbers from the panel.
     * Queries each valid area via batch to build zone-to-areas mapping.
     */
    async getValidZoneNumbers() {
        debug('\n=== Querying Valid Zone Numbers ===');

        // Get valid areas (from cache or query)
        let validAreas = await this.getValidAreaNumbers();
        if (!validAreas || validAreas.length === 0) {
            debug('No valid areas found');
            return null;
        }

        if (this.isX000Panel()) {
            return this._getValidZoneNumbersLegacy(validAreas);
        }

        // Build batch request - one getZonesAssignedToAreas per area
        // Separator byte is the length of each embedded message (0x0c for 12-byte messages)
        const requests = [];
        for (let i = 0; i < validAreas.length; i++) {
            const areaNum = validAreas[i];
            const msg = buildGetValidZonesMessage([areaNum]);
            // Strip header for batch
            const withoutHeader = msg.slice(1);
            // Separator is the message length (0x0c = 12 bytes for getZonesAssignedToAreas)
            const separator = withoutHeader.length;
            // Add separator between requests (not after last one)
            if (i < validAreas.length - 1) {
                requests.push(Buffer.concat([withoutHeader, Buffer.from([separator])]));
            } else {
                requests.push(withoutHeader);
            }
        }

        // Send batch request
        // First byte after msgId is the length of each embedded message (0x0c = 12 for ZonesAssignedToAreas)
        const batchMsg = constructMessage('batch', {});
        const lengthByte = Buffer.from([0x0c]); // getZonesAssignedToAreas messages are 12 bytes
        const payload = Buffer.concat([batchMsg, lengthByte, ...requests]);
        debug(`Zone batch payload (${payload.length} bytes): ${payload.toString('hex')}`);
        let response;
        try {
            response = await this.callEncrypted(payload, this.sessionKey);
        } catch (err) {
            if (this._isPanelError(err)) {
                debug(`Zone batch request rejected, falling back to individual queries: ${err.message}`);
                return this._getValidZoneNumbersIndividual(validAreas);
            }
            throw err;
        }

        if (!response || response.length < 4) {
            debug('No valid batch response for zones');
            return null;
        }

        // Response format: a0 [ee ee 20] [response1] [20] [response2] [20] ... [responseN]
        // 0x20 is the msgId for zonesAssignedToAreas - error responses already throw
        if (response[1] !== 0xEE || response[2] !== 0xEE || response[3] !== 0x20) {
            debug(`Unexpected response format: ${response.slice(0, 4).toString('hex')}, falling back to individual queries`);
            return this._getValidZoneNumbersIndividual(validAreas);
        }

        // Reset zone-to-areas mapping
        this.zoneAreas = {};
        const validZonesSet = new Set();

        // Each zone response is 32 bytes: 20 0a [30 bytes bitset]
        // Plus 0x20 separator between responses (not after last)
        const ZONE_RESPONSE_LEN = 32;
        let offset = 4; // Skip a0 ee ee 20 header

        for (let i = 0; i < validAreas.length; i++) {
            const areaNum = validAreas[i];
            const isLast = (i === validAreas.length - 1);
            const responseLen = isLast ? ZONE_RESPONSE_LEN : ZONE_RESPONSE_LEN + 1; // +1 for 0x20 separator

            if (offset + ZONE_RESPONSE_LEN > response.length) {
                debug(`Not enough data at offset ${offset} for area ${areaNum}`);
                break;
            }

            const zoneResponse = response.slice(offset, offset + ZONE_RESPONSE_LEN);
            offset += responseLen;

            // Parse: 20 0a [bitset...]
            if (zoneResponse[0] !== 0x20) {
                debug(`Unexpected zone response format for area ${areaNum}: ${zoneResponse.slice(0, 4).toString('hex')}`);
                continue;
            }

            const bitsetStart = 2; // Skip 20 0a
            const bitset = zoneResponse.slice(bitsetStart);

            for (let byteIdx = 0; byteIdx < bitset.length; byteIdx++) {
                for (let bit = 0; bit < 8; bit++) {
                    if (bitset[byteIdx] & (1 << bit)) {
                        const zoneNum = byteIdx * 8 + bit + 1;
                        validZonesSet.add(zoneNum);

                        // Add this area to zone's area list
                        if (!this.zoneAreas[zoneNum]) {
                            this.zoneAreas[zoneNum] = [];
                        }
                        this.zoneAreas[zoneNum].push(areaNum);
                    }
                }
            }
        }

        const validZones = Array.from(validZonesSet).sort((a, b) => a - b);
        debug(`Found ${validZones.length} valid zones: ${validZones.join(', ')}`);
        debug(`Zone-to-areas mapping: ${JSON.stringify(this.zoneAreas)}`);
        return validZones;
    }

    /**
     * x000 panels use c8 00 to ask for the zone bitmap of one area at a time.
     * @private
     */
    async _getValidZoneNumbersLegacy(validAreas) {
        debug('Using legacy x000 zone assignment queries');

        this.zoneAreas = {};
        const validZonesSet = new Set();

        for (const areaNum of validAreas) {
            const payload = constructMessage('getZonesAssignedToAreaLegacy', { objectId: areaNum });
            let response;

            try {
                response = await this.callEncrypted(payload, this.sessionKey);
            } catch (err) {
                if (this._isPanelError(err)) {
                    debug(`Panel rejected legacy zone assignment for area ${areaNum}: ${err.message}`);
                    continue;
                }
                throw err;
            }

            if (!response || response[0] !== HEADER.RESPONSE || response[1] !== 0x20 || response[2] !== 0x02) {
                debug(`Unexpected legacy zone assignment response for area ${areaNum}: ${response ? response.toString('hex') : 'none'}`);
                continue;
            }

            const responseArea = response[4] || areaNum;
            const bitset = response.slice(5);
            for (let byteIdx = 0; byteIdx < bitset.length; byteIdx++) {
                for (let bit = 0; bit < 8; bit++) {
                    if (bitset[byteIdx] & (1 << bit)) {
                        const zoneNum = byteIdx * 8 + bit + 1;
                        validZonesSet.add(zoneNum);

                        if (!this.zoneAreas[zoneNum]) {
                            this.zoneAreas[zoneNum] = [];
                        }
                        this.zoneAreas[zoneNum].push(responseArea);
                    }
                }
            }
        }

        const validZones = Array.from(validZonesSet).sort((a, b) => a - b);
        debug(`Found ${validZones.length} valid zones: ${validZones.join(', ')}`);
        debug(`Zone-to-areas mapping: ${JSON.stringify(this.zoneAreas)}`);
        return validZones;
    }

    /**
     * Fallback: query zones for each area individually (slower but more compatible)
     * @private
     */
    async _getValidZoneNumbersIndividual(validAreas) {
        debug('Using individual zone queries (fallback)');

        this.zoneAreas = {};
        const validZonesSet = new Set();

        for (const areaNum of validAreas) {
            const payload = buildGetValidZonesMessage([areaNum]);
            let response;
            try {
                response = await this.callEncrypted(payload, this.sessionKey);
            } catch (err) {
                if (this._isPanelError(err)) {
                    debug(`Panel rejected zone assignment for area ${areaNum}: ${err.message}`);
                    continue;
                }
                throw err;
            }

            if (!response) {
                debug(`No response for area ${areaNum}`);
                continue;
            }

            if (response[0] === HEADER.RESPONSE && isMessageType(response, 'zonesAssignedToAreas', 1)) {
                const bitsetStart = 3; // Skip a0 20 0a
                const bitset = response.slice(bitsetStart);

                for (let byteIdx = 0; byteIdx < bitset.length; byteIdx++) {
                    for (let bit = 0; bit < 8; bit++) {
                        if (bitset[byteIdx] & (1 << bit)) {
                            const zoneNum = byteIdx * 8 + bit + 1;
                            validZonesSet.add(zoneNum);

                            if (!this.zoneAreas[zoneNum]) {
                                this.zoneAreas[zoneNum] = [];
                            }
                            this.zoneAreas[zoneNum].push(areaNum);
                        }
                    }
                }
            }
        }

        const validZones = Array.from(validZonesSet).sort((a, b) => a - b);
        debug(`Found ${validZones.length} valid zones: ${validZones.join(', ')}`);
        debug(`Zone-to-areas mapping: ${JSON.stringify(this.zoneAreas)}`);
        return validZones;
    }

    /**
     * Get the areas a zone belongs to.
     * Returns array of area numbers, or null if unknown.
     */
    getZoneAreas(zoneNum) {
        return this.zoneAreas[zoneNum] || null;
    }

    /**
     * Get zone names from the panel.
     * @returns {Promise<Array>} Array of zone objects with {number, name}
     */
    async getZoneNames() {
        // First, get the list of valid zones from the panel
        const validZoneNumbers = await this.getValidZoneNumbers();

        return this._getNames('getZoneNames', 'zoneNames', {
            validNumbers: validZoneNumbers,
            entityName: 'Zone'
        });
    }

    /**
     * Get zone states using batch request (much faster than individual queries)
     * Uses batch (Message ID 921557047) to batch multiple getZoneStatus requests
     *
     * @param {Array|number} zonesOrMax - Array of zone objects with .number or max zone count
     * @returns {Promise<Array>} Array of zone state objects
     */
    async getZoneStates(zonesOrMax = 24) {
        debug('\n=== Querying Zone States ===');

        const zoneNumbers = this._toEntityNumbers(zonesOrMax);
        return this._getEntityStatesWithFallback('ZONE', zoneNumbers, 'zoneStatus', ZoneState, 'zone');
    }

    /**
     * Get zone states individually (fallback when batch fails)
     * @private
     */
    async getZoneStatesIndividual(zoneNumbers) {
        return this._getEntityStatesIndividual('ZONE', this._toEntityNumbers(zoneNumbers), 'zoneStatus', ZoneState, 'zone');
    }

    /**
     * Build area props object for createZoneControlSession based on zone's assigned areas.
     * @private
     */
    async _getZoneAreaProps(zoneNum) {
        // If zone-to-areas mapping is empty, populate it first
        if (Object.keys(this.zoneAreas).length === 0) {
            debug(`  Zone-to-areas mapping empty, querying...`);
            await this.getValidZoneNumbers();
        }

        const areas = this.getZoneAreas(zoneNum);
        if (areas && areas.length > 0) {
            const props = {};
            for (const areaNum of areas) {
                props[`area.${areaNum}`] = true;
            }
            debug(`  Zone ${zoneNum} is in areas: ${areas.join(', ')}`);
            return props;
        }
        // Fallback to all valid areas if zone mapping unknown
        if (this.validAreaNumbers && this.validAreaNumbers.length > 0) {
            const props = {};
            for (const areaNum of this.validAreaNumbers) {
                props[`area.${areaNum}`] = true;
            }
            debug(`  Zone ${zoneNum} area unknown, using all valid areas: ${this.validAreaNumbers.join(', ')}`);
            return props;
        }
        // Last resort fallback
        debug(`  Zone ${zoneNum} area unknown, falling back to area 1`);
        return { 'area.1': true };
    }

    /**
     * Execute an action within a control session context.
     * Creates the session, runs the action, and ensures cleanup.
     * @private
     * @param {string} createMsgName - Message name to create the control session
     * @param {Object} createProps - Properties for the create session message
     * @param {Function} actionFn - Async function(sessionId) to execute within the session
     * @param {string} entityType - Entity type for error messages (e.g., 'zone', 'output')
     * @param {number|string} entityId - Entity ID for error messages
     */
    async _withControlSession(createMsgName, createProps, actionFn, entityType, entityId) {
        const actualCreateMsgName = this._getCreateSessionMessageName(createMsgName);
        debug(`  Creating ${actualCreateMsgName}...`);
        const createPayload = constructMessage(actualCreateMsgName, createProps);
        const response = await this.callEncrypted(createPayload, this.sessionKey);

        const ccResponse = parseCreateCCResponse(response);
        if (!ccResponse) {
            throw new AritechError(`Failed to create control context for ${entityType} ${entityId}`, {
                code: ErrorCodes.CREATE_CC_FAILED,
                details: { [entityType]: entityId, response: response ? response.toString('hex') : null }
            });
        }

        const { sessionId } = ccResponse;
        debug(`  ✓ ${actualCreateMsgName} succeeded, sessionId: 0x${sessionId.toString(16)}`);

        try {
            await actionFn(sessionId);
        } finally {
            debug(`  Cleanup control context...`);
            await this.callEncrypted(constructMessage('destroyControlSession', { sessionId }), this.sessionKey);
            debug(`  ✓ Cleanup complete`);
        }
    }

    /**
     * Inhibit a zone.
     * @param {number} zoneNum - Zone number to inhibit
     * @throws {AritechError} If inhibiting fails
     */
    async inhibitZone(zoneNum) {
        debug(`\n=== Inhibiting Zone ${zoneNum} ===`);
        const areaProps = await this._getZoneAreaProps(zoneNum);

        await this._withControlSession('createZoneControlSession', areaProps, async (sessionId) => {
            debug(`  Calling inhibitZone...`);
            const payload = constructMessage('inhibitZone', { sessionId, objectId: zoneNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            if (parseReturnBool(response) !== true) {
                throw new AritechError(`Failed to inhibit zone ${zoneNum}`, {
                    code: ErrorCodes.ZONE_INHIBIT_FAILED,
                    details: { zoneNum, response: response ? response.toString('hex') : null }
                });
            }
            debug(`  ✓ Zone ${zoneNum} inhibited successfully!`);
        }, 'zone', zoneNum);
    }

    /**
     * Uninhibit a zone.
     * @param {number} zoneNum - Zone number to uninhibit
     * @throws {AritechError} If uninhibiting fails
     */
    async uninhibitZone(zoneNum) {
        debug(`\n=== Uninhibiting Zone ${zoneNum} ===`);
        const areaProps = await this._getZoneAreaProps(zoneNum);

        await this._withControlSession('createZoneControlSession', areaProps, async (sessionId) => {
            debug(`  Calling uninhibitZone...`);
            const payload = constructMessage('uninhibitZone', { sessionId, objectId: zoneNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            if (parseReturnBool(response) !== true) {
                throw new AritechError(`Failed to uninhibit zone ${zoneNum}`, {
                    code: ErrorCodes.ZONE_UNINHIBIT_FAILED,
                    details: { zoneNum, response: response ? response.toString('hex') : null }
                });
            }
            debug(`  ✓ Zone ${zoneNum} uninhibited successfully!`);
        }, 'zone', zoneNum);
    }

    /**
     * Force activate an output (override to ON state).
     * This sets the output to active and marks it as overridden.
     * Use cancelForceOutput() to remove the override and return to normal state.
     * @param {number} outputNum - Output number to force activate
     * @throws {AritechError} If force activation fails
     */
    async forceActivateOutput(outputNum) {
        debug(`\n=== Force Activating Output ${outputNum} ===`);

        await this._withControlSession('createOutputControlSession', { 'area.1': true }, async (sessionId) => {
            debug(`  Calling forceActivateOutput...`);
            const payload = constructMessage('forceActivateOutput', { sessionId, objectId: outputNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            if (parseReturnBool(response) !== true) {
                throw new AritechError(`Failed to force activate output ${outputNum}`, {
                    code: ErrorCodes.OUTPUT_ACTIVATE_FAILED,
                    details: { outputNum, response: response ? response.toString('hex') : null }
                });
            }
            debug(`  ✓ Output ${outputNum} force activated successfully!`);
        }, 'output', outputNum);
    }

    /**
     * Force deactivate an output (override to OFF state).
     * This sets the output to inactive and marks it as overridden.
     * Use cancelForceOutput() to remove the override and return to normal state.
     * @param {number} outputNum - Output number to force deactivate
     * @throws {AritechError} If force deactivation fails
     */
    async forceDeactivateOutput(outputNum) {
        debug(`\n=== Force Deactivating Output ${outputNum} ===`);

        await this._withControlSession('createOutputControlSession', { 'area.1': true }, async (sessionId) => {
            debug(`  Calling forceDeactivateOutput...`);
            const payload = constructMessage('forceDeactivateOutput', { sessionId, objectId: outputNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            if (parseReturnBool(response) !== true) {
                throw new AritechError(`Failed to force deactivate output ${outputNum}`, {
                    code: ErrorCodes.OUTPUT_DEACTIVATE_FAILED,
                    details: { outputNum, response: response ? response.toString('hex') : null }
                });
            }
            debug(`  ✓ Output ${outputNum} force deactivated successfully!`);
        }, 'output', outputNum);
    }

    /**
     * Cancel force status on an output (remove override).
     * This removes the override flag and returns the output to its normal programmed state.
     * @param {number} outputNum - Output number to cancel force on
     * @throws {AritechError} If cancel force fails
     */
    async cancelForceOutput(outputNum) {
        debug(`\n=== Canceling Force on Output ${outputNum} ===`);

        await this._withControlSession('createOutputControlSession', { 'area.1': true }, async (sessionId) => {
            debug(`  Calling cancelForceOutput...`);
            const payload = constructMessage('cancelForceOutput', { sessionId, objectId: outputNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            if (parseReturnBool(response) !== true) {
                throw new AritechError(`Failed to cancel force on output ${outputNum}`, {
                    code: ErrorCodes.OUTPUT_CANCEL_FORCE_FAILED,
                    details: { outputNum, response: response ? response.toString('hex') : null }
                });
            }
            debug(`  ✓ Output ${outputNum} force canceled successfully!`);
        }, 'output', outputNum);
    }

    /**
     * Get output names from the panel.
     * @returns {Promise<Array>} Array of output objects with {number, name}
     */
    async getOutputNames() {
        return this._getNames('getOutputNames', 'outputNames', {
            entityName: 'Output'
        });
    }

    /**
     * Get trigger names from the panel.
     * @returns {Promise<Array>} Array of trigger objects with {number, name}
     */
    async getTriggerNames() {
        const triggerNames = await this._getNames('getTriggerNames', 'triggerNames', {
            entityName: 'Trigger'
        });

        if (!this.isX000Panel()) {
            return triggerNames;
        }

        const configuredTriggers = this._filterGeneratedX000TriggerNames(triggerNames);
        this.validTriggerNumbers = configuredTriggers.map(trigger => trigger.number);
        debug(`x000 panel: inferred ${configuredTriggers.length} configured triggers: ${this.validTriggerNumbers.join(', ') || 'none'}`);
        return configuredTriggers;
    }

    /**
     * Get configured trigger numbers.
     * @returns {Promise<number[]>} Array of trigger numbers
     */
    async getValidTriggerNumbers() {
        if (Array.isArray(this.validTriggerNumbers)) {
            return this.validTriggerNumbers;
        }

        const triggerNames = await this.getTriggerNames();
        return triggerNames.map(trigger => trigger.number);
    }

    /**
     * Get trigger states using batch request.
     * @param {Array|number} triggersOrMax - Array of trigger numbers/objects or max trigger count
     * @returns {Promise<Array>} Array of trigger state objects
     */
    async getTriggerStates(triggersOrMax = 8) {
        debug('\n=== Querying Trigger States ===');

        let triggerNumbers;
        if (this.isX000Panel() && !Array.isArray(triggersOrMax) && triggersOrMax > 16) {
            triggerNumbers = await this.getValidTriggerNumbers();
            debug(`x000 panel: limiting broad trigger status query to configured triggers: ${triggerNumbers.join(', ') || 'none'}`);
        } else {
            triggerNumbers = this._toEntityNumbers(triggersOrMax);
        }

        return this._getEntityStatesWithFallback('TRIGGER', triggerNumbers, 'triggerStatus', TriggerState, 'trigger');
    }

    /**
     * Activate a trigger.
     * @param {number} triggerNum - Trigger number to activate
     * @throws {AritechError} If activation fails
     */
    async activateTrigger(triggerNum) {
        debug(`\n=== Activating Trigger ${triggerNum} ===`);

        // Check current state first
        const states = await this.getTriggerStates([triggerNum]);
        if (states.length > 0 && states[0].state.isActive) {
            debug(`  Trigger ${triggerNum} is already active, skipping`);
            return { skipped: true, reason: 'already active' };
        }

        await this._withControlSession('createTriggerControlSession', {}, async (sessionId) => {
            debug(`  Calling activateTrigger...`);
            const payload = constructMessage('activateTrigger', { sessionId, objectId: triggerNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            if (parseReturnBool(response) !== true) {
                throw new AritechError(`Failed to activate trigger ${triggerNum}`, {
                    code: ErrorCodes.TRIGGER_ACTIVATE_FAILED,
                    details: { triggerNum, response: response ? response.toString('hex') : null }
                });
            }
            debug(`  ✓ Trigger ${triggerNum} activated!`);
        }, 'trigger', triggerNum);
        return { skipped: false };
    }

    /**
     * Deactivate a trigger.
     * @param {number} triggerNum - Trigger number to deactivate
     * @throws {AritechError} If deactivation fails
     */
    async deactivateTrigger(triggerNum) {
        debug(`\n=== Deactivating Trigger ${triggerNum} ===`);

        // Check current state first
        const states = await this.getTriggerStates([triggerNum]);
        if (states.length > 0 && !states[0].state.isActive) {
            debug(`  Trigger ${triggerNum} is already inactive, skipping`);
            return { skipped: true, reason: 'already inactive' };
        }

        await this._withControlSession('createTriggerControlSession', {}, async (sessionId) => {
            debug(`  Calling deactivateTrigger...`);
            const payload = constructMessage('deactivateTrigger', { sessionId, objectId: triggerNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            if (parseReturnBool(response) !== true) {
                throw new AritechError(`Failed to deactivate trigger ${triggerNum}`, {
                    code: ErrorCodes.TRIGGER_DEACTIVATE_FAILED,
                    details: { triggerNum, response: response ? response.toString('hex') : null }
                });
            }
            debug(`  ✓ Trigger ${triggerNum} deactivated!`);
        }, 'trigger', triggerNum);
        return { skipped: false };
    }

    // ========================================================================
    // DOOR METHODS
    // ========================================================================

    /**
     * Get door names from the panel.
     * @returns {Promise<Array>} Array of door objects with {number, name}
     */
    async getDoorNames() {
        return this._getNames('getDoorNames', 'doorNames', {
            entityName: 'Door'
        });
    }

    /**
     * Get the list of valid/configured door numbers from the panel.
     * @returns {Promise<Array>} Array of valid door numbers
     */
    async getValidDoorNumbers() {
        debug('\n=== Querying Valid Door Numbers ===');

        const payload = constructMessage('getValidDoors', {});
        const response = await this.callEncrypted(payload, this.sessionKey);

        if (!response || response.length < 4) {
            debug('No valid response for getValidDoors');
            return [];
        }

        // Parse bitmask response - doors are typically in bytes starting at offset 2
        const validDoors = [];
        for (let byteIdx = 2; byteIdx < response.length; byteIdx++) {
            const byte = response[byteIdx];
            for (let bit = 0; bit < 8; bit++) {
                if (byte & (1 << bit)) {
                    const doorNum = (byteIdx - 2) * 8 + bit + 1;
                    validDoors.push(doorNum);
                }
            }
        }

        debug(`Valid doors: ${validDoors.join(', ') || 'none'}`);
        return validDoors;
    }

    /**
     * Get door states using batch request.
     * @param {Array|number} doorsOrMax - Array of door numbers/objects or max door count
     * @returns {Promise<Array>} Array of door state objects
     */
    async getDoorStates(doorsOrMax = 8) {
        debug('\n=== Querying Door States ===');

        const doorNumbers = this._toEntityNumbers(doorsOrMax);
        return this._getEntityStatesWithFallback('DOOR', doorNumbers, 'doorStatus', DoorState, 'door');
    }

    /**
     * Lock a door.
     * @param {number} doorNum - Door number to lock
     * @throws {AritechError} If locking fails
     */
    async lockDoor(doorNum) {
        debug(`\n=== Locking Door ${doorNum} ===`);

        await this._withControlSession('createDoorControlSession', {}, async (sessionId) => {
            debug(`  Calling lockDoor...`);
            const payload = constructMessage('lockDoor', { sessionId, objectId: doorNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            // Door commands return a0000100 for success (boolean 0x00 = no error)
            // Error responses have 0xF0 header which checkResponseError will throw on
            checkResponseError(response);
            debug(`  ✓ Door ${doorNum} locked!`);
        }, 'door', doorNum);
    }

    /**
     * Unlock a door indefinitely.
     * @param {number} doorNum - Door number to unlock
     * @throws {AritechError} If unlocking fails
     */
    async unlockDoor(doorNum) {
        debug(`\n=== Unlocking Door ${doorNum} ===`);

        await this._withControlSession('createDoorControlSession', {}, async (sessionId) => {
            debug(`  Calling unlockDoor...`);
            const payload = constructMessage('unlockDoor', { sessionId, objectId: doorNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            // Door commands return a0000100 for success (boolean 0x00 = no error)
            checkResponseError(response);
            debug(`  ✓ Door ${doorNum} unlocked!`);
        }, 'door', doorNum);
    }

    /**
     * Unlock a door for the door's configured standard time.
     * The door will automatically re-lock after the configured timeout.
     * @param {number} doorNum - Door number to unlock
     * @throws {AritechError} If unlocking fails
     */
    async unlockDoorStandardTime(doorNum) {
        debug(`\n=== Unlocking Door ${doorNum} (Standard Time) ===`);

        await this._withControlSession('createDoorControlSession', {}, async (sessionId) => {
            debug(`  Calling unlockDoorStandardTime...`);
            const payload = constructMessage('unlockDoorStandardTime', { sessionId, objectId: doorNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            // Door commands return a0000100 for success (boolean 0x00 = no error)
            checkResponseError(response);
            debug(`  ✓ Door ${doorNum} unlocked (standard time)!`);
        }, 'door', doorNum);
    }

    /**
     * Unlock a door for a specified time.
     * The door will automatically re-lock after the specified timeout.
     * @param {number} doorNum - Door number to unlock
     * @param {number} seconds - Time in seconds to keep door unlocked
     * @throws {AritechError} If unlocking fails
     */
    async unlockDoorTime(doorNum, seconds) {
        debug(`\n=== Unlocking Door ${doorNum} for ${seconds}s ===`);

        await this._withControlSession('createDoorControlSession', {}, async (sessionId) => {
            debug(`  Calling unlockDoorTime...`);
            const payload = constructMessage('unlockDoorTime', { sessionId, objectId: doorNum, timeOpen: seconds });
            const response = await this.callEncrypted(payload, this.sessionKey);

            // Door commands return a0000100 for success (boolean 0x00 = no error)
            checkResponseError(response);
            debug(`  ✓ Door ${doorNum} unlocked for ${seconds}s!`);
        }, 'door', doorNum);
    }

    /**
     * Disable a door.
     * @param {number} doorNum - Door number to disable
     * @throws {AritechError} If disabling fails
     */
    async disableDoor(doorNum) {
        debug(`\n=== Disabling Door ${doorNum} ===`);

        // Check current state first
        const states = await this.getDoorStates([doorNum]);
        if (states.length > 0 && states[0].state.isDisabled) {
            debug(`  Door ${doorNum} is already disabled, skipping`);
            return { skipped: true, reason: 'already disabled' };
        }

        await this._withControlSession('createDoorControlSession', {}, async (sessionId) => {
            debug(`  Calling disableDoor...`);
            const payload = constructMessage('disableDoor', { sessionId, objectId: doorNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            // Door commands return a0000100 for success (boolean 0x00 = no error)
            checkResponseError(response);
            debug(`  ✓ Door ${doorNum} disabled!`);
        }, 'door', doorNum);
        return { skipped: false };
    }

    /**
     * Enable a door.
     * @param {number} doorNum - Door number to enable
     * @throws {AritechError} If enabling fails
     */
    async enableDoor(doorNum) {
        debug(`\n=== Enabling Door ${doorNum} ===`);

        // Check current state first
        const states = await this.getDoorStates([doorNum]);
        if (states.length > 0 && !states[0].state.isDisabled) {
            debug(`  Door ${doorNum} is already enabled, skipping`);
            return { skipped: true, reason: 'already enabled' };
        }

        await this._withControlSession('createDoorControlSession', {}, async (sessionId) => {
            debug(`  Calling enableDoor...`);
            const payload = constructMessage('enableDoor', { sessionId, objectId: doorNum });
            const response = await this.callEncrypted(payload, this.sessionKey);

            // Door commands return a0000100 for success (boolean 0x00 = no error)
            checkResponseError(response);
            debug(`  ✓ Door ${doorNum} enabled!`);
        }, 'door', doorNum);
        return { skipped: false };
    }

    /**
     * Get output states using batch request.
     * @param {Array|number} outputsOrMax - Array of output numbers or max output count
     * @returns {Promise<Array>} Array of output state objects
     */
    async getOutputStates(outputsOrMax = 8) {
        debug('\n=== Querying Output States ===');

        const outputNumbers = this._toEntityNumbers(outputsOrMax);
        return this._getEntityStatesWithFallback('OUTPUT', outputNumbers, 'outputStatus', OutputState, 'output');
    }

    // ========================================================================
    // FILTER METHODS
    // ========================================================================

    /**
     * Get filter names from the panel.
     * @returns {Promise<Array>} Array of filter objects with {number, name}
     */
    async getFilterNames() {
        return this._getNames('getFilterNames', 'filterNames', {
            entityName: 'Filter'
        });
    }

    /**
     * Get filter states using batch request.
     * Filters are read-only entities with a simple on/off (active/inactive) state.
     *
     * @param {Array|number} filtersOrMax - Array of filter numbers or max filter count
     * @returns {Promise<Array>} Array of filter state objects
     */
    async getFilterStates(filtersOrMax = 64) {
        debug('\n=== Querying Filter States ===');

        const filterNumbers = this._toEntityNumbers(filtersOrMax);
        return this._getEntityStatesWithFallback('FILTER', filterNumbers, 'filterStatus', FilterState, 'filter');
    }

    /**
     * Arm one or more areas.
     *
     * @param {number|number[]} areas - Area number(s) to arm (1-64)
     * @param {string} setType - Arm type: 'full', 'part1', or 'part2'
     * @param {boolean} force - Force arm even with faults/active zones/inhibited zones
     * @throws {AritechError} If arming fails (with code, status, and details)
     */
    async armArea(areas, setType = 'full', force = false) {
        const areaList = Array.isArray(areas) ? areas : [areas];
        debug(`\n=== Arming Area(s) ${areaList.join(', ')} (${setType}${force ? ', force' : ''}) ===`);

        const createMessages = {
            'full': 'createArmSession',
            'part1': 'createPartArmSession',
            'part2': 'createPartArm2Session'
        };
        const createMsgName = createMessages[setType] || 'createArmSession';

        const successStatuses = {
            'full': [CC_STATUS.FullSetSetting, CC_STATUS.FullSetSet],
            'part1': [CC_STATUS.PartSetSetting, CC_STATUS.PartSetSet],
            'part2': [CC_STATUS.PartSet2Setting, CC_STATUS.PartSet2Set]
        };
        const faultStatuses = {
            'full': CC_STATUS.FullSetFault,
            'part1': CC_STATUS.PartSetFault,
            'part2': CC_STATUS.PartSet2Fault
        };
        const activeStatuses = {
            'full': CC_STATUS.FullSetActiveStates,
            'part1': CC_STATUS.PartSetActiveStates,
            'part2': CC_STATUS.PartSet2ActiveStates
        };
        const inhibitedStatuses = {
            'full': CC_STATUS.FullSetInhibited,
            'part1': CC_STATUS.PartSetInhibited,
            'part2': CC_STATUS.PartSet2Inhibited
        };

        const areaProps = {};
        for (const area of areaList) {
            areaProps[`area.${area}`] = true;
        }

        await this._withControlSession(createMsgName, areaProps, async (sessionId) => {
            // Step 2: Start arm procedure
            debug(`Step 2: Starting arm procedure (armAreas)`);
            const setAreasPayload = constructMessage('armAreas', { sessionId: sessionId });
            const setAreasResponse = await this.callEncrypted(setAreasPayload, this.sessionKey);
            if (parseReturnBool(setAreasResponse) !== true) {
                throw new AritechError('Failed to start arm procedure', {
                    code: ErrorCodes.ARM_FAILED,
                    details: { areas: areaList, response: setAreasResponse ? setAreasResponse.toString('hex') : null }
                });
            }
            debug(`✓ armAreas sent`);

            // Step 3: Poll status and handle force scenarios
            let forcedOnce = false;
            let pollsAfterForce = 0;
            let lastStatus = 0;
            let faults = [];
            let activeZones = [];
            let inhibitedZones = [];

            for (let i = 0; i < 60; i++) {
                if (i > 0) {
                    await new Promise(r => setTimeout(r, 300));
                }

                // Read status
                const statusPayload = constructMessage('getControlSessionStatus', { sessionId: sessionId });
                const statusResponse = await this.callEncrypted(statusPayload, this.sessionKey);

                if (!statusResponse || statusResponse.length < 5) {
                    debug(`  Poll ${i + 1}: Invalid response`);
                    continue;
                }

                // Check if this is actually a controlSessionStatus (msgId 0x20)
                // Skip COS events or other messages that may interleave
                if (!isMessageType(statusResponse, 'controlSessionStatus', 1)) {
                    debug(`  Poll ${i + 1}: Got different message (0x${statusResponse[1].toString(16)}), retrying...`);
                    continue;
                }

                // Parse stateId using template (16-bit big-endian)
                // Strip protocol header (byte 0) for getProperty
                const stateId = getProperty('controlSessionStatus', statusResponse.slice(1), 'stateId');
                lastStatus = stateId;
                debug(`  Poll ${i + 1}: Status 0x${stateId.toString(16).padStart(4, '0')}`);

                // Check for success (Setting or Set)
                if (successStatuses[setType].includes(stateId)) {
                    debug(`✓ Arm operation complete - status: 0x${stateId.toString(16)}`);
                    return; // Success - just return, no error
                }

                // Handle fault status
                if (stateId === faultStatuses[setType]) {
                    if (!forcedOnce && force) {
                        debug(`  Fault detected, forcing arm...`);
                        forcedOnce = true;
                        pollsAfterForce = 0;
                        const forcePayload = constructMessage('setAreaForced', { sessionId: sessionId });
                        await this.callEncrypted(forcePayload, this.sessionKey);
                        continue;
                    }
                    if (forcedOnce) {
                        pollsAfterForce++;
                        if (pollsAfterForce >= 10) {
                            throw new AritechError('Force arm failed - faults still present after forcing', {
                                code: ErrorCodes.FORCE_ARM_FAILED,
                                status: stateId
                            });
                        }
                        continue;  // Keep polling after force
                    }
                    // Read fault zones and throw
                    faults = await this._readArmIssues(sessionId, 'getFaultZones');
                    throw new AritechError('Arm failed - zone faults detected', {
                        code: ErrorCodes.ARM_FAULTS,
                        status: stateId,
                        details: { faults }
                    });
                }

                // Handle active states status
                if (stateId === activeStatuses[setType]) {
                    if (!forcedOnce && force) {
                        debug(`  Active zones detected, forcing arm...`);
                        forcedOnce = true;
                        pollsAfterForce = 0;
                        const forcePayload = constructMessage('setAreaForced', { sessionId: sessionId });
                        await this.callEncrypted(forcePayload, this.sessionKey);
                        continue;
                    }
                    if (forcedOnce) {
                        pollsAfterForce++;
                        if (pollsAfterForce >= 10) {
                            throw new AritechError('Force arm failed - active zones still present after forcing', {
                                code: ErrorCodes.FORCE_ARM_FAILED,
                                status: stateId
                            });
                        }
                        continue;  // Keep polling after force
                    }
                    // Read active zones and throw
                    activeZones = await this._readArmIssues(sessionId, 'getActiveZones');
                    throw new AritechError('Arm failed - active zones detected', {
                        code: ErrorCodes.ARM_ACTIVE_ZONES,
                        status: stateId,
                        details: { activeZones }
                    });
                }

                // Handle inhibited status
                if (stateId === inhibitedStatuses[setType]) {
                    if (!forcedOnce && force) {
                        debug(`  Inhibited zones detected, re-sending set command...`);
                        forcedOnce = true;
                        pollsAfterForce = 0;
                        // For inhibited, re-send armAreas (not setAreaForced)
                        const reSetPayload = constructMessage('armAreas', { sessionId: sessionId });
                        await this.callEncrypted(reSetPayload, this.sessionKey);
                        continue;
                    }
                    if (forcedOnce) {
                        pollsAfterForce++;
                        if (pollsAfterForce >= 10) {
                            throw new AritechError('Force arm failed - inhibited zones still blocking after forcing', {
                                code: ErrorCodes.FORCE_ARM_FAILED,
                                status: stateId
                            });
                        }
                        continue;  // Keep polling after force
                    }
                    // Read inhibited zones and throw
                    inhibitedZones = await this._readArmIssues(sessionId, 'getInhibitedZones');
                    throw new AritechError('Arm failed - inhibited zones detected', {
                        code: ErrorCodes.ARM_INHIBITED,
                        status: stateId,
                        details: { inhibitedZones }
                    });
                }
            }

            // If we get here, polling timed out without success or clear failure
            throw new AritechError('Arm operation timed out', {
                code: ErrorCodes.ARM_FAILED,
                status: lastStatus
            });
        }, 'area', areaList.join(','));
    }

    /**
     * Read fault/active/inhibited zones during arm procedure.
     * @private
     */
    async _readArmIssues(sessionId, messageName) {
        const issues = [];
        let next = 0;

        for (let i = 0; i < 100; i++) {  // Safety limit
            const payload = constructMessage(messageName, { sessionId: sessionId, next });
            let response;
            try {
                response = await this.callEncrypted(payload, this.sessionKey);
            } catch (err) {
                // Panel may return error when no issues to report
                debug(`  ${messageName}: ${err.message}`);
                break;
            }

            if (!response || response.length < 3) break;

            // Check if response is booleanResponse (end of list)
            if (isMessageType(response, 'booleanResponse', 1)) {
                break;
            }

            // Parse zone info from response (simplified - would need return.sysevent template)
            if (response.length >= 5) {
                issues.push({
                    raw: response.toString('hex'),
                    index: i
                });
            }

            next = 1;  // Continue reading
        }

        debug(`  Read ${issues.length} ${messageName.split('_').pop().toLowerCase()} zones`);
        return issues;
    }

    /**
     * Disarm an area.
     * @param {number} areaNumber - Area number to disarm (1-64)
     * @throws {AritechError} If disarming fails
     */
    async disarmArea(areaNumber) {
        debug(`\n=== Disarming Area ${areaNumber} ===`);

        await this._withControlSession('createDisarmSession', { [`area.${areaNumber}`]: true }, async (sessionId) => {
            debug(`  Calling disarmAreas...`);
            const fnPayload = constructMessage('disarmAreas', { sessionId: sessionId });
            const response = await this.callEncrypted(fnPayload, this.sessionKey);

            if (parseReturnBool(response) !== true) {
                throw new AritechError(`Failed to disarm area ${areaNumber}`, {
                    code: ErrorCodes.DISARM_FAILED,
                    details: { areaNumber, response: response ? response.toString('hex') : null }
                });
            }

            debug(`  ✓ Area ${areaNumber} disarmed successfully!`);
        }, 'area', areaNumber);
    }

    /**
     * Read the event log from the panel as an async generator (stream).
     * Events are yielded from newest to oldest.
     *
     * @param {number} maxEvents - Maximum number of events to read (default: 100, 0 = unlimited)
     * @yields {Object} Parsed event object from event-parser
     */
    async *readEventLog(maxEvents = 100) {
        debug('\n=== Reading Event Log ===');

        // x700 panels and x500 panels with protocol 4.4+ use 60-byte events
        // Older x500 panels use 70-byte events
        const isX700 = this.isX700Panel();
        const isExtendedProtocol = this.protocolVersion && this.protocolVersion >= 4004;
        const eventSize = (isX700 || isExtendedProtocol) ? 60 : 70;

        if (isX700) {
            // x700 requires startMonitor first
            const startPayload = constructMessage('startMonitor', {});
            const startResponse = await this.callEncrypted(startPayload, this.sessionKey);
            if (startResponse) {
                debug(`startMonitor response: ${startResponse.toString('hex')}`);
            }
        }
        const initPayload = constructMessage('openLog', {});
        const initResponse = await this.callEncrypted(initPayload, this.sessionKey);
        if (initResponse) {
            debug(`Event log init response: ${initResponse.toString('hex')}`);
        }

        let eventCount = 0;
        let direction = EVENT_LOG_DIRECTION.FIRST;
        let lastSequence = null;
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 3;

        while (maxEvents === 0 || eventCount < maxEvents) {
            const payload = buildGetEventLogMessage(direction);

            try {
                const response = await this.callEncrypted(payload, this.sessionKey);

                if (!response) {
                    debug('No response received');
                    consecutiveErrors++;
                    if (consecutiveErrors >= maxConsecutiveErrors) {
                        debug('Max consecutive errors reached, stopping');
                        break;
                    }
                    continue;
                }

                // Check for logEntry response (msgId -7 = 0x0D)
                if (!isMessageType(response, 'logEntry', 1)) {
                    // Check for ack response (can happen as async COS message)
                    if (response[1] === 0x00) {
                        debug('Received ack, continuing...');
                        continue;
                    }
                    debug(`Unexpected response: ${response.slice(0, 10).toString('hex')}`);
                    consecutiveErrors++;
                    if (consecutiveErrors >= maxConsecutiveErrors) break;
                    continue;
                }

                // Response payload starts at offset 2 (after header + msgId)
                const eventData = response.slice(2);

                if (eventData.length < eventSize) {
                    debug(`Event data too short: ${eventData.length} bytes (expected ${eventSize})`);
                    consecutiveErrors++;
                    if (consecutiveErrors >= maxConsecutiveErrors) break;
                    continue;
                }

                // Parse the event (60 bytes for x700, 70 bytes for x500)
                try {
                    const eventBuffer = eventData.slice(0, eventSize);
                    const parsedEvent = parseEvent(eventBuffer);

                    // Use parsed sequence for end detection
                    const sequence = parsedEvent.sequence;

                    // Check for end of log - when sequence wraps (255 -> 0) or stays at 0
                    // The log goes from newest (highest seq) to oldest (lowest seq)
                    if (lastSequence !== null && lastSequence === 0 && sequence === 0) {
                        debug('Reached end of event log (oldest event)');
                        break;
                    }

                    eventCount++;
                    consecutiveErrors = 0;
                    lastSequence = sequence;

                    yield parsedEvent;
                } catch (parseError) {
                    debug(`Failed to parse event: ${parseError.message}`);
                    debug(`Raw event data: ${eventData.slice(0, eventSize).toString('hex')}`);
                    consecutiveErrors++;
                    if (consecutiveErrors >= maxConsecutiveErrors) break;
                }

                // After first request, switch to "next" direction
                direction = EVENT_LOG_DIRECTION.NEXT;

            } catch (err) {
                console.error(`Error reading event: ${err.message}`);
                consecutiveErrors++;
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    debug('Max errors reached, stopping event log read');
                    break;
                }
            }
        }

        debug(`\n=== Read ${eventCount} events from log ===`);
    }
}
