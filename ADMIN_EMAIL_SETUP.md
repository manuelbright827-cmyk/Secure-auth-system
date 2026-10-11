# Password reset code emails

Administrator account creation sends an automatic temporary-password email. The primary administrator creates the account with an email address, then the app generates a strong temporary password and sends it to that registered address. The new administrator links their authenticator app on first sign-in.

The same email delivery configuration is also used by the forgot-password flow. A user requests a six-digit reset code, enters that code, and chooses a new password.

## Local development

The default local `.env` can use `EMAIL_DELIVERY=console`. In this mode, administrator temporary passwords and password reset codes are printed in the server console instead of being sent by email.

Console delivery is blocked in `NODE_ENV=production`.

## Gmail SMTP setup

The project is preset to Gmail's SMTP endpoint (`smtp.gmail.com`, port `587`, STARTTLS). For real administrator and password reset emails, set `EMAIL_DELIVERY=smtp` and configure these values in the private `.env` file:

- `SMTP_USER`: the full Gmail address that will send temporary passwords and reset codes.
- `SMTP_PASS`: an **App Password** generated for that Google account (not the normal Google sign-in password). App Passwords require 2-Step Verification on the Google account.
- `EMAIL_FROM`: the same Gmail address, or an address Gmail is authorized to send as.
- `APP_BASE_URL`: the URL where recipients can reach the app, without a trailing slash. Use `http://localhost:3000` only while testing locally; replace it with the deployed HTTPS URL after hosting.

Keep `SMTP_PASS` private; do not paste it into chat or commit `.env`. For a Vercel deployment, add these settings in Vercel Project Settings → Environment Variables as well. Some serverless platforms restrict outbound SMTP; if Gmail SMTP cannot connect from Vercel, use a mail provider's HTTPS API (such as Resend) instead of exposing credentials or weakening security.

## Hosting and offline backup notes

The app now supports Vercel Node Functions with PostgreSQL-backed users, sessions, and rate limits. Vercel's daily Cron endpoint can create encrypted PostgreSQL snapshots in Google Drive when its private environment variables are configured. See [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) for deployment steps.

On your computer, leave `DATABASE_URL` unset to keep using local SQLite and the local backup scheduler. Local SQLite and hosted PostgreSQL are separate databases; local snapshots do not automatically include changes made online. A hosted PostgreSQL Drive snapshot is an encrypted JSON table export, not a SQLite file.

The app serves its public frontend while explicitly blocking backend source, OAuth JSON files, backups, and secrets directories from static downloads.

After updating `.env`, restart the app. New administrators sign in with the temporary password from email, then enroll their authenticator on first sign-in.
