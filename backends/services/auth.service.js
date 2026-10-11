const { findUserByEmail, findUserById } = require('./user.service');
const { verifyPassword } = require('./password.service');

async function authenticateUser(email, password) {
    const user = await findUserByEmail(email);

    if (!user || !user.is_active) {
        return null;
    }

    const validPassword = await verifyPassword(
        password,
        user.password_hash
    );

    if (!validPassword) {
        return null;
    }

    return user;
}

module.exports = {
    authenticateUser,
    findUserById
};