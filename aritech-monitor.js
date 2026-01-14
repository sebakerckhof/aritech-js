/**
 * Aritech ATS Panel Monitor
 *
 * Monitors the panel for changes and emits events when zones or areas change.
 * Uses COS (Change of Status) events from the panel to detect changes efficiently.
 */

import { EventEmitter } from 'events';
import { constructMessage as _constructMessage } from './message-helpers.js';
import { messageTemplates } from './messages.js';

// Bind constructMessage to our templates
const constructMessage = (name, params = {}) => _constructMessage(messageTemplates, name, params);

// COS change type constants (from COS payload byte 2)
const COS_CHANGE_TYPES = {
    ZONE: 0x01,
    AREA: 0x02,
    OUTPUT: 0x07,
    FILTER: 0x08,
    DOOR: 0x0b,
    TRIGGER: 0x14,
    ALL: 0xFF
};

// Response header constant
const HEADER_RESPONSE = 0xA0;


/**
 * Build COS acknowledgment message.
 * Format: a0 00 01 01 (response header 0xA0, msgId 0, ack bytes)
 * This ack tells the panel we received the COS notification.
 */
function buildCOSAcknowledgment() {
    return Buffer.from([0xA0, 0x00, 0x01, 0x01]);
}

// Debug logging helper
const DEBUG = process.env.LOG_LEVEL === 'debug';
const debug = (...args) => {
    if (DEBUG) console.debug(...args);
};

/**
 * Monitor class that wraps an AritechClient and emits change events.
 *
 * Events emitted:
 * - 'zoneChanged': { id, name, oldData, newData }
 * - 'areaChanged': { id, name, oldData, newData }
 * - 'outputChanged': { id, name, oldData, newData }
 * - 'triggerChanged': { id, name, oldData, newData }
 * - 'doorChanged': { id, name, oldData, newData }
 * - 'filterChanged': { id, name, oldData, newData }
 * - 'initialized': { zones, areas, outputs, triggers, doors, filters }
 * - 'error': Error object
 *
 * @example
 * const monitor = new AritechMonitor(client);
 * monitor.on('zoneChanged', (event) => {
 *   debug(`Zone ${event.id} changed from ${event.oldData.state} to ${event.newData.state}`);
 * });
 * await monitor.start();
 */
export class AritechMonitor extends EventEmitter {
    constructor(client) {
        super();
        this.client = client;

        // State tracking
        this.zones = [];           // Array of {number, name}
        this.areas = [];           // Array of {number, name}
        this.outputs = [];         // Array of {number, name}
        this.triggers = [];        // Array of {number, name}
        this.doors = [];           // Array of {number, name}
        this.filters = [];         // Array of {number, name}
        this.zoneStates = {};      // Map of zoneNum -> state data
        this.areaStates = {};      // Map of areaNum -> state data
        this.outputStates = {};    // Map of outputNum -> state data
        this.triggerStates = {};   // Map of triggerNum -> state data
        this.doorStates = {};      // Map of doorNum -> state data
        this.filterStates = {};    // Map of filterNum -> state data

        // Internal state
        this.running = false;
    }

    /**
     * Start monitoring. Initializes state and begins listening for COS events.
     */
    async start() {
        if (this.running) {
            throw new Error('Monitor is already running');
        }

        debug('\n╔═══════════════════════════════════════════════════════════╗');
        debug('║              ARITECH MONITOR STARTING                     ║');
        debug('╚═══════════════════════════════════════════════════════════╝');

        try {
            // Initialize: fetch zone and area names and initial states
            await this._initialize();

            // Set up COS event handling
            this._setupCOSHandler();

            this.running = true;
            this.client.monitoringActive = true;

            debug('\n✓ Monitor started successfully');
            debug('  Listening for changes...\n');

        } catch (err) {
            this.emit('error', err);
            throw err;
        }
    }

    /**
     * Stop monitoring and clean up.
     */
    stop() {
        debug('\n🛑 Stopping monitor...');

        this.running = false;
        this.client.monitoringActive = false;

        // Remove our COS listener
        // Note: We can't easily remove our specific listener from client.eventListeners
        // without modifying the client. For now, the running flag prevents processing.

        debug('✓ Monitor stopped');
    }

