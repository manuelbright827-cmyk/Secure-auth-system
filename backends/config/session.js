const session = require('express-session');

const isProduction = process.env.NODE_ENV === 'production';

const sessionConfig = {
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60
    }
};

module.exports = session(sessionConfig);