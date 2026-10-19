const express = require('express');
const db = require('../config/database');
const { hashPassword } = require('../services/password.service');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createBackup, createPostgresBackup } = require('../services/backup.service');
const { listDriveBackups } = require('../services/google-drive.service');

const router = express.Router();
const roles = {
    admin: ['admin', 'administrator'],
    pharmacist: ['admin', 'administrator', 'pharmacist', 'inputer'],
    cashier: ['admin', 'administrator', 'cashier'],
    manager: ['admin', 'administrator', 'manager']
};

function requireRole(...allowed) {
    return async (req, res, next) => {
        const user = req.session.user;
        if (!user) return res.status(401).json({ message: 'Authentication required' });
        try {
            const current = await db.query('SELECT id,email,role,is_active FROM users WHERE id=?', [user.id]);
            const account = current.rows[0];
            if (!account || !account.is_active) return res.status(401).json({ message: 'Account not available. Please sign in again.' });
            req.session.user.role = account.role;
            req.session.user.email = account.email;
            if (!allowed.some((role) => roles[role]?.includes(account.role))) {
                return res.status(403).json({ message: 'Access denied' });
            }
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

async function audit(req, action, resource, result = 'success') {
    await db.query(`INSERT INTO audit_logs (user_id, action, ip_address, user_agent, actor_role, resource, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.session.user?.id || null, action, req.ip || null, req.get('user-agent') || null, req.session.user?.role || null, JSON.stringify(resource), result]);
}

const positiveInt = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0;

router.get('/medicines', requireRole('pharmacist', 'manager', 'cashier'), async (req, res) => {
    const result = await db.query(`SELECT m.*, COALESCE(i.quantity, 0) AS stock FROM medicines m LEFT JOIN inventory i ON i.medicine_id=m.id WHERE m.is_active=TRUE ORDER BY m.name`);
    return res.json({ medicines: result.rows });
});

router.post('/medicines', requireRole('pharmacist'), async (req, res) => {
    const { name, sku, category = null, description = null, unitPrice, stock = 0, reorderLevel = 0 } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || typeof sku !== 'string' || !sku.trim() ||
        !Number.isFinite(Number(unitPrice)) || Number(unitPrice) < 0 || !Number.isSafeInteger(Number(stock)) || Number(stock) < 0 ||
        !Number.isSafeInteger(Number(reorderLevel)) || Number(reorderLevel) < 0) return res.status(400).json({ message: 'Provide a name, SKU, non-negative price and valid stock levels.' });
    try {
        const created = await db.transaction(async () => {
            const result = await db.query(`INSERT INTO medicines (name, sku, category, description, unit_price, reorder_level, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
                [name.trim(), sku.trim(), category, description, Number(unitPrice), Number(reorderLevel), req.session.user.id, req.session.user.id]);
            await db.query('INSERT INTO inventory (medicine_id, quantity) VALUES (?, ?)', [result.rows[0].id, Number(stock)]);
            return result.rows[0].id;
        })();
        await audit(req, 'medicine.created', { medicineId: created, sku: sku.trim() });
        return res.status(201).json({ id: created });
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === '23505') return res.status(409).json({ message: 'SKU already exists.' });
        throw e;
    }
});

router.patch('/medicines/:id', requireRole('pharmacist'), async (req, res) => {
    if (!positiveInt(req.params.id)) return res.status(400).json({ message: 'Invalid medicine ID.' });
    const allowed = ['name', 'category', 'description', 'unitPrice', 'reorderLevel', 'stock'];
    const input = req.body || {};
    if (!Object.keys(input).length || Object.keys(input).some((key) => !allowed.includes(key))) return res.status(400).json({ message: 'Provide supported medicine fields.' });
    const medicineId = Number(req.params.id);
    if (Object.hasOwn(input, 'name') && (typeof input.name !== 'string' || !input.name.trim())) return res.status(400).json({ message: 'Medicine name cannot be empty.' });
    if (Object.hasOwn(input, 'unitPrice') && (!Number.isFinite(Number(input.unitPrice)) || Number(input.unitPrice) < 0)) return res.status(400).json({ message: 'Unit price must be non-negative.' });
    if (Object.hasOwn(input, 'reorderLevel') && (!Number.isSafeInteger(Number(input.reorderLevel)) || Number(input.reorderLevel) < 0)) return res.status(400).json({ message: 'Reorder level must be a non-negative whole number.' });
    await db.transaction(async () => {
        const fields = []; const values = [];
        for (const [key, column] of [['name','name'],['category','category'],['description','description'],['unitPrice','unit_price'],['reorderLevel','reorder_level']]) {
            if (Object.hasOwn(input, key)) { fields.push(`${column} = ?`); values.push(input[key]); }
        }
        if (fields.length) {
            fields.push('updated_by = ?', 'updated_at = CURRENT_TIMESTAMP'); values.push(req.session.user.id, medicineId);
            const changed = await db.query(`UPDATE medicines SET ${fields.join(', ')} WHERE id = ? AND is_active = TRUE`, values);
            if (!changed.rowCount) throw Object.assign(new Error('Medicine not found.'), { status: 404 });
        }
        if (Object.hasOwn(input, 'stock')) {
            if (!Number.isSafeInteger(Number(input.stock)) || Number(input.stock) < 0) throw Object.assign(new Error('Stock must be a non-negative integer.'), { status: 400 });
            await db.query('INSERT INTO inventory (medicine_id, quantity) VALUES (?, ?) ON CONFLICT(medicine_id) DO UPDATE SET quantity=excluded.quantity, updated_at=CURRENT_TIMESTAMP', [medicineId, Number(input.stock)]);
        }
    })();
    await audit(req, 'medicine.updated', { medicineId });
    return res.json({ message: 'Medicine updated.' });
});