    /**
     * Get current state of all zones.
     * @returns {Object} Map of zone number to state data
     */
    getZoneStates() {
        return { ...this.zoneStates };
    }

    /**
     * Get current state of all areas.
     * @returns {Object} Map of area number to state data
     */
    getAreaStates() {
        return { ...this.areaStates };
    }

    /**
     * Get current state of all outputs.
     * @returns {Object} Map of output number to state data
     */
    getOutputStates() {
        return { ...this.outputStates };
    }

    /**
     * Get current state of all triggers.
     * @returns {Object} Map of trigger number to state data
     */
    getTriggerStates() {
        return { ...this.triggerStates };
    }

    /**
     * Get current state of all doors.
     * @returns {Object} Map of door number to state data
     */
    getDoorStates() {
        return { ...this.doorStates };
    }

    /**
     * Get current state of all filters.
     * @returns {Object} Map of filter number to state data
     */
    getFilterStates() {
        return { ...this.filterStates };
    }

    /**
     * Initialize by fetching all zone/area names and their current states.
     * @private
     */
    async _initialize() {
        debug('\n=== Initializing Monitor State ===');

        // Enable event notifications (like mobile app does after login)
        // Uses getUserInfo (msgId 228) which triggers COS notification setup
        debug('Enabling event notifications...');
        await this.client.callEncrypted(constructMessage('getUserInfo'), this.client.sessionKey);

        // Fetch zone names
        debug('Fetching zone names...');
        this.zones = await this.client.getZoneNames();
        debug(`  Found ${this.zones.length} zones`);

        // Fetch area names
        debug('Fetching area names...');
        this.areas = await this.client.getAreaNames();
        debug(`  Found ${this.areas.length} areas`);

        // Fetch initial zone states
        debug('Fetching initial zone states...');
        const zoneStates = await this.client.getZoneStates(this.zones);
        for (const zoneState of zoneStates) {
            this.zoneStates[zoneState.zone] = {
                ...zoneState,
            };
        }
        debug(`  Captured state for ${Object.keys(this.zoneStates).length} zones`);

        // Fetch initial area states
        debug('Fetching initial area states...');
        const areaStates = await this.client.getAreaStates(this.areas);
        for (const areaState of areaStates) {
            this.areaStates[areaState.area] = {
                ...areaState,
            };
        }
        debug(`  Captured state for ${Object.keys(this.areaStates).length} areas`);

        // Fetch output names
        debug('Fetching output names...');
        this.outputs = await this.client.getOutputNames();
        debug(`  Found ${this.outputs.length} outputs`);

        // Fetch initial output states
        debug('Fetching initial output states...');
        const outputStates = await this.client.getOutputStates(this.outputs.map(o => o.number));
        for (const outputState of outputStates) {
            this.outputStates[outputState.output] = {
                ...outputState,
            };
        }
        debug(`  Captured state for ${Object.keys(this.outputStates).length} outputs`);

        // Fetch trigger names
        debug('Fetching trigger names...');
        this.triggers = await this.client.getTriggerNames();
        debug(`  Found ${this.triggers.length} triggers`);

        // Fetch initial trigger states
        debug('Fetching initial trigger states...');
        const triggerStates = await this.client.getTriggerStates(this.triggers.map(t => t.number));
        for (const triggerState of triggerStates) {
            this.triggerStates[triggerState.trigger] = {
                ...triggerState,
            };
        }
        debug(`  Captured state for ${Object.keys(this.triggerStates).length} triggers`);

        // Fetch door names
        debug('Fetching door names...');
        this.doors = await this.client.getDoorNames();
        debug(`  Found ${this.doors.length} doors`);

        // Fetch initial door states
        if (this.doors.length > 0) {
            debug('Fetching initial door states...');
            const doorStates = await this.client.getDoorStates(this.doors.map(d => d.number));
            for (const doorState of doorStates) {
                this.doorStates[doorState.door] = {
                    ...doorState,
                };
            }
            debug(`  Captured state for ${Object.keys(this.doorStates).length} doors`);
        }

        // Fetch filter names
        debug('Fetching filter names...');
        this.filters = await this.client.getFilterNames();
        debug(`  Found ${this.filters.length} filters`);

        // Fetch initial filter states
        if (this.filters.length > 0) {
            debug('Fetching initial filter states...');
            const filterStates = await this.client.getFilterStates(this.filters.map(f => f.number));
            for (const filterState of filterStates) {
                this.filterStates[filterState.filter] = {
                    ...filterState,
                };
            }
            debug(`  Captured state for ${Object.keys(this.filterStates).length} filters`);
        }

        // Emit initialized event
        this.emit('initialized', {
            zones: this.zones,
            areas: this.areas,
            outputs: this.outputs,
            triggers: this.triggers,
            doors: this.doors,
            filters: this.filters,
            zoneStates: this.getZoneStates(),
            areaStates: this.getAreaStates(),
            outputStates: this.getOutputStates(),
            triggerStates: this.getTriggerStates(),
            doorStates: this.getDoorStates(),
            filterStates: this.getFilterStates()
        });

        debug('✓ Initialization complete\n');
    }

