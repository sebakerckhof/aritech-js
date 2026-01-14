/**
 * Message helpers for constructing requests and extracting properties from responses
 *
 * IMPORTANT: Byte offset handling differs between construction and parsing:
 * - constructMessage: DRV byte offsets are relative to after header, so bufferIndex = byteOffset + 1
 * - getProperty: DRV byte offsets are direct indices into the payload buffer
 *
 * Usage:
 *   import { messageTemplates } from './protocol.js';
 *   import { constructMessage, getProperty } from './message-helpers.js';
 *
 *   // Construct a request message
 *   const msg = constructMessage(messageTemplates, 'inhibitZone', {
 *       sessionId: 0x12,
 *       objectId: 5
 *   });
 *   // Result: c0cf83210200120005
 *
 *   // Extract a property from a response payload
 *   const response = Buffer.from([0xa0, 0x31, 0x01, 0x05, 0x11, 0x00, 0x00]);
 *   const isActive = getProperty(messageTemplates, 'zoneStatus', response, 'isActive');
 *   // Result: true (since byte 4 = 0x11, mask 0x01 -> true)
 */

/**
 * Construct a message buffer from a template and properties
 *
 * DRV byte offsets are relative to after the header byte:
 *   byte 0 = first msgId byte
 *   byte N = position in [msgIdBytes][templateBytes]
 *
 * The buffer structure is: [header][msgIdBytes][templateBytes]
 * So bufferIndex = byteOffset + 1 (to account for header)
 *
 * @param {Object} templates - The messageTemplates object
 * @param {string} msgName - Message name (e.g., 'inhibitZone')
 * @param {Object} properties - Property values to set (e.g., { sessionId: 1234, objectId: 5 })
 * @returns {Buffer} The constructed message payload (with header)
 */
export function constructMessage(templates, msgName, properties = {}) {
    const template = templates[msgName];
    if (!template) {
        throw new Error(`Unknown message: ${msgName}`);
    }

    // Calculate total payload size: header (1) + msgIdBytes + templateBytes
    const payloadLength = 1 + template.msgIdBytes.length + template.templateBytes.length;
    const buffer = Buffer.alloc(payloadLength);

    let offset = 0;

    // Write header byte (0xC0 for requests)
    buffer[offset++] = 0xC0;

    // Write message ID bytes
    for (const b of template.msgIdBytes) {
        buffer[offset++] = b;
    }

    // Write template bytes (default values)
    for (const b of template.templateBytes) {
        buffer[offset++] = b;
    }

    // Apply property values
    // DRV byte offsets are relative to after header, so buffer index = byteOffset + 1
    for (const [propName, value] of Object.entries(properties)) {
        const propDef = template.properties[propName];
        if (!propDef) {
            console.warn(`Unknown property '${propName}' for message '${msgName}'`);
            continue;
        }

        // Handle multi-byte properties (array with multiple entries)
        if (Array.isArray(propDef) && propDef.length > 1 && propDef.every(p => p.mask === 0xFF)) {
            // Multi-byte value - write as little-endian across consecutive bytes
            let numValue = Number(value) || 0;
            for (const { byte: byteOffset } of propDef) {
                const bufferIndex = byteOffset + 1; // +1 to skip header
                if (bufferIndex >= 0 && bufferIndex < buffer.length) {
                    buffer[bufferIndex] = numValue & 0xFF;
                    numValue = numValue >> 8;
                }
            }
            continue;
        }

        // Property definition is an array of { byte, mask, length?, type? }
        for (const { byte: byteOffset, mask, length, type } of propDef) {
            const bufferIndex = byteOffset + 1; // +1 to skip header

            if (bufferIndex < 0 || bufferIndex >= buffer.length) {
                console.warn(`Property '${propName}' byte offset ${byteOffset} out of range`);
                continue;
            }

            // Handle Buffer/byte array values (for binary data like keys)
            if (Buffer.isBuffer(value) || (Array.isArray(value) && value.every(v => typeof v === 'number'))) {
                const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
                const maxLen = length || bytes.length;
                for (let i = 0; i < maxLen && bufferIndex + i < buffer.length; i++) {
                    buffer[bufferIndex + i] = i < bytes.length ? bytes[i] : 0;
                }
                continue;
            }

            // Handle string values for type: 'string' properties (length-prefixed)
            if (type === 'string' && typeof value === 'string') {
                const maxLen = length || 16;
                const strBytes = Buffer.from(value, 'ascii');
                buffer[bufferIndex] = Math.min(strBytes.length, maxLen);
                for (let i = 0; i < maxLen && bufferIndex + 1 + i < buffer.length; i++) {
                    buffer[bufferIndex + 1 + i] = i < strBytes.length ? strBytes[i] : 0;
                }
                continue;
            }

            // Handle string values for fixed-length fields (no length prefix, null-padded)
            if (typeof value === 'string' && length) {
                const strBytes = Buffer.from(value, 'ascii');
                for (let i = 0; i < length && bufferIndex + i < buffer.length; i++) {
                    buffer[bufferIndex + i] = i < strBytes.length ? strBytes[i] : 0;
                }
                continue;
            }

            if (mask === 0xFF) {
                // Full byte value - use type hint from property definition if available
                const numValue = Number(value) || 0;
                const typeByteCount = { 'bool': 1, 'byte': 1, 'short': 2, 'int': 4 };

                if (type && typeByteCount[type]) {
                    // Use explicit type from property definition
                    writeVarint(buffer, bufferIndex, numValue, typeByteCount[type]);
                } else if (length && length > 1) {
                    // Explicit length specified
                    writeVarint(buffer, bufferIndex, numValue, length);
                } else {
                    // Default to short (2 bytes) for numeric values
                    writeVarint(buffer, bufferIndex, numValue, 2);
                }
            } else {
                // Bitmask value - set or clear the bit
                if (value) {
                    buffer[bufferIndex] |= mask;
                } else {
                    buffer[bufferIndex] &= ~mask;
                }
            }
        }
    }

    return buffer;
}

