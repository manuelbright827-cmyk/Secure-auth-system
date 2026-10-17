const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const backupPrefix = 'auth-db-';
const driveApiBase = 'https://www.googleapis.com/drive/v3';
const driveUploadBase = 'https://www.googleapis.com/upload/drive/v3';

let cachedAccessToken;
let accessTokenExpiresAt = 0;

function resolveProjectPath(value) {
    return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

async function loadClientCredentials({ fallbackFile } = {}) {
    if (process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET) {
        return {
            client_id: process.env.GOOGLE_DRIVE_CLIENT_ID,
            client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
            auth_uri: process.env.GOOGLE_DRIVE_AUTH_URI,
            token_uri: process.env.GOOGLE_DRIVE_TOKEN_URI
        };
    }

    const configuredPath = process.env.GOOGLE_DRIVE_CLIENT_SECRET_FILE;
    let clientPath;

    if (configuredPath) {
        clientPath = resolveProjectPath(configuredPath);
        try {
            await fs.access(clientPath);
        } catch (error) {
            if (error.code !== 'ENOENT' || !fallbackFile) {
                throw new Error(`Google OAuth client file configured by GOOGLE_DRIVE_CLIENT_SECRET_FILE was not found: ${configuredPath}`);
            }
            clientPath = resolveProjectPath(fallbackFile);
            await fs.access(clientPath);
            console.warn(`Configured Google OAuth client file is missing; using ${path.basename(clientPath)} for authorization.`);
        }
    } else {
        const preferredPath = path.join(projectRoot, 'credentials.json');
        try {
            await fs.access(preferredPath);
            clientPath = preferredPath;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const files = (await fs.readdir(projectRoot))
                .filter((name) => /^client_secret.*\.json$/i.test(name));
            if (files.length !== 1) {
                throw new Error('Set GOOGLE_DRIVE_CLIENT_SECRET_FILE to your Google OAuth Desktop client JSON file.');
            }
            clientPath = path.join(projectRoot, files[0]);
        }
    }

    const document = JSON.parse(await fs.readFile(clientPath, 'utf8'));
    const credentials = document.installed || document.web;
    if (!credentials?.client_id || !credentials?.client_secret) {
        throw new Error('The Google OAuth JSON must contain an installed or web OAuth client.');
    }

    return credentials;
}

async function loadToken() {
    if (process.env.GOOGLE_DRIVE_REFRESH_TOKEN) {
        return {
            token: { refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN },
            tokenPath: null
        };
    }

    const tokenPath = resolveProjectPath(
        process.env.GOOGLE_DRIVE_TOKEN_FILE || 'secrets/google-drive-token.json'
    );
    const token = JSON.parse(await fs.readFile(tokenPath, 'utf8'));
    if (!token.refresh_token) {
        throw new Error('Google Drive token has no refresh token. Run npm run drive:auth again.');
    }
    return { token, tokenPath };
}

async function getAccessToken() {
    if (cachedAccessToken && Date.now() < accessTokenExpiresAt - 60_000) {
        return cachedAccessToken;
    }

    const [credentials, saved] = await Promise.all([
        loadClientCredentials(),
        loadToken()
    ]);
    const body = new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        refresh_token: saved.token.refresh_token,
        grant_type: 'refresh_token'
    });
    const response = await fetch(credentials.token_uri || 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) {
        throw new Error(`Google Drive token refresh failed (HTTP ${response.status}). Reauthorize with npm run drive:auth.`);
    }

    if (result.refresh_token && saved.tokenPath) {
        saved.token.refresh_token = result.refresh_token;
        await fs.writeFile(saved.tokenPath, JSON.stringify(saved.token, null, 2), { mode: 0o600 });
    }

    cachedAccessToken = result.access_token;
    accessTokenExpiresAt = Date.now() + (result.expires_in || 3600) * 1000;
    return cachedAccessToken;
}

function getEncryptionKey() {
    const value = process.env.BACKUP_ENCRYPTION_KEY || '';
    if (!/^[\da-fA-F]{64}$/.test(value)) {
        throw new Error('BACKUP_ENCRYPTION_KEY must be a 64-character hex-encoded random key.');
    }
    return Buffer.from(value, 'hex');
}

async function driveRequest(url, options = {}) {
    const token = await getAccessToken();
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Google Drive API request failed (HTTP ${response.status}): ${details.slice(0, 500)}`);
    }

    return response;
}

function encryptBackupBuffer(plaintext) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([
        Buffer.from('SABK1'),
        iv,
        cipher.getAuthTag(),
        ciphertext
    ]);
}

async function encryptBackup(filePath) {
    return encryptBackupBuffer(await fs.readFile(filePath));
}

function multipartBody(metadata, encryptedBackup, boundary) {
    const delimiter = `--${boundary}\r\n`;
    return Buffer.concat([
        Buffer.from(`${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
        Buffer.from(`${delimiter}Content-Type: application/octet-stream\r\nContent-Disposition: form-data; name="file"; filename="${metadata.name}"\r\n\r\n`),
        encryptedBackup,
        Buffer.from(`\r\n--${boundary}--`)
    ]);
}

async function uploadBackup(filePath) {
    return uploadBackupBuffer(await fs.readFile(filePath), `${path.basename(filePath)}.enc`);
}

async function uploadBackupBuffer(plaintext, name) {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
        throw new Error('Set GOOGLE_DRIVE_FOLDER_ID to the ID of your Google Drive project backup folder.');
    }

    const encryptedBackup = encryptBackupBuffer(plaintext);
    const metadata = {
        name,
        mimeType: 'application/octet-stream',
        parents: [folderId],
        appProperties: { backupFormat: 'secure-auth-aes-256-gcm-v1' }
    };
    const boundary = `secureauth_${crypto.randomBytes(18).toString('hex')}`;
    const body = multipartBody(metadata, encryptedBackup, boundary);
    const query = new URLSearchParams({ uploadType: 'multipart', fields: 'id,name,createdTime' });
    const response = await driveRequest(`${driveUploadBase}/files?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
    });
    const uploaded = await response.json();

    await pruneDriveBackups(folderId);
    return uploaded;
}

async function pruneDriveBackups(folderId) {
    const retentionDays = Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '14', 10);
    const retentionMs = (Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 14) * 24 * 60 * 60 * 1000;
    const query = new URLSearchParams({
        q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and name contains '${backupPrefix}'`,
        fields: 'files(id,name,createdTime)',
        pageSize: '1000',
        orderBy: 'createdTime'
    });
    const response = await driveRequest(`${driveApiBase}/files?${query}`);
    const result = await response.json();
    const cutoff = Date.now() - retentionMs;

    for (const file of result.files || []) {
        if (file.name.startsWith(backupPrefix) && file.name.endsWith('.enc') &&
            Date.parse(file.createdTime) < cutoff) {
            await driveRequest(`${driveApiBase}/files/${encodeURIComponent(file.id)}`, {
                method: 'DELETE'
            });
            console.log(`Removed expired Google Drive backup: ${file.name}`);
        }
    }
}

async function listDriveBackups() {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) throw new Error('Set GOOGLE_DRIVE_FOLDER_ID to list cloud backups.');
    const query = new URLSearchParams({
        q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and name contains '${backupPrefix}'`,
        fields: 'files(id,name,createdTime,size)',
        pageSize: '1000',
        orderBy: 'createdTime desc'
    });
    const response = await driveRequest(`${driveApiBase}/files?${query}`);
    const result = await response.json();
    return (result.files || []).filter((file) => file.name.startsWith(backupPrefix) && file.name.endsWith('.enc'));
}

module.exports = {
    loadClientCredentials,
    uploadBackup,
    uploadBackupBuffer,
    listDriveBackups
};
