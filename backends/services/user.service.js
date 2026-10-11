const db = require('../config/database');
const { hashPassword } = require('./password.service');

async function createUser(email, password, role = 'inputer') {
    const passwordHash = await hashPassword(password);

    const result = await db.query(`
        INSERT INTO users (email, password_hash, role)
        VALUES (?, ?, ?)
        RETURNING id
    `, [email, passwordHash, role]);

    return {
        id: result.rows[0].id,
        email,
        role
    };
}

async function findUserByEmail(email) {
    const result = await db.query(`
        SELECT *
        FROM users
        WHERE email = ?
    `, [email]);
    return result.rows[0];
}

async function findUserById(id) {
    const result = await db.query(`
        SELECT *
        FROM users
        WHERE id = ?
    `, [id]);
    return result.rows[0];
}

module.exports = {
    createUser,
    findUserByEmail,
    findUserById
};