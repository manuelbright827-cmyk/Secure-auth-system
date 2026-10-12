const app = require('./app');
const { ensureSchema } = require('./database/schema');

let schemaReady;

module.exports = async function vercelHandler(req, res) {
    try {
        schemaReady ||= ensureSchema();
        await schemaReady;
        return app(req, res);
    } catch (error) {
        schemaReady = undefined;
        console.error('Vercel API initialization failed:', error.message);
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({
            message: 'The API could not connect to its database. Check the Vercel database and session environment variables.'
        }));
    }
};