router.get('/prescriptions', requireRole('pharmacist'), async (_req, res) => {
    const result = await db.query(`SELECT p.*, c.name AS customer_name FROM prescriptions p LEFT JOIN customers c ON c.id=p.customer_id ORDER BY p.created_at DESC`);
    return res.json({ prescriptions: result.rows });
});

router.post('/prescriptions', requireRole('pharmacist'), async (req, res) => {
    const { customerId = null, prescriber = null, reference = null, items } = req.body || {};
    if (!Array.isArray(items) || items.length < 1 || items.some((i) => !positiveInt(i.medicineId) || !positiveInt(i.quantity))) return res.status(400).json({ message: 'Prescription needs one or more valid medicine and quantity items.' });
    const id = await db.transaction(async () => {
        const result = await db.query('INSERT INTO prescriptions (customer_id, prescriber, reference, created_by) VALUES (?, ?, ?, ?) RETURNING id', [customerId, prescriber, reference, req.session.user.id]);
        for (const item of items) await db.query('INSERT INTO prescription_items (prescription_id, medicine_id, quantity) VALUES (?, ?, ?)', [result.rows[0].id, Number(item.medicineId), Number(item.quantity)]);
        return result.rows[0].id;
    })();
    await audit(req, 'prescription.created', { prescriptionId: id });
    return res.status(201).json({ id });
});

router.post('/prescriptions/:id/dispense', requireRole('pharmacist'), async (req, res) => {
    if (!positiveInt(req.params.id)) return res.status(400).json({ message: 'Invalid prescription ID.' });
    const id = Number(req.params.id);
    await db.transaction(async () => {
        const p = await db.query("SELECT id FROM prescriptions WHERE id=? AND status='pending'", [id]);
        if (!p.rows[0]) throw Object.assign(new Error('Pending prescription not found.'), { status: 404 });
        const items = await db.query('SELECT medicine_id, quantity FROM prescription_items WHERE prescription_id=?', [id]);
        for (const item of items.rows) {
            const stock = await db.query('SELECT quantity FROM inventory WHERE medicine_id=?', [item.medicine_id]);
            if (!stock.rows[0] || stock.rows[0].quantity < item.quantity) throw Object.assign(new Error('Insufficient stock for one or more medicines.'), { status: 409 });
            await db.query('UPDATE inventory SET quantity=quantity-?, updated_at=CURRENT_TIMESTAMP WHERE medicine_id=?', [item.quantity, item.medicine_id]);
        }
        await db.query("UPDATE prescriptions SET status='dispensed', dispensed_by=?, dispensed_at=CURRENT_TIMESTAMP WHERE id=?", [req.session.user.id, id]);
    })();
    await audit(req, 'prescription.dispensed', { prescriptionId: id });
    return res.json({ message: 'Prescription dispensed.' });
});

