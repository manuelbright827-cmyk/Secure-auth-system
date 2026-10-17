const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const configuredDatabaseUrl = [
	process.env.SUPABASE_DB_URL,
	process.env.DATABASE_POSTGRES_URL,
	process.env.DATABASE_POSTGRES_PRISMA_URL,
	process.env.DATABASE_URL
].find((value) => typeof value === 'string' && value.trim());
let databaseUrl;
if (configuredDatabaseUrl) {
	try {
		const parsed = new URL(configuredDatabaseUrl);
		if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
		databaseUrl = configuredDatabaseUrl;
	} catch {
		throw new Error('The configured PostgreSQL URL is invalid. Check SUPABASE_DB_URL / DATABASE_URL without sharing its value.');
	}
}
const isPostgres = Boolean(databaseUrl);
const isVercelRuntime = process.env.VERCEL === '1';
const isProduction = process.env.NODE_ENV === 'production';
if (!isPostgres && (isVercelRuntime || isProduction)) {
	throw new Error(
		'PostgreSQL is required in production. Set SUPABASE_DB_URL (or DATABASE_URL) in the deployment environment; SQLite is available only for local development.'
	);
}
const transactionContext = new AsyncLocalStorage();
let sqlite;
let pool;
let sqliteQueue = Promise.resolve();

if (isPostgres) {
	const { Pool } = require('pg');
	const poolOptions = {
		connectionString: databaseUrl,
		max: Number.parseInt(process.env.PG_POOL_MAX || '2', 10),
		idleTimeoutMillis: 10_000,
		connectionTimeoutMillis: 10_000
	};
	if (process.env.DATABASE_SSL_CA) {
		const secureUrl = new URL(databaseUrl);
		for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
			secureUrl.searchParams.delete(parameter);
		}
		poolOptions.connectionString = secureUrl.toString();
		poolOptions.ssl = {
			ca: process.env.DATABASE_SSL_CA,
			rejectUnauthorized: true
		};
	}
	pool = new Pool(poolOptions);
} else {
	const Database = require('better-sqlite3');
	const databasePath = path.resolve(
		projectRoot,
		process.env.DATABASE_PATH || 'backends/database/auth.db'
	);
	sqlite = new Database(databasePath);
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('journal_mode = WAL');
}

async function acquireSqliteQueue() {
	let release;
	const previous = sqliteQueue;
	sqliteQueue = new Promise((resolve) => { release = resolve; });
	await previous;
	return release;
}

function postgresPlaceholders(sql) {
	let parameter = 0;
	return sql.replace(/\?/g, () => `$${++parameter}`);
}

async function query(sql, params = []) {
	if (isPostgres) {
		const client = transactionContext.getStore()?.client;
		const result = await (client || pool).query(postgresPlaceholders(sql), params);
		return { rows: result.rows, rowCount: result.rowCount ?? 0 };
	}

	const context = transactionContext.getStore();
	const release = context?.sqliteTransaction ? null : await acquireSqliteQueue();
	try {
		const statement = sqlite.prepare(sql);
		if (statement.reader) {
			const rows = statement.all(...params);
			return { rows, rowCount: rows.length };
		}
		const result = statement.run(...params);
		return { rows: [], rowCount: result.changes, lastInsertRowid: result.lastInsertRowid };
	} finally {
		release?.();
	}
}

async function backup(destination) {
	if (isPostgres) {
		throw new Error('PostgreSQL snapshots are managed by the database provider.');
	}
	return sqlite.backup(destination);
}

async function restoreFromBackup(sourcePath) {
	if (isPostgres) throw new Error('In-place restore is only supported for local SQLite databases.');
	const release = await acquireSqliteQueue();
	const tables = ['users', 'audit_logs', 'password_setup_tokens', 'password_reset_codes', 'rate_limit_counters', 'deleted_users', 'medicines', 'inventory', 'customers', 'prescriptions', 'prescription_items', 'sales', 'sale_items'];
	try {
		sqlite.pragma('foreign_keys = OFF');
		sqlite.prepare('ATTACH DATABASE ? AS restore_db').run(sourcePath);
		const available = new Set(sqlite.prepare("SELECT name FROM restore_db.sqlite_master WHERE type='table'").all().map((row) => row.name));
		const restoring = tables.filter((table) => available.has(table));
		if (!restoring.includes('users')) throw new Error('Backup does not contain application user data.');
		sqlite.exec('BEGIN IMMEDIATE');
		for (const table of [...tables].reverse()) sqlite.exec(`DELETE FROM main."${table}"`);
		for (const table of restoring) {
			const current = sqlite.prepare(`PRAGMA main.table_info("${table}")`).all().map((row) => row.name);
			const archived = new Set(sqlite.prepare(`PRAGMA restore_db.table_info("${table}")`).all().map((row) => row.name));
			const columns = current.filter((column) => archived.has(column));
			if (!columns.length) continue;
			const list = columns.map((column) => `"${column}"`).join(',');
			sqlite.exec(`INSERT INTO main."${table}" (${list}) SELECT ${list} FROM restore_db."${table}"`);
		}
		sqlite.exec('COMMIT');
		sqlite.exec('DETACH DATABASE restore_db');
	} catch (error) {
		try { sqlite.exec('ROLLBACK'); } catch {}
		try { sqlite.exec('DETACH DATABASE restore_db'); } catch {}
		throw error;
	} finally {
		sqlite.pragma('foreign_keys = ON');
		release();
	}
}

async function close() {
	if (isPostgres) await pool.end();
	else sqlite.close();
}

function transaction(callback) {
	return async (...args) => {
		if (isPostgres) {
			const client = await pool.connect();
			try {
				await client.query('BEGIN');
			const result = await transactionContext.run({ client }, () => callback(...args));
				await client.query('COMMIT');
				return result;
			} catch (error) {
				await client.query('ROLLBACK');
				throw error;
			} finally {
				client.release();
			}
		}

		const release = await acquireSqliteQueue();
		try {
			sqlite.exec('BEGIN IMMEDIATE');
			const result = await transactionContext.run({ sqliteTransaction: true }, () => callback(...args));
			sqlite.exec('COMMIT');
			return result;
		} catch (error) {
			sqlite.exec('ROLLBACK');
			throw error;
		} finally {
			release();
		}
	};
}

module.exports = {
	dialect: isPostgres ? 'postgres' : 'sqlite',
	pool,
	query,
	transaction,
	backup,
	restoreFromBackup,
	close
};