    /**
     * Set up the COS event handler on the client.
     * @private
     */
    _setupCOSHandler() {
        this.client.onCOSEvent(async (statusByte, payload) => {
            if (!this.running) return;

            try {
                await this._handleCOSEvent(statusByte, payload);
            } catch (err) {
                debug('Error handling COS event:', err);
                this.emit('error', err);
            }
        });
    }

    /**
     * Handle a COS event by determining what changed and fetching updated state.
     *
     * COS payload format: 30 00 TT 00 00 00 00 00
     *   TT = Type: 01 = zone, 02 = area, 07 = output, 14 = trigger, ff = sync all
     *
     * After receiving COS, we must:
     * 1. Send ack (Message ID 0, payload 0101)
     * 2. Request change bitmap:
     *    - For zones: Message ID 101 (ca01)
     *    - For areas: Message ID 165 (ca02)
     *    - For outputs: Message ID 421 (ca07)
     *    - For triggers: Message ID 1205 (ca14)
     * 3. Parse bitmap response (Message ID 24): TT BB BB BB...
     *    - TT: 01=zone, 02=area, 07=output, 14=trigger
     *    - BB: bitmap of changed items (bit 0 = item 1, etc.)
     * 4. Query only the specific items that changed
     *
     * @private
     */
    async _handleCOSEvent(statusByte, payload) {
        debug(`\n━━━ Processing COS Event ━━━`);
        debug(`Status byte: 0x${statusByte?.toString(16).padStart(2, '0') || '??'}`);
        debug(`Payload: ${payload?.toString('hex') || 'none'}`);

        // Parse COS payload to determine what changed
        // Format: 30 00 TT 00 00 00 00 00
        //   TT: 01 = zone, 02 = area, 07 = output, 14 = trigger, ff = all
        let changeType = 'all';

        if (payload && payload.length >= 3 && payload[0] === 0x30) {
            const typeByte = payload[2];
            if (typeByte === COS_CHANGE_TYPES.ZONE) {
                changeType = 'zone';
            } else if (typeByte === COS_CHANGE_TYPES.AREA) {
                changeType = 'area';
            } else if (typeByte === COS_CHANGE_TYPES.OUTPUT) {
                changeType = 'output';
            } else if (typeByte === COS_CHANGE_TYPES.FILTER) {
                changeType = 'filter';
            } else if (typeByte === COS_CHANGE_TYPES.TRIGGER) {
                changeType = 'trigger';
            } else if (typeByte === COS_CHANGE_TYPES.DOOR) {
                changeType = 'door';
            }
            debug(`  Change type: ${changeType}`);
        }

        // Send acknowledgment using helper
        const ackPayload = buildCOSAcknowledgment();
        this.client.sendEncrypted(ackPayload, this.client.sessionKey);

        // Small delay before querying
        await new Promise(r => setTimeout(r, 50));

        // Request change bitmap using the appropriate message ID
        // - Message ID 101 (ca01) for zones
        // - Message ID 165 (ca02) for areas
        // - Message ID 421 (ca07) for outputs
        // - Message ID 549 (ca08) for filters
        // - Message ID 1205 (ca14) for triggers
        let changedZones = [];
        let changedAreas = [];
        let changedOutputs = [];
        let changedFilters = [];
        let changedTriggers = [];
        let changedDoors = [];

        if (changeType === 'zone' || changeType === 'all') {
            const zoneResponse = await this.client.callEncrypted(constructMessage('getZoneChanges'), this.client.sessionKey);

            if (zoneResponse && zoneResponse.length >= 3 &&
                zoneResponse[0] === HEADER_RESPONSE && zoneResponse[1] === 0x30) {
                const bitmapType = zoneResponse[2];
                const bitmap = zoneResponse.slice(3);
                debug(`  Zone bitmap response type: 0x${bitmapType.toString(16)}, data: ${bitmap.toString('hex')}`);

                if (bitmapType === COS_CHANGE_TYPES.ZONE) {
                    changedZones = this._parseBitmap(bitmap, this.zones.map(z => z.number));
                    debug(`  Changed zones: ${changedZones.join(', ') || 'none'}`);
                }
            }
        }

        if (changeType === 'area' || changeType === 'all') {
            const areaResponse = await this.client.callEncrypted(constructMessage('getAreaChanges'), this.client.sessionKey);

            if (areaResponse && areaResponse.length >= 3 &&
                areaResponse[0] === HEADER_RESPONSE && areaResponse[1] === 0x30) {
                const bitmapType = areaResponse[2];
                const bitmap = areaResponse.slice(3);
                debug(`  Area bitmap response type: 0x${bitmapType.toString(16)}, data: ${bitmap.toString('hex')}`);

                if (bitmapType === COS_CHANGE_TYPES.AREA) {
                    changedAreas = this._parseBitmap(bitmap, this.areas.map(a => a.number));
                    debug(`  Changed areas: ${changedAreas.join(', ') || 'none'}`);
                }
            }
        }

        if (changeType === 'output' || changeType === 'all') {
            const outputResponse = await this.client.callEncrypted(constructMessage('getOutputChanges'), this.client.sessionKey);

            if (outputResponse && outputResponse.length >= 3 &&
                outputResponse[0] === HEADER_RESPONSE && outputResponse[1] === 0x30) {
                const bitmapType = outputResponse[2];
                const bitmap = outputResponse.slice(3);
                debug(`  Output bitmap response type: 0x${bitmapType.toString(16)}, data: ${bitmap.toString('hex')}`);

                if (bitmapType === COS_CHANGE_TYPES.OUTPUT) {
                    changedOutputs = this._parseBitmap(bitmap, this.outputs.map(o => o.number));
                    debug(`  Changed outputs: ${changedOutputs.join(', ') || 'none'}`);
                }
            }
        }

        if (changeType === 'filter' || changeType === 'all') {
            const filterResponse = await this.client.callEncrypted(constructMessage('getFilterChanges'), this.client.sessionKey);

            if (filterResponse && filterResponse.length >= 3 &&
                filterResponse[0] === HEADER_RESPONSE && filterResponse[1] === 0x30) {
                const bitmapType = filterResponse[2];
                const bitmap = filterResponse.slice(3);
                debug(`  Filter bitmap response type: 0x${bitmapType.toString(16)}, data: ${bitmap.toString('hex')}`);

                if (bitmapType === COS_CHANGE_TYPES.FILTER) {
                    changedFilters = this._parseBitmap(bitmap, this.filters.map(f => f.number));
                    debug(`  Changed filters: ${changedFilters.join(', ') || 'none'}`);
                }
            }
        }

        if (changeType === 'trigger' || changeType === 'all') {
            const triggerResponse = await this.client.callEncrypted(constructMessage('getTriggerChanges'), this.client.sessionKey);

            if (triggerResponse && triggerResponse.length >= 3 &&
                triggerResponse[0] === HEADER_RESPONSE && triggerResponse[1] === 0x30) {
                const bitmapType = triggerResponse[2];
                const bitmap = triggerResponse.slice(3);
                debug(`  Trigger bitmap response type: 0x${bitmapType.toString(16)}, data: ${bitmap.toString('hex')}`);

                if (bitmapType === COS_CHANGE_TYPES.TRIGGER) {
                    changedTriggers = this._parseBitmap(bitmap, this.triggers.map(t => t.number));
                    debug(`  Changed triggers: ${changedTriggers.join(', ') || 'none'}`);
                }
            }
        }

        if (changeType === 'door' || changeType === 'all') {
            const doorResponse = await this.client.callEncrypted(constructMessage('getDoorChanges'), this.client.sessionKey);

            if (doorResponse && doorResponse.length >= 3 &&
                doorResponse[0] === HEADER_RESPONSE && doorResponse[1] === 0x30) {
                const bitmapType = doorResponse[2];
                const bitmap = doorResponse.slice(3);
                debug(`  Door bitmap response type: 0x${bitmapType.toString(16)}, data: ${bitmap.toString('hex')}`);

                if (bitmapType === COS_CHANGE_TYPES.DOOR) {
                    changedDoors = this._parseBitmap(bitmap, this.doors.map(d => d.number));
                    debug(`  Changed doors: ${changedDoors.join(', ') || 'none'}`);
                }
            }
        }

        // Update based on what actually changed
        if (changedZones.length > 0) {
            await this._updateZoneStates(changedZones);
        } else if (changeType === 'zone' || changeType === 'all') {
            // Fallback: fetch all zones if no specific bitmap
            debug(`  No specific zones in bitmap, fetching all`);
            const allZoneNumbers = this.zones.map(z => z.number);
            await this._updateZoneStates(allZoneNumbers);
        }

        if (changedAreas.length > 0) {
            await this._updateAreaStates(changedAreas);
        } else if (changeType === 'area' || changeType === 'all') {
            // Fallback: fetch all areas if no specific bitmap
            debug(`  No specific areas in bitmap, fetching all`);
            await this._updateAreaStates();
        }

        if (changedOutputs.length > 0) {
            await this._updateOutputStates(changedOutputs);
        } else if (changeType === 'output' || changeType === 'all') {
            // Fallback: fetch all outputs if no specific bitmap
            debug(`  No specific outputs in bitmap, fetching all`);
            const allOutputNumbers = this.outputs.map(o => o.number);
            await this._updateOutputStates(allOutputNumbers);
        }

        if (changedFilters.length > 0) {
            await this._updateFilterStates(changedFilters);
        } else if (changeType === 'filter' || changeType === 'all') {
            // Fallback: fetch all filters if no specific bitmap
            debug(`  No specific filters in bitmap, fetching all`);
            const allFilterNumbers = this.filters.map(f => f.number);
            await this._updateFilterStates(allFilterNumbers);
        }

        if (changedTriggers.length > 0) {
            await this._updateTriggerStates(changedTriggers);
        } else if (changeType === 'trigger' || changeType === 'all') {
            // Fallback: fetch all triggers if no specific bitmap
            debug(`  No specific triggers in bitmap, fetching all`);
            const allTriggerNumbers = this.triggers.map(t => t.number);
            await this._updateTriggerStates(allTriggerNumbers);
        }

        if (changedDoors.length > 0) {
            await this._updateDoorStates(changedDoors);
        } else if (changeType === 'door' || changeType === 'all') {
            // Fallback: fetch all doors if no specific bitmap
            debug(`  No specific doors in bitmap, fetching all`);
            const allDoorNumbers = this.doors.map(d => d.number);
            await this._updateDoorStates(allDoorNumbers);
        }
    }

