const dashboardMessage = document.getElementById('dashboardMessage');
const overview = document.getElementById('overview');
const logoutButtons = [
    document.getElementById('logoutButton'),
    document.getElementById('settingsLogoutButton')
].filter(Boolean);
const adminPanel = document.getElementById('administration');
const adminTab = document.getElementById('adminTab');
const adminTools = document.getElementById('adminTools');
const bootstrapAdminPanel = document.getElementById('bootstrapAdminPanel');
const bootstrapAdminButton = document.getElementById('bootstrapAdminButton');
const createAdminForm = document.getElementById('createAdminForm');
const adminFormMessage = document.getElementById('adminFormMessage');
const adminUserList = document.getElementById('adminUserList');

async function readApiJson(response) {
    const body = await response.text();
    try {
        return JSON.parse(body);
    } catch {
        const contentType = response.headers.get('content-type') || 'unknown content type';
        const endpoint = new URL(response.url).pathname;
        throw new Error(`The API returned ${contentType} (HTTP ${response.status}) for ${endpoint}, not JSON. Make sure the updated backend is running; a static-only deployment cannot handle this API request.`);
    }
}

async function authenticatedJson(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: {
            ...(options.headers || {}),
            ...(options.body ? { 'Content-Type': 'application/json' } : {})
        }
    });

    const data = await readApiJson(response);
    return { response, data };
}

