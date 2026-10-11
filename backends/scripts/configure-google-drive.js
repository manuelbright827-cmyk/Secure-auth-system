require('dotenv').config({ path: require('node:path').resolve(__dirname, '..', '..', '.env') });

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

const projectRoot = path.resolve(__dirname, '..', '..');
const envPath = path.join(projectRoot, '.env');

function readEnvValue(contents, name) {
    const line = contents.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : '';
}

function setEnvValue(contents, name, value) {
    const lines = contents.split(/\r?\n/);
    const index = lines.findIndex((line) => line.startsWith(`${name}=`));
    if (index >= 0) {
        lines[index] = `${name}=${value}`;
    } else {
        lines.push(`${name}=${value}`);
    }
    return lines.join('\n').replace(/\n*$/, '\n');
}

async function main() {
    let clientFile = 'credentials.json';
    try {
        await fs.access(path.join(projectRoot, clientFile));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const clientFiles = (await fs.readdir(projectRoot))
            .filter((name) => /^client_secret.*\.json$/i.test(name));
        if (clientFiles.length !== 1) {
            throw new Error('Place credentials.json in the project root, or keep exactly one client_secret*.json OAuth file there.');
        }
        [clientFile] = clientFiles;
    }

    let folderId = process.argv[2]?.trim();
    if (!folderId) {
        const prompt = readline.createInterface({ input: stdin, output: stdout });
        try {
            folderId = (await prompt.question(
                'Paste the ID from your Google Drive folder URL (/drive/folders/ID): '
            )).trim();
        } finally {
            prompt.close();
        }
    }
    if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) {
        throw new Error('That does not look like a Drive folder ID. Copy the ID after /drive/folders/ from drive.google.com.');
    }

    let contents = await fs.readFile(envPath, 'utf8');
    contents = setEnvValue(contents, 'GOOGLE_DRIVE_CLIENT_SECRET_FILE', clientFile);
    contents = setEnvValue(contents, 'GOOGLE_DRIVE_TOKEN_FILE', 'secrets/google-drive-token.json');
    contents = setEnvValue(contents, 'GOOGLE_DRIVE_FOLDER_ID', folderId);

    const existingKey = readEnvValue(contents, 'BACKUP_ENCRYPTION_KEY');
    if (!/^[\da-fA-F]{64}$/.test(existingKey)) {
        contents = setEnvValue(contents, 'BACKUP_ENCRYPTION_KEY', crypto.randomBytes(32).toString('hex'));
        console.log('Generated and saved a new private AES-256 backup encryption key. Do not lose it.');
    } else {
        console.log('Kept the existing valid backup encryption key.');
    }

    const temporaryPath = `${envPath}.tmp`;
    await fs.writeFile(temporaryPath, contents, { mode: 0o600 });
    await fs.rename(temporaryPath, envPath);
    try {
        await fs.chmod(envPath, 0o600);
    } catch (error) {
        if (process.platform !== 'win32') throw error;
    }

    console.log('Google Drive folder and OAuth client configured in .env.');
    console.log('Next run npm run drive:auth, approve Drive access, then restart the app.');
}

main().catch((error) => {
    console.error('Google Drive configuration failed:', error.message);
    process.exitCode = 1;
});
