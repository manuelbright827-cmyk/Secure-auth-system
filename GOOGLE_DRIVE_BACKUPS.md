# Google Drive backups

The app already creates local SQLite backups. Google Drive copies are uploaded only when `GOOGLE_DRIVE_FOLDER_ID` is configured. Cloud copies are encrypted by the app with AES-256-GCM before upload; the encryption key is not uploaded to Drive.

## One-time setup

1. In Google Cloud Console, open the `secure-auth-system-backup` project, enable **Google Drive API**, and configure the OAuth consent screen. Add the Google account that owns the Drive folder as a test user if the app is in Testing mode.
2. Create an OAuth client of type **Desktop app**. Keep the downloaded `client_secret_*.json` in this project root. The repository ignores this file; never commit or share it.
3. In Google Drive, open the project backup folder. Copy the folder ID from its URL, which has the form `https://drive.google.com/drive/folders/FOLDER_ID`. Do not use the Google Cloud Console URL.
4. From the project directory, run `npm.cmd run drive:configure`. Paste the ID from your Drive folder URL when prompted. The script configures the OAuth JSON and folder, generates a random 256-bit encryption key if needed, and saves it privately in `.env` without printing it. Keep a separate secure copy of `BACKUP_ENCRYPTION_KEY` (for example in a password manager); without it, cloud backups cannot be decrypted.
5. Run `npm.cmd run drive:auth`. Open the URL it prints, sign in as the Google account that can access the target folder, and approve Drive access. The refresh token is saved locally under `secrets/`; it is not printed.
6. Restart the app. It creates and uploads a backup at startup, then uploads on the configured schedule. The terminal reports successful uploads or explains cloud upload failures; local backups continue even when Drive is unavailable.

The app needs Drive access to the folder you specify. The current OAuth flow requests the Drive scope so it can upload into a folder you created beforehand and remove expired backups from that folder. Use this project only with a Google account you trust.

## Backup behavior and restore

- Local SQLite snapshots stay under `backups/` and are retained according to `BACKUP_RETENTION_DAYS`.
- Google Drive snapshots are named `auth-db-<timestamp>.db.enc` and encrypted before upload. Expired app backups are deleted from the configured folder according to the same retention period.
- Keep `BACKUP_ENCRYPTION_KEY` stable. Restore requires downloading the `.db.enc` file, decrypting its format (`SABK1` header, 12-byte IV, 16-byte authentication tag, ciphertext), and then replacing the SQLite database while the server is stopped. Do not overwrite the live database while the app is running.
- OAuth applications left in Google's external **Testing** mode may have refresh tokens that expire after seven days. For unattended long-term operation, review the app's publishing/verification status and Google's current OAuth policies; reauthorize with `npm.cmd run drive:auth` if authorization expires.
