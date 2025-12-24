/**
 * Aritech ATS Panel Utilities
 *
 * Low-level utilities for CRC, SLIP framing, and AES encryption.
 *
 * Protocol details:
 * - AES-CTR encryption (128, 192, or 256 bit keys)
 * - Frame structure: [8-byte nonce][encrypted payload + CRC]
 * - IV = [nonce 8 bytes][serial 6 bytes][padding 2 bytes]
 * - CRC-16 polynomial 0xA001, init 0xFFFF, big-endian
 */

import crypto from 'crypto';

// ============================================================================
// ENCRYPTION MODE CONSTANTS
// ============================================================================

/**
 * Encryption modes supported by the panel
 */
export const EncryptionMode = {
    NONE: 0,
    AES_128: 1,
    AES_192: 2,  // Note: Panel may report this as AES_256
    AES_256: 2,  // Panel reports 2 for AES-256
};

/**
 * Get the required password length for an encryption mode
 * @param {number} mode - Encryption mode
 * @returns {number} Required password length (24, 36, or 48 chars)
 */
export function getPasswordLength(mode) {
    switch (mode) {
        case EncryptionMode.AES_128:
            return 24;
        case EncryptionMode.AES_192:
            return 36;
        case EncryptionMode.AES_256:
            return 48;
        default:
            return 24;
    }
}

/**
 * Get the AES cipher name based on key size
 * @param {number} keySize - Key size in bytes (16, 24, or 32)
 * @returns {string} Node.js crypto cipher name
 */
export function getAesCipherName(keySize) {
    switch (keySize) {
        case 16:
            return 'aes-128-ecb';
        case 24:
            return 'aes-192-ecb';
        case 32:
            return 'aes-256-ecb';
        default:
            throw new Error(`Invalid AES key size: ${keySize}. Must be 16, 24, or 32 bytes.`);
    }
}

// ============================================================================
// SLIP FRAMING
// ============================================================================

export const SLIP_END = 0xC0;
export const SLIP_ESC = 0xDB;
export const SLIP_ESC_END = 0xDC;
export const SLIP_ESC_ESC = 0xDD;

/**
 * Encode data using SLIP framing
 * @param {Buffer} data - Data to encode
 * @returns {Buffer} SLIP-encoded data with END markers
 */
export function slipEncode(data) {
    const result = [SLIP_END];
    for (const byte of data) {
        if (byte === SLIP_END) {
            result.push(SLIP_ESC, SLIP_ESC_END);
        } else if (byte === SLIP_ESC) {
            result.push(SLIP_ESC, SLIP_ESC_ESC);
        } else {
            result.push(byte);
        }
    }
    result.push(SLIP_END);
    return Buffer.from(result);
}

/**
 * Decode SLIP-framed data
 * @param {Buffer} data - SLIP-encoded data
 * @returns {Buffer} Decoded data
 */
export function slipDecode(data) {
    const result = [];
    let i = data[0] === SLIP_END ? 1 : 0;
    while (i < data.length && data[i] !== SLIP_END) {
        if (data[i] === SLIP_ESC && i + 1 < data.length) {
            i++;
            if (data[i] === SLIP_ESC_END) result.push(SLIP_END);
            else if (data[i] === SLIP_ESC_ESC) result.push(SLIP_ESC);
            else result.push(data[i]);
        } else {
            result.push(data[i]);
        }
        i++;
    }
    return Buffer.from(result);
}

// ============================================================================
// CRC-16 (polynomial 0xA001, init 0xFFFF, result big-endian)
// ============================================================================

/**
 * Calculate CRC-16 checksum
 * @param {Buffer} data - Data to checksum
 * @param {number} [offset=0] - Start offset
 * @param {number} [length] - Length to checksum
 * @returns {number} CRC-16 value
 */
export function crc16(data, offset = 0, length = data.length - offset) {
    let crc = 0xFFFF;
    for (let i = 0; i < length; i++) {
        crc = crc ^ data[offset + i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) {
                crc = (crc >>> 1) ^ 0xA001;
            } else {
                crc = crc >>> 1;
            }
        }
    }
    return crc;
}

/**
 * Append CRC-16 checksum to data (big-endian)
 * @param {Buffer} data - Data to append CRC to
 * @returns {Buffer} Data with CRC appended
 */
export function appendCrc(data) {
    const crcVal = crc16(data);
    // Big-endian
    return Buffer.concat([data, Buffer.from([(crcVal >> 8) & 0xFF, crcVal & 0xFF])]);
}

