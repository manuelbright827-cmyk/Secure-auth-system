const crypto = require('node:crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const encryptionKey = crypto.scryptSync(
    process.env.SESSION_SECRET || 'development-session-secret',
    'secure-auth-system:authenticator-secret:v1',
    32
);

function base32Encode(buffer) {
    let bits = '';
    for (const byte of buffer) {
        bits += byte.toString(2).padStart(8, '0');
    }

    let encoded = '';
    for (let index = 0; index < bits.length; index += 5) {
        const chunk = bits.slice(index, index + 5).padEnd(5, '0');
        encoded += BASE32_ALPHABET[parseInt(chunk, 2)];
    }
    return encoded;
}

function base32Decode(secret) {
    const normalized = String(secret || '').trim().toUpperCase().replace(/=+$/, '');
    if (!normalized) {
        return Buffer.alloc(0);
    }

    const valueMap = Object.fromEntries(
        Array.from(BASE32_ALPHABET).map((char, index) => [char, index])
    );

    let bits = '';
    for (const char of normalized) {
        const value = valueMap[char];
        if (value === undefined) {
            throw new Error('Invalid authenticator secret');
        }
        bits += value.toString(2).padStart(5, '0');
    }

    while (bits.length % 8 !== 0) {
        bits = bits.slice(0, -1);
    }

    const bytes = [];
    for (let index = 0; index < bits.length; index += 8) {
        bytes.push(parseInt(bits.slice(index, index + 8), 2));
    }
    return Buffer.from(bytes);
}

function createAuthenticatorSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function encryptSecret(secret) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const encrypted = Buffer.concat([
        cipher.update(secret, 'utf8'),
        cipher.final()
    ]);

    return [
        'v1',
        iv.toString('hex'),
        cipher.getAuthTag().toString('hex'),
        encrypted.toString('hex')
    ].join(':');
}

function decryptSecret(encryptedSecret) {
    if (!encryptedSecret.startsWith('v1:')) {
        return encryptedSecret;
    }

    const [, ivHex, tagHex, encryptedHex] = encryptedSecret.split(':');
    if (!ivHex || !tagHex || !encryptedHex) {
        throw new Error('Invalid encrypted authenticator secret');
    }

    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        encryptionKey,
        Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    return Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, 'hex')),
        decipher.final()
    ]).toString('utf8');
}

function generateTotp(secret, timestamp = Date.now()) {
    const counter = Math.floor(timestamp / 1000 / 30);
    const key = base32Decode(secret);
    const buffer = Buffer.alloc(8);
    let value = BigInt(counter);

    for (let index = 7; index >= 0; index -= 1) {
        buffer[index] = Number(value & 0xffn);
        value >>= 8n;
    }

    const hash = crypto.createHmac('sha1', key).update(buffer).digest();
    const offset = hash[hash.length - 1] & 0x0f;
    const binary = ((hash[offset] & 0x7f) << 24) |
        ((hash[offset + 1] & 0xff) << 16) |
        ((hash[offset + 2] & 0xff) << 8) |
        (hash[offset + 3] & 0xff);

    return String(binary % 1000000).padStart(6, '0');
}

async function verifyAuthenticatorCode(secret, code) {
    if (typeof secret !== 'string' || typeof code !== 'string') {
        return false;
    }

    const normalizedCode = code.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
        return false;
    }

    const now = Date.now();
    const currentWindow = Math.floor(now / 1000 / 30);

    for (let offset = -1; offset <= 1; offset += 1) {
        const candidate = generateTotp(secret, (currentWindow + offset) * 30 * 1000);
        if (candidate === normalizedCode) {
            return true;
        }
    }

    return false;
}

module.exports = {
    createAuthenticatorSecret,
    encryptSecret,
    decryptSecret,
    verifyAuthenticatorCode
};