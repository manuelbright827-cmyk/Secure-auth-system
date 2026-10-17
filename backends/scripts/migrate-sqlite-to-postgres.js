require('dotenv').config({ path: require('node:path').resolve(__dirname, '..', '..', '.env') });

const path = require('node:path');
const Database = require('better-sqlite3');
const { ensureSchema } = require('../database/schema');
const db = require('../config/database');

const tables = {
    users: ['id', 'email', 'password_hash', 'role', 'two_factor_secret', 'two_factor_enabled', 'is_active', 'created_at', 'updated_at'],
    audit_logs: ['id', 'user_id', 'action', 'ip_address', 'user_agent', 'actor_role', 'resource', 'result', 'created_at'],
    password_setup_tokens: ['token_hash', 'user_id', 'expires_at', 'used_at', 'created_at'],
    password_reset_codes: ['code_hash', 'user_id', 'expires_at', 'used_at', 'created_at'],
    rate_limit_counters: ['key', 'hits', 'reset_at'],
    deleted_users: ['id', 'original_user_id', 'email', 'role', 'deleted_by', 'deleted_at'],
    medicines: ['id', 'name', 'sku', 'category', 'description', 'unit_price', 'reorder_level', 'is_active', 'created_by', 'updated_by', 'created_at', 'updated_at'],
    inventory: ['medicine_id', 'quantity', 'updated_at'],
    customers: ['id', 'name', 'phone', 'created_at'],
    prescriptions: ['id', 'customer_id', 'prescriber', 'reference', 'status', 'created_by', 'dispensed_by', 'created_at', 'dispensed_at'],
    prescription_items: ['id', 'prescription_id', 'medicine_id', 'quantity'],
    sales: ['id', 'customer_id', 'cashier_id', 'total', 'status', 'created_at'],
    sale_items: ['id', 'sale_id', 'medicine_id', 'quantity', 'unit_price', 'line_total']
};

async function main() {
    if (db.dialect !== 'postgres') {
        throw new Error('Set SUPABASE_DB_URL (or DATABASE_URL) to the destination PostgreSQL database before running this migration.');
    }

    const sourcePath = path.resolve(
        path.resolve(__dirname, '..', '..'),
        process.env.DATABASE_PATH || 'backends/database/auth.db'
    );
    const sqlite = new Database(sourcePath, { readonly: true, fileMustExist: true });
    const client = await db.pool.connect();

    try {
        await ensureSchema();
        for (const table of Object.keys(tables)) {
            const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
            if (!exists) continue;
            const count = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
            if (count.rows[0].count !== 0) {
                throw new Error(`Destination table ${table} is not empty. Migration stopped without copying data.`);
            }
        }

        await client.query('BEGIN');
        const copied = {};
        for (const [table, columns] of Object.entries(tables)) {
            const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
            if (!exists) {
                copied[table] = 0;
                continue;
            }

            const sourceColumns = new Set(sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name));
            const compatibleColumns = columns.filter((column) => sourceColumns.has(column));
            if (!compatibleColumns.length) {
                copied[table] = 0;
                continue;
            }
            const rows = sqlite.prepare(`SELECT ${compatibleColumns.join(', ')} FROM ${table}`).all();
            copied[table] = rows.length;
            if (!rows.length) continue;

            const placeholders = compatibleColumns.map((_, index) => `$${index + 1}`).join(', ');
            const insert = `INSERT INTO ${table} (${compatibleColumns.join(', ')}) VALUES (${placeholders})`;
            for (const row of rows) {
                await client.query(insert, compatibleColumns.map((column) => (
                    ['is_active', 'two_factor_enabled'].includes(column)
                        ? Boolean(row[column])
                        : row[column]
                )));
            }
        }

        for (const table of ['users', 'audit_logs', 'deleted_users', 'medicines', 'customers', 'prescriptions', 'prescription_items', 'sales', 'sale_items']) {
            await client.query(`
                SELECT setval(
                    pg_get_serial_sequence('${table}', 'id'),
                    COALESCE((SELECT MAX(id) FROM ${table}), 1),
                    EXISTS (SELECT 1 FROM ${table})
                )
            `);
        }
        await client.query('COMMIT');
        console.log('SQLite account data copied to PostgreSQL. Row totals:');
        for (const [table, count] of Object.entries(copied)) console.log(`- ${table}: ${count}`);
        console.log('Keep SESSION_SECRET and PASSWORD_PEPPER unchanged in Vercel to preserve 2FA secrets and password verification.');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        sqlite.close();
    }
}

main().catch((error) => {
    console.error('SQLite-to-PostgreSQL migration failed:', error.message);
    process.exitCode = 1;
});