function formatRole(role) {
    return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(`${value.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }).format(date);
}

async function loadAccount() {
    try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await readApiJson(response);

        if (!response.ok) {
            window.location.replace('index.html');
            return;
        }

        const user = data.user;
        const initial = user.email.charAt(0).toUpperCase();
        const role = formatRole(user.role);

        document.getElementById('welcomeAvatar').textContent = initial;
        document.getElementById('profileAvatar').textContent = initial;
        document.getElementById('profileEmail').textContent = user.email;
        document.getElementById('profileRole').textContent = `${role} account`;
        document.getElementById('detailEmail').textContent = user.email;
        document.getElementById('detailRole').textContent = role;
        document.getElementById('detailCreated').textContent = formatDate(user.createdAt);

        const status = document.getElementById('twoFactorStatus');
        const badge = document.getElementById('twoFactorBadge');
        const setupLink = document.getElementById('setupAuthenticatorLink');

        if (user.twoFactorEnabled) {
            status.textContent = 'Linked to your account';
            badge.textContent = 'Enabled';
            badge.classList.add('enabled-badge');
        } else {
            status.textContent = 'Not set up yet';
            badge.textContent = 'Action needed';
            badge.classList.add('attention-badge');
            setupLink.hidden = false;
        }

        await loadAdminTools(user.role);

        dashboardMessage.hidden = true;
        overview.hidden = false;
    } catch (error) {
        console.error('Could not load account details:', error);
        dashboardMessage.textContent = 'Unable to load your account. Check your connection and refresh.';
        dashboardMessage.classList.add('error');
    }
}

function showAdminPanel({ bootstrap = false, isAdmin = false } = {}) {
    adminPanel.hidden = !(bootstrap || isAdmin);
    adminTab.hidden = !(bootstrap || isAdmin);
    bootstrapAdminPanel.hidden = !bootstrap;
    adminTools.hidden = !isAdmin;
}

async function loadAdminUsers() {
    const { response, data } = await authenticatedJson('/api/auth/admin/users');
    if (!response.ok) throw new Error(data.message || 'Could not load administrator accounts.');

    adminUserList.replaceChildren();
    for (const user of data.users) {
        const item = document.createElement('li');
        item.className = 'admin-user-item';

        const identity = document.createElement('div');
        identity.className = 'admin-user-identity';
        const email = document.createElement('strong');
        email.textContent = user.email;
        const role = document.createElement('span');
        role.textContent = `${formatRole(user.role)}${user.isActive ? '' : ' · Inactive'}`;
        identity.append(email, role);

        const status = document.createElement('span');
        status.className = `status-badge ${user.twoFactorEnabled ? 'enabled-badge' : 'attention-badge'}`;
        status.textContent = user.twoFactorEnabled ? '2FA enabled' : '2FA pending';

        const actions = document.createElement('div');
        actions.className = 'admin-user-actions';
        actions.append(status);
        if (user.role === 'admin') {
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'admin-delete-button';
            deleteButton.textContent = 'Delete';
            deleteButton.setAttribute('aria-label', `Delete administrator ${user.email}`);
            deleteButton.addEventListener('click', async () => {
                if (!window.confirm(`Delete administrator account ${user.email}? This cannot be undone.`)) return;

                deleteButton.disabled = true;
                try {
                    const { response: deleteResponse, data: deleteData } = await authenticatedJson(
                        `/api/auth/admin/users/${encodeURIComponent(user.id)}`,
                        { method: 'DELETE' }
                    );
                    if (!deleteResponse.ok) throw new Error(deleteData.message || 'Could not delete this administrator.');
                    adminFormMessage.textContent = deleteData.message;
                    adminFormMessage.className = 'message success';
                    await loadAdminUsers();
                } catch (error) {
                    adminFormMessage.textContent = error.message || 'Unable to connect to the server.';
                    adminFormMessage.className = 'message error';
                    deleteButton.disabled = false;
                }
            });
            actions.append(deleteButton);
        }

        item.append(identity, actions);
        adminUserList.append(item);
    }
}

async function loadAdminTools(role) {
    const isAdmin = role === 'administrator';
    try {
        const { response, data } = await authenticatedJson('/api/auth/admin/status');
        if (!response.ok) throw new Error(data.message || 'Could not check administrator access.');

        const canBootstrap = !isAdmin && data.canBootstrap;
        showAdminPanel({ bootstrap: canBootstrap, isAdmin });
        if (isAdmin) await loadAdminUsers();
    } catch (error) {
        console.error('Could not load administrator tools:', error);
        showAdminPanel();
    }
}

bootstrapAdminButton?.addEventListener('click', async () => {
    bootstrapAdminButton.disabled = true;
    try {
        const { response, data } = await authenticatedJson('/api/auth/admin/bootstrap', {
            method: 'POST'
        });
        if (!response.ok) throw new Error(data.message || 'Could not claim the administrator role.');
        await loadAccount();
    } catch (error) {
        adminFormMessage.textContent = error.message;
        adminFormMessage.className = 'message error';
        bootstrapAdminButton.disabled = false;
    }
});

createAdminForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    adminFormMessage.textContent = '';

    const createButton = document.getElementById('createAdminButton');
    createButton.disabled = true;
    try {
        const { response, data } = await authenticatedJson('/api/auth/admin/users', {
            method: 'POST',
            body: JSON.stringify({
                email: document.getElementById('newAdminEmail').value
            })
        });
        if (!response.ok) throw new Error(data.message || 'Could not create the administrator.');

        adminFormMessage.textContent = data.message;
        adminFormMessage.className = 'message success';
        createAdminForm.reset();
        await loadAdminUsers();
    } catch (error) {
        adminFormMessage.textContent = error.message || 'Unable to connect to the server.';
        adminFormMessage.className = 'message error';
    } finally {
        createButton.disabled = false;
    }
});

document.getElementById('refreshAdminUsers')?.addEventListener('click', async () => {
    try {
        await loadAdminUsers();
    } catch (error) {
        adminFormMessage.textContent = error.message;
        adminFormMessage.className = 'message error';
    }
});

async function signOut() {
    for (const button of logoutButtons) button.disabled = true;

    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (error) {
        console.error('Sign out request failed:', error);
    } finally {
        window.location.replace('index.html');
    }
}

for (const button of logoutButtons) {
    button.addEventListener('click', signOut);
}

for (const tab of document.querySelectorAll('.dashboard-tab')) {
    tab.addEventListener('click', () => {
        document.querySelector('.dashboard-tab.active')?.classList.remove('active');
        tab.classList.add('active');
    });
}

loadAccount();
