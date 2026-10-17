# Pharmacy MVP

The existing authentication application now also provides a pharmacy workspace at `/pharmacy.html` and JSON endpoints under `/api/pharmacy`. Existing login, Argon2id password hashes, `PASSWORD_PEPPER`, authenticator-based 2FA, SQLite/PostgreSQL support, and encrypted Google Drive uploads remain in place.

## Roles

- `administrator` and `admin`: user and role management, audit logs, backup controls, and full pharmacy access.
- `pharmacist`: medicine records, inventory, prescriptions, and dispensing.
- `cashier`: medicine lookup and sales recording/history.
- `manager`: inventory, sales history, and reports.
- Existing `inputer` accounts retain pharmacist permissions for compatibility.

The backend enforces these permissions. The workspace UI only reflects the signed-in user's role; it is not the security boundary. Admin-created passwords must be at least 12 characters and are hashed with the existing Argon2id plus environment pepper service.

## Data and audit

Startup schema initialization creates the pharmacy tables and expands the supported user roles. Deleting a user archives their ID, email, role, deleting admin, and deletion time in `deleted_users` before removing the account. Audit events include actor ID/role, action, timestamp, resource details, result, IP address, and user agent.

Medicine stock and sale/dispensing writes run in database transactions. SQL values use bound parameters; dynamic update column names come only from a fixed allowlist.

## Backups and restore

SQLite Admins can create/list local snapshots and restore a selected `.db` snapshot from the Pharmacy workspace. Restore replaces the current application data. The existing scheduled local backup and AES-256-GCM encrypted Google Drive upload remain enabled by their current settings.

In PostgreSQL deployments, the existing encrypted scheduled Google Drive export remains the cloud recovery path. Use `npm run db:restore-postgres-backup -- <private-backup-file>` against a new empty PostgreSQL database for recovery; the script validates the encrypted export and refuses non-empty application tables. The dashboard identifies this PostgreSQL restore path.

## API surface

- `GET/POST /api/pharmacy/medicines`; `PATCH /api/pharmacy/medicines/:id`
- `GET/POST /api/pharmacy/prescriptions`; `POST /api/pharmacy/prescriptions/:id/dispense`
- `GET/POST /api/pharmacy/sales`; `GET /api/pharmacy/reports`
- Admin: `GET/POST /api/pharmacy/admin/users`, `PATCH /api/pharmacy/admin/users/:id/role`, `DELETE /api/pharmacy/admin/users/:id`, `GET /api/pharmacy/admin/audit-logs`, `GET/POST /api/pharmacy/admin/backups`, `POST /api/pharmacy/admin/backups/restore`
