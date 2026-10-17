const crypto = require('node:crypto');
const db = require('../../backends/config/database');
const { ensureSchema } = require('../../backends/database/schema');
const { createPostgresBackup } = require('../../backends/services/backup.service');

function authorized(req) {
    const secret = process.env.CRON_SECRET || '';
    const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!secret || !supplied) return false;
    const expectedBytes = Buffer.from(secret);
    const suppliedBytes = Buffer.from(supplied);
    return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

function sendJson(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}

module.exports = async function backupHandler(req, res) {
    if (req.method !== 'GET') {
        return sendJson(res, 405, { message: 'Method not allowed.' });
    }
    if (!authorized(req)) {
        return sendJson(res, 401, { message: 'Unauthorized.' });
    }

    try {
        await ensureSchema();
        if (db.dialect !== 'postgres') {
            return sendJson(res, 503, { message: 'Scheduled cloud backups require PostgreSQL.' });
        }
        const uploaded = await createPostgresBackup();
        return sendJson(res, 200, { status: 'ok', backup: uploaded.name });
    } catch (error) {
        console.error('Scheduled PostgreSQL backup failed:', error.message);
        return sendJson(res, 500, { message: 'Could not create the encrypted cloud database backup.' });
    }
};