/**
 * Verify CRC-16 checksum
 * @param {Buffer} data - Data with CRC to verify
 * @returns {boolean} True if CRC is valid
 */
export function verifyCrc(data) {
    if (data.length < 3) return false;
    const payload = data.slice(0, -2);
    const frameCrc = (data[data.length - 2] << 8) | data[data.length - 1];
    const calcCrc = crc16(payload);
    return frameCrc === calcCrc;
}

// ============================================================================
// ENCRYPTION KEY DERIVATION
// ============================================================================

/**
 * Gray pack encoding for key derivation
 * @private
 */
function grayPack(value) {
    const num = value ^ (value >> 1);
    return ((num & 0x600) >> 3) | ((num & 0xC0) >> 2) | ((num & 0x18) >> 1) | (num & 3);
}

/**
 * Derive encryption key from password.
 *
 * Password length determines key size:
 * - 24 chars (2 parts × 12) → 16-byte key (AES-128)
 * - 36 chars (3 parts × 12) → 24-byte key (AES-192)
 * - 48 chars (4 parts × 12) → 32-byte key (AES-256)
 *
 * @param {string} password - Encryption password (24, 36, or 48 characters)
 * @returns {Buffer} Encryption key (16, 24, or 32 bytes)
 */
export function makeEncryptionKey(password) {
    if (!password || password.length < 24) return Buffer.alloc(16);

    // Determine number of 12-character parts based on password length
    const numParts = Math.min(Math.floor(password.length / 12), 4);
    const keySize = numParts * 8;  // 8 bytes per part
    const result = Buffer.alloc(keySize);

    for (let partIndex = 0; partIndex < numParts; partIndex++) {
        const part = password.substring(partIndex * 12, (partIndex + 1) * 12);
        const chars = Buffer.from(part, 'ascii');
        const offset = partIndex * 8;
        result[offset + 0] = grayPack((chars[0] << 4) | (chars[1] >> 4));
        result[offset + 1] = grayPack(((chars[1] & 0xF) << 8) | chars[2]);
        result[offset + 2] = grayPack((chars[3] << 4) | (chars[4] >> 4));
        result[offset + 3] = grayPack(((chars[4] & 0xF) << 8) | chars[5]);
        result[offset + 4] = grayPack((chars[6] << 4) | (chars[7] >> 4));
        result[offset + 5] = grayPack(((chars[7] & 0xF) << 8) | chars[8]);
        result[offset + 6] = grayPack((chars[9] << 4) | (chars[10] >> 4));
        result[offset + 7] = grayPack(((chars[10] & 0xF) << 8) | chars[11]);
    }
    return result;
}

// ============================================================================
// SERIAL NUMBER DECODING
// ============================================================================

/**
 * Decode base64 character to value
 * @private
 */
function base64CharToVal(c) {
    const code = c.charCodeAt(0);
    if (code >= 65 && code <= 90) return code - 65;
    if (code >= 97 && code <= 122) return code - 97 + 26;
    if (code >= 48 && code <= 57) return code - 48 + 52;
    if (c === '+' || c === '-') return 62;
    if (c === '_' || c === '/') return 63;
    return -1;
}

/**
 * Decode panel serial number from base64 format
 * @param {string} serial - Base64-encoded serial (16 chars)
 * @returns {Buffer} 6-byte decoded serial
 */
export function decodeSerial(serial) {
    const bArr = Buffer.alloc(12);
    for (let i = 0; i < 4; i++) {
        const i2 = i * 4;
        let val = base64CharToVal(serial[i2]) << 18;
        val += base64CharToVal(serial[i2 + 1]) << 12;
        val += base64CharToVal(serial[i2 + 2]) << 6;
        val += base64CharToVal(serial[i2 + 3]);
        const i3 = i * 3;
        bArr[i3] = (val >> 16) & 0xFF;
        bArr[i3 + 1] = (val >> 8) & 0xFF;
        bArr[i3 + 2] = val & 0xFF;
    }
    const result = Buffer.alloc(6);
    result[0] = bArr[0] ^ bArr[6];
    result[1] = bArr[7] ^ bArr[1];
    result[2] = bArr[8] ^ bArr[2];
    result[3] = bArr[9] ^ bArr[3];
    result[4] = bArr[10] ^ bArr[4];
    result[5] = bArr[11] ^ bArr[5];
    return result;
}

// ============================================================================
// PROTOCOL VERSION
// ============================================================================

