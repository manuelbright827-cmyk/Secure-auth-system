const vercelHandler = require('../backends/vercel-handler');
const db = require('../backends/config/database');

function databaseProvider() {
    if (db.dialect !== 'postgres') return { dialect: db.dialect, provider: 'local' };
    const connectionString = process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL ||
        process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING ||
        process.env.DATABASE_POSTGRES_URL || process.env.DATABASE_POSTGRES_PRISMA_URL || process.env.DATABASE_URL || '';
    try {
        const hostname = new URL(connectionString).hostname.toLowerCase();
        const provider = hostname.endsWith('.supabase.co') || hostname.endsWith('.supabase.com')
            ? 'supabase'
            : 'postgresql';
        return { dialect: 'postgres', provider };
    } catch {
        return { dialect: 'postgres', provider: 'unknown' };
    }
}

module.exports = function healthHandler(req, res) {
    req.url = '/api/health';
    const originalJson = res.json;
    res.json = function healthJson(payload) {
        return originalJson.call(this, { ...payload, database: databaseProvider() });
    };
    return vercelHandler(req, res);
};