    /**
     * Parse a bitmap to extract which items changed.
     * @private
     * @param {Buffer} bitmap - Bitmap data
     * @param {number[]} validNumbers - Valid item numbers (zones or areas)
     * @returns {number[]} Array of item numbers that changed
     */
    _parseBitmap(bitmap, validNumbers) {
        const changed = [];
        const validSet = new Set(validNumbers);

        for (let byteIdx = 0; byteIdx < bitmap.length; byteIdx++) {
            const byte = bitmap[byteIdx];
            if (byte === 0) continue; // Skip empty bytes for efficiency

            for (let bit = 0; bit < 8; bit++) {
                if (byte & (1 << bit)) {
                    const itemNum = byteIdx * 8 + bit + 1;
                    if (validSet.has(itemNum)) {
                        changed.push(itemNum);
                    }
                }
            }
        }

        return changed;
    }

    /**
     * Update zone states and emit events for changes.
     * @private
     * @param {number[]} zoneNumbers - Zone numbers to update
     */
    async _updateZoneStates(zoneNumbers) {
        if (zoneNumbers.length === 0) return;

        // Build zone objects for the batch request
        const zonesToQuery = zoneNumbers.map(num => ({ number: num }));
        const newStates = await this.client.getZoneStates(zonesToQuery);

        for (const newState of newStates) {
            const zoneNum = newState.zone;
            const oldState = this.zoneStates[zoneNum];

            // Check if changed by comparing raw bytes
            const hasChanged = !oldState || oldState.rawHex !== newState.rawHex;

            if (hasChanged) {
                // Find zone name
                const zone = this.zones.find(z => z.number === zoneNum);
                const zoneName = zone?.name || `Zone ${zoneNum}`;

                // Emit event
                this.emit('zoneChanged', {
                    id: zoneNum,
                    name: zoneName,
                    oldData: oldState ? { ...oldState } : null,
                    newData: { ...newState }
                });

                debug(`  🔔 Zone ${zoneNum} (${zoneName}): ${oldState?.rawHex || 'NEW'} → ${newState.rawHex}`);
            }

            // Update stored state
            this.zoneStates[zoneNum] = { ...newState };
        }
    }

