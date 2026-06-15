// options.js — settings page that populates `backendUrl`

document.addEventListener('DOMContentLoaded', async () => {
    const backendUrlInput = document.getElementById('backendUrl');
    const saveBtn = document.getElementById('save');
    const statusEl = document.getElementById('status');

    // Load any previously saved configuration.
    chrome.storage.local.get(['backendUrl'], (res) => {
        if (res.backendUrl) backendUrlInput.value = res.backendUrl;
    });

    saveBtn.addEventListener('click', () => {
        const backendUrl = backendUrlInput.value.trim().replace(/\/+$/, '');
        chrome.storage.local.set({ backendUrl }, () => {
            statusEl.textContent = 'Configurações salvas.';
            setTimeout(() => { statusEl.textContent = ''; }, 2500);
        });
    });

    // Perfil e Logout logic
    const userEmailEl = document.getElementById('user-email');
    const userInitialEl = document.getElementById('user-initial');
    const btnLogout = document.getElementById('btn-logout');

    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session && session.user) {
        userEmailEl.textContent = session.user.email;
        userInitialEl.textContent = session.user.email.charAt(0).toUpperCase();
    } else {
        userEmailEl.textContent = "Não conectado";
        userInitialEl.textContent = "!";
        btnLogout.style.display = "none";
    }

    btnLogout.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        await chrome.storage.local.remove('authToken');
        userEmailEl.textContent = "Sessão encerrada";
        userInitialEl.textContent = "!";
        btnLogout.style.display = "none";
        statusEl.textContent = 'Logout realizado com sucesso.';
        setTimeout(() => { statusEl.textContent = ''; }, 2500);
    });
});
