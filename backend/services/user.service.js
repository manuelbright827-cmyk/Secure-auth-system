const db = require('../config/database');
const { hashPassword } = require('./password.service');

async function createUser(email, password, role = 'inputer') {
    const passwordHash = await hashPassword(password);

    const statement = db.prepare(`
        INSERT INTO users (email, password_hash, role)
        VALUES (?, ?, ?)
    `);

    const result = statement.run(email, passwordHash, role);

    return {
        id: result.lastInsertRowid,
        email,
        role
    };
}

function findUserByEmail(email) {
    return db.prepare(`
        SELECT *
        FROM users
        WHERE email = ?
    `).get(email);
}

function findUserById(id) {
    return db.prepare(`
        SELECT *
        FROM users
        WHERE id = ?
    `).get(id);
}

module.exports = {
    createUser,
    findUserByEmail,
    findUserById
};