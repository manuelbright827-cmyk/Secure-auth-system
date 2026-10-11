const loginForm = document.getElementById('loginForm');
const passwordInput = document.getElementById('password');
const togglePassword = document.getElementById('togglePassword');
const message = document.getElementById('message');
const setupForm = document.getElementById('setupForm');
const twoFactorForm = document.getElementById('twoFactorForm');
const setupMessage = document.getElementById('setupMessage');
const twoFactorMessage = document.getElementById('twoFactorMessage');

async function postCode(url, code) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code })
    });
    const data = await response.json();
    return { response, data };
}

if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';

        passwordInput.type = isPassword ? 'text' : 'password';
        togglePassword.textContent = isPassword ? 'Hide' : 'Show';
    });
}

if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const email = document.getElementById('email').value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            message.textContent = 'Please enter your email and password.';
            message.className = 'message error';
            return;
        }

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    email,
                    password
                })
            });

            const data = await response.json();

            if (!response.ok) {
                message.textContent = data.message || 'Login failed.';
                message.className = 'message error';
                return;
            }

            message.textContent = 'Password accepted. Continue to authenticator verification.';
            message.className = 'message success';

            setTimeout(() => {
                window.location.href = 'two-factor.html';
            }, 700);

        } catch (error) {
            console.error(error);

            message.textContent = 'Unable to connect to the server.';
            message.className = 'message error';
        }
    });
}

if (setupForm && twoFactorForm) {
    const setupPanel = document.getElementById('setupPanel');
    const setupCode = document.getElementById('setupCode');
    const verificationCode = document.getElementById('verificationCode');
    const secretElement = document.getElementById('authenticatorSecret');
    const subtitle = document.getElementById('twoFactorSubtitle');
    const stageMessage = document.getElementById('stageMessage');
    const copySecret = document.getElementById('copySecret');

    async function initializeAuthenticatorStage() {
        try {
            const statusResponse = await fetch('/api/auth/2fa/status', {
                credentials: 'include'
            });
            const status = await statusResponse.json();

            if (!statusResponse.ok) {
                subtitle.textContent = 'Sign in with your email and password to continue.';
                stageMessage.textContent = status.message || 'Your sign-in session has expired.';
                return;
            }

            if (status.configured) {
                twoFactorForm.hidden = false;
                return;
            }

            const setupResponse = await fetch('/api/auth/2fa/setup', {
                method: 'POST',
                credentials: 'include'
            });
            const setup = await setupResponse.json();

            if (!setupResponse.ok) {
                stageMessage.textContent = setup.message || 'Could not start authenticator setup.';
                return;
            }

            secretElement.textContent = setup.secret;
            setupPanel.hidden = false;
        } catch (error) {
            console.error(error);
            stageMessage.textContent = 'Unable to connect to the server.';
        }
    }

    for (const input of [setupCode, verificationCode]) {
        input.addEventListener('input', () => {
            input.value = input.value.replace(/\D/g, '').slice(0, 6);
        });
    }

    copySecret.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(secretElement.textContent);
            copySecret.textContent = 'Copied';
        } catch {
            setupMessage.textContent = 'Copy was blocked. Select and copy the account key manually.';
            setupMessage.className = 'message error';
        }
    });

    setupForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setupMessage.textContent = '';

        try {
            const { response, data } = await postCode(
                '/api/auth/2fa/verify-setup',
                setupCode.value.trim()
            );
            setupMessage.textContent = response.ok
                ? 'Authenticator linked. Your account is now protected by 2-step sign-in.'
                : (data.message || 'Could not verify that code.');
            setupMessage.className = response.ok ? 'message success' : 'message error';

            if (response.ok) {
                setupCode.disabled = true;
                setupForm.querySelector('button[type="submit"]').disabled = true;
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 900);
            }
        } catch (error) {
            console.error(error);
            setupMessage.textContent = 'Unable to connect to the server.';
            setupMessage.className = 'message error';
        }
    });

    twoFactorForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        twoFactorMessage.textContent = '';

        try {
            const { response, data } = await postCode(
                '/api/auth/2fa/verify',
                verificationCode.value.trim()
            );
            twoFactorMessage.textContent = response.ok
                ? 'Code verified. Sign-in successful.'
                : (data.message || 'Could not verify that code.');
            twoFactorMessage.className = response.ok ? 'message success' : 'message error';

            if (response.ok) {
                verificationCode.disabled = true;
                twoFactorForm.querySelector('button[type="submit"]').disabled = true;
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 700);
            }
        } catch (error) {
            console.error(error);
            twoFactorMessage.textContent = 'Unable to connect to the server.';
            twoFactorMessage.className = 'message error';
        }
    });

    initializeAuthenticatorStage();
}