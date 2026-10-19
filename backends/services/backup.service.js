const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../config/database');
const { uploadBackup, uploadBackupBuffer } = require('./google-drive.service');

const projectRoot = path.resolve(__dirname, '..', '..');
const backupDirectory = path.resolve(
    projectRoot,
    process.env.BACKUP_DIRECTORY || 'backups'
);
const intervalHours = Number.parseFloat(process.env.BACKUP_INTERVAL_HOURS || '24');
const retentionDays = Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '14', 10);
const backupIntervalMs = (Number.isFinite(intervalHours) && intervalHours > 0 ? intervalHours : 24) * 60 * 60 * 1000;
const backupRetentionMs = (Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 14) * 24 * 60 * 60 * 1000;
const backupPrefix = 'auth-db-';
const postgresBackupTables = [
    'users', 'audit_logs', 'password_setup_tokens', 'password_reset_codes', 'rate_limit_counters', 'two_factor_last_counters',
    'deleted_users', 'medicines', 'inventory', 'customers', 'prescriptions', 'prescription_items', 'sales', 'sale_items'
];

let backupInProgress = false;
let backupTimer;

async function removeExpiredBackups(now = Date.now()) {
    const entries = await fs.readdir(backupDirectory, { withFileTypes: true });

    await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(backupPrefix) && entry.name.endsWith('.db'))
        .map(async (entry) => {
            const filePath = path.join(backupDirectory, entry.name);
            const stats = await fs.stat(filePath);
            if (now - stats.mtimeMs > backupRetentionMs) {
                await fs.unlink(filePath);
                console.log(`Removed expired database backup: ${entry.name}`);
            }
        }));
}

async function createBackup() {
    if (backupInProgress) {
        console.warn('Skipping scheduled database backup because a backup is already running.');
        return null;
    }

    backupInProgress = true;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(backupDirectory, `${backupPrefix}${timestamp}.db`);

    try {
        await fs.mkdir(backupDirectory, { recursive: true });
        await db.backup(filePath);

        try {
            await fs.chmod(filePath, 0o600);
        } catch (error) {
            if (process.platform !== 'win32') throw error;
        }

        await removeExpiredBackups();
        console.log(`Database backup created: ${path.relative(projectRoot, filePath)}`);

        if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
            try {
                const uploaded = await uploadBackup(filePath);
                console.log(`Encrypted cloud backup uploaded to Google Drive: ${uploaded.name}`);
            } catch (error) {
                console.error('Google Drive backup failed; the local backup is still available:', error.message);
            }
        }

        return filePath;
    } catch (error) {
        console.error('Database backup failed:', error);
        throw error;
    } finally {
        backupInProgress = false;
    }
}

async function createPostgresBackup() {
    if (db.dialect !== 'postgres') throw new Error('PostgreSQL backup requested while SQLite is active.');
    if (!process.env.GOOGLE_DRIVE_FOLDER_ID) throw new Error('Configure cloud backup storage before creating a PostgreSQL backup.');
    const tables = {};
    for (const table of postgresBackupTables) {
        const result = await db.query(`SELECT * FROM ${table} ORDER BY 1`);
        tables[table] = result.rows;
    }
    const snapshot = Buffer.from(JSON.stringify({
        format: 'secure-auth-postgres-json-v1',
        createdAt: new Date().toISOString(),
        tables
    }));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return uploadBackupBuffer(snapshot, `${backupPrefix}${timestamp}.pg.json.enc`);
}

function startScheduledBackups() {
    if (backupTimer) return;

    console.log(`Automatic database backups enabled (every ${intervalHours} hour(s), keeping ${retentionDays} day(s)).`);
    if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
        console.warn('Google Drive backups are not configured; backups are currently local only.');
    }
    createBackup().catch(() => {});
    backupTimer = setInterval(() => {
        createBackup().catch(() => {});
    }, backupIntervalMs);
    backupTimer.unref();
}

function stopScheduledBackups() {
    if (backupTimer) {
        clearInterval(backupTimer);
        backupTimer = undefined;
    }
}

module.exports = {
    createBackup,
    createPostgresBackup,
    postgresBackupTables,
    removeExpiredBackups,
    startScheduledBackups,
    stopScheduledBackups
};
