const express = require('express');
const path = require('node:path');
const helmet = require('helmet');
const sessionMiddleware = require('./config/session');
const authRoutes = require('./routes/auth.routes');
const pharmacyRoutes = require('./routes/pharmacy.routes');

const projectRoot = path.resolve(__dirname, '..');
const app = express();
const APP_VERSION = 'vercel-postgres-migration';

app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(sessionMiddleware);

// Local development serves the static UI from disk. Vercel serves frontend/ as static output.
if (process.env.VERCEL !== '1') {
    app.use(express.static(path.join(projectRoot, 'frontend')));
}

app.get('/forgot-password', (req, res) => {
    res.sendFile(path.join(projectRoot, 'frontend', 'forgot-password.html'));
});

app.get('/forgot-password.html', (req, res) => {
    res.sendFile(path.join(projectRoot, 'frontend', 'forgot-password.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/pharmacy', pharmacyRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: APP_VERSION });
});

app.use('/api', (req, res) => {
    res.status(404).json({ message: 'API endpoint not found.' });
});

app.use((error, req, res, next) => {
    console.error('Unhandled API error:', error.message);
    if (res.headersSent) return next(error);
    return res.status(500).json({ message: 'An unexpected server error occurred.' });
});

module.exports = app;
