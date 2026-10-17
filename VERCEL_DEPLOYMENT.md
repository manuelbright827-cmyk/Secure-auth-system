# Deploying Secure Auth System on Vercel

Vercel serves the static site from `frontend/` and invokes the Express application through the Node Functions under `api/`. Configure Supabase with `SUPABASE_DB_URL` (or a supported PostgreSQL URL alias); users, pharmacy records, rate limits, audit logs, and sessions then use PostgreSQL. SQLite is local-development-only: the application now fails fast in production or on Vercel if no PostgreSQL URL is configured. This prevents a missing deployment variable from silently opening a SQLite path in Vercel's temporary/read-only filesystem, which can surface as `SQLITE_CANTOPEN`.

## Vercel project configuration

Use a single Vercel project connected to this repository and the `main` branch:

- Set **Root Directory** to the repository root (leave it blank/default, not `frontend/` or `backends/`).
- Keep the Framework Preset as **Other** unless Vercel auto-detects it correctly.
- Use the repository's `vercel.json`; its static output directory is `frontend` and Vercel discovers the `api/` function.
- Do not add a build command. Vercel runs the Node package install from the root `package.json`.
- Confirm the connected Git repository is `manuelbright827-cmyk/Secure-auth-system`, the Production Branch is `main`, and the Root Directory is the repository root. The local Git remote and branch do not by themselves prove the Vercel dashboard linkage.

The frontend and API share the same Vercel origin, so its existing relative `/api/...` fetches and `SameSite=Lax` session cookie stay same-origin; no CORS allowlist or cross-site cookie is needed.

## PostgreSQL database

Create a Supabase project and copy its PostgreSQL connection string from the project's database settings. For serverless Vercel functions, use Supabase's transaction pooler; use its session pooler if your selected database features require a persistent session. Set the connection string as the private `SUPABASE_DB_URL` environment variable. The Supabase Vercel Marketplace variables `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, and `POSTGRES_URL_NON_POOLING` are also recognized, followed by the legacy `DATABASE_URL` and `DATABASE_POSTGRES_URL` aliases. Include Supabase's recommended `sslmode=require`. Keep the URL private; never commit it or paste it into chat. The API creates its PostgreSQL schema idempotently on first request.

The app needs these production environment variables in Vercel Project Settings → Environment Variables:

- `SUPABASE_DB_URL`: Supabase PostgreSQL connection string. Supabase Marketplace `POSTGRES_URL` is also supported; use a Supabase URL for either name.
- `NODE_ENV`: `production`.
- `SESSION_SECRET`: a high-entropy private secret. If migrating current users, preserve the exact local value; it also encrypts their TOTP secrets.
- `PASSWORD_PEPPER`: a high-entropy private secret. If migrating users, preserve the exact local value or their password hashes will no longer verify.
- `EMAIL_DELIVERY`: `smtp`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM`: your authorized mail provider settings. Keep the App Password private.
- `APP_BASE_URL`: the production Vercel HTTPS origin, without a trailing slash.
- `CRON_SECRET`: a separate long random secret used to authenticate the scheduled backup endpoint.
- `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`, and `GOOGLE_DRIVE_FOLDER_ID`: private OAuth and destination-folder settings for daily encrypted backups.
- `BACKUP_ENCRYPTION_KEY`: a stable random 32-byte key encoded as 64 hex characters. Keep a separate secure copy; losing it makes encrypted Drive backups unrecoverable.

Set the variables for Production (and Preview only if needed) and redeploy after changing them. Do not upload `.env`, OAuth client JSON, token files, or local database files to Vercel/GitHub.

`vercel.json` uses `frontend` for static output and keeps the Node handlers in the root `api/` directory. Frontend calls use relative `/api/...` URLs, so the UI, session cookie, and handlers stay on the same deployment origin. The pharmacy pages use `pharmacy.js` for page-level role gating; the API continues to enforce authorization independently, including for admin users and backups.

After setting Production variables, verify the Vercel environment-variable names in Project Settings (or `vercel env ls production`) without printing or copying values. At minimum, confirm the database URL, session secret, password pepper, SMTP settings, production `APP_BASE_URL`, cron secret, and the Drive/encryption variables if cloud backups are enabled. The `/api/health` route reports API initialization health; a missing database URL now fails before SQLite can be opened.

## Transfer existing local accounts

The local SQLite database and hosted PostgreSQL database are separate. To migrate, configure `SUPABASE_DB_URL` privately in your local process and run `npm.cmd run db:migrate-sqlite-to-postgres` once. The migration refuses to copy into non-empty application tables. It transfers auth, rate-limit, audit, archived-user, medicine, inventory, customer, prescription, and sales data when present. It preserves password hashes and encrypted authenticator secrets. Keep the existing `SESSION_SECRET`, `PASSWORD_PEPPER`, and TOTP encryption key values unchanged. Do not run the migration twice or against a database already containing application data. The source SQLite file is read-only during migration and remains in place.

If you prefer a clean cloud start instead, do not run that command; a first-user provisioning flow will be needed because the current app has no public registration endpoint.

## Backups and local/offline use

Vercel runs the authenticated `/api/cron/backup` endpoint once daily at 03:00 UTC. It exports auth and pharmacy tables to JSON in memory, encrypts the snapshot with AES-256-GCM, and uploads only the encrypted object to the configured Drive folder. The Drive file is not a SQLite database; it contains a PostgreSQL data snapshot. Old app backups are pruned according to `BACKUP_RETENTION_DAYS`.

To restore a downloaded `auth-db-*.pg.json.enc` file, set the original `BACKUP_ENCRYPTION_KEY` and `SUPABASE_DB_URL` pointing to a new, empty PostgreSQL database in your private environment, then run `npm.cmd run db:restore-postgres-backup -- <path-to-file>`. The command validates the format and refuses to write if any application table already has rows.

On the computer, leaving all PostgreSQL URL variables unset keeps the existing SQLite database and local file snapshot scheduler. Those SQLite snapshots remain available offline. The migration does not delete the SQLite file. Cloud PostgreSQL and local SQLite are separate databases; the local copy does not automatically mirror later cloud changes. Preserve provider-level backups too, and keep the encryption key separately from Drive.
