// options.js — settings page that populates `backendUrl` and `authToken`
// in chrome.storage. background.js resolves the endpoint from these values at
// request time (see getBackendUrl/authedFetch), replacing the old hardcoded
// localhost constant.

document.addEventListener('DOMContentLoaded', () => {
    const backendUrlInput = document.getElementById('backendUrl');
    const authTokenInput = document.getElementById('authToken');
    const saveBtn = document.getElementById('save');
    const statusEl = document.getElementById('status');

    // Load any previously saved configuration.
    chrome.storage.local.get(['backendUrl', 'authToken'], (res) => {
        if (res.backendUrl) backendUrlInput.value = res.backendUrl;
        if (res.authToken) authTokenInput.value = res.authToken;
    });

    saveBtn.addEventListener('click', () => {
        // Normalize: trim and strip any trailing slash so request paths join cleanly.
        const backendUrl = backendUrlInput.value.trim().replace(/\/+$/, '');
        const authToken = authTokenInput.value.trim();

        chrome.storage.local.set({ backendUrl, authToken }, () => {
            statusEl.textContent = 'Configurações salvas.';
            setTimeout(() => { statusEl.textContent = ''; }, 2500);
        });
    });
});