/**
 * Extract a property value from a response payload
 *
 * For response parsing, DRV byte offsets are used as direct indices
 * into the payload buffer (no offset adjustment needed).
 *
 * @param {Object} templates - The messageTemplates object
 * @param {string} msgName - Message name (e.g., 'zoneStatus')
 * @param {Buffer} payload - The response payload buffer (including header byte)
 * @param {string} propertyName - Property name to extract (e.g., 'ZNEV_ACTIVE')
 * @returns {number|boolean|string} The property value (boolean for bitmask, number for full byte, string for type:'string')
 */
export function getProperty(templates, msgName, payload, propertyName) {
    const template = templates[msgName];
    if (!template) {
        throw new Error(`Unknown message: ${msgName}`);
    }

    const propDef = template.properties[propertyName];
    if (!propDef) {
        throw new Error(`Unknown property '${propertyName}' for message '${msgName}'`);
    }

    // Get starting byte offset from property definition
    const { byte: byteOffset, mask, length, type } = propDef[0];

    if (byteOffset < 0 || byteOffset >= payload.length) {
        throw new Error(`Property '${propertyName}' byte offset ${byteOffset} out of range (payload length: ${payload.length})`);
    }

    // Handle string type - length-prefixed string
    if (type === 'string') {
        const strLen = payload[byteOffset];
        if (strLen === 0 || byteOffset + 1 + strLen > payload.length) {
            return '';
        }
        return payload.slice(byteOffset + 1, byteOffset + 1 + strLen)
            .toString('ascii')
            .replace(/\0/g, '')
            .trim();
    }

    // Handle numeric types from property definition
    const typeByteCount = { 'bool': 1, 'byte': 1, 'short': 2, 'int': 4 };
    if (type && typeByteCount[type]) {
        const byteCount = typeByteCount[type];
        let value = 0;
        for (let i = 0; i < byteCount && byteOffset + i < payload.length; i++) {
            value |= (payload[byteOffset + i] << (i * 8));
        }
        return type === 'bool' ? value !== 0 : value;
    }

    // Handle multi-byte properties (array with multiple entries in DRV)
    if (Array.isArray(propDef) && propDef.length > 1 && propDef.every(p => p.mask === 0xFF)) {
        // Multi-byte value - read as little-endian across consecutive bytes
        let value = 0;
        for (let i = 0; i < propDef.length; i++) {
            const { byte: offset } = propDef[i];
            if (offset >= 0 && offset < payload.length) {
                value |= (payload[offset] << (i * 8));
            }
        }
        return value;
    }

    if (mask === 0xFF) {
        // Full byte value
        if (length && length > 1) {
            // Multi-byte value
            return readVarint(payload, byteOffset, length);
        } else {
            // Single byte
            return payload[byteOffset];
        }
    } else {
        // Bitmask value - return boolean
        return (payload[byteOffset] & mask) !== 0;
    }
}

