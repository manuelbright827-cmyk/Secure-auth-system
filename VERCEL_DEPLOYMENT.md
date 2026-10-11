# Deploying Secure Auth System on Vercel

Vercel serves the static site from `frontend/` and invokes the existing Express authentication routes as a Node Function from `api/[...path].js`. Local development continues to use SQLite; when `DATABASE_URL` is set, both users and sessions use PostgreSQL. Vercel's temporary filesystem is never used for account storage.

## Vercel project configuration

Use a single Vercel project connected to this repository and the `main` branch:

- Set **Root Directory** to the repository root (leave it blank/default, not `frontend/` or `backends/`).
- Keep the Framework Preset as **Other** unless Vercel auto-detects it correctly.
- Use the repository's `vercel.json`; its static output directory is `frontend` and Vercel discovers the `api/` function.
- Do not add a build command. Vercel runs the Node package install from the root `package.json`.

The frontend and API share the same Vercel origin, so its existing relative `/api/...` fetches and `SameSite=Lax` session cookie stay same-origin; no CORS allowlist or cross-site cookie is needed.

## PostgreSQL database

Create a free-tier PostgreSQL database through a Vercel Marketplace provider such as Neon, subject to the provider's current limits and terms. In that provider, use its pooled connection string for Vercel's `DATABASE_URL` environment variable. Keep the URL private; never commit it or paste it into chat. The API creates its PostgreSQL schema idempotently on first request.

The app needs these production environment variables in Vercel Project Settings → Environment Variables:

- `DATABASE_URL`: pooled PostgreSQL connection string.
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

## Transfer existing local accounts

The local SQLite database and hosted PostgreSQL database are separate. To keep existing users, first configure `DATABASE_URL` privately in your local process and run `npm.cmd run db:migrate-sqlite-to-postgres` once. The migration refuses to copy into non-empty application tables. It preserves password hashes, encrypted authenticator secrets, audit rows, and outstanding setup/reset tokens. Keep the existing `SESSION_SECRET` and `PASSWORD_PEPPER` values unchanged in Vercel. Do not run the migration twice or against a database already containing accounts.

If you prefer a clean cloud start instead, do not run that command; a first-user provisioning flow will be needed because the current app has no public registration endpoint.

## Backups and local/offline use

Vercel runs the authenticated `/api/cron/backup` endpoint once daily at 03:00 UTC. It exports the application tables to JSON in memory, encrypts the snapshot with AES-256-GCM, and uploads only the encrypted object to the configured Drive folder. The Drive file is not a SQLite database; it contains a PostgreSQL data snapshot. Old app backups are pruned according to `BACKUP_RETENTION_DAYS`.

To restore a downloaded `auth-db-*.pg.json.enc` file, set the original `BACKUP_ENCRYPTION_KEY` and a `DATABASE_URL` pointing to a new, empty PostgreSQL database in your private environment, then run `npm.cmd run db:restore-postgres-backup -- <path-to-file>`. The command validates the format and refuses to write if any application table already has rows.

On the computer, leaving `DATABASE_URL` unset keeps the existing SQLite database and local file snapshot scheduler. Those SQLite snapshots remain available offline. Cloud PostgreSQL and local SQLite are separate databases; the local copy does not automatically mirror later cloud changes. Preserve provider-level backups too, and keep the encryption key separately from Drive.