/**
 * Calculate protocol version from firmware string.
 * @param {string} firmware - Firmware version string (e.g., "MR_4.1.38741")
 * @returns {number|null} Protocol version number, or null if parse failed
 */
export function calculateProtocolVersion(firmware) {
    if (!firmware) {
        return null;
    }

    try {
        // Split by underscore and dots: "MR_4.1.38741" → ["MR", "4", "1", "38741"]
        const parts = firmware.split(/[_\.]/);

        if (parts.length < 3) {
            return null;
        }

        const num1 = parseInt(parts[1], 10);  // Major version
        const num2 = parseInt(parts[2], 10);  // Minor version

        if (isNaN(num1) || isNaN(num2)) {
            return null;
        }

        if (num1 <= 21) {
            return num1 * 1000 + num2;
        } else {
            return num1;
        }
    } catch (error) {
        return null;
    }
}

// ============================================================================
// AES-CTR MODE (128/192/256 bit)
// ============================================================================

/**
 * AES-CTR encryption/decryption.
 *
 * Supports AES-128, AES-192, and AES-256 based on key size.
 *
 * @param {Buffer} data - Data to encrypt/decrypt
 * @param {Buffer} key - Encryption key (16, 24, or 32 bytes)
 * @param {Buffer} nonce - 8-byte nonce
 * @param {Buffer} serialBytes - 6-byte decoded serial
 * @returns {Buffer} Encrypted/decrypted data
 */
export function aesCtr(data, key, nonce, serialBytes) {
    // IV = [nonce 8 bytes][serial 6 bytes][padding 2 bytes]
    const iv = Buffer.alloc(16);
    nonce.copy(iv, 0, 0, 8);
    serialBytes.copy(iv, 8, 0, 6);
    // bytes 14-15 stay 0

    // Select cipher based on key size
    const cipherName = getAesCipherName(key.length);

    const result = Buffer.alloc(data.length);
    const blockSize = 16;

    for (let block = 0; block * blockSize < data.length; block++) {
        const cipher = crypto.createCipheriv(cipherName, key, null);
        cipher.setAutoPadding(false);
        const keystream = cipher.update(iv);

        const start = block * blockSize;
        const end = Math.min(start + blockSize, data.length);
        for (let i = start; i < end; i++) {
            result[i] = data[i] ^ keystream[i - start];
        }

        // Increment counter (big-endian from end)
        for (let i = iv.length - 1; i >= 0; i--) {
            iv[i] = (iv[i] + 1) & 0xFF;
            if (iv[i] !== 0) break;
        }
    }

    return result;
}

// ============================================================================
// MESSAGE ENCRYPTION/DECRYPTION
// ============================================================================

/**
 * Generate random 8-byte nonce for encryption
 * @returns {Buffer} 8-byte random nonce
 */
export function generateNonce() {
    return crypto.randomBytes(8);
}

/**
 * Encrypt a message payload (adds CRC, encrypts, prepends nonce)
 * @param {Buffer} payload - Message payload to encrypt
 * @param {Buffer} key - Encryption key (16, 24, or 32 bytes for AES-128/192/256)
 * @param {Buffer} serialBytes - 6-byte decoded serial
 * @returns {Buffer} Encrypted frame: [nonce][encrypted(payload + CRC)]
 */
export function encryptMessage(payload, key, serialBytes) {
    const withCrc = appendCrc(payload);
    const nonce = generateNonce();
    const encrypted = aesCtr(withCrc, key, nonce, serialBytes);
    return Buffer.concat([nonce, encrypted]);
}

/**
 * Decrypt a received frame (extracts nonce, decrypts, verifies CRC)
 * @param {Buffer} frame - SLIP-encoded frame to decrypt
 * @param {Buffer} key - Encryption key (16, 24, or 32 bytes for AES-128/192/256)
 * @param {Buffer} serialBytes - 6-byte decoded serial
 * @returns {Buffer|null} Decrypted payload (without CRC), or null if invalid
 */
export function decryptMessage(frame, key, serialBytes) {
    const decoded = slipDecode(frame);
    if (decoded.length <= 10) return null;

    const nonce = decoded.slice(0, 8);
    const encrypted = decoded.slice(8);
    const decrypted = aesCtr(encrypted, key, nonce, serialBytes);

    // Verify CRC
    if (!verifyCrc(decrypted)) {
        return null;
    }

    return decrypted.slice(0, -2);  // Strip CRC
}
