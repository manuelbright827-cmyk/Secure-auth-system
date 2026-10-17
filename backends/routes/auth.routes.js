const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const { authenticateUser, findUserById } = require('../services/auth.service');
const { createUser } = require('../services/user.service');
const { hashPassword } = require('../services/password.service');
const DatabaseRateLimitStore = require('../services/database-rate-limit-store');
const {
    isConsoleDelivery,
    sendAdminTemporaryPasswordEmail,
    sendPasswordResetCode
} = require('../services/email.service');
const { findUserByEmail } = require('../services/user.service');
const db = require('../config/database');
const {
    createAuthenticatorSecret,
    encryptSecret,
    decryptSecret,
    verifyAuthenticatorCode
} = require('../services/two-factor.service');

const router = express.Router();
const rateLimitHandler = (req, res) => res.status(429).json({
    message: 'Too many requests. Please wait before trying again.'
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: new DatabaseRateLimitStore('login'),
    handler: rateLimitHandler
});

const verificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: new DatabaseRateLimitStore('verification'),
    handler: rateLimitHandler
});

const adminCreationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: new DatabaseRateLimitStore('admin-creation'),
    skipFailedRequests: true,
    handler: (req, res) => res.status(429).json({
        message: 'Too many administrator accounts were created from this address. Try again after the one-hour limit resets.'
    })
});

const passwordSetupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: new DatabaseRateLimitStore('password-setup'),
    handler: rateLimitHandler
});

const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: new DatabaseRateLimitStore('password-reset'),
    handler: rateLimitHandler
});

async function getAuthenticatedAccount(req, res) {
    if (!req.session.user) {
        res.status(401).json({ message: 'Authentication required' });
        return null;
    }

    const user = await findUserById(req.session.user.id);
    if (!user || !user.is_active) {
        res.status(401).json({ message: 'Account not available. Please sign in again.' });
        return null;
    }

    return user;
}

async function getAdminAccount(req, res) {
    const user = await getAuthenticatedAccount(req, res);
    if (!user) return null;

    if (!['admin', 'administrator'].includes(user.role)) {
        res.status(403).json({ message: 'Only the primary administrator can manage administrator accounts' });
        return null;
    }

    return user;
}

async function getPendingAccount(req, res) {
    const pending = req.session.pendingTwoFactor;
    if (!pending) {
        res.status(401).json({ message: 'Please sign in with your password first' });
        return null;
    }

    const user = await findUserById(pending.id);
    if (!user || !user.is_active) {
        delete req.session.pendingTwoFactor;
        delete req.session.pendingTwoFactorSecret;
        res.status(401).json({ message: 'Account not available. Please sign in again.' });
        return null;
    }

    return user;
}

function completeSignIn(req, user) {
    req.session.user = {
        id: user.id,
        email: user.email,
        role: user.role
    };
    delete req.session.pendingTwoFactor;
    delete req.session.pendingTwoFactorSecret;
}

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: 'Email and password are required'
            });
        }

        const user = await authenticateUser(
            email.trim().toLowerCase(),
            password
        );

        if (!user) {
            await db.query(`INSERT INTO audit_logs (user_id, action, ip_address, user_agent, actor_role, resource, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [null, 'login.failed', req.ip || null, req.get('user-agent') || null, null, JSON.stringify({ email: email.trim().toLowerCase() }), 'failure']);
            return res.status(401).json({
                message: 'Invalid email or password'
            });
        }

        req.session.pendingTwoFactor = {
            id: user.id,
            email: user.email,
            role: user.role
        };
        delete req.session.user;
        delete req.session.pendingTwoFactorSecret;

        await db.query(`INSERT INTO audit_logs (user_id, action, ip_address, user_agent, actor_role, resource, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [user.id, 'login.password_accepted', req.ip || null, req.get('user-agent') || null, user.role, null, 'pending_2fa']);

        return res.json({
            message: 'Password accepted. Complete authenticator setup or verification.',
            requiresTwoFactor: true
        });
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({
            message: 'An unexpected error occurred'
        });
    }
});

router.get('/2fa/status', async (req, res) => {
    const user = await getPendingAccount(req, res);
    if (!user) return;

    res.json({
        configured: Boolean(user.two_factor_enabled && user.two_factor_secret)
    });
});

router.post('/2fa/setup', async (req, res) => {
    const user = await getPendingAccount(req, res);
    if (!user) return;

    if (user.two_factor_enabled && user.two_factor_secret) {
        return res.status(409).json({ message: 'An authenticator is already linked to this account' });
    }

    if (!req.session.pendingTwoFactorSecret) {
        req.session.pendingTwoFactorSecret = createAuthenticatorSecret();
    }

    return res.json({
        issuer: 'Secure Auth System',
        account: user.email,
        secret: req.session.pendingTwoFactorSecret,
        digits: 6,
        period: 30
    });
});

