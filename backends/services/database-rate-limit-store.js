const db = require('../config/database');

class DatabaseRateLimitStore {
    constructor(prefix = 'default') {
        this.windowMs = 15 * 60 * 1000;
        this.prefix = `rl:${prefix}:`;
        this.requestsSinceCleanup = 0;
    }

    init(options) {
        this.windowMs = options.windowMs;
        this.prefix = options.keyPrefix || this.prefix;
    }

    async increment(key) {
        const now = Date.now();
        const resetAt = now + this.windowMs;
        const result = await db.query(`
            INSERT INTO rate_limit_counters (key, hits, reset_at)
            VALUES (?, 1, ?)
            ON CONFLICT (key) DO UPDATE SET
                hits = CASE WHEN rate_limit_counters.reset_at <= ? THEN 1 ELSE rate_limit_counters.hits + 1 END,
                reset_at = CASE WHEN rate_limit_counters.reset_at <= ? THEN excluded.reset_at ELSE rate_limit_counters.reset_at END
            RETURNING hits, reset_at
        `, [`${this.prefix}${key}`, resetAt, now, now]);

        this.requestsSinceCleanup += 1;
        if (this.requestsSinceCleanup >= 1000) {
            this.requestsSinceCleanup = 0;
            db.query('DELETE FROM rate_limit_counters WHERE reset_at <= ?', [now]).catch(() => {});
        }

        return {
            totalHits: Number(result.rows[0].hits),
            resetTime: new Date(Number(result.rows[0].reset_at))
        };
    }

    async decrement(key) {
        await db.query(`
            UPDATE rate_limit_counters
            SET hits = CASE WHEN hits > 0 THEN hits - 1 ELSE 0 END
            WHERE key = ?
        `, [`${this.prefix}${key}`]);
    }

    async resetKey(key) {
        await db.query('DELETE FROM rate_limit_counters WHERE key = ?', [`${this.prefix}${key}`]);
    }

    async resetAll() {
        await db.query('DELETE FROM rate_limit_counters WHERE key LIKE ?', [`${this.prefix}%`]);
    }
}

module.exports = DatabaseRateLimitStore;
