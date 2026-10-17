const api = (path) => `/api/pharmacy${path}`;
const page = document.body.dataset.page;
const $ = (id) => document.getElementById(id);
let user = null;
let medicines = [];

const permissions = {
  pharmacist: ['pharmacy.html', 'overview.html', 'medicines.html', 'inventory.html', 'prescriptions.html'],
  inputer: ['pharmacy.html', 'overview.html', 'medicines.html', 'inventory.html', 'prescriptions.html'],
  cashier: ['pharmacy.html', 'overview.html', 'sales.html'],
  manager: ['pharmacy.html', 'overview.html', 'medicines.html', 'inventory.html', 'sales.html', 'reports.html'],
  admin: ['pharmacy.html', 'overview.html', 'medicines.html', 'inventory.html', 'prescriptions.html', 'sales.html', 'reports.html', 'users.html', 'backup.html'],
  administrator: ['pharmacy.html', 'overview.html', 'medicines.html', 'inventory.html', 'prescriptions.html', 'sales.html', 'reports.html', 'users.html', 'backup.html']
};
const adminRoles = ['admin', 'administrator'];
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const moneyFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (n) => moneyFormat.format(Number(n) || 0);
const formatDate = (v) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d); };
function status(message, tone = '') { const el = $('pageStatus'); if (!el) return; el.textContent = message; el.className = `pharmacy-status${tone ? ` is-${tone}` : ''}`; }
function td(value, className = '') { const el = document.createElement('td'); if (value instanceof Node) el.append(value); else el.textContent = value ?? '—'; if (className) el.className = className; return el; }
function row(table, values) { const tr = document.createElement('tr'); values.forEach(v => tr.append(v instanceof HTMLTableCellElement ? v : td(v))); table.append(tr); return tr; }
function empty(table, columns, message) { if (!table) return; const tr = document.createElement('tr'); const cell = td(message, 'empty-state'); cell.colSpan = columns; tr.append(cell); table.replaceChildren(tr); }
function badge(text, cls = '') { const el = document.createElement('span'); el.className = cls; el.textContent = text; return el; }
function button(text, handler, danger = false) { const el = document.createElement('button'); el.type = 'button'; el.className = `table-action${danger ? ' is-danger' : ''}`; el.textContent = text; el.addEventListener('click', handler); return el; }
async function request(path, options = {}) { const res = await fetch(api(path), { credentials: 'include', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } }); const data = await res.json().catch(() => ({})); if (res.status === 401) { location.replace('index.html'); throw new Error('Please sign in again.'); } if (!res.ok) throw new Error(data.message || 'Request failed.'); return data; }
const values = (form) => Object.fromEntries(new FormData(form).entries());

