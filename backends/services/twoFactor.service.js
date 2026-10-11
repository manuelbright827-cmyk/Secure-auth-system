const { generateSecret, generateURI, verify } = require('otplib');

function createTwoFactorSecret(email) {
    const secret = generateSecret();

    const otpauthUrl = generateURI({
        issuer: 'Secure Auth System',
        label: email,
        secret
    });

    return {
        secret,
        otpauthUrl
    };
}

async function verifyTwoFactorCode(secret, code) {
    const result = await verify({
        secret,
        token: code
    });

    return result.valid;
}

module.exports = {
    createTwoFactorSecret,
    verifyTwoFactorCode
};