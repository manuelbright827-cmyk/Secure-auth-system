require('dotenv').config({ path: require('node:path').resolve(__dirname, '..', '..', '.env') });

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { loadClientCredentials } = require('../services/google-drive.service');

const projectRoot = path.resolve(__dirname, '..', '..');
const tokenPath = path.resolve(
    projectRoot,
    process.env.GOOGLE_DRIVE_TOKEN_FILE || 'secrets/google-drive-token.json'
);
const scopes = ['https://www.googleapis.com/auth/drive'];
const state = crypto.randomBytes(24).toString('hex');

async function main() {
    const credentials = await loadClientCredentials({ fallbackFile: 'credentials.json' });
    if (!credentials.client_id || !credentials.client_secret) {
        throw new Error('The configured Google OAuth client JSON is incomplete.');
    }

    const callbackServer = http.createServer(async (request, response) => {
        const callbackUrl = new URL(request.url, 'http://localhost');
        if (callbackUrl.pathname !== '/oauth2callback') {
            response.writeHead(404).end('Not found');
            return;
        }
        if (callbackUrl.searchParams.get('state') !== state) {
            response.writeHead(400).end('Authorization state did not match. You can close this tab.');
            return;
        }
        if (callbackUrl.searchParams.has('error')) {
            response.writeHead(400, { 'Content-Type': 'text/plain' })
                .end('Google Drive authorization was not completed. You can close this tab and return to the terminal.');
            console.error('Google Drive authorization was not completed.');
            callbackServer.close();
            return;
        }

        const code = callbackUrl.searchParams.get('code');
        if (!code) {
            response.writeHead(400).end('Authorization code was missing. You can close this tab.');
            return;
        }

        try {
            const body = new URLSearchParams({
                code,
                client_id: credentials.client_id,
                client_secret: credentials.client_secret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            });
            const tokenResponse = await fetch(credentials.token_uri || 'https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body
            });
            const tokens = await tokenResponse.json();
            if (!tokenResponse.ok || !tokens.refresh_token) {
                throw new Error('Google did not return a refresh token. Revoke the app access in your Google Account and run authorization again.');
            }

            await fs.mkdir(path.dirname(tokenPath), { recursive: true });
            await fs.writeFile(tokenPath, JSON.stringify({
                refresh_token: tokens.refresh_token,
                scope: tokens.scope,
                token_type: tokens.token_type
            }, null, 2), { mode: 0o600 });
            try {
                await fs.chmod(tokenPath, 0o600);
            } catch (error) {
                if (process.platform !== 'win32') throw error;
            }

            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                .end('<!doctype html><html><head><meta charset="utf-8"><title>Drive connected</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#172033"><h1>Google Drive connected</h1><p>Authorization completed. You can close this tab and return to the application.</p></body></html>');
            console.log('Google Drive authorization saved locally. The refresh token was not printed.');
            callbackServer.close();
        } catch (error) {
            response.writeHead(500, { 'Content-Type': 'text/plain' })
                .end('Could not save Google Drive authorization. Check the terminal for details.');
            console.error(error.message);
            callbackServer.close();
            process.exitCode = 1;
        }
    });

    await new Promise((resolve, reject) => {
        callbackServer.once('error', reject);
        callbackServer.listen(0, 'localhost', resolve);
    });

    const address = callbackServer.address();
    const redirectUri = `http://localhost:${address.port}/oauth2callback`;
    const authorizeUrl = new URL(credentials.auth_uri || 'https://accounts.google.com/o/oauth2/v2/auth');
    authorizeUrl.search = new URLSearchParams({
        client_id: credentials.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state
    }).toString();

    console.log('Open this URL in your browser and approve Google Drive access:');
    console.log(authorizeUrl.toString());
    console.log('Waiting for the local authorization callback…');

    const timeout = setTimeout(() => {
        console.error('Authorization timed out. Run npm run drive:auth to try again.');
        callbackServer.close();
        process.exitCode = 1;
    }, 5 * 60 * 1000);
    timeout.unref();
    callbackServer.once('close', () => clearTimeout(timeout));
}

main().catch((error) => {
    console.error('Google Drive authorization setup failed:', error.message);
    process.exitCode = 1;
});
