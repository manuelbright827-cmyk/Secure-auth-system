const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const isPostgres = Boolean(process.env.DATABASE_URL);
const transactionContext = new AsyncLocalStorage();
let sqlite;
let pool;
let sqliteQueue = Promise.resolve();

if (isPostgres) {
	const { Pool } = require('pg');
	pool = new Pool({
		connectionString: process.env.DATABASE_URL,
		max: Number.parseInt(process.env.PG_POOL_MAX || '2', 10),
		idleTimeoutMillis: 10_000,
		connectionTimeoutMillis: 10_000
	});
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
	close
};