router.post('/sales', requireRole('cashier'), async (req, res) => {
    const { customerId = null, items } = req.body || {};
    if (!Array.isArray(items) || !items.length || items.some((i) => !positiveInt(i.medicineId) || !positiveInt(i.quantity))) return res.status(400).json({ message: 'Sale needs one or more valid medicine and quantity items.' });
    const sale = await db.transaction(async () => {
        let total = 0; const rows = [];
        for (const item of items) {
            const medicine = await db.query('SELECT unit_price FROM medicines WHERE id=? AND is_active=TRUE', [Number(item.medicineId)]);
            const stock = await db.query('SELECT quantity FROM inventory WHERE medicine_id=?', [Number(item.medicineId)]);
            if (!medicine.rows[0] || !stock.rows[0]) throw Object.assign(new Error('Medicine not found.'), { status: 404 });
            if (stock.rows[0].quantity < Number(item.quantity)) throw Object.assign(new Error('Insufficient stock.'), { status: 409 });
            const price = Number(medicine.rows[0].unit_price); const line = price * Number(item.quantity);
            total += line; rows.push({ ...item, price, line });
        }
        const created = await db.query('INSERT INTO sales (customer_id, cashier_id, total) VALUES (?, ?, ?) RETURNING id', [customerId, req.session.user.id, total]);
        for (const item of rows) {
            await db.query('INSERT INTO sale_items (sale_id, medicine_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)', [created.rows[0].id, Number(item.medicineId), Number(item.quantity), item.price, item.line]);
            await db.query('UPDATE inventory SET quantity=quantity-?, updated_at=CURRENT_TIMESTAMP WHERE medicine_id=?', [Number(item.quantity), Number(item.medicineId)]);
        }
        return { id: created.rows[0].id, total };
    })();
    await audit(req, 'sale.completed', { saleId: sale.id, total: sale.total });
    return res.status(201).json(sale);
});

router.get('/sales', requireRole('cashier', 'manager'), async (_req, res) => {
    const result = await db.query('SELECT s.*, c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.created_at DESC');
    return res.json({ sales: result.rows });
});

router.get('/reports', requireRole('manager'), async (_req, res) => {
    const [sales, inventory, counts] = await Promise.all([
        db.query("SELECT COUNT(*) AS transactions, COALESCE(SUM(total),0) AS revenue FROM sales WHERE status='completed'"),
        db.query('SELECT COUNT(*) AS medicines, COALESCE(SUM(quantity),0) AS units, COALESCE(SUM(CASE WHEN COALESCE(quantity,0) <= m.reorder_level THEN 1 ELSE 0 END),0) AS low_stock FROM medicines m LEFT JOIN inventory i ON i.medicine_id=m.id WHERE m.is_active=TRUE'),
        db.query('SELECT COUNT(*) AS pending_prescriptions FROM prescriptions WHERE status=\'pending\'')
    ]);
    return res.json({ sales: sales.rows[0], inventory: inventory.rows[0], ...counts.rows[0] });
});

router.get('/admin/users', requireRole('admin'), async (_req, res) => {
    const result = await db.query('SELECT id,email,role,is_active,two_factor_enabled,created_at FROM users ORDER BY id');
    return res.json({ users: result.rows });
});

router.post('/admin/users', requireRole('admin'), async (req, res) => {
    const { email, password, role } = req.body || {};
    const allowed = ['pharmacist','cashier','manager','admin'];
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof password !== 'string' || password.length < 12 || !allowed.includes(role)) return res.status(400).json({ message: 'Provide a valid email, 12+ character password and supported role.' });
    const hash = await hashPassword(password);
    try {
        const result = await db.query('INSERT INTO users (email,password_hash,role) VALUES (?,?,?) RETURNING id', [email.trim().toLowerCase(), hash, role]);
        await audit(req, 'user.created', { userId: result.rows[0].id, role });
        return res.status(201).json({ id: result.rows[0].id, email: email.trim().toLowerCase(), role });
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === '23505') return res.status(409).json({ message: 'An account with that email already exists.' });
        throw e;
    }
});

router.patch('/admin/users/:id/role', requireRole('admin'), async (req, res) => {
    const id = Number(req.params.id); const { role } = req.body || {};
    if (!positiveInt(id) || !['pharmacist','cashier','manager','admin'].includes(role)) return res.status(400).json({ message: 'Invalid user ID or role.' });
    if (id === req.session.user.id) return res.status(403).json({ message: 'You cannot change your own role.' });
    const changed = await db.query('UPDATE users SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND is_active=TRUE', [role,id]);
    if (!changed.rowCount) return res.status(404).json({ message: 'User not found.' });
    await audit(req, 'user.role_changed', { userId: id, role });
    return res.json({ message: 'User role updated.' });
});