/**
 * Extract all properties from a response payload
 *
 * For response parsing, DRV byte offsets are used as direct indices
 * into the payload buffer (no offset adjustment needed).
 *
 * @param {Object} templates - The messageTemplates object
 * @param {string} msgName - Message name (e.g., 'zoneStatus')
 * @param {Buffer} payload - The response payload buffer (including header byte)
 * @returns {Object} Object with all property values
 */
export function getAllProperties(templates, msgName, payload) {
    const template = templates[msgName];
    if (!template) {
        throw new Error(`Unknown message: ${msgName}`);
    }

    const result = {};

    for (const [propName, propDef] of Object.entries(template.properties)) {
        try {
            // Handle multi-byte properties
            if (Array.isArray(propDef) && propDef.length > 1 && propDef.every(p => p.mask === 0xFF)) {
                let value = 0;
                let valid = true;
                for (let i = 0; i < propDef.length; i++) {
                    const { byte: byteOffset } = propDef[i];
                    if (byteOffset >= 0 && byteOffset < payload.length) {
                        value |= (payload[byteOffset] << (i * 8));
                    } else {
                        valid = false;
                        break;
                    }
                }
                if (valid) {
                    result[propName] = value;
                }
                continue;
            }

            const { byte: byteOffset, mask, length, type } = propDef[0];

            if (byteOffset >= 0 && byteOffset < payload.length) {
                // Handle string type
                if (type === 'string') {
                    const strLen = payload[byteOffset];
                    if (strLen > 0 && byteOffset + 1 + strLen <= payload.length) {
                        result[propName] = payload.slice(byteOffset + 1, byteOffset + 1 + strLen)
                            .toString('ascii')
                            .replace(/\0/g, '')
                            .trim();
                    } else {
                        result[propName] = '';
                    }
                } else if (mask === 0xFF) {
                    if (length && length > 1) {
                        result[propName] = readVarint(payload, byteOffset, length);
                    } else {
                        result[propName] = payload[byteOffset];
                    }
                } else {
                    result[propName] = (payload[byteOffset] & mask) !== 0;
                }
            }
        } catch (e) {
            // Skip properties that can't be read
        }
    }

    return result;
}

/**
 * Get only the "active" (truthy) bitmask properties from a response
 * Useful for seeing which flags are set
 *
 * For response parsing, DRV byte offsets are used as direct indices
 * into the payload buffer (no offset adjustment needed).
 *
 * @param {Object} templates - The messageTemplates object
 * @param {string} msgName - Message name
 * @param {Buffer} payload - The response payload buffer (including header byte)
 * @returns {string[]} Array of property names that are true/set
 */
export function getActiveFlags(templates, msgName, payload) {
    const template = templates[msgName];
    if (!template) {
        throw new Error(`Unknown message: ${msgName}`);
    }

    const activeFlags = [];

    for (const [propName, propDef] of Object.entries(template.properties)) {
        const { byte: byteOffset, mask } = propDef[0];

        // Only check bitmask properties (not full-byte values)
        if (mask !== 0xFF && byteOffset >= 0 && byteOffset < payload.length) {
            if ((payload[byteOffset] & mask) !== 0) {
                activeFlags.push(propName);
            }
        }
    }

    return activeFlags;
}

// ============================================================================
// BATCH RESPONSE PARSING
// ============================================================================

// Response payload lengths for batch responses
// Note: These may differ from template definitions due to extended response formats
const BATCH_PAYLOAD_LENGTHS = {
    'areaStatus': 17,   // Extended format in batch responses
    'zoneStatus': 7,
    'triggerStatus': 5,
    'outputStatus': 5,
    'doorStatus': 6,
    'filterStatus': 5,
};

