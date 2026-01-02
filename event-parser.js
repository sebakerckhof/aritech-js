#!/usr/bin/env node

/**
 * Aritech ATS Event Log Parser
 * Parses 70-byte event messages into structured JSON
 *
 * Event data structure (70 bytes total):
 *   Bytes 0-1:   Internal header (0x0020)
 *   Bytes 2-7:   Timestamp in BCD format (YYMMDDhhmmss)
 *   Bytes 8-11:  Reserved/unknown
 *   Byte 12:     Sequence number (0-255, decrements from newest to oldest)
 *   Byte 13:     Log type
 *   Bytes 14-15: Event ID (big-endian, maps to EVENT_TYPES)
 *   Byte 16:     Event source/class ID (high byte of class/device)
 *   Byte 17:     Source sub-ID
 *   Bytes 18-19: Entity ID / sub-type (big-endian)
 *   Byte 20:     Area ID
 *   Bytes 21-27: Detail fields (context-dependent)
 *   Bytes 28-69: Description text (42 bytes, NULL-padded ASCII)
 */

import { EVENT_TYPES, CLASS_ID_STRINGS } from './event-types.js';

// ============================================================================
// EVENT FIELD DEFINITIONS
// ============================================================================

/**
 * Event field byte offsets for x500 panels (70-byte event buffer).
 */
const EVENT_FIELDS_X500 = {
    // Header and timestamp
    header: { byte: 0, length: 2 },
    timestamp: { byte: 2, length: 6 },  // BCD format: YYMMDDhhmmss

    // Event identification
    sequence: { byte: 12, length: 1 },
    logType: { byte: 13, length: 1 },
    eventId: { byte: 14, length: 2, bigEndian: true },
    eventSource: { byte: 16, length: 1 },
    sourceSubId: { byte: 17, length: 1 },
    entityId: { byte: 18, length: 2, bigEndian: true },
    area: { byte: 20, length: 1 },

    // Detail fields (context-dependent based on event type)
    details: { byte: 21, length: 7 },

    // Description text (42 bytes for x500)
    description: { byte: 28, length: 42, type: 'string' }
};

/**
 * Event field byte offsets for x700 panels (60-byte event buffer).
 * Same structure as x500 but with shorter description field.
 */
const EVENT_FIELDS_X700 = {
    // Header and timestamp
    header: { byte: 0, length: 2 },
    timestamp: { byte: 2, length: 6 },  // BCD format: YYMMDDhhmmss

    // Event identification
    sequence: { byte: 12, length: 1 },
    logType: { byte: 13, length: 1 },
    eventId: { byte: 14, length: 2, bigEndian: true },
    eventSource: { byte: 16, length: 1 },
    sourceSubId: { byte: 17, length: 1 },
    entityId: { byte: 18, length: 2, bigEndian: true },
    area: { byte: 20, length: 1 },

    // Detail fields (context-dependent based on event type)
    details: { byte: 21, length: 7 },

    // Description text (32 bytes for x700)
    description: { byte: 28, length: 32, type: 'string' }
};

// Alias for backwards compatibility
const EVENT_FIELDS = EVENT_FIELDS_X500;

// ============================================================================
// PARSING FUNCTIONS
// ============================================================================

/**
 * Read a field value from the event buffer based on field definition
 * @param {Buffer} buffer - Event buffer
 * @param {Object} fieldDef - Field definition { byte, length, bigEndian?, type? }
 * @returns {number|string|Buffer} Field value
 */
function readField(buffer, fieldDef) {
    const { byte: offset, length, bigEndian, type } = fieldDef;

    if (offset + length > buffer.length) {
        return type === 'string' ? '' : 0;
    }

    if (type === 'string') {
        // eslint-disable-next-line no-control-regex
        return buffer.slice(offset, offset + length).toString('ascii').replace(/\x00/g, '').trim();
    }

    if (length === 1) {
        return buffer[offset];
    }

    if (length === 2) {
        return bigEndian ? buffer.readUInt16BE(offset) : buffer.readUInt16LE(offset);
    }

    if (length === 4) {
        return bigEndian ? buffer.readUInt32BE(offset) : buffer.readUInt32LE(offset);
    }

    // Return raw bytes for other lengths
    return buffer.slice(offset, offset + length);
}