router.post('/2fa/verify-setup', verificationLimiter, async (req, res) => {
    const user = await getPendingAccount(req, res);
    if (!user) return;

    const { code } = req.body;
    const secret = req.session.pendingTwoFactorSecret;
    if (!secret) {
        return res.status(400).json({ message: 'Start authenticator setup again before verifying a code' });
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ message: 'Enter the 6-digit code from your authenticator app' });
    }

    if (!(await verifyAuthenticatorCode(secret, code))) {
        await db.query(`INSERT INTO audit_logs (user_id, action, ip_address, user_agent, actor_role, resource, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [user.id, 'two_factor.setup_failed', req.ip || null, req.get('user-agent') || null, user.role, null, 'failure']);
        return res.status(401).json({ message: 'Code did not match. Check your authenticator app and try again.' });
    }

    const result = await db.query(`
        UPDATE users
        SET two_factor_secret = ?, two_factor_enabled = TRUE,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND is_active = TRUE AND two_factor_enabled = FALSE
    `, [encryptSecret(secret), user.id]);

    if (result.rowCount !== 1) {
        const currentUser = await findUserById(user.id);
        if (!currentUser || !currentUser.two_factor_enabled || !currentUser.two_factor_secret) {
            return res.status(409).json({ message: 'Could not link the authenticator. Please restart setup.' });
        }
    }

    completeSignIn(req, user);
    await db.query(`INSERT INTO audit_logs (user_id, action, ip_address, user_agent, actor_role, resource, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [user.id, 'login.completed', req.ip || null, req.get('user-agent') || null, user.role, null, 'success']);
    return res.json({ message: 'Authenticator linked. Two-factor sign-in is enabled.' });
});

router.post('/2fa/verify', verificationLimiter, async (req, res) => {
    const user = await getPendingAccount(req, res);
    if (!user) return;

    if (!user.two_factor_enabled || !user.two_factor_secret) {
        return res.status(409).json({ message: 'Authenticator setup is required for this account' });
    }

    const { code } = req.body;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ message: 'Enter the 6-digit code from your authenticator app' });
    }

    let secret;
    try {
        secret = decryptSecret(user.two_factor_secret);
    } catch (error) {
        console.error('Could not read the authenticator secret:', error.message);
        return res.status(500).json({ message: 'Authenticator configuration could not be read' });
    }

    if (!(await verifyAuthenticatorCode(secret, code))) {
        await db.query(`INSERT INTO audit_logs (user_id, action, ip_address, user_agent, actor_role, resource, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [user.id, 'two_factor.verification_failed', req.ip || null, req.get('user-agent') || null, user.role, null, 'failure']);
        return res.status(401).json({ message: 'Invalid code. Check your authenticator app and try again.' });
    }

    completeSignIn(req, user);
    await db.query(`INSERT INTO audit_logs (user_id, action, ip_address, user_agent, actor_role, resource, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [user.id, 'login.completed', req.ip || null, req.get('user-agent') || null, user.role, null, 'success']);
    return res.json({ message: 'Sign-in successful' });
});

router.get('/me', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    const user = await findUserById(req.session.user.id);
    if (!user || !user.is_active) {
        req.session.destroy(() => {});
        return res.status(401).json({ message: 'Account not available. Please sign in again.' });
    }

    return res.json({
        user: {
            id: user.id,
            email: user.email,
            role: user.role,
            createdAt: user.created_at,
            isActive: Boolean(user.is_active),
            twoFactorEnabled: Boolean(user.two_factor_enabled)
        }
    });
});

router.get('/admin/status', async (req, res) => {
    const user = await getAuthenticatedAccount(req, res);
    if (!user) return;

    const adminCountResult = await db.query(`
        SELECT COUNT(*) AS count
        FROM users
        WHERE role IN ('admin', 'administrator') AND is_active = TRUE
    `);
    const adminCount = Number(adminCountResult.rows[0].count);

    return res.json({
        isAdmin: ['admin', 'administrator'].includes(user.role),
        canBootstrap: adminCount === 0
    });
});

router.post('/admin/bootstrap', async (req, res) => {
    const user = await getAuthenticatedAccount(req, res);
    if (!user) return;

    const claimFirstAdmin = db.transaction(async (userId) => {
        if (db.dialect === 'postgres') await db.query('LOCK TABLE users IN EXCLUSIVE MODE');
        const result = await db.query(`
            UPDATE users
            SET role = 'administrator', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND is_active = TRUE
              AND NOT EXISTS (
                  SELECT 1 FROM users
                  WHERE role IN ('admin', 'administrator') AND is_active = TRUE
              )
        `, [userId]);
        return result.rowCount;
    });

    const changes = await claimFirstAdmin(user.id);
    if (changes !== 1) {
        return res.status(409).json({
            message: 'The initial administrator has already been set up. Ask an administrator to add your account.'
        });
    }

    req.session.user.role = 'administrator';
    return res.json({ message: 'Your account is now the first administrator.' });
});

router.get('/admin/users', async (req, res) => {
    if (!await getAdminAccount(req, res)) return;

    const result = await db.query(`
        SELECT id, email, role, is_active, two_factor_enabled, created_at
        FROM users
        ORDER BY created_at ASC, id ASC
    `);
    const users = result.rows.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        isActive: Boolean(user.is_active),
        twoFactorEnabled: Boolean(user.two_factor_enabled),
        createdAt: user.created_at
    }));

    return res.json({ users });
});

router.post('/admin/users', adminCreationLimiter, async (req, res) => {
    if (!await getAdminAccount(req, res)) return;

    const email = typeof req.body.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: 'Enter a valid email address.' });
    }

    let newAdmin;
    try {
        const temporaryPassword = crypto.randomBytes(18).toString('base64url');
        newAdmin = await createUser(email, temporaryPassword, 'admin');
        await sendAdminTemporaryPasswordEmail(email, temporaryPassword);

        await db.query(`
            INSERT INTO audit_logs (user_id, action, ip_address, user_agent)
            VALUES (?, ?, ?, ?)
        `, [req.session.user.id, `admin_account_created:${newAdmin.id}`, req.ip || null, req.get('user-agent') || null]);

        return res.status(201).json({
            message: isConsoleDelivery()
                ? 'Administrator account created. The temporary password was printed in the server console.'
                : 'Administrator account created. The temporary password was emailed to the registered address.',
            user: newAdmin
        });
    } catch (error) {
        if (newAdmin) {
            await db.query('DELETE FROM users WHERE id = ? AND role = \'admin\'', [newAdmin.id]);
        }
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === '23505') {
            return res.status(409).json({ message: 'An account with that email already exists.' });
        }
        console.error('Administrator creation error:', error.message);
        return res.status(502).json({ message: 'Could not email the temporary password. No administrator account was kept; check Gmail settings and try again.' });
    }
});

router.delete('/admin/users/:id', async (req, res) => {
    const admin = await getAdminAccount(req, res);
    if (!admin) return;

    const userId = Number(req.params.id);
    if (!Number.isSafeInteger(userId) || userId < 1) {
        return res.status(400).json({ message: 'Invalid administrator account ID.' });
    }
    if (userId === admin.id) {
        return res.status(403).json({ message: 'You cannot delete your own signed-in account.' });
    }

    const removeAdmin = db.transaction(async () => {
        const targetResult = await db.query('SELECT id, email, role FROM users WHERE id = ?', [userId]);
        const target = targetResult.rows[0];
        if (!target) return { status: 404, message: 'Administrator account not found.' };
        if (target.role !== 'admin') {
            return { status: 403, message: 'The primary administrator account cannot be deleted here.' };
        }

        await db.query('INSERT INTO deleted_users (original_user_id, email, role, deleted_by) VALUES (?, ?, ?, ?)', [target.id, target.email, target.role, admin.id]);
        await db.query('DELETE FROM users WHERE id = ? AND role = \'admin\'', [userId]);
        await db.query(`
            INSERT INTO audit_logs (user_id, action, ip_address, user_agent)
            VALUES (?, ?, ?, ?)
        `, [admin.id, `admin_account_deleted:${userId}`, req.ip || null, req.get('user-agent') || null]);

        return { status: 200, message: 'Administrator account deleted.', email: target.email };
    });

    try {
        const result = await removeAdmin();
        if (result.status !== 200) {
            return res.status(result.status).json({ message: result.message });
        }
        return res.json({ message: `${result.email} was deleted.` });
    } catch (error) {
        console.error('Administrator deletion error:', error.message);
        return res.status(500).json({ message: 'Could not delete the administrator account.' });
    }
});