    /**
     * Update area states and emit events for changes.
     * @private
     * @param {number[]} [areaNumbers] - Optional array of area numbers to update. If not provided, updates all areas.
     */
    async _updateAreaStates(areaNumbers) {
        // If specific areas provided, query just those; otherwise query all
        const areasToQuery = areaNumbers
            ? areaNumbers.map(num => this.areas.find(a => a.number === num) || { number: num })
            : this.areas;

        if (areasToQuery.length === 0) return;

        const newStates = await this.client.getAreaStates(areasToQuery);

        for (const newState of newStates) {
            const areaNum = newState.area;
            const oldState = this.areaStates[areaNum];

            // Check if changed by comparing raw bytes
            const hasChanged = !oldState || oldState.rawHex !== newState.rawHex;

            if (hasChanged) {
                // Find area name
                const area = this.areas.find(a => a.number === areaNum);
                const areaName = area?.name || `Area ${areaNum}`;

                // Emit event
                this.emit('areaChanged', {
                    id: areaNum,
                    name: areaName,
                    oldData: oldState ? { ...oldState } : null,
                    newData: { ...newState }
                });

                debug(`  🔔 Area ${areaNum} (${areaName}): ${oldState?.rawHex || 'NEW'} → ${newState.rawHex}`);
            }

            // Update stored state
            this.areaStates[areaNum] = { ...newState };
        }
    }