/**
 * Split a batch response into individual messages.
 *
 * Batch response format:
 * - a0 ee ee [typeIndicator] [msg1...] [typeIndicator] [msg2...] ...
 * - For areaStatus: a0 ee ee 11 [31 02 00 id flags...] 11 [31 02 00 id flags...] ...
 * - For zoneStatus: a0 ee ee 07 [31 01 00 id flags...] 07 [31 01 00 id flags...] ...
 *
 * The typeIndicator (11, 07, etc.) precedes each embedded message except the first.
 * The first message starts immediately at offset 4 (after a0 ee ee [typeIndicator]).
 * Between messages there's a single byte separator (same as typeIndicator in header).
 *
 * @param {Object} templates - The messageTemplates object
 * @param {Buffer} response - The batch response buffer (starting with 0xa0)
 * @param {string} expectedTemplate - The expected response template name
 * @returns {Array<{template: string, bytes: Buffer, objectId: number}>} Array of parsed messages
 */
export function splitBatchResponse(templates, response, expectedTemplate) {
    if (!response || response.length < 4) {
        return [];
    }

    const HEADER_RESPONSE = 0xA0;

    // Check for batch response header: a0 ee ee [typeIndicator]
    if (response[0] !== HEADER_RESPONSE || response[1] !== 0xEE || response[2] !== 0xEE) {
        // Not a batch response - might be a single response
        // Try to parse as single message
        const template = templates[expectedTemplate];
        if (template && response[0] === HEADER_RESPONSE) {
            // For single response, strip the a0 header and extract objectId from byte 3
            const msgBytes = response.slice(1);
            const objectId = msgBytes[3];
            return [{
                template: expectedTemplate,
                bytes: msgBytes,
                objectId: objectId
            }];
        }
        return [];
    }

    const messages = [];
    const payloadLength = BATCH_PAYLOAD_LENGTHS[expectedTemplate];

    if (!payloadLength) {
        console.error(`Unknown template for splitting: ${expectedTemplate}`);
        return [];
    }

    // The separator/type indicator is at offset 3 (tells us what type follows)
    const typeIndicator = response[3];

    // First message starts at offset 4 (after a0 ee ee [typeIndicator])
    // Each embedded message is payloadLength bytes
    // After each message (except last), there's a 1-byte separator (typeIndicator)
    let offset = 4;

    while (offset + payloadLength <= response.length) {
        const msgBytes = response.slice(offset, offset + payloadLength);

        // Validate message ID byte (should be 0x31 for status responses)
        const expectedMsgIdByte = templates[expectedTemplate]?.msgIdBytes?.[0];
        if (expectedMsgIdByte && msgBytes[0] !== expectedMsgIdByte) {
            // Unexpected message ID - stop parsing
            break;
        }

        // Extract objectId from byte 3 of the embedded message (after msgId, type, 0x00)
        const objectId = msgBytes[3];

        messages.push({
            template: expectedTemplate,
            bytes: msgBytes,
            objectId: objectId
        });

        offset += payloadLength;

        // Check for separator byte (typeIndicator) between messages
        if (offset < response.length) {
            if (response[offset] === typeIndicator) {
                // Skip separator byte, next message follows
                offset += 1;
            } else {
                // Different byte - might be end of messages or different message type
                break;
            }
        }
    }

    return messages;
}

// ============================================================================
// BATCH REQUEST BUILDERS
// ============================================================================

// Entity type to message name mapping
const GET_STAT_MSG_NAMES = {
    ZONE: 'getZoneStatus',
    AREA: 'getAreaStatus',
    OUTPUT: 'getOutputStatus',
    TRIGGER: 'getTriggerStatus',
    DOOR: 'getDoorStatus',
    FILTER: 'getFilterStatus',
};

/**
 * Build individual getSTAT request for use in batch.
 * Returns message without header (for embedding in batch).
 *
 * @param {Object} templates - The messageTemplates object
 * @param {string} entityType - Entity type: 'ZONE', 'AREA', 'OUTPUT', 'TRIGGER', or 'DOOR'
 * @param {number} entityId - The entity ID (zone number, area number, etc.)
 * @param {boolean} [withSeparator=false] - Whether to append separator byte
 * @returns {Buffer} Message bytes without header
 */
