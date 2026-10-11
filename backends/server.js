const path = require('path');
const projectRoot = path.resolve(__dirname, '..');

require('dotenv').config({ path: path.resolve(projectRoot, '.env') });

const db = require('./config/database');
const { ensureSchema } = require('./database/schema');
const { startScheduledBackups } = require('./services/backup.service');
const app = require('./app');
const PORT = process.env.PORT || 3000;

async function start() {
    await ensureSchema();
    app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Project root: ${projectRoot}`);
        if (db.dialect === 'sqlite') startScheduledBackups();
        else console.log('PostgreSQL is active; database backups are managed by the database provider.');
    });
}

start().catch((error) => {
    console.error('Could not start Secure Auth System:', error.message);
    process.exitCode = 1;
});