    /**
     * Update output states and emit events for changes.
     * @private
     * @param {number[]} outputNumbers - Output numbers to update
     */
    async _updateOutputStates(outputNumbers) {
        if (outputNumbers.length === 0) return;

        const newStates = await this.client.getOutputStates(outputNumbers);

        for (const newState of newStates) {
            const outputNum = newState.output;
            const oldState = this.outputStates[outputNum];

            // Check if changed by comparing raw bytes
            const hasChanged = !oldState || oldState.rawHex !== newState.rawHex;

            if (hasChanged) {
                // Find output name
                const output = this.outputs.find(o => o.number === outputNum);
                const outputName = output?.name || `Output ${outputNum}`;

                // Emit event
                this.emit('outputChanged', {
                    id: outputNum,
                    name: outputName,
                    oldData: oldState ? { ...oldState } : null,
                    newData: { ...newState }
                });

                debug(`  🔔 Output ${outputNum} (${outputName}): ${oldState?.rawHex || 'NEW'} → ${newState.rawHex}`);
            }

            // Update stored state
            this.outputStates[outputNum] = { ...newState };
        }
    }

    /**
     * Update trigger states and emit events for changes.
     * @private
     * @param {number[]} triggerNumbers - Trigger numbers to update
     */
    async _updateTriggerStates(triggerNumbers) {
        if (triggerNumbers.length === 0) return;

        const newStates = await this.client.getTriggerStates(triggerNumbers);

        for (const newState of newStates) {
            const triggerNum = newState.trigger;
            const oldState = this.triggerStates[triggerNum];

            // Check if changed by comparing raw bytes
            const hasChanged = !oldState || oldState.rawHex !== newState.rawHex;

            if (hasChanged) {
                // Find trigger name
                const trigger = this.triggers.find(t => t.number === triggerNum);
                const triggerName = trigger?.name || `Trigger ${triggerNum}`;

                // Emit event
                this.emit('triggerChanged', {
                    id: triggerNum,
                    name: triggerName,
                    oldData: oldState ? { ...oldState } : null,
                    newData: { ...newState }
                });

                debug(`  🔔 Trigger ${triggerNum} (${triggerName}): ${oldState?.rawHex || 'NEW'} → ${newState.rawHex}`);
            }

            // Update stored state
            this.triggerStates[triggerNum] = { ...newState };
        }
    }

