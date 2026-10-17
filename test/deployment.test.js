const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('production and Vercel refuse to fall back to SQLite without a PostgreSQL URL', () => {
    const env = { ...process.env, VERCEL: '1', NODE_ENV: 'production' };
    for (const key of ['SUPABASE_DB_URL', 'DATABASE_URL', 'DATABASE_POSTGRES_URL', 'DATABASE_POSTGRES_PRISMA_URL']) env[key] = '';
    const result = spawnSync(process.execPath, ['-e', "try { require('./backends/config/database'); process.exit(2); } catch (error) { if (!error.message.includes('PostgreSQL is required in production')) process.exit(3); }"], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('configured PostgreSQL is selected by the production database adapter', () => {
    const env = { ...process.env, VERCEL: '1', NODE_ENV: 'production', SUPABASE_DB_URL: 'postgresql://test:test@127.0.0.1:5432/test?sslmode=require' };
    const result = spawnSync(process.execPath, ['-e', "const db=require('./backends/config/database'); if(db.dialect!=='postgres') process.exit(2); db.close();"], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Vercel serves static frontend output and configures API function duration', () => {
    const config = JSON.parse(read('vercel.json'));
    assert.equal(config.outputDirectory, 'frontend');
    assert.equal(config.functions['api/**/*.js'].maxDuration, 30);
    assert.ok(fs.existsSync(path.join(root, 'api/pharmacy/[...path].js')));
});

test('all pharmacy pages exist and navigate through the shared page shell', () => {
    const pages = ['pharmacy.html', 'overview.html', 'medicines.html', 'inventory.html', 'prescriptions.html', 'sales.html', 'reports.html', 'users.html', 'backup.html'];
    for (const file of pages) {
        const html = read(`frontend/${file}`);
        assert.match(html, new RegExp(`data-page="${file.replace('.', '\\.')}"`), file);
        assert.match(html, /src="pharmacy\.js"/, file);
        for (const destination of pages) assert.ok(html.includes(`href="${destination}"`), `${file} does not link to ${destination}`);
    }
});

test('frontend permissions match pharmacy roles and restrict admin pages', () => {
    const source = read('frontend/pharmacy.js');
    const match = source.match(/const permissions = (\{[\s\S]*?\n\});/);
    assert.ok(match, 'permission map exists');
    const permissions = vm.runInNewContext(`(${match[1]})`);
    for (const role of ['admin', 'administrator']) {
        for (const page of ['users.html', 'backup.html']) assert.ok(permissions[role].includes(page));
    }
    for (const role of ['pharmacist', 'inputer', 'cashier', 'manager']) {
        assert.ok(!permissions[role].includes('users.html'), `${role} cannot access users`);
        assert.ok(!permissions[role].includes('backup.html'), `${role} cannot access backups`);
    }
    assert.ok(permissions.pharmacist.includes('prescriptions.html'));
    assert.ok(permissions.cashier.includes('sales.html'));
    assert.ok(permissions.manager.includes('reports.html'));
});

test('Vercel pharmacy API catch-all forwards requests to the protected Express router', () => {
    const handler = read('api/pharmacy/[...path].js');
    assert.match(handler, /backends\/vercel-handler/);
    assert.match(handler, /api\/pharmacy/);
    const routes = read('backends/routes/pharmacy.routes.js');
    assert.match(routes, /router\.get\('\/admin\/users', requireRole\('admin'\)/);
    assert.match(routes, /router\.get\('\/admin\/backups', requireRole\('admin'\)/);
    assert.match(routes, /router\.get\('\/prescriptions', requireRole\('pharmacist'\)/);
    assert.match(routes, /router\.get\('\/sales', requireRole\('cashier', 'manager'\)/);
    assert.match(routes, /router\.get\('\/reports', requireRole\('manager'\)/);
});

test('local API routes respond and reject anonymous access', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-api-smoke-'));
    const env = { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'deployment-smoke-test-secret', PASSWORD_PEPPER: 'deployment-smoke-test-pepper', DATABASE_PATH: path.join(tempDir, 'smoke.db') };
    delete env.VERCEL;
    const script = String.raw`
      const db = require('./backends/config/database');
      const { ensureSchema } = require('./backends/database/schema');
      ensureSchema().then(() => {
        const app = require('./backends/app');
        const server = app.listen(0, '127.0.0.1', async () => {
          const base = 'http://127.0.0.1:' + server.address().port;
          const paths = ['/api/auth/me','/api/pharmacy/medicines','/api/pharmacy/prescriptions','/api/pharmacy/sales','/api/pharmacy/reports','/api/pharmacy/admin/users','/api/pharmacy/admin/backups'];
          try {
            for (const pathname of paths) {
              const response = await fetch(base + pathname);
              if (response.status !== 401) throw new Error(pathname + ' returned ' + response.status);
            }
            const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            if (login.status !== 400) throw new Error('Login handler returned ' + login.status + ' for missing credentials');
            console.log('All API routes responded with expected authentication/validation status.');
          } catch (error) { console.error(error.message); process.exitCode = 1; }
          finally { server.close(async () => { await db.close(); }); }
        });
      }).catch((error) => { console.error(error.message); process.exitCode = 1; });
    `;
    try {
        const result = spawnSync(process.execPath, ['-e', script], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
        assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('browser API calls remain same-origin and use the Vercel API paths', () => {
    assert.match(read('frontend/pharmacy.js'), /`\/api\/pharmacy\$\{path\}`/);
    assert.match(read('frontend/pharmacy.js'), /fetch\('\/api\/auth\/me'/);
    assert.match(read('frontend/script.js'), /const API_BASE_URL = \(window\.API_BASE_URL \|\| ''\)/);
});