router.post('/password/setup', passwordSetupLimiter, async (req, res) => {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const password = req.body.password;
    if (!/^[\da-f]{64}$/i.test(token)) {
        return res.status(400).json({ message: 'This password setup link is invalid or expired.' });
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
        return res.status(400).json({ message: 'Choose a password between 12 and 256 characters.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const existing = await db.query(`
        SELECT user_id FROM password_setup_tokens
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
    `, [tokenHash, Date.now()]);
    if (!existing.rows[0]) {
        return res.status(400).json({ message: 'This password setup link is invalid or expired.' });
    }

    try {
        const passwordHash = await hashPassword(password);
        const completeSetup = db.transaction(async () => {
            const currentResult = await db.query(`
                UPDATE password_setup_tokens SET used_at = ?
                WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
                RETURNING user_id
            `, [Date.now(), tokenHash, Date.now()]);
            const current = currentResult.rows[0];
            if (!current) return false;

            const changedUser = await db.query(`
                UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND is_active = TRUE
            `, [passwordHash, current.user_id]);
            return changedUser.rowCount === 1;
        });

        if (!await completeSetup()) {
            return res.status(400).json({ message: 'This password setup link is invalid or expired.' });
        }
        return res.json({ message: 'Password set successfully. You can now sign in and set up your authenticator.' });
    } catch (error) {
        console.error('Password setup error:', error.message);
        return res.status(500).json({ message: 'Could not set the password. Please try again.' });
    }
});

router.post('/password/reset/request', passwordResetLimiter, async (req, res) => {
    const email = typeof req.body.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: 'Enter a valid email address.' });
    }

    const user = await findUserByEmail(email);
    if (!user || !user.is_active) {
        return res.json({ message: 'If that active account exists, a reset code has been sent.' });
    }

    try {
        const code = String(crypto.randomInt(100000, 1000000));
        const codeHash = crypto.createHash('sha256').update(`${email}:${code}`).digest('hex');
        await db.transaction(async () => {
            await db.query('DELETE FROM password_reset_codes WHERE user_id = ?', [user.id]);
            await db.query(`
                INSERT INTO password_reset_codes (code_hash, user_id, expires_at)
                VALUES (?, ?, ?)
            `, [codeHash, user.id, Date.now() + 15 * 60 * 1000]);
        })();

        await sendPasswordResetCode(email, code);
        return res.json({
            message: 'If that active account exists, a reset code has been sent.',
            resetCode: isConsoleDelivery() ? code : undefined
        });
    } catch (error) {
        console.error('Password reset request error:', error.message);
        return res.status(500).json({ message: 'Could not start password reset. Try again later.' });
    }
});

router.post('/password/reset/confirm', passwordResetLimiter, async (req, res) => {
    const email = typeof req.body.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
    const password = req.body.password;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ message: 'Enter the 6-digit reset code.' });
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
        return res.status(400).json({ message: 'Choose a password between 12 and 256 characters.' });
    }

    const user = await findUserByEmail(email);
    if (!user || !user.is_active) {
        return res.status(400).json({ message: 'The reset code is invalid or expired.' });
    }

    const codeHash = crypto.createHash('sha256').update(`${email}:${code}`).digest('hex');
    try {
        const passwordHash = await hashPassword(password);
        const completeReset = db.transaction(async () => {
            const existing = await db.query(`
                UPDATE password_reset_codes SET used_at = ?
                WHERE code_hash = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?
                RETURNING user_id
            `, [Date.now(), codeHash, user.id, Date.now()]);
            if (!existing.rows[0]) return false;

            const changedUser = await db.query(`
                UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND is_active = TRUE
            `, [passwordHash, user.id]);
            return changedUser.rowCount === 1;
        });

        if (!await completeReset()) {
            return res.status(400).json({ message: 'The reset code is invalid or expired.' });
        }

        req.session.destroy(() => {});
        return res.json({ message: 'Password changed. Sign in with your new password.' });
    } catch (error) {
        console.error('Password reset confirm error:', error.message);
        return res.status(500).json({ message: 'Could not change the password. Please try again.' });
    }
});

router.post('/logout', (req, res) => {
    const user = req.session.user;
    if (user) {
        db.query(`INSERT INTO audit_logs (user_id, action, ip_address, user_agent, actor_role, resource, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [user.id, 'logout', req.ip || null, req.get('user-agent') || null, user.role, null, 'success'])
            .catch((error) => console.error('Could not record logout audit event:', error.message));
    }
    req.session.destroy((error) => {
        if (error) {
            console.error('Logout error:', error);
            return res.status(500).json({ message: 'Could not sign out. Please try again.' });
        }

        res.clearCookie('connect.sid', { path: '/' });
        return res.json({ message: 'Signed out successfully' });
    });
});

module.exports = router;