async function loadMedicines() {
  const data = await request('/medicines'); medicines = data.medicines || [];
  const list = $('medicineList'); if (list) list.replaceChildren();
  const select = $('saleMedicine'); if (select) { select.replaceChildren(new Option(medicines.length ? 'Choose a medicine' : 'No medicines available', '')); }
  for (const m of medicines) {
    const stock = Number(m.stock) || 0; const low = stock <= (Number(m.reorder_level) || 0);
    const state = badge(low ? 'Reorder' : 'In stock', `stock-badge${low ? ' is-low' : ''}`);
    if (list) {
      const canEdit = ['pharmacist','inputer','admin','administrator'].includes(user?.role);
      const actions = page === 'inventory.html' && canEdit ? button('Adjust stock', async () => { const input = prompt('Set available stock quantity', String(stock)); if (input === null) return; const quantity = Number(input); if (!Number.isSafeInteger(quantity) || quantity < 0) return status('Enter a non-negative whole number.', 'error'); try { await request(`/medicines/${m.id}`, { method: 'PATCH', body: JSON.stringify({ stock: quantity }) }); await loadMedicines(); status('Stock quantity updated.', 'success'); } catch (e) { status(e.message, 'error'); } }) : state;
      const cells = [m.name, m.sku, m.category || '—', formatMoney(m.unit_price), numberFormat.format(stock), actions];
      row(list, cells);
    }
    if (select) { const option = new Option(`${m.name} · ${stock} available`, m.id); option.disabled = stock < 1; select.append(option); }
  }
  if (list && !medicines.length) empty(list, 6, 'No medicines have been added yet.');
}
async function loadSales() { const { sales = [] } = await request('/sales'); const list = $('salesList'); if (!list) return; list.replaceChildren(); sales.forEach(s => row(list, [`#${s.id}`, s.customer_name || 'Walk-in customer', formatDate(s.created_at), formatMoney(s.total), badge('Completed', 'state-badge is-done')])); if (!sales.length) empty(list, 5, 'No sales have been recorded yet.'); }
async function loadPrescriptions() { const { prescriptions = [] } = await request('/prescriptions'); const list = $('prescriptionList'); if (!list) return; list.replaceChildren(); for (const p of prescriptions) { const pending = p.status === 'pending'; const action = pending ? button('Dispense', async () => { try { await request(`/prescriptions/${p.id}/dispense`, { method: 'POST', body: '{}' }); status(`Prescription ${p.id} dispensed.`, 'success'); await loadPrescriptions(); } catch (e) { status(e.message, 'error'); } }) : '—'; row(list, [`#${p.id}`, p.customer_name || 'Customer not linked', p.prescriber || '—', formatDate(p.created_at), badge(p.status, `state-badge ${pending ? 'is-pending' : 'is-done'}`), action]); } if (!prescriptions.length) empty(list, 6, 'No prescriptions are waiting for review.'); }
async function loadReport() { const report = await request('/reports'); const counts = { metricTransactions: report.sales?.transactions, metricRevenue: report.sales?.revenue, metricMedicines: report.inventory?.medicines, metricStockUnits: report.inventory?.units, metricLowStock: report.inventory?.low_stock, metricPending: report.pending_prescriptions }; for (const [id, value] of Object.entries(counts)) { const el = $(id); if (el) el.textContent = id === 'metricRevenue' ? formatMoney(value) : numberFormat.format(Number(value) || 0); } const lowCount = $('lowStockCount'); if (lowCount) lowCount.textContent = numberFormat.format(Number(report.inventory?.low_stock) || 0); const lowList = $('lowStockList'); if (lowList) { lowList.replaceChildren(); const items = medicines.filter(m => Number(m.stock) <= Number(m.reorder_level)); items.forEach(m => row(lowList, [m.name, m.sku, numberFormat.format(Number(m.stock) || 0), numberFormat.format(Number(m.reorder_level) || 0), badge('Reorder', 'stock-badge is-low')])); if (!items.length) empty(lowList, 5, 'All listed medicines are above their reorder level.'); } }
async function loadAdmin() { const { users = [] } = await request('/admin/users'); const list = $('userList'); if (list) { list.replaceChildren(); for (const u of users) { const select = document.createElement('select'); ['pharmacist','cashier','manager','admin'].forEach(role => { const op = new Option(role[0].toUpperCase() + role.slice(1), role); op.selected = role === u.role; select.append(op); }); select.addEventListener('change', async () => { try { await request(`/admin/users/${u.id}/role`, { method: 'PATCH', body: JSON.stringify({ role: select.value }) }); status(`Role updated for ${u.email}.`, 'success'); await loadAdmin(); } catch (e) { status(e.message, 'error'); } }); const control = u.role === 'administrator' ? badge('Primary administrator', 'state-badge') : select; const remove = String(u.id) === String(user.id) || u.role === 'administrator' ? '—' : button('Archive and delete', async () => { if (!confirm(`Archive and delete ${u.email}?`)) return; try { await request(`/admin/users/${u.id}`, { method: 'DELETE' }); await loadAdmin(); status('Staff account archived and deleted.', 'success'); } catch (e) { status(e.message, 'error'); } }, true); row(list, [u.email, badge(u.role, 'state-badge'), control, remove]); } if (!users.length) empty(list, 4, 'No staff accounts found.'); }
  const logs = await request('/admin/audit-logs'); const auditList = $('auditList'); if (auditList) { auditList.replaceChildren(); (logs.auditLogs || []).forEach(x => row(auditList, [formatDate(x.created_at), x.action, x.actor_role || x.role || 'System', x.result || 'Recorded'])); if (!logs.auditLogs?.length) empty(auditList, 4, 'No security events have been recorded yet.'); }
}
async function loadBackups() { const list = $('backupList'); if (!list) return; list.replaceChildren(); try { const data = await request('/admin/backups'); for (const b of data.backups || []) { const action = data.storage === 'local' ? button('Restore', async () => { if (!confirm(`Restore ${b.name}? This replaces current local database records.`)) return; try { const result = await request('/admin/backups/restore', { method: 'POST', body: JSON.stringify({ name: b.name }) }); status(result.message, 'success'); } catch (e) { status(e.message, 'error'); } }) : '—'; row(list, [b.name, formatDate(b.createdAt), b.size ? `${numberFormat.format(b.size)} bytes` : '—', action]); } if (!data.backups?.length) empty(list, 4, 'No backups are available. Create one to start a recovery history.'); } catch (e) { empty(list, 4, e.message); } }

