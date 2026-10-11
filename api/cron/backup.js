const crypto = require('node:crypto');
const db = require('../../backends/config/database');
const { ensureSchema } = require('../../backends/database/schema');
const { uploadBackupBuffer } = require('../../backends/services/google-drive.service');

const backupTables = [
    'users',
    'audit_logs',
    'password_setup_tokens',
    'password_reset_codes'
];

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
        if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
            return sendJson(res, 503, { message: 'Google Drive backup settings are not configured.' });
        }

        const tables = {};
        for (const table of backupTables) {
            const result = await db.query(`SELECT * FROM ${table} ORDER BY 1`);
            tables[table] = result.rows;
        }

        const snapshot = Buffer.from(JSON.stringify({
            format: 'secure-auth-postgres-json-v1',
            createdAt: new Date().toISOString(),
            tables
        }));
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const uploaded = await uploadBackupBuffer(snapshot, `auth-db-${timestamp}.pg.json.enc`);
        return sendJson(res, 200, { status: 'ok', backup: uploaded.name });
    } catch (error) {
        console.error('Scheduled PostgreSQL backup failed:', error.message);
        return sendJson(res, 500, { message: 'Could not create the encrypted cloud database backup.' });
    }
};