export function buildGetStatRequest(templates, entityType, entityId, withSeparator = false) {
    const msgName = GET_STAT_MSG_NAMES[entityType];
    if (!msgName) {
        throw new Error(`Unknown entity type for getStatus: ${entityType}`);
    }
    const msg = constructMessage(templates, msgName, { objectId: entityId });
    // Remove 0xC0 header for embedding in batch
    const withoutHeader = msg.slice(1);
    if (withSeparator) {
        return Buffer.concat([withoutHeader, Buffer.from([0x06])]);
    }
    return withoutHeader;
}

/**
 * Build batch request for multiple getSTAT queries.
 *
 * @param {Object} templates - The messageTemplates object
 * @param {string} entityType - Entity type: 'ZONE', 'AREA', 'OUTPUT', 'TRIGGER', or 'DOOR'
 * @param {number[]} entityIds - Array of entity IDs to query
 * @returns {Buffer} Complete batch request message
 */
export function buildBatchStatRequest(templates, entityType, entityIds) {
    if (!entityIds || entityIds.length === 0) {
        throw new Error('Entity IDs array cannot be empty');
    }

    const requests = entityIds.map((id, index) => {
        const isLast = index === entityIds.length - 1;
        return buildGetStatRequest(templates, entityType, id, !isLast);
    });

    // Build batch message with embedded requests
    // First byte after msgId is the length of each embedded message (0x06 for getStatus)
    const batchMsg = constructMessage(templates, 'batch', {});
    const lengthByte = Buffer.from([0x06]); // getStatus messages are 6 bytes
    return Buffer.concat([batchMsg, lengthByte, ...requests]);
}

/**
 * Build get.ZonesAssignedToAreas message (valid zones query).
 * By default queries zones for all 64 areas.
 *
 * @param {Object} templates - The messageTemplates object
 * @param {number[]} [areas] - Array of area numbers (1-64), or omit to query all areas
 * @returns {Buffer} Complete request message
 */
export function buildGetValidZonesMessage(templates, areas) {
    if (!areas) {
        // Query all 64 areas using 32-bit bitmasks
        return constructMessage(templates, 'getZonesAssignedToAreas', {
            'areas-1-32': 0xFFFFFFFF,
            'areas-33-64': 0xFFFFFFFF
        });
    }
    // Query specific areas using individual bit properties
    const props = {};
    for (const area of areas) {
        props[`area.${area}`] = true;
    }
    return constructMessage(templates, 'getZonesAssignedToAreas', props);
}

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

// Protocol header constants
const HEADER = {
    REQUEST: 0xC0,   // Client → Panel
    RESPONSE: 0xA0,  // Panel → Client (success)
    ERROR: 0xF0      // Panel → Client (error)
};

/**
 * Check if response is an error (0xF0 header) and throw if so.
 * Note: This function doesn't need templates parameter.
 *
 * @param {Buffer} response - The response buffer
 * @throws {Error} If response has error header
 */
export function checkResponseError(response) {
    if (response && response.length > 0 && response[0] === HEADER.ERROR) {
        const errorCode = response.slice(1).toString('hex');
        throw new Error(`Panel error: ${errorCode}`);
    }
}

/**
 * Check if a response matches a message template by comparing msgIdBytes and first templateByte (typeId).
 *
 * @param {Object} templates - The messageTemplates object
 * @param {Buffer} response - Response buffer (without 0xA0 header, or with header starting at offset)
 * @param {string} msgName - Message template name
 * @param {number} [offset=0] - Offset into response where msgId bytes start
 * @returns {boolean} True if response matches the message template
 */
export function isMessageType(templates, response, msgName, offset = 0) {
    const template = templates[msgName];
    if (!template) return false;

    const { msgIdBytes, templateBytes } = template;
    const totalIdLen = msgIdBytes.length + 1; // msgIdBytes + first templateByte (typeId)

    if (!response || response.length < offset + totalIdLen) return false;

    // Check msgIdBytes match
    for (let i = 0; i < msgIdBytes.length; i++) {
        if (response[offset + i] !== msgIdBytes[i]) return false;
    }

    // Check first templateByte (typeId) matches
    if (response[offset + msgIdBytes.length] !== templateBytes[0]) return false;

    return true;
}