async function init() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' }); const data = await response.json().catch(() => ({})); if (!response.ok || !data.user) { location.replace('index.html'); return; }
    user = data.user; const role = user.role; const allowed = permissions[role] || [];
    if (!allowed.includes(page)) { status('You are not authorized to view this page.', 'error'); location.replace('pharmacy.html?denied=1'); return; }
    $('roleBadge').textContent = role;
    if ($('medicineForm')) $('medicineForm').hidden = !['pharmacist','inputer','admin','administrator'].includes(role);
    document.querySelectorAll('[data-admin]').forEach(el => { el.hidden = !adminRoles.includes(role); });
    document.querySelectorAll('[data-link]').forEach(el => { const target = el.dataset.link; const roles = Object.keys(permissions).filter(r => permissions[r].includes(target)); el.hidden = !roles.includes(role); if (target === page) el.setAttribute('aria-current', 'page'); });
    if (page === 'pharmacy.html') document.querySelectorAll('.dashboard-links a[data-link]').forEach(el => { const target = el.dataset.link; el.hidden = !allowed.includes(target); });
    if (new URLSearchParams(location.search).has('denied')) status('That section is not available for your role.');
    if (['medicines.html','inventory.html','sales.html','overview.html','reports.html'].includes(page)) await loadMedicines();
    if (page === 'medicines.html' || page === 'inventory.html') { /* table loaded above */ }
    if (page === 'sales.html') await loadSales();
    if (page === 'prescriptions.html') await loadPrescriptions();
    if ((page === 'overview.html' || page === 'reports.html') && ['manager','admin','administrator'].includes(role)) await loadReport();
    if (page === 'overview.html' && !['manager','admin','administrator'].includes(role)) {
      const medicineMetric = $('metricMedicines'); if (medicineMetric) medicineMetric.textContent = numberFormat.format(medicines.length);
      const stockMetric = $('metricStockUnits'); if (stockMetric) stockMetric.textContent = numberFormat.format(medicines.reduce((total, item) => total + (Number(item.stock) || 0), 0));
      for (const id of ['metricTransactions','metricRevenue','metricLowStock','metricPending']) $(id)?.closest('.report-card')?.setAttribute('hidden', '');
    }
    if (page === 'users.html') await loadAdmin();
    if (page === 'backup.html') await loadBackups();
    status(`Signed in as ${user.email}. Your ${role} workspace is ready.`, 'success');
  } catch (e) { status(e.message, 'error'); }
}
$('medicineForm')?.addEventListener('submit', async e => { e.preventDefault(); const form = e.currentTarget; const data = values(form); for (const key of ['unitPrice','stock','reorderLevel']) data[key] = Number(data[key]); try { await request('/medicines', { method: 'POST', body: JSON.stringify(data) }); form.reset(); await loadMedicines(); status('Medicine added to the catalogue.', 'success'); } catch (err) { status(err.message, 'error'); } });
$('saleForm')?.addEventListener('submit', async e => { e.preventDefault(); const form = e.currentTarget; try { const sale = await request('/sales', { method: 'POST', body: JSON.stringify({ items: [{ medicineId: Number($('saleMedicine').value), quantity: Number(form.elements.quantity.value) }] }) }); status(`Sale ${sale.id} recorded. Total: ${formatMoney(sale.total)}.`, 'success'); form.reset(); await loadSales(); await loadMedicines(); } catch (err) { status(err.message, 'error'); } });
$('userForm')?.addEventListener('submit', async e => { e.preventDefault(); const form = e.currentTarget; try { await request('/admin/users', { method: 'POST', body: JSON.stringify(values(form)) }); form.reset(); await loadAdmin(); status('Staff account created. They will set up two-factor authentication on first sign-in.', 'success'); } catch (err) { status(err.message, 'error'); } });
$('createBackup')?.addEventListener('click', async () => { try { const data = await request('/admin/backups', { method: 'POST', body: '{}' }); status(data.message, 'success'); await loadBackups(); } catch (e) { status(e.message, 'error'); } });
$('signOut')?.addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); location.replace('index.html'); });
init();
