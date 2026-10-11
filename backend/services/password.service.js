const argon2 = require('argon2');

const PEPPER = process.env.PASSWORD_PEPPER;

async function hashPassword(password) {
    return argon2.hash(password + PEPPER, {
        type: argon2.argon2id
    });
}

async function verifyPassword(password, passwordHash) {
    return argon2.verify(passwordHash, password + PEPPER);
}

module.exports = {
    hashPassword,
    verifyPassword
};