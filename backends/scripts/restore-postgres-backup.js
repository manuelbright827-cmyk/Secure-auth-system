require('dotenv').config({ path: require('node:path').resolve(__dirname, '..', '..', '.env') });

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../config/database');
const { ensureSchema } = require('../database/schema');

const tableColumns = {
    users: ['id', 'email', 'password_hash', 'role', 'two_factor_secret', 'two_factor_enabled', 'is_active', 'created_at', 'updated_at'],
    audit_logs: ['id', 'user_id', 'action', 'ip_address', 'user_agent', 'created_at'],
    password_setup_tokens: ['token_hash', 'user_id', 'expires_at', 'used_at', 'created_at'],
    password_reset_codes: ['code_hash', 'user_id', 'expires_at', 'used_at', 'created_at']
};

function decryptSnapshot(encrypted) {
    if (encrypted.length < 33 || encrypted.subarray(0, 5).toString() !== 'SABK1') {
        throw new Error('This file does not have the Secure Auth backup header.');
    }
    const keyHex = process.env.BACKUP_ENCRYPTION_KEY || '';
    if (!/^[\da-fA-F]{64}$/.test(keyHex)) {
        throw new Error('Set the original BACKUP_ENCRYPTION_KEY in the private environment before restoring.');
    }

    const iv = encrypted.subarray(5, 17);
    const tag = encrypted.subarray(17, 33);
    const ciphertext = encrypted.subarray(33);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function main() {
    if (db.dialect !== 'postgres') {
        throw new Error('Set DATABASE_URL to the empty destination PostgreSQL database before restoring.');
    }
    const backupPath = process.argv[2];
    if (!backupPath) {
        throw new Error('Usage: npm run db:restore-postgres-backup -- <downloaded .pg.json.enc path>');
    }

    const snapshot = JSON.parse(decryptSnapshot(await fs.readFile(path.resolve(backupPath))).toString('utf8'));
    if (snapshot.format !== 'secure-auth-postgres-json-v1' || !snapshot.tables) {
        throw new Error('This encrypted file is not a PostgreSQL snapshot for this app.');
    }
    for (const table of Object.keys(tableColumns)) {
        if (!Array.isArray(snapshot.tables[table])) throw new Error(`Backup is missing table ${table}.`);
    }

    await ensureSchema();
    const client = await db.pool.connect();
    try {
        for (const table of Object.keys(tableColumns)) {
            const count = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
            if (count.rows[0].count !== 0) {
                throw new Error(`Destination table ${table} is not empty. Restore stopped without changing data; use a new empty database.`);
            }
        }

        await client.query('BEGIN');
        for (const [table, columns] of Object.entries(tableColumns)) {
            for (const row of snapshot.tables[table]) {
                const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
                const values = columns.map((column) => (
                    ['is_active', 'two_factor_enabled'].includes(column)
                        ? Boolean(row[column])
                        : row[column] ?? null
                ));
                await client.query(
                    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
                    values
                );
            }
        }

        for (const table of ['users', 'audit_logs']) {
            await client.query(`
                SELECT setval(
                    pg_get_serial_sequence('${table}', 'id'),
                    COALESCE((SELECT MAX(id) FROM ${table}), 1),
                    EXISTS (SELECT 1 FROM ${table})
                )
            `);
        }
        await client.query('COMMIT');
        console.log(`Restored encrypted PostgreSQL snapshot from ${snapshot.createdAt}.`);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        await db.close();
    }
}

main().catch((error) => {
    console.error('PostgreSQL backup restore failed:', error.message);
    process.exitCode = 1;
});
