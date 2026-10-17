const API_BASE_URL = (window.API_BASE_URL || '').replace(/\/$/, '');
const resolveApiUrl = (url) => {
    if (!url.startsWith('/')) return url;
    return API_BASE_URL ? `${API_BASE_URL}${url}` : url;
};

const form = document.getElementById('passwordSetupForm');
const message = document.getElementById('passwordSetupMessage');
const submitButton = document.getElementById('passwordSetupButton');
const token = new URLSearchParams(window.location.search).get('token') || '';

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';

    const password = document.getElementById('newPassword').value;
    const confirmation = document.getElementById('confirmPassword').value;
    if (password !== confirmation) {
        message.textContent = 'The passwords do not match.';
        message.className = 'message error';
        return;
    }

    submitButton.disabled = true;
    try {
        const response = await fetch(resolveApiUrl('/api/auth/password/setup'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Could not set your password.');

        window.history.replaceState(null, '', 'password-setup.html');
        message.textContent = `${data.message} Redirecting to sign in…`;
        message.className = 'message success';
        form.reset();
        window.setTimeout(() => window.location.assign('index.html'), 1800);
    } catch (error) {
        message.textContent = error.message || 'Unable to connect to the server.';
        message.className = 'message error';
        submitButton.disabled = false;
    }
});
