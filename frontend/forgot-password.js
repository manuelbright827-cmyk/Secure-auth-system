const API_BASE_URL = (window.API_BASE_URL || '').replace(/\/$/, '');
const resolveApiUrl = (url) => {
    if (!url.startsWith('/')) return url;
    return API_BASE_URL ? `${API_BASE_URL}${url}` : url;
};

const requestForm = document.getElementById('resetRequestForm');
const confirmForm = document.getElementById('resetConfirmForm');
const requestMessage = document.getElementById('resetRequestMessage');
const confirmMessage = document.getElementById('resetConfirmMessage');
const requestButton = document.getElementById('requestResetButton');
const confirmButton = document.getElementById('confirmResetButton');
const emailInput = document.getElementById('resetEmail');
const codeInput = document.getElementById('resetCode');

async function postJson(url, body) {
    const response = await fetch(resolveApiUrl(url), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const text = await response.text();
    let data = {};

    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            data = {
                message: 'The server returned an unexpected response. Please try again.'
            };
        }
    }

    return { response, data };
}

codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
});

requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    requestMessage.textContent = '';
    requestButton.disabled = true;

    try {
        const email = emailInput.value.trim();
        const { response, data } = await postJson('/api/auth/password/reset/request', { email });
        if (!response.ok) throw new Error(data.message || 'Could not request a reset code.');

        requestMessage.textContent = data.resetCode
            ? `${data.message} Local reset code: ${data.resetCode}`
            : data.message;
        requestMessage.className = 'message success';
        confirmForm.hidden = false;
        codeInput.focus();
    } catch (error) {
        requestMessage.textContent = error.message || 'Unable to connect to the server.';
        requestMessage.className = 'message error';
    } finally {
        requestButton.disabled = false;
    }
});

confirmForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    confirmMessage.textContent = '';

    const password = document.getElementById('newPassword').value;
    const confirmation = document.getElementById('confirmPassword').value;
    if (password !== confirmation) {
        confirmMessage.textContent = 'The passwords do not match.';
        confirmMessage.className = 'message error';
        return;
    }

    confirmButton.disabled = true;
    try {
        const { response, data } = await postJson('/api/auth/password/reset/confirm', {
            email: emailInput.value.trim(),
            code: codeInput.value.trim(),
            password
        });
        if (!response.ok) throw new Error(data.message || 'Could not change the password.');

        confirmMessage.textContent = `${data.message} Redirecting to sign in...`;
        confirmMessage.className = 'message success';
        confirmForm.reset();
        window.setTimeout(() => window.location.assign('/'), 1400);
    } catch (error) {
        confirmMessage.textContent = error.message || 'Unable to connect to the server.';
        confirmMessage.className = 'message error';
        confirmButton.disabled = false;
    }
});
