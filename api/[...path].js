const app = require('../backends/app');
const { ensureSchema } = require('../backends/database/schema');

let schemaReady;

module.exports = async function handler(req, res) {
    try {
        schemaReady ||= ensureSchema();
        await schemaReady;
        return app(req, res);
    } catch (error) {
        schemaReady = undefined;
        console.error('Vercel API initialization failed:', error.message);
        return res.status(503).json({ message: 'The API could not connect to its database. Check the Vercel database configuration.' });
    }
};