/**
 * Parse createCC response (return.short) to extract sessionId.
 *
 * @param {Object} templates - The messageTemplates object
 * @param {Buffer} response - The response buffer
 * @returns {{sessionId: number}|null} Parsed response or null if invalid
 */
export function parseCreateCCResponse(templates, response) {
    if (!response || response.length < 5 || !isMessageType(templates, response, 'shortResponse', 1)) {
        return null;
    }
    const payload = response.slice(1); // Strip header for getProperty
    // Result is defined as 2 bytes in template, no type hint needed
    const sessionId = getProperty(templates, 'shortResponse', payload, 'result');
    return { sessionId };
}

/**
 * Parse fnCC response (return.bool) to extract boolean result.
 *
 * @param {Object} templates - The messageTemplates object
 * @param {Buffer} response - The response buffer
 * @returns {boolean|null} The boolean result or null if invalid
 */
export function parseReturnBool(templates, response) {
    if (!response || response.length < 4 || !isMessageType(templates, response, 'booleanResponse', 1)) {
        return null;
    }
    const payload = response.slice(1); // Strip header for getProperty
    return getProperty(templates, 'booleanResponse', payload, 'result');
}

/**
 * Build select.getLOG message to fetch event log entries.
 *
 * @param {Object} templates - The messageTemplates object
 * @param {number} [direction=0] - Log reading direction (0=FIRST, 3=NEXT)
 * @returns {Buffer} The request message
 */
export function buildGetEventLogMessage(templates, direction = 0) {
    return constructMessage(templates, 'selectLogEntry', { logReadingDirection: direction });
}

// ============================================================================
// HELPER FACTORY
// ============================================================================

/**
 * Create bound helper methods for a given templates object.
 * This allows using the helpers without passing templates each time.
 *
 * @param {Object} templates - The messageTemplates object to bind
 * @returns {Object} Object containing all bound helper methods
 *
 * @example
 * import { messageTemplates } from './messages.x500.js';
 * import { createHelperMethods } from './message-helpers.js';
 *
 * const helpers = createHelperMethods(messageTemplates);
 * const msg = helpers.constructMessage('getZoneStatus', { objectId: 1 });
 */
export function createHelperMethods(templates) {
    return {
        // Message construction
        constructMessage: constructMessage.bind(null, templates),
        // Property extraction
        getProperty: getProperty.bind(null, templates),
        getAllProperties: getAllProperties.bind(null, templates),
        getActiveFlags: getActiveFlags.bind(null, templates),
        // Batch handling
        splitBatchResponse: splitBatchResponse.bind(null, templates),
        buildGetStatRequest: buildGetStatRequest.bind(null, templates),
        buildBatchStatRequest: buildBatchStatRequest.bind(null, templates),
        buildGetValidZonesMessage: buildGetValidZonesMessage.bind(null, templates),
        // Response helpers
        checkResponseError,  // Doesn't need templates
        isMessageType: isMessageType.bind(null, templates),
        parseCreateCCResponse: parseCreateCCResponse.bind(null, templates),
        parseReturnBool: parseReturnBool.bind(null, templates),
        buildGetEventLogMessage: buildGetEventLogMessage.bind(null, templates),
    };
}

/**
 * Write a varint value to a buffer
 * @private
 */
function writeVarint(buffer, offset, value, maxLength) {
    // Simple implementation - write as little-endian bytes
    for (let i = 0; i < maxLength && offset + i < buffer.length; i++) {
        buffer[offset + i] = (value >> (i * 8)) & 0xFF;
    }
}

/**
 * Read a varint value from a buffer
 * @private
 */
function readVarint(buffer, offset, length) {
    let value = 0;
    for (let i = 0; i < length && offset + i < buffer.length; i++) {
        value |= buffer[offset + i] << (i * 8);
    }
    return value;
}

export default {
    constructMessage,
    getProperty,
    getAllProperties,
    getActiveFlags,
    splitBatchResponse,
    buildGetStatRequest,
    buildBatchStatRequest,
    buildGetValidZonesMessage,
    checkResponseError,
    isMessageType,
    parseCreateCCResponse,
    parseReturnBool,
    buildGetEventLogMessage,
    createHelperMethods
};