    /**
     * Update door states and emit events for changes.
     * @private
     * @param {number[]} doorNumbers - Door numbers to update
     */
    async _updateDoorStates(doorNumbers) {
        if (doorNumbers.length === 0) return;

        const newStates = await this.client.getDoorStates(doorNumbers);

        for (const newState of newStates) {
            const doorNum = newState.door;
            const oldState = this.doorStates[doorNum];

            // Check if changed by comparing raw bytes
            const hasChanged = !oldState || oldState.rawHex !== newState.rawHex;

            if (hasChanged) {
                // Find door name
                const door = this.doors.find(d => d.number === doorNum);
                const doorName = door?.name || `Door ${doorNum}`;

                // Emit event
                this.emit('doorChanged', {
                    id: doorNum,
                    name: doorName,
                    oldData: oldState ? { ...oldState } : null,
                    newData: { ...newState }
                });

                debug(`  🔔 Door ${doorNum} (${doorName}): ${oldState?.rawHex || 'NEW'} → ${newState.rawHex}`);
            }

            // Update stored state
            this.doorStates[doorNum] = { ...newState };
        }
    }

    /**
     * Update filter states and emit events for changes.
     * @private
     * @param {number[]} filterNumbers - Filter numbers to update
     */
    async _updateFilterStates(filterNumbers) {
        if (filterNumbers.length === 0) return;

        const newStates = await this.client.getFilterStates(filterNumbers);

        for (const newState of newStates) {
            const filterNum = newState.filter;
            const oldState = this.filterStates[filterNum];

            // Check if changed by comparing raw bytes
            const hasChanged = !oldState || oldState.rawHex !== newState.rawHex;

            if (hasChanged) {
                // Find filter name
                const filter = this.filters.find(f => f.number === filterNum);
                const filterName = filter?.name || `Filter ${filterNum}`;

                // Emit event
                this.emit('filterChanged', {
                    id: filterNum,
                    name: filterName,
                    oldData: oldState ? { ...oldState } : null,
                    newData: { ...newState }
                });

                debug(`  🔔 Filter ${filterNum} (${filterName}): ${oldState?.rawHex || 'NEW'} → ${newState.rawHex}`);
            }

            // Update stored state
            this.filterStates[filterNum] = { ...newState };
        }
    }

}

export default AritechMonitor;
