const express = require('express');
const path = require('path');
const helmet = require('helmet');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const sessionMiddleware = require('./config/session');
require('./database/schema');
const authRoutes = require('./routes/auth.routes');
const { startScheduledBackups } = require('./services/backup.service');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = 'admin-email-temp-password-2026-10-11';

app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware);

// Frontend
app.use((req, res, next) => {
    let requestedPath;
    try {
        requestedPath = decodeURIComponent(req.path).replace(/^\/+/, '');
    } catch {
        return res.sendStatus(400);
    }

    const normalizedPath = path.posix.normalize(`/${requestedPath}`).replace(/^\/+/, '');
    const firstSegment = normalizedPath.split('/')[0].toLowerCase();
    if (
        ['backend', 'backups', 'secrets', 'node_modules', '.git'].includes(firstSegment) ||
        /^client_secret[^/]*\.json$/i.test(normalizedPath) ||
        normalizedPath.toLowerCase() === 'credentials.json'
    ) {
        return res.sendStatus(404);
    }
    next();
});
app.use(express.static(path.resolve(__dirname, '..')));

// Authentication
app.use('/api/auth', authRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        version: APP_VERSION,
        root: path.resolve(__dirname, '..')
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`App version: ${APP_VERSION}`);
    console.log(`Project root: ${path.resolve(__dirname, '..')}`);
    startScheduledBackups();
});