/**
 * Parse BCD timestamp bytes into a Date object
 * @param {Buffer} buffer - Event buffer
 * @param {number} offset - Offset to timestamp bytes
 * @returns {Date} Parsed timestamp
 */
function parseBcdTimestamp(buffer, offset) {
    // BCD format: each byte represents two decimal digits in hex
    // e.g., 0x25 = year 25 (2025), 0x12 = month 12
    const year = parseInt(buffer[offset].toString(16).padStart(2, '0'), 10);
    const month = parseInt(buffer[offset + 1].toString(16).padStart(2, '0'), 10);
    const day = parseInt(buffer[offset + 2].toString(16).padStart(2, '0'), 10);
    const hour = parseInt(buffer[offset + 3].toString(16).padStart(2, '0'), 10);
    const minute = parseInt(buffer[offset + 4].toString(16).padStart(2, '0'), 10);
    const second = parseInt(buffer[offset + 5].toString(16).padStart(2, '0'), 10);

    return new Date(2000 + year, month - 1, day, hour, minute, second);
}

/**
 * Parse an event buffer into structured JSON.
 * Auto-detects format based on buffer length:
 * - 60 bytes: x700 panel format (32-byte description)
 * - 70 bytes: x500 panel format (42-byte description)
 *
 * @param {Buffer} eventBuffer - 60 or 70-byte event data
 * @returns {Object} Parsed event object
 */
export function parseEvent(eventBuffer) {
    if (!Buffer.isBuffer(eventBuffer)) {
        throw new Error('Input must be a Buffer');
    }

    // Auto-detect format based on buffer length
    let fields;
    if (eventBuffer.length === 60) {
        fields = EVENT_FIELDS_X700;  // x700 panel format
    } else if (eventBuffer.length === 70) {
        fields = EVENT_FIELDS_X500;  // x500 panel format
    } else {
        throw new Error(`Event buffer must be 60 (x700) or 70 (x500) bytes, got ${eventBuffer.length}`);
    }

    // Parse timestamp from BCD bytes
    const timestamp = parseBcdTimestamp(eventBuffer, fields.timestamp.byte);

    // Read event identification fields
    const sequence = readField(eventBuffer, fields.sequence);
    const logType = readField(eventBuffer, fields.logType);
    const eventId = readField(eventBuffer, fields.eventId);
    const eventSource = readField(eventBuffer, fields.eventSource);
    const sourceSubId = readField(eventBuffer, fields.sourceSubId);
    const entityId = readField(eventBuffer, fields.entityId);
    const areaId = readField(eventBuffer, fields.area);
    const description = readField(eventBuffer, fields.description);

    // Look up event type info
    const eventInfo = EVENT_TYPES[eventId] || {
        code: `UNKNOWN_0x${eventId.toString(16).padStart(4, '0')}`,
        name: 'Unknown event type',
        category: 'Unknown'
    };

    // Construct class/device ID for entity parsing (maintains compatibility)
    const classDeviceId = (eventSource << 8) | sourceSubId;

    // Parse entity information based on class type
    const entityInfo = parseSubType(classDeviceId, entityId);

    return {
        raw: eventBuffer.toString('hex'),
        timestamp: timestamp.toISOString(),
        sequence,
        logType,
        type: eventId,
        name: eventInfo.name,
        category: eventInfo.category,
        classId: entityInfo.classId,
        classType: entityInfo.classType,
        area: areaId ? { id: areaId.toString() } : null,
        entity: {
            type: entityInfo.type,
            id: entityInfo.id,
            description: description || null
        },
        // Include detail bytes for advanced parsing
        details: eventBuffer.slice(fields.details.byte, fields.details.byte + fields.details.length)
    };
}

// ============================================================================
// ENTITY CLASS DEFINITIONS
// ============================================================================

/**
 * Entity class definitions - maps class ID to entity type and whether
 * the low byte represents an area ID or extra data.
 */
const ENTITY_CLASSES = {
    0:  { type: 'zone', hasArea: true },           // ZonesDev
    1:  { type: 'zone', hasArea: true },           // AreasDev
    2:  { type: 'user_group', hasArea: true },     // UserGrpDev
    3:  { type: 'dgp', hasArea: false },           // DgpDev
    5:  { type: 'expander', hasArea: false },      // DGPZoneSensor/DGP0
    6:  { type: 'user', hasArea: true },           // UserDev
    7:  { type: 'output', hasArea: false },        // OutputDev
    8:  { type: 'panel', hasArea: false },         // PanelDev
    9:  { type: 'ras', hasArea: false },           // RasDev
    10: { type: 'central_station', hasArea: false }, // CSDev
    11: { type: 'pc_connection', hasArea: false }, // PCConnDev
    14: { type: 'output', hasArea: false },        // OutputDev
    15: { type: 'filter', hasArea: false },        // FilterDev
    16: { type: 'user', hasArea: true },           // UserDev
    17: { type: 'system', hasArea: false },        // SystemDev
    19: { type: 'trigger', hasArea: false },       // TriggerDev
    20: { type: 'calendar', hasArea: false },      // CalendarDev
    25: { type: 'fob', hasArea: true },            // FobDev
    26: { type: 'camera', hasArea: false },        // CameraDev
    32: { type: 'area_group', hasArea: false },    // AreaGroupsDev
    35: { type: 'region', hasArea: false },        // RegionDev
    36: { type: 'door', hasArea: false },          // DoorDev
    37: { type: 'door_group', hasArea: false },    // DoorGroupDev
    39: { type: 'special_day', hasArea: false },   // SpecialDayDev
    41: { type: 'reader', hasArea: false },        // ReaderDev
    42: { type: 'audio_device', hasArea: false },  // VocDev
    43: { type: 'notification', hasArea: false },  // NotifyDev
};

/**
 * Parse entity information from class/device ID and sub-type fields.
 *
 * @param {number} classDeviceId - Class/Device ID (bytes 16-17 combined)
 * @param {number} subType - Sub-type value (bytes 18-19, entity ID)
 * @returns {Object} Entity information with class type
 */
function parseSubType(classDeviceId, subType) {
    // Extract class ID from high byte
    const classId = (classDeviceId >> 8) & 0xff;
    const classType = CLASS_ID_STRINGS[classId] || `Unknown (${classId})`;

    // Extract entity number from sub-type (high byte = entity ID, low byte = area or extra)
    const entityNumber = (subType >> 8) & 0xff;
    const entityLowByte = subType & 0xff;

    // Look up class definition
    const classDef = ENTITY_CLASSES[classId] || { type: 'unknown', hasArea: false };

    const result = {
        classId,
        classType,
        type: classDef.type,
        id: entityNumber
    };

    // Add area or extra field based on class definition
    if (classDef.hasArea) {
        result.area = entityLowByte;
    } else if (entityLowByte !== 0) {
        result.extra = entityLowByte;
    }

    return result;
}

/**
 * Parse multiple events from a buffer
 * @param {Buffer} buffer - Buffer containing one or more 70-byte events
 * @returns {Array} Array of parsed event objects
 */
export function parseEvents(buffer) {
  const events = [];
  const eventCount = Math.floor(buffer.length / 70);

  for (let i = 0; i < eventCount; i++) {
    const offset = i * 70;
    const eventBuffer = buffer.slice(offset, offset + 70);

    if (eventBuffer.length === 70) {
      try {
        events.push(parseEvent(eventBuffer));
      } catch (error) {
        events.push({
          error: error.message,
          offset,
          raw: eventBuffer.toString('hex')
        });
      }
    }
  }

  return events;
}

// Export field definitions and entity classes for external use
export { EVENT_FIELDS, ENTITY_CLASSES };
