// Helper function for bitmask properties (prefix.N where N goes from startIndex to endIndex)
function generateBitmaskProps(prefix, startByte, startIndex, endIndex) {
    const props = {};
    for (let i = startIndex; i <= endIndex; i++) {
        const byteOffset = Math.floor((i - startIndex) / 8);
        const bitOffset = (i - startIndex) % 8;
        const mask = 1 << bitOffset;
        props[`${prefix}.${i}`] = [{ byte: startByte + byteOffset, mask }];
    }
    return props;
}

export const messageTemplates = {
    'createSession': {
        msgId: 120,
        msgIdBytes: [0xf0, 0x01],
        templateBytes: [0x00, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 20,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'data': [{ byte: 4, mask: 0xFF, length: 16 }]
        }
    },
    'batch': {
        msgId: 116250679,
        msgIdBytes: [0xEE, 0xE0, 0xEE, 0xEE],
        templateBytes: [],  // Length byte added by caller based on embedded message size
        payloadLength: 5,
        properties: {}
    },
    'createPartArmSession': {
        msgId: 294,
        msgIdBytes: [0xcc, 0x04],
        // Fixed: 10 data bytes for area bitmap (areas 1-64)
        templateBytes: [0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 10,
        properties: {
            ...generateBitmaskProps('area', 4, 1, 64),
            'typeId': [{ byte: 3, mask: 0xFF }],
            'areas-1-32': [{ byte: 4, mask: 0xFF }],
            'areas-33-64': [{ byte: 8, mask: 0xFF }]
        }
    },
    'createPartArm2Session': {
        msgId: 1062,
        msgIdBytes: [0xcc, 0x10],
        // Fixed: 10 data bytes for area bitmap (areas 1-64)
        templateBytes: [0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 10,
        properties: {
            ...generateBitmaskProps('area', 4, 1, 64),
            'typeId': [{ byte: 3, mask: 0xFF }],
            'areas-1-32': [{ byte: 4, mask: 0xFF }],
            'areas-33-64': [{ byte: 8, mask: 0xFF }]
        }
    },
    'createArmSession': {
        msgId: 358,
        msgIdBytes: [0xcc, 0x05],
        // Capture shows 10 data bytes after msgIdBytes: 00 04 01 00 00 00 00 00 00 00
        templateBytes: [0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 10,
        properties: {
            ...generateBitmaskProps('area', 4, 1, 64),
            'typeId': [{ byte: 3, mask: 0xFF }],
            'areas-1-32': [{ byte: 4, mask: 0xFF }],
            'areas-33-64': [{ byte: 8, mask: 0xFF }]
        }
    },
    'createDisarmSession': {
        msgId: 230,
        msgIdBytes: [0xcc, 0x03],
        // Fixed: 10 data bytes for area bitmap (areas 1-64)
        templateBytes: [0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 10,
        properties: {
            ...generateBitmaskProps('area', 4, 1, 64),
            'typeId': [{ byte: 3, mask: 0xFF }],
            'areas-1-32': [{ byte: 4, mask: 0xFF }],
            'areas-33-64': [{ byte: 8, mask: 0xFF }]
        }
    },
    'createOutputControlSession': {
        msgId: 934,
        msgIdBytes: [0xcc, 0x0e],
        templateBytes: [0x00, 0x04, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 8,
        properties: {
            ...generateBitmaskProps('area', 4, 1, 64),
            'typeId': [{ byte: 3, mask: 0xFF }],
            'areas-1-32': [{ byte: 4, mask: 0xFF }],
            'areas-33-64': [{ byte: 8, mask: 0xFF }]
        }
    },
    'createTriggerControlSession': {
        msgId: 678,
        msgIdBytes: [0xcc, 0x0a],
        templateBytes: [0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 12,
        properties: {
            ...generateBitmaskProps('area', 4, 1, 64),
            'typeId': [{ byte: 3, mask: 0xFF }],
            'areas-1-32': [{ byte: 4, mask: 0xFF }],
            'areas-33-64': [{ byte: 8, mask: 0xFF }]
        }
    },
    'createZoneControlSession': {
        msgId: 550,
        msgIdBytes: [0xcc, 0x08],
        templateBytes: [0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 12,
        properties: {
            ...generateBitmaskProps('area', 4, 1, 64),
            'typeId': [{ byte: 3, mask: 0xFF }],
            'areas-1-32': [{ byte: 4, mask: 0xFF }],
            'areas-33-64': [{ byte: 8, mask: 0xFF }]
        }
    },
    'destroyControlSession': {
        msgId: -39,
        msgIdBytes: [0xcd, 0x00],
        templateBytes: [0x00, 0x03, 0x00, 0x00],
        payloadLength: 7,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 4, mask: 0xFF }]
        }
    },
    'deviceDescription': {
        msgId: 4,
        msgIdBytes: [0x08],
        templateBytes: [0x50, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 88,
        properties: {
            'typeId': [{ byte: 1, mask: 0xFF }],
            'deviceName': [{ byte: 3, mask: 0xFF, length: 16, type: 'string' }],
            'productName': [{ byte: 20, mask: 0xFF, length: 16, type: 'string' }],
            'flexibleNumbering': [{ byte: 35, mask: 0x1 }],
            'cdcMode': [{ byte: 35, mask: 0x2 }],
            'firmwareVersion': [{ byte: 37, mask: 0xFF, length: 16, type: 'string' }],
            'serialNumber': [{ byte: 54, mask: 0xFF, length: 16, type: 'string' }],
            'hardwareVariant': [{ byte: 71, mask: 0xFF }],
            'macAddress': [{ byte: 72, mask: 0xFF, length: 6 }],
            'encryptionMode': [{ byte: 78, mask: 0xFF }],
            'panelNorm': [{ byte: 79, mask: 0xFF }],
            'daylightSaving1Month': [{ byte: 80, mask: 0xFF }],
            'daylightSaving2Month': [{ byte: 81, mask: 0xFF }],
            'daylightSaving1Mode': [{ byte: 82, mask: 0xFF }],
            'daylightSaving2Mode': [{ byte: 83, mask: 0xFF }],
            'utcOffset': [{ byte: 84, mask: 0xFF }],
            'customer': [{ byte: 85, mask: 0xFF }],
            'region': [{ byte: 86, mask: 0xFF }],
            'panelLanguage': [{ byte: 87, mask: 0xFF }]
        }
    },
    'logout': {
        msgId: -8,
        msgIdBytes: [0x0f],
        templateBytes: [0x06, 0x00, 0x00],
        payloadLength: 4,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }]
        }
    },
    // x500 panels: PIN-based login (device.getConnect)
    'loginWithPin': {
        msgId: 3,
        msgIdBytes: [0x06],
        // Extended template to include connMethod at byte 22 and userAction_RFU at byte 24
        // Note: byte 9 (0x0b) is some kind of length/type indicator before the PIN field
        templateBytes: [0x06, 0x0b, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 25,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'canUpload': [{ byte: 4, mask: 0xFF }],
            'canDownload': [{ byte: 5, mask: 0xFF }],
            'canControl': [{ byte: 6, mask: 0xFF }],
            'canMonitor': [{ byte: 7, mask: 0xFF }],
            'canDiagnose': [{ byte: 8, mask: 0xFF }],
            'canReadLogs': [{ byte: 9, mask: 0xFF }],
            'pinCode': [{ byte: 11, mask: 0xFF, length: 10 }],  // Fixed-length field starting at byte 11
            'userPin2': [{ byte: 21, mask: 0xFF, length: 1, type: 'string' }],
            'connectionMethod': [{ byte: 22, mask: 0xFF }],
            'connectionMethodExtended': [{ byte: 23, mask: 0xFF }],
            'reservedForFutureUse': [{ byte: 24, mask: 0xFF }]
        }
    },
    // x700 panels: Username/password login (device.getLogPassConnect)
    // Based on mobile app capture - payloadLength 79 bytes (including msgId byte)
    // Byte layout: [0x06][0x0f][0x06][6 permission flags][0x20 usrlen][32-byte username][0x20 pwdlen][32-byte password][connMethod][connMethodExt][RFU]
    // Mobile app payload: 060f06 010001010101 20 cccc...32bytes... 20 cccc...32bytes... 030000
    'loginWithAccount': {
        msgId: 3,
        msgIdBytes: [0x06],
        templateBytes: [
            0x06, 0x0f, 0x06,  // templateBytes 0-2: sub-type markers
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // templateBytes 3-8: 6 permission flags (upload, download, control, monitor, diagnose, readLogs)
            0x20,              // templateBytes 9: username length marker (0x20 = 32, fixed)
            ...Array(32).fill(0x00),  // templateBytes 10-41: username (32 bytes, null-padded)
            0x20,              // templateBytes 42: password length marker (0x20 = 32, fixed)
            ...Array(32).fill(0x00),  // templateBytes 43-74: password (32 bytes, null-padded)
            0x00, 0x00, 0x00   // templateBytes 75-77: connMethod, connMethodExt, RFU
        ],
        payloadLength: 79,  // including msgId byte
        properties: {
            // Byte offsets are relative to after header (byte 0 = msgId), so bufferIndex = byteOffset + 1
            // Use type: 'byte' for single-byte values to prevent 2-byte writes
            'canUpload': [{ byte: 4, mask: 0xFF, type: 'byte' }],         // templateBytes[3]
            'canDownload': [{ byte: 5, mask: 0xFF, type: 'byte' }],       // templateBytes[4]
            'canControl': [{ byte: 6, mask: 0xFF, type: 'byte' }],        // templateBytes[5]
            'canMonitor': [{ byte: 7, mask: 0xFF, type: 'byte' }],        // templateBytes[6]
            'canDiagnose': [{ byte: 8, mask: 0xFF, type: 'byte' }],       // templateBytes[7]
            'canReadLogs': [{ byte: 9, mask: 0xFF, type: 'byte' }],       // templateBytes[8]
            'username': [{ byte: 11, mask: 0xFF, length: 32 }],           // templateBytes[10-41], skip len marker at byte 10
            'password': [{ byte: 44, mask: 0xFF, length: 32 }],           // templateBytes[43-74], skip len marker at byte 43
            'connectionMethod': [{ byte: 76, mask: 0xFF, type: 'byte' }],       // templateBytes[75]
            'connectionMethodExtended': [{ byte: 77, mask: 0xFF, type: 'byte' }], // templateBytes[76]
            'reservedForFutureUse': [{ byte: 78, mask: 0xFF, type: 'byte' }]    // templateBytes[77]
        }
    },
    'getDeviceInfo': {
        msgId: -2,
        msgIdBytes: [0x03],
        templateBytes: [0x50, 0x00, 0x00],
        payloadLength: 4,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }]
        }
    },
    'enableEncryptionKey': {
        msgId: 120,
        msgIdBytes: [0xf0, 0x01],
        templateBytes: [0x00, 0x00],
        payloadLength: 4,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }]
        }
    },
    'setAreaForced': {
        msgId: -5416,
        msgIdBytes: [0xcf, 0x54],
        templateBytes: [0x00, 0x03, 0x00, 0x00],
        payloadLength: 7,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 4, mask: 0xFF }, { byte: 5, mask: 0xFF }]
        }
    },
    'getActiveZones': {
        msgId: -5480,
        msgIdBytes: [0xcf, 0x55],
        templateBytes: [0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 8,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 5, mask: 0xFF }, { byte: 6, mask: 0xFF }],
            'next': [{ byte: 7, mask: 0xFF }]
        }
    },
    'getFaultZones': {
        msgId: -5288,
        msgIdBytes: [0xcf, 0x52],
        templateBytes: [0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 8,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 5, mask: 0xFF }, { byte: 6, mask: 0xFF }],
            'next': [{ byte: 7, mask: 0xFF }]
        }
    },
    'getInhibitedZones': {
        msgId: -5608,
        msgIdBytes: [0xcf, 0x57],
        templateBytes: [0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 8,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 5, mask: 0xFF }, { byte: 6, mask: 0xFF }],
            'next': [{ byte: 7, mask: 0xFF }]
        }
    },
    'armAreas': {
        msgId: -5224,
        msgIdBytes: [0xcf, 0x51],
        // Capture shows 7 bytes total: c0 cf51 00 03 XX YY (sessionId is 2 bytes)
        templateBytes: [0x00, 0x03, 0x00, 0x00],
        payloadLength: 7,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 4, mask: 0xFF }]
        }
    },
    'disarmAreas': {
        msgId: -3176,
        msgIdBytes: [0xcf, 0x31],
        templateBytes: [0x00, 0x03, 0x00, 0x00],
        payloadLength: 7,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 4, mask: 0xFF }]
        }
    },
    'activateOutput': {
        msgId: -276584,
        msgIdBytes: [0xcf, 0xe1, 0x21],
        templateBytes: [0x02, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 8,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 4, mask: 0xFF }],
            'objectId': [{ byte: 7, mask: 0xFF }]
        }
    },
    'deactivateOutput': {
        msgId: -276648,
        msgIdBytes: [0xcf, 0xe2, 0x21],
        templateBytes: [0x02, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 8,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 4, mask: 0xFF }],
            'objectId': [{ byte: 7, mask: 0xFF }]
        }
    },
    'activateTrigger': {
        msgId: -272488,
        msgIdBytes: [0xcf, 0xa1, 0x21],
        // Capture shows: c0 cfa121 02 XX YY 00 ZZ (sessionId is 2 bytes)
        templateBytes: [0x02, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 9,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 4, mask: 0xFF }],
            'objectId': [{ byte: 7, mask: 0xFF }]
        }
    },
    'deactivateTrigger': {
        msgId: -272552,
        msgIdBytes: [0xcf, 0xa2, 0x21],
        templateBytes: [0x02, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 9,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 4, mask: 0xFF }],
            'objectId': [{ byte: 7, mask: 0xFF }]
        }
    },
    'inhibitZone': {
        msgId: -270568,
        msgIdBytes: [0xcf, 0x83, 0x21],
        templateBytes: [0x02, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 8,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 4, mask: 0xFF }],
            'objectId': [{ byte: 7, mask: 0xFF }]
        }
    },
    'uninhibitZone': {
        msgId: -270632,
        msgIdBytes: [0xcf, 0x84, 0x21],
        templateBytes: [0x02, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 8,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 4, mask: 0xFF }],
            'objectId': [{ byte: 7, mask: 0xFF }]
        }
    },
    'getUserInfo': {
        msgId: 228,
        msgIdBytes: [0xc8, 0x03],
        templateBytes: [0x00, 0x00],
        payloadLength: 4,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }]
        }
    },
    'getZonesAssignedToAreas': {
        msgId: 484,
        msgIdBytes: [0xc8, 0x07],
        templateBytes: [0x21, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 12,
        properties: {
            ...generateBitmaskProps('area', 4, 1, 64),
            'typeId': [{ byte: 3, mask: 0xFF }],
            // 32-bit bitmasks for bulk area selection (little-endian)
            'areas-1-32': [{ byte: 4, mask: 0xFF }, { byte: 5, mask: 0xFF }, { byte: 6, mask: 0xFF }, { byte: 7, mask: 0xFF }],
            'areas-33-64': [{ byte: 8, mask: 0xFF }, { byte: 9, mask: 0xFF }, { byte: 10, mask: 0xFF }, { byte: 11, mask: 0xFF }]
        }
    },
    'getAreaChanges': {
        msgId: 165,
        msgIdBytes: [0xca, 0x02],
        templateBytes: [0x00, 0x00],
        payloadLength: 4,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }]
        }
    },
    'getOutputChanges': {
        msgId: 485,
        msgIdBytes: [0xca, 0x07],
        templateBytes: [0x00, 0x00],
        payloadLength: 4,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }]
        }
    },
    'getTriggerChanges': {
        msgId: 1317,
        msgIdBytes: [0xca, 0x14],
        templateBytes: [0x00, 0x00],
        payloadLength: 4,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }]
        }
    },
    'getZoneChanges': {
        msgId: 101,
        msgIdBytes: [0xca, 0x01],
        templateBytes: [0x00, 0x00],
        payloadLength: 4,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }]
        }
    },
    'getAreaStatus': {
        msgId: -166,
        msgIdBytes: [0xcb, 0x02],
        templateBytes: [0x00, 0x03, 0x00, 0x00],
        payloadLength: 6,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'objectId': [{ byte: 5, mask: 0xFF }]
        }
    },
    'getOutputStatus': {
        msgId: -486,
        msgIdBytes: [0xcb, 0x07],
        templateBytes: [0x00, 0x03, 0x00, 0x00],
        payloadLength: 6,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'objectId': [{ byte: 5, mask: 0xFF }]
        }
    },
    'getTriggerStatus': {
        msgId: -1318,
        msgIdBytes: [0xcb, 0x14],
        templateBytes: [0x00, 0x03, 0x00, 0x00],
        payloadLength: 6,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'objectId': [{ byte: 5, mask: 0xFF }]
        }
    },
    'getZoneStatus': {
        msgId: -102,
        msgIdBytes: [0xcb, 0x01],
        templateBytes: [0x00, 0x03, 0x00, 0x00],
        payloadLength: 6,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'objectId': [{ byte: 5, mask: 0xFF }]
        }
    },
    'getValidAreas': {
        msgId: 13,
        msgIdBytes: [0x1a],
        templateBytes: [0x02, 0x00, 0x00],
        payloadLength: 4,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }]
        }
    },
    'ping': {
        msgId: 3,
        msgIdBytes: [0x06],
        templateBytes: [0x68, 0x00, 0x00],
        payloadLength: 4,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }]
        }
    },
    'openLog': {
        msgId: 3,
        msgIdBytes: [0x06],
        templateBytes: [0x0d, 0x00, 0x00],
        payloadLength: 4,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }]
        }
    },
    'areaNames': {
        msgId: -13,
        msgIdBytes: [0x19],
        templateBytes: [0x02, 0x00, 0x00, 0x10],
        payloadLength: 5,
        properties: {
            'name': [{ byte: -1, mask: 0xFF, length: 16, type: 'string' }],
            'index': [{ byte: 3, mask: 0xFF }]
        }
    },
    'outputNames': {
        msgId: -13,
        msgIdBytes: [0x19],
        templateBytes: [0x07, 0x00, 0x00, 0x10],
        payloadLength: 5,
        properties: {
            'name': [{ byte: -1, mask: 0xFF, length: 16, type: 'string' }],
            'index': [{ byte: 3, mask: 0xFF }]
        }
    },
    'triggerNames': {
        msgId: -13,
        msgIdBytes: [0x19],
        templateBytes: [0x14, 0x00, 0x00, 0x10],
        payloadLength: 5,
        properties: {
            'name': [{ byte: -1, mask: 0xFF, length: 16, type: 'string' }],
            'index': [{ byte: 3, mask: 0xFF }]
        }
    },
    'zoneNames': {
        msgId: -13,
        msgIdBytes: [0x19],
        templateBytes: [0x01, 0x00, 0x00, 0x10],
        payloadLength: 5,
        properties: {
            'name': [{ byte: -1, mask: 0xFF, length: 16, type: 'string' }],
            'index': [{ byte: 3, mask: 0xFF }]
        }
    },
    'zonesAssignedToAreas': {
        msgId: 16,
        msgIdBytes: [0x20],
        templateBytes: [0x0a],
        payloadLength: 2,
        properties: {
            'bitset': [{ byte: 2, mask: 0xFF }]
        }
    },
    'booleanResponse': {
        msgId: 0,
        msgIdBytes: [0x00],
        templateBytes: [0x01, 0x00],
        payloadLength: 3,
        properties: {
            'result': [{ byte: 2, mask: 0xFF, type: 'bool' }]
        }
    },
    'logEntry': {
        msgId: -7,
        msgIdBytes: [0x0d],
        templateBytes: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 61,
        properties: {
            'timestamp': [{ byte: 9, mask: 0xFF }],
            'uniqueId': [{ byte: 13, mask: 0xFF }],
            'logType': [{ byte: 14, mask: 0xFF }],
            'eventId': [{ byte: 16, mask: 0xFF }],
            'eventSource': [{ byte: 17, mask: 0xFF }],
            'sourceId': [{ byte: 19, mask: 0xFF }],
            'area': [{ byte: 20, mask: 0xFF }],
            'location': [{ byte: 21, mask: 0xFF }],
            'pcConnection': [{ byte: 21, mask: 0xFF }],
            'wiegandInterface': [{ byte: 21, mask: 0xFF }],
            'regionId': [{ byte: 21, mask: 0xFF }],
            'region': [{ byte: 21, mask: 0xFF }],
            'subDgp': [{ byte: 21, mask: 0xFF }],
            'smsCount': [{ byte: 21, mask: 0xFF }],
            'status': [{ byte: 21, mask: 0xFF }],
            'path': [{ byte: 21, mask: 0xFF }],
            'mainDgp': [{ byte: 21, mask: 0xFF }],
            'shockGross': [{ byte: 21, mask: 0xFF }],
            'cameraMode': [{ byte: 21, mask: 0xFF }],
            'objectClass': [{ byte: 21, mask: 0xFF }],
            'input': [{ byte: 21, mask: 0xFF }],
            'battery': [{ byte: 21, mask: 0xFF }],
            'charger': [{ byte: 21, mask: 0xFF }],
            'accessReaderId': [{ byte: 22, mask: 0xFF }],
            'dealerLogDownload': [{ byte: 22, mask: 0xFF }],
            'shockPulse': [{ byte: 22, mask: 0xFF }],
            'door': [{ byte: 22, mask: 0xFF }],
            'sessionType': [{ byte: 22, mask: 0xFF }],
            'batteryResistance': [{ byte: 22, mask: 0xFF }],
            'pictureId': [{ byte: 22, mask: 0xFF }],
            'dealerLogPowerSource': [{ byte: 23, mask: 0xFF }],
            'dealerLogChargeSource': [{ byte: 23, mask: 0xFF }],
            'pictureSource': [{ byte: 23, mask: 0xFF }],
            'subdeviceUserId': [{ byte: 23, mask: 0xFF }],
            'note': [{ byte: 24, mask: 0xFF }],
            'fuse': [{ byte: 24, mask: 0xFF }],
            'siren': [{ byte: 24, mask: 0xFF }],
            'dealerLogReportEvent': [{ byte: 24, mask: 0xFF }],
            'tamper': [{ byte: 24, mask: 0xFF }],
            'ras': [{ byte: 24, mask: 0xFF }],
            'userId': [{ byte: 24, mask: 0xFF }],
            'centralStation': [{ byte: 24, mask: 0xFF }],
            'systemFaultId': [{ byte: 24, mask: 0xFF }],
            'accessUserId': [{ byte: 24, mask: 0xFF }],
            'accessRegionId': [{ byte: 25, mask: 0xFF }],
            'lift': [{ byte: 25, mask: 0xFF }],
            'rssi': [{ byte: 25, mask: 0xFF }],
            'pictureSourceId': [{ byte: 25, mask: 0xFF }],
            'detailsTimestamp': [{ byte: 28, mask: 0xFF }],
            'userCardNumber': [{ byte: 29, mask: 0xF }],
            'userCardData': [{ byte: 29, mask: 0xF }],
            'userCard': [{ byte: 29, mask: 0xFF, length: 15 }],
            'userCardSize': [{ byte: 29, mask: 0xF }],
            'eventText': [{ byte: 29, mask: 0xFF, length: 32, type: 'string' }]
        }
    },
    'shortResponse': {
        msgId: 0,
        msgIdBytes: [0x00],
        templateBytes: [0x03, 0x00, 0x00],
        payloadLength: 4,
        properties: {
            // Result is 2 bytes at positions 2-3 (little-endian)
            // fnCC messages only use the low byte of this value
            'result': [{ byte: 2, mask: 0xFF }, { byte: 3, mask: 0xFF }]
        }
    },
    'controlSessionStatus': {
        msgId: 16,
        msgIdBytes: [0x20],
        templateBytes: [0x00, 0x00, 0x00],
        payloadLength: 4,
        properties: {
            // stateId is big-endian (high byte first)
            'stateId': [{ byte: 3, mask: 0xFF }, { byte: 2, mask: 0xFF }]
        }
    },
    'validAreas': {
        msgId: -14,
        msgIdBytes: [0x1b],
        templateBytes: [0x02],
        payloadLength: 2,
        properties: {
            'bitset': [{ byte: 2, mask: 0xFF }]
        }
    },
    'areaStatus': {
        msgId: -25,
        msgIdBytes: [0x31],
        templateBytes: [0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 14,
        properties: {
            'objectId': [{ byte: 3, mask: 0xFF }],
            'hasFullSetAlarm': [{ byte: 4, mask: 0x80 }],
            'hasUnsetAlarm': [{ byte: 4, mask: 0x40 }],
            'isAlarming': [{ byte: 4, mask: 0x8 }],
            'hasPartSetAlarm': [{ byte: 4, mask: 0x20 }],
            'isUnset': [{ byte: 4, mask: 0x4 }],
            'isFullSet': [{ byte: 4, mask: 0x1 }],
            'hasFullSetAlarm2': [{ byte: 4, mask: 0x10 }],
            'isPartiallySet': [{ byte: 4, mask: 0x2 }],
            'hasFireDoor': [{ byte: 5, mask: 0x1 }],
            'hasFire': [{ byte: 5, mask: 0x20 }],
            'hasFullSetFireDoor': [{ byte: 5, mask: 0x10 }],
            'hasPartSetFireDoor': [{ byte: 5, mask: 0x4 }],
            'hasUnsetFireDoor': [{ byte: 5, mask: 0x8 }],
            'hasFullSetFire': [{ byte: 5, mask: 0x40 }],
            'hasFullSetFireDoor2': [{ byte: 5, mask: 0x2 }],
            'hasPartSetFire': [{ byte: 5, mask: 0x80 }],
            'hasPanic': [{ byte: 6, mask: 0x4 }],
            'hasMedical': [{ byte: 6, mask: 0x80 }],
            'hasPartSetPanic': [{ byte: 6, mask: 0x10 }],
            'hasUnsetPanic': [{ byte: 6, mask: 0x20 }],
            'hasFullSetFire3': [{ byte: 6, mask: 0x2 }],
            'hasUnsetFire': [{ byte: 6, mask: 0x1 }],
            'hasFullSetPanic': [{ byte: 6, mask: 0x8 }],
            'hasFullSetPanic2': [{ byte: 6, mask: 0x40 }],
            'hasTechnical': [{ byte: 7, mask: 0x10 }],
            'hasPartSetMedical': [{ byte: 7, mask: 0x2 }],
            'hasUnsetTechnical': [{ byte: 7, mask: 0x80 }],
            'hasUnsetMedical': [{ byte: 7, mask: 0x4 }],
            'hasFullSetMedical': [{ byte: 7, mask: 0x1 }],
            'hasPartSetTechnical': [{ byte: 7, mask: 0x40 }],
            'hasFullSetMedical2': [{ byte: 7, mask: 0x8 }],
            'hasFullSetTechnical': [{ byte: 7, mask: 0x20 }],
            'hasDoorbell': [{ byte: 8, mask: 0x40 }],
            'hasFullSetTechnical2': [{ byte: 8, mask: 0x1 }],
            'isTampered': [{ byte: 8, mask: 0x2 }],
            'hasFullSetTamper': [{ byte: 8, mask: 0x4 }],
            'hasFullSetTamper2': [{ byte: 8, mask: 0x20 }],
            'hasUnsetTamper': [{ byte: 8, mask: 0x10 }],
            'hasPartSetTamper': [{ byte: 8, mask: 0x8 }],
            'hasPartSetDoorbell': [{ byte: 8, mask: 0x80 }],
            'hasZoneFaults': [{ byte: 9, mask: 0x10 }],
            'hasRasTamper': [{ byte: 9, mask: 0x80 }],
            'hasZoneAntiMask': [{ byte: 9, mask: 0x20 }],
            'hasActiveZones': [{ byte: 9, mask: 0x2 }],
            'hasIsolatedZones': [{ byte: 9, mask: 0x8 }],
            'hasZoneTamper': [{ byte: 9, mask: 0x40 }],
            'hasInhibitedZones': [{ byte: 9, mask: 0x4 }],
            'hasUnsetDoorbell': [{ byte: 9, mask: 0x1 }],
            'hasFullSetDuress': [{ byte: 10, mask: 0x80 }],
            'hasFullSetDuress2': [{ byte: 10, mask: 0x10 }],
            'hasPartSetDuress': [{ byte: 10, mask: 0x20 }],
            'hasRasFault': [{ byte: 10, mask: 0x1 }],
            'hasDgpTamper': [{ byte: 10, mask: 0x2 }],
            'hasUnsetDuress': [{ byte: 10, mask: 0x40 }],
            'hasDuress': [{ byte: 10, mask: 0x8 }],
            'hasDgpFault': [{ byte: 10, mask: 0x4 }],
            'isExiting': [{ byte: 11, mask: 0x4 }],
            'hasExitFault': [{ byte: 11, mask: 0x8 }],
            'hasCodeTamper': [{ byte: 11, mask: 0x1 }],
            'isReadyToArm': [{ byte: 11, mask: 0x10 }],
            'isSetOk': [{ byte: 11, mask: 0x20 }],
            'hasSetFault': [{ byte: 11, mask: 0x40 }],
            'isEntering': [{ byte: 11, mask: 0x2 }],
            'isUnsetOk': [{ byte: 11, mask: 0x80 }],
            'hasAAlarm': [{ byte: 12, mask: 0x10 }],
            'isFireReset': [{ byte: 12, mask: 0x2 }],
            'hasBAlarm': [{ byte: 12, mask: 0x20 }],
            'hasWalkZoneActive': [{ byte: 12, mask: 0x8 }],
            'isAlarmAcknowledged': [{ byte: 12, mask: 0x1 }],
            'isInternalSiren': [{ byte: 12, mask: 0x40 }],
            'isExternalSiren': [{ byte: 12, mask: 0x80 }],
            'isWalking': [{ byte: 12, mask: 0x4 }],
            'hasHbAlarm': [{ byte: 13, mask: 0x80 }],
            'hasHaAlarm': [{ byte: 13, mask: 0x40 }],
            'hasWarning': [{ byte: 13, mask: 0x10 }],
            'isAutoArm': [{ byte: 13, mask: 0x20 }],
            'isBuzzerActive': [{ byte: 13, mask: 0x2 }],
            'isPartiallySet2': [{ byte: 13, mask: 0x8 }],
            'isAntiMaskReset': [{ byte: 13, mask: 0x4 }],
            'isStrobeActive': [{ byte: 13, mask: 0x1 }],
            'isAutoArmExtendedTime': [{ byte: 14, mask: 0x80 }],
            'hasZoneIsolateLimit': [{ byte: 14, mask: 0x2 }],
            'isAutoArmTime': [{ byte: 14, mask: 0x20 }],
            'hasZoneInhibitLimit': [{ byte: 14, mask: 0x1 }],
            'hasZoneShuntLimit': [{ byte: 14, mask: 0x4 }],
            'isAutoArmWarningTime': [{ byte: 14, mask: 0x40 }],
            'hasIsolateLimitFault': [{ byte: 14, mask: 0x8 }],
            'isAutoArmDelay': [{ byte: 14, mask: 0x10 }],
            'isSensorReset': [{ byte: 15, mask: 0x40 }],
            'hasZoneDelayedShunt': [{ byte: 15, mask: 0x1 }],
            'hasZoneDelayedShuntWarning': [{ byte: 15, mask: 0x2 }],
            'hasZoneShunt': [{ byte: 15, mask: 0x10 }],
            'isProhibitUnset': [{ byte: 15, mask: 0x8 }],
            'isUnsetDelayed': [{ byte: 15, mask: 0x4 }],
            'isScheduled': [{ byte: 15, mask: 0x80 }],
            'hasShuntFault': [{ byte: 15, mask: 0x20 }],
            'hasZoneMainsFail': [{ byte: 16, mask: 0x8 }],
            'hasVocTamper': [{ byte: 16, mask: 0x2 }],
            'isFaultAcknowledged': [{ byte: 16, mask: 0x20 }],
            'hasVocFault': [{ byte: 16, mask: 0x4 }],
            'hasReaderTamper': [{ byte: 16, mask: 0x1 }],
            'hasZoneJamFail': [{ byte: 16, mask: 0x10 }],
            'hasVocTamperV21': [{ byte: 16, mask: 0x1 }],
            'hasVocFaultV21': [{ byte: 16, mask: 0x2 }]
        }
    },
    'outputStatus': {
        msgId: -25,
        msgIdBytes: [0x31],
        templateBytes: [0x07, 0x00, 0x00, 0x00],
        payloadLength: 5,
        properties: {
            'objectId': [{ byte: 3, mask: 0xFF }],
            'isActive': [{ byte: 4, mask: 0x1 }],
            'isOn': [{ byte: 4, mask: 0x2 }],
            'isForced': [{ byte: 4, mask: 0x4 }]
        }
    },
    'triggerStatus': {
        msgId: -25,
        msgIdBytes: [0x31],
        templateBytes: [0x14, 0x00, 0x00, 0x00],
        payloadLength: 5,
        properties: {
            'objectId': [{ byte: 3, mask: 0xFF }],
            'isRemoteOutput': [{ byte: 4, mask: 0x8 }],
            'isFob': [{ byte: 4, mask: 0x40 }],
            'isKeyfobSwitch1': [{ byte: 4, mask: 0x1 }],
            'isKeyfobSwitch2': [{ byte: 4, mask: 0x2 }],
            'isSchedule': [{ byte: 4, mask: 0x20 }],
            'isKeyfobSwitch12': [{ byte: 4, mask: 0x4 }],
            'isFunctionKey': [{ byte: 4, mask: 0x10 }]
        }
    },
    'zoneStatus': {
        msgId: -25,
        msgIdBytes: [0x31],
        templateBytes: [0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
        payloadLength: 7,
        properties: {
            'objectId': [{ byte: 3, mask: 0xFF }],
            'hasFault': [{ byte: 4, mask: 0x10 }],
            'isDirty': [{ byte: 4, mask: 0x20 }],
            'hasSupervisoryLong': [{ byte: 4, mask: 0x80 }],
            'isTampered': [{ byte: 4, mask: 0x2 }],
            'hasSupervisoryShort': [{ byte: 4, mask: 0x40 }],
            'isActive': [{ byte: 4, mask: 0x1 }],
            'hasBatteryFault': [{ byte: 4, mask: 0x8 }],
            'isAntiMask': [{ byte: 4, mask: 0x4 }],
            'isLearned': [{ byte: 5, mask: 0x20 }],
            'isHeldOpen': [{ byte: 5, mask: 0x80 }],
            'isPreLearned': [{ byte: 5, mask: 0x40 }],
            'isIsolated': [{ byte: 5, mask: 0x2 }],
            'isInhibited': [{ byte: 5, mask: 0x1 }],
            'isInSoakTest': [{ byte: 5, mask: 0x4 }],
            'isSet': [{ byte: 5, mask: 0x8 }],
            'isAlarming': [{ byte: 5, mask: 0x10 }],
            'hasRfJamFault': [{ byte: 6, mask: 0x40 }],
            'hasDelayedShuntWarning': [{ byte: 6, mask: 0x10 }],
            'isShunted': [{ byte: 6, mask: 0x2 }],
            'hasShuntFault': [{ byte: 6, mask: 0x4 }],
            'hasMainsFail': [{ byte: 6, mask: 0x20 }],
            'hasDelayedShunt': [{ byte: 6, mask: 0x8 }],
            'hasInvalidWireType': [{ byte: 6, mask: 0x1 }]
        }
    },
    'getAreaNames': {
        msgId: 12,
        msgIdBytes: [0x18],
        templateBytes: [0x02, 0x00, 0x03, 0x00, 0x00],
        payloadLength: 6,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'index': [{ byte: 5, mask: 0xFF }]
        }
    },
    'getOutputNames': {
        msgId: 12,
        msgIdBytes: [0x18],
        templateBytes: [0x07, 0x00, 0x03, 0x00, 0x00],
        payloadLength: 6,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'index': [{ byte: 5, mask: 0xFF }]
        }
    },
    'getTriggerNames': {
        msgId: 12,
        msgIdBytes: [0x18],
        templateBytes: [0x14, 0x00, 0x03, 0x00, 0x00],
        payloadLength: 6,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'index': [{ byte: 5, mask: 0xFF }]
        }
    },
    'getZoneNames': {
        msgId: 12,
        msgIdBytes: [0x18],
        templateBytes: [0x01, 0x00, 0x03, 0x00, 0x00],
        payloadLength: 6,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'index': [{ byte: 5, mask: 0xFF }]
        }
    },
    // Extended format for name queries (x700 panels and x500 panels with protocol 4.4+)
    // Uses 0x19 message ID (same as response), 30-byte names, 4 names per page
    'getAreaNamesExtended': {
        msgId: -13,
        msgIdBytes: [0x19],
        templateBytes: [0x02, 0x00, 0x03, 0x00, 0x00],
        payloadLength: 6,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'index': [{ byte: 5, mask: 0xFF }]
        }
    },
    'getZoneNamesExtended': {
        msgId: -13,
        msgIdBytes: [0x19],
        templateBytes: [0x01, 0x00, 0x03, 0x00, 0x00],
        payloadLength: 6,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'index': [{ byte: 5, mask: 0xFF }]
        }
    },
    'selectLogEntry': {
        msgId: -2,
        msgIdBytes: [0x03],
        templateBytes: [0x0d, 0x00, 0x02, 0x00],
        payloadLength: 5,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'logReadingDirection': [{ byte: 4, mask: 0xFF }]
        }
    },
    // x700 panels require start.MONITOR before reading event logs
    'startMonitor': {
        msgId: -101,
        msgIdBytes: [0xc9, 0x01],
        templateBytes: [0x00, 0x00],
        payloadLength: 4,
        properties: {}
    },
    'getControlSessionStatus': {
        msgId: 39,
        msgIdBytes: [0xce, 0x00],
        templateBytes: [0x00, 0x03, 0x00, 0x00],
        payloadLength: 7,
        properties: {
            'typeId': [{ byte: 3, mask: 0xFF }],
            'sessionId': [{ byte: 4, mask: 0xFF }]
        }
    }
};
