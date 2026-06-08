document.addEventListener('DOMContentLoaded', async () => {
    // ═══════════════════════════════════════════
    // DOM ELEMENTS
    // ═══════════════════════════════════════════
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const btnAbort = document.getElementById('btn-abort');
    const btnForceStop = document.getElementById('btn-force-stop');

    // Toggles
    const toggleMic = document.getElementById('toggle-mic');
    const toggleAi = document.getElementById('toggle-ai');
    const toggleCam = document.getElementById('toggle-cam');

    // Icon boxes
    const iconMic = document.getElementById('icon-mic');
    const iconAi = document.getElementById('icon-ai');

    // Cards
    const cardMic = document.getElementById('card-mic');
    const cardAi = document.getElementById('card-ai');

    // Header sections
    const headerDefault = document.getElementById('header-default');
    const headerRecording = document.getElementById('header-recording');
    const recTimer = document.getElementById('rec-timer');

    // Layout sections
    const tagline = document.getElementById('tagline');
    const tabsWrapper = document.getElementById('tabs-wrapper');
    const settingsContent = document.getElementById('settings-content');
    const recordingActions = document.getElementById('recording-actions');
    const processingBanner = document.getElementById('processing-banner');

    // Timer interval reference
    let timerInterval = null;

    // ═══════════════════════════════════════════
    // SETTINGS GEAR → Options page
    // ═══════════════════════════════════════════
    const settingsIcon = document.getElementById('settings-icon');
    if (settingsIcon) {
        settingsIcon.addEventListener('click', () => {
            if (chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            } else {
                window.open(chrome.runtime.getURL('options.html'));
            }
        });
    }

    // ═══════════════════════════════════════════
    // TAB LOGIC (Segmented Control)
    // ═══════════════════════════════════════════
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const targetId = tab.getAttribute('data-tab');
            const targetEl = document.getElementById(targetId);
            targetEl.classList.add('active');

            // Trigger fade-in animation
            targetEl.style.animation = 'none';
            targetEl.offsetHeight; // force reflow
            targetEl.style.animation = '';

            if (targetId === 'tab-practice') {
                carregarModulosPratica();
            }
        });
    });

    // ═══════════════════════════════════════════
    // PRACTICE MODE LOGIC
    // ═══════════════════════════════════════════
    async function carregarModulosPratica() {
        const container = document.getElementById('practice-modules-container');

        // Show skeleton loading
        container.innerHTML = `
            <div class="skeleton-card"><div class="skeleton-line w-70"></div><div class="skeleton-line w-45"></div></div>
            <div class="skeleton-card"><div class="skeleton-line w-70"></div><div class="skeleton-line w-45"></div></div>
            <div class="skeleton-card"><div class="skeleton-line w-70"></div><div class="skeleton-line w-45"></div></div>
        `;

        try {
            // Discover active tab domain
            const tabsChrome = await chrome.tabs.query({ active: true, currentWindow: true });
            let dominio = "";
            if (tabsChrome[0] && tabsChrome[0].url) {
                const url = new URL(tabsChrome[0].url);
                dominio = url.hostname;
            }

            const resStorage = await chrome.storage.local.get(['backendUrl', 'authToken']);
            // Dev-only fallback assembled from parts so no production endpoint
            // is hardcoded; configure `backendUrl` via the options page.
            const backendUrl = resStorage.backendUrl || ("http://" + "localhost" + ":8000");
            const headers = {};
            if (resStorage.authToken) headers['Authorization'] = `Bearer ${resStorage.authToken}`;

            const res = await fetch(`${backendUrl}/api/v1/modulos?dominio=${dominio}`, { headers });
            if (!res.ok) throw new Error("Falha ao buscar módulos");
            const data = await res.json();

            if (data.total === 0) {
                container.innerHTML = '<p class="modules-message">Nenhum módulo encontrado para este site.</p>';
                return;
            }

            container.innerHTML = '';
            data.modulos.forEach(mod => {
                const div = document.createElement('div');
                div.className = 'module-item';
                div.innerHTML = `
                    <div class="module-title">${mod.titulo}</div>
                    <div class="module-meta">${mod.total_passos} passos • ${mod.xp_max} XP max</div>
                `;
                div.onclick = () => iniciarPratica(mod.modulo_id, tabsChrome[0].id);
                container.appendChild(div);
            });
        } catch (e) {
            container.innerHTML = `<p class="modules-error">Erro: ${e.message}</p>`;
        }
    }

    function iniciarPratica(moduloId, tabId) {
        chrome.runtime.sendMessage({
            action: 'INICIAR_SESSAO_ARBITRO',
            moduloId: moduloId,
            tabId: tabId
        }, (response) => {
            // O popup pode fechar antes da response async chegar (MV3 race condition).
            // Se response é undefined (port closed) ou ok, fechamos normalmente.
            if (chrome.runtime.lastError || !response || response.ok) {
                window.close();
            } else {
                alert("Erro ao iniciar sessão de prática: " + (response.error || "desconhecido"));
            }
        });
    }

    // ═══════════════════════════════════════════
    // TOGGLE VISUAL LOGIC
    // ═══════════════════════════════════════════
    function updateTogglesUI() {
        // Mic icon state
        if (toggleMic.checked) {
            iconMic.classList.add('active');
            toggleAi.checked = false;
            iconAi.classList.remove('active');
            cardAi.classList.remove('glow-active');
        } else {
            iconMic.classList.remove('active');
        }

        // AI icon state
        if (toggleAi.checked) {
            iconAi.classList.add('active');
            cardAi.classList.add('glow-active');
            toggleMic.checked = false;
            iconMic.classList.remove('active');
        } else {
            iconAi.classList.remove('active');
            cardAi.classList.remove('glow-active');
        }
    }

    toggleMic.addEventListener('change', () => {
        if (toggleMic.checked) toggleAi.checked = false;
        else toggleAi.checked = true;
        updateTogglesUI();
        chrome.storage.local.set({ useMic: toggleMic.checked, useAi: toggleAi.checked });
    });

    toggleAi.addEventListener('change', () => {
        if (toggleAi.checked) toggleMic.checked = false;
        else toggleMic.checked = true;
        updateTogglesUI();
        chrome.storage.local.set({ useMic: toggleMic.checked, useAi: toggleAi.checked });
    });

    // Restore saved toggle states
    chrome.storage.local.get(['useMic', 'useAi'], (res) => {
        if (res.useMic !== undefined) toggleMic.checked = res.useMic;
        if (res.useAi !== undefined) toggleAi.checked = res.useAi;
        updateTogglesUI();
    });

    // ═══════════════════════════════════════════
    // LIVE RECORDING TIMER
    // ═══════════════════════════════════════════
    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);

        chrome.storage.local.get(['recordingStartTime'], (res) => {
            const startTime = res.recordingStartTime || Date.now();

            function updateTimer() {
                const elapsed = (Date.now() - startTime) / 1000;
                if (recTimer) recTimer.textContent = formatTime(elapsed);
            }

            updateTimer(); // immediate update
            timerInterval = setInterval(updateTimer, 1000);
        });
    }

    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    // ═══════════════════════════════════════════
    // STATE TRANSITIONS
    // ═══════════════════════════════════════════
    function enterRecordingState() {
        // Header: switch to recording mode
        headerDefault.style.display = 'none';
        headerRecording.style.display = 'flex';
        if (tagline) tagline.style.display = 'none';
        if (tabsWrapper) tabsWrapper.style.display = 'none';

        // Hide settings, show recording actions
        settingsContent.style.display = 'none';
        btnStart.style.display = 'none';
        recordingActions.classList.add('active');
        btnForceStop.style.display = 'none';
        processingBanner.classList.remove('active');

        // Start the live timer
        startTimer();
    }

    function enterProcessingState() {
        // Reset header
        headerDefault.style.display = 'flex';
        headerRecording.style.display = 'none';
        if (tagline) tagline.style.display = '';
        if (tabsWrapper) tabsWrapper.style.display = '';
        settingsContent.style.display = '';

        // Show processing UI
        processingBanner.classList.add('active');
        btnStart.disabled = true;
        btnStart.classList.remove('pulse-anim');
        btnStart.innerHTML = `
            <div class="processing-spinner" style="width:14px;height:14px;border-width:2px;border-color:#fff;border-top-color:transparent;"></div>
            Processando...
        `;
        btnStart.style.opacity = '0.7';
        btnStart.style.cursor = 'not-allowed';

        // Disable all toggles
        toggleMic.disabled = true;
        toggleAi.disabled = true;
        toggleCam.disabled = true;

        // Show force stop, hide recording actions
        btnForceStop.style.display = 'flex';
        recordingActions.classList.remove('active');

        stopTimer();
    }

    function enterIdleState() {
        // Reset header
        headerDefault.style.display = 'flex';
        headerRecording.style.display = 'none';
        if (tagline) tagline.style.display = '';
        if (tabsWrapper) tabsWrapper.style.display = '';
        settingsContent.style.display = '';

        // Reset buttons
        btnStart.disabled = false;
        btnStart.classList.add('pulse-anim');
        btnStart.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"></circle>
            </svg>
            Gravar Agora
        `;
        btnStart.style.opacity = '';
        btnStart.style.cursor = '';
        btnStart.style.display = 'flex';

        // Hide recording/processing UI
        recordingActions.classList.remove('active');
        btnForceStop.style.display = 'none';
        processingBanner.classList.remove('active');

        // Re-enable toggles
        toggleMic.disabled = false;
        toggleAi.disabled = false;
        // toggleCam stays disabled (Em breve)

        stopTimer();
    }

    // ═══════════════════════════════════════════
    // RECOVER STATE ON POPUP OPEN
    // ═══════════════════════════════════════════
    chrome.runtime.sendMessage({ action: 'get_status' }, (response) => {
        if (response && response.isRecording) {
            enterRecordingState();
        }
    });

    // Check if processing
    chrome.storage.local.get(['isProcessing'], (res) => {
        if (res.isProcessing) {
            enterProcessingState();
        } else {
            btnForceStop.style.display = 'none';
        }
    });

    // ═══════════════════════════════════════════
    // BUTTON ACTIONS
    // ═══════════════════════════════════════════
    btnStart.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'start_recording' });
        window.close(); // Close popup immediately for frictionless UX
    });

    btnStop.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'stop_recording' });
        window.close();
    });

    btnAbort.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'abort_recording' });
        window.close();
    });

    btnForceStop.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'abort_processing' });
        window.close();
    });
});
