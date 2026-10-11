const session = require('express-session');
const db = require('./database');

const isProduction = process.env.NODE_ENV === 'production';
if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set before starting the authentication server.');
}
let store;

if (db.dialect === 'postgres') {
    const PgSession = require('connect-pg-simple')(session);
    store = new PgSession({
        pool: db.pool,
        tableName: 'user_sessions',
        createTableIfMissing: false,
        pruneSessionInterval: 15
    });
}

const sessionConfig = {
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    ...(store ? { store } : {}),
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60
    }
};

module.exports = session(sessionConfig);