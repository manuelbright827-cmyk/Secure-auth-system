# Google Drive backups

Google Drive backups are encrypted by the app with AES-256-GCM before upload. The encryption key is never uploaded. Keep `BACKUP_ENCRYPTION_KEY` stable and store a separate secure copy; losing it makes encrypted Drive backups unrecoverable.

## Local SQLite mode

When running on the computer without a PostgreSQL URL, the app uses SQLite at `DATABASE_PATH`, creates local snapshots under `backups/`, and uploads encrypted `.db.enc` copies when `GOOGLE_DRIVE_FOLDER_ID` and local OAuth files are configured. Local snapshots are retained according to `BACKUP_RETENTION_DAYS`.

Set up local Drive access with `npm.cmd run drive:configure` and `npm.cmd run drive:auth`. Keep the OAuth JSON and refresh token under the ignored files; never commit or share them. OAuth apps left in Google's external Testing mode can have refresh tokens that expire, so review Google's current OAuth requirements for unattended use.

## Vercel/PostgreSQL mode

When `SUPABASE_DB_URL` (or `DATABASE_URL`) contains the Supabase PostgreSQL connection string, the app uses PostgreSQL. Vercel's daily Cron invokes `/api/cron/backup`; it exports auth, audit, rate-limit, archived-user, and pharmacy tables, encrypts the JSON snapshot with the same AES-256-GCM backup format, uploads it to Drive as `auth-db-<timestamp>.pg.json.enc`, and prunes old app backups according to `BACKUP_RETENTION_DAYS`.

Configure these as private Vercel Production environment variables:

- `SUPABASE_DB_URL`: Supabase PostgreSQL connection string. `DATABASE_URL` remains supported as an alias.
- `GOOGLE_DRIVE_FOLDER_ID`: the ID of your existing Drive backup folder.
- `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET`: from your OAuth Desktop client JSON.
- `GOOGLE_DRIVE_REFRESH_TOKEN`: from the private local `secrets/google-drive-token.json` created by `npm.cmd run drive:auth`.
- `BACKUP_ENCRYPTION_KEY`: the same stable 64-hex-character key used for local Drive backups, or a newly generated key copied securely to your password manager first.
- `CRON_SECRET`: a separate long random value. Vercel uses it to authenticate the scheduled endpoint.

Do not paste or commit these values. Use Google's OAuth configuration and a Drive folder accessible to the authorized account. Verify the Cron deployment and Drive upload in Vercel logs after production deployment.

## Restore

A local `.db` backup is an SQLite snapshot; stop the local server before restoring it to the local database. A cloud `.pg.json.enc` backup is an encrypted PostgreSQL table export, not an SQLite file. Download it privately, set the original `BACKUP_ENCRYPTION_KEY` and `SUPABASE_DB_URL` for a new empty PostgreSQL database in your local process, then run `npm.cmd run db:restore-postgres-backup -- <path-to-file>`. The restore command refuses to write into non-empty application tables. Keep `SESSION_SECRET`, `PASSWORD_PEPPER`, and the TOTP encryption key unchanged when restoring existing users so authenticator decryption and password verification continue to work.

The local SQLite database and hosted Supabase PostgreSQL database are separate. Local offline snapshots do not automatically include changes made by the online app; the encrypted PostgreSQL Drive snapshot is the cloud recovery copy.
