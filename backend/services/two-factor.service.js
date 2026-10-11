const crypto = require('node:crypto');
const { generateSecret, verify } = require('otplib');

const encryptionKey = crypto.scryptSync(
    process.env.SESSION_SECRET,
    'secure-auth-system:authenticator-secret:v1',
    32
);

function createAuthenticatorSecret() {
    return generateSecret();
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

async function verifyAuthenticatorCode(secret, code) {
    try {
        const result = await verify({ secret, token: code });
        return result.valid;
    } catch {
        return false;
    }
}

module.exports = {
    createAuthenticatorSecret,
    encryptSecret,
    decryptSecret,
    verifyAuthenticatorCode
};