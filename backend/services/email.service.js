const nodemailer = require('nodemailer');
const path = require('path');
const dotenv = require('dotenv');

const envResult = dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
if (
    process.env.NODE_ENV !== 'production' &&
    envResult.parsed?.EMAIL_DELIVERY?.trim().toLowerCase() === 'console'
) {
    process.env.EMAIL_DELIVERY = 'console';
}

function getEmailConfig() {
    const delivery = (process.env.EMAIL_DELIVERY || 'smtp').trim().toLowerCase();
    if (!['smtp', 'console'].includes(delivery)) {
        throw new Error('EMAIL_DELIVERY must be either smtp or console.');
    }
    if (delivery === 'console' && process.env.NODE_ENV === 'production') {
        throw new Error('Console email delivery is only available outside production.');
    }

    const required = delivery === 'smtp'
        ? ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'APP_BASE_URL']
        : ['APP_BASE_URL'];
    const missing = required.filter((name) => !process.env[name]?.trim());
    if (missing.length) {
        throw new Error(`Email delivery is not configured. Set ${missing.join(', ')} in .env before sending password reset codes.`);
    }

    const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('SMTP_PORT must be a valid TCP port.');
    }

    let baseUrl;
    try {
        baseUrl = new URL(process.env.APP_BASE_URL);
    } catch {
        throw new Error('APP_BASE_URL must be an absolute application URL.');
    }
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
        throw new Error('APP_BASE_URL must use HTTP or HTTPS and must not include credentials.');
    }

    return {
        delivery,
        host: process.env.SMTP_HOST?.trim() || '',
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.EMAIL_FROM,
        baseUrl: baseUrl.toString().replace(/\/$/, '')
    };
}

function assertEmailConfigured() {
    getEmailConfig();
}

function isConsoleDelivery() {
    return getEmailConfig().delivery === 'console';
}

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function createTransporter(config) {
    return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.pass },
        ...(config.secure ? {} : { requireTLS: true })
    });
}

async function sendPasswordResetCode(email, code) {
    const config = getEmailConfig();

    if (config.delivery === 'console') {
        console.log([
            'Password reset email is in console delivery mode.',
            `Recipient: ${email}`,
            `Reset code: ${code}`
        ].join('\n'));
        return;
    }

    const transporter = createTransporter(config);
    const safeEmail = escapeHtml(email);

    await transporter.sendMail({
        from: config.from,
        to: email,
        subject: 'Your Secure Auth System password reset code',
        text: `Use this code to reset the password for ${email}: ${code}\n\nThis code expires in 15 minutes. If you did not request this, ignore this email.`,
        html: `<p>Use this code to reset the password for <strong>${safeEmail}</strong>:</p><p><strong>${code}</strong></p><p>This code expires in 15 minutes. If you did not request this, ignore this email.</p>`
    });
}

async function sendAdminTemporaryPasswordEmail(email, temporaryPassword) {
    const config = getEmailConfig();

    if (config.delivery === 'console') {
        console.log([
            'Administrator temporary password email is in console delivery mode.',
            `Recipient: ${email}`,
            `Temporary password: ${temporaryPassword}`
        ].join('\n'));
        return;
    }

    const transporter = createTransporter(config);
    const safeEmail = escapeHtml(email);
    const safePassword = escapeHtml(temporaryPassword);

    await transporter.sendMail({
        from: config.from,
        to: email,
        subject: 'Your Secure Auth System administrator account',
        text: `An administrator account was created for ${email}.\n\nTemporary password: ${temporaryPassword}\n\nSign in at ${config.baseUrl} and set up your authenticator app on first sign-in. Change this password after signing in if your organization requires it.`,
        html: `<p>An administrator account was created for <strong>${safeEmail}</strong>.</p><p>Temporary password: <strong>${safePassword}</strong></p><p>Sign in at <a href="${config.baseUrl}">${config.baseUrl}</a> and set up your authenticator app on first sign-in.</p><p>Change this password after signing in if your organization requires it.</p>`
    });
}

module.exports = {
    assertEmailConfigured,
    isConsoleDelivery,
    sendAdminTemporaryPasswordEmail,
    sendPasswordResetCode
};