router.delete('/admin/users/:id', requireRole('admin'), async (req, res) => {
    const id = Number(req.params.id);
    if (!positiveInt(id)) return res.status(400).json({ message: 'Invalid user ID.' });
    if (id === req.session.user.id) return res.status(403).json({ message: 'You cannot delete your own account.' });
    const deleted = await db.transaction(async () => {
        const user = await db.query('SELECT id,email,role FROM users WHERE id=?', [id]);
        if (!user.rows[0]) return null;
        await db.query('INSERT INTO deleted_users (original_user_id,email,role,deleted_by) VALUES (?,?,?,?)', [id,user.rows[0].email,user.rows[0].role,req.session.user.id]);
        await db.query('DELETE FROM users WHERE id=?', [id]);
        return user.rows[0];
    })();
    if (!deleted) return res.status(404).json({ message: 'User not found.' });
    await audit(req, 'user.deleted', { userId: id, role: deleted.role });
    return res.json({ message: `${deleted.email} archived and deleted.` });
});

router.get('/admin/audit-logs', requireRole('admin'), async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const result = await db.query('SELECT a.id,a.user_id,u.role,a.action,a.ip_address,a.user_agent,a.created_at FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT ?', [limit]);
    return res.json({ auditLogs: result.rows });
});

router.get('/admin/backups', requireRole('admin'), async (_req, res) => {
    if (db.dialect === 'postgres') {
        try {
            const backups = await listDriveBackups();
            return res.json({ storage: 'cloud', backups: backups.map((backup) => ({ name: backup.name, id: backup.id, createdAt: backup.createdTime, size: Number(backup.size) || null })) });
        } catch (error) {
            console.error('Cloud backup listing failed:', error.message);
            return res.status(503).json({ message: 'Google Drive backup access failed. Reauthorize the Google Drive connection configured for this deployment.' });
        }
    }
    const directory = path.resolve(path.join(__dirname, '..', '..'), process.env.BACKUP_DIRECTORY || 'backups');
    await fs.mkdir(directory, { recursive: true });
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const backups = [];
    for (const entry of entries) {
        if (!entry.isFile() || !/^auth-db-.*\.db$/.test(entry.name)) continue;
        const stat = await fs.stat(path.join(directory, entry.name));
        backups.push({ name: entry.name, size: stat.size, createdAt: stat.mtime.toISOString() });
    }
    backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return res.json({ storage: 'local', backups });
});

router.post('/admin/backups', requireRole('admin'), async (req, res) => {
    if (db.dialect === 'postgres') {
        try {
            const uploaded = await createPostgresBackup();
            await audit(req, 'backup.created', { name: uploaded.name, storage: 'cloud' });
            return res.status(201).json({ backup: uploaded.name, message: 'Encrypted cloud backup created.' });
        } catch (error) {
            console.error('Cloud backup creation failed:', error.message);
            return res.status(503).json({ message: 'Google Drive backup access failed. Reauthorize the Google Drive connection configured for this deployment.' });
        }
    }
    const filePath = await createBackup();
    if (!filePath) return res.status(409).json({ message: 'A backup is already running.' });
    await audit(req, 'backup.created', { name: path.basename(filePath), storage: 'local' });
    return res.status(201).json({ backup: path.basename(filePath), message: 'Backup created.' });
});

router.post('/admin/backups/restore', requireRole('admin'), async (req, res) => {
    if (db.dialect !== 'sqlite') return res.status(503).json({ message: 'PostgreSQL restore uses the guarded restore script and must target a new empty database.' });
    const name = req.body?.name;
    if (typeof name !== 'string' || !/^auth-db-[\da-zA-ZT_-]+\.db$/.test(name) || path.basename(name) !== name) return res.status(400).json({ message: 'Select a valid local database backup.' });
    const directory = path.resolve(path.join(__dirname, '..', '..'), process.env.BACKUP_DIRECTORY || 'backups');
    const filePath = path.join(directory, name);
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) return res.status(404).json({ message: 'Backup not found.' });
    } catch (error) {
        if (error.code === 'ENOENT') return res.status(404).json({ message: 'Backup not found.' });
        throw error;
    }
    try {
        await db.restoreFromBackup(filePath);
    } catch (error) {
        await audit(req, 'backup.restore_failed', { name, reason: error.message }, 'failure');
        throw error;
    }
    await db.query('INSERT INTO audit_logs (user_id, action, ip_address, user_agent, actor_role, resource, result) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [null, 'backup.restored', req.ip || null, req.get('user-agent') || null, req.session.user.role, JSON.stringify({ name, actorUserId: req.session.user.id, actorEmail: req.session.user.email }), 'success']);
    return res.json({ message: 'Backup restored. Sign in again if your restored account state requires it.' });
});

function handleError(error, req, res, next) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
}
router.use(handleError);

module.exports = router;
