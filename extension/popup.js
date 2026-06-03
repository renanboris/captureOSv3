document.addEventListener('DOMContentLoaded', async () => {
    // Elementos do DOM
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const btnAbort = document.getElementById('btn-abort');
    const pinWarning = document.getElementById('pin-warning');
    
    // Toggles
    const toggleMic = document.getElementById('toggle-mic');
    const toggleAi = document.getElementById('toggle-ai');
    const toggleCam = document.getElementById('toggle-cam');
    
    // Icons
    const iconMic = document.getElementById('icon-mic');
    const iconAi = document.getElementById('icon-ai');

    let isPinned = true;

    // --- Settings gear opens the options/settings page ---
    const settingsIcon = document.querySelector('.settings-icon');
    if (settingsIcon) {
        settingsIcon.addEventListener('click', () => {
            if (chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            } else {
                window.open(chrome.runtime.getURL('options.html'));
            }
        });
    }

    // --- Lógica de Abas ---
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const targetId = tab.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');

            if (targetId === 'tab-practice') {
                carregarModulosPratica();
            }
        });
    });

    // --- Lógica do Modo Prática ---
    async function carregarModulosPratica() {
        const container = document.getElementById('practice-modules-container');
        container.innerHTML = '<p style="font-size: 12px; color: #64748b;">Buscando módulos...</p>';

        try {
            // Descobrir domínio da aba ativa
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
                container.innerHTML = '<p style="font-size: 12px; color: #64748b;">Nenhum módulo encontrado para este site.</p>';
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
            container.innerHTML = `<p style="font-size: 12px; color: #ef4444;">Erro: ${e.message}</p>`;
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

    // --- Lógica Visual dos Toggles ---
    function updateTogglesUI() {
        if (toggleMic.checked) {
            iconMic.style.color = '#0b5ce3';
            iconMic.style.background = '#eff6ff';
            iconMic.style.borderColor = '#bfdbfe';
            
            toggleAi.checked = false; // Desativa IA se ativar Mic
            iconAi.style.color = '#64748b';
            iconAi.style.background = '#f8fafc';
            iconAi.style.borderColor = '#f1f5f9';
        } else {
            iconMic.style.color = '#64748b';
            iconMic.style.background = '#f8fafc';
            iconMic.style.borderColor = '#f1f5f9';
        }
        
        if (toggleAi.checked) {
            iconAi.style.color = '#0b5ce3';
            iconAi.style.background = '#eff6ff';
            iconAi.style.borderColor = '#bfdbfe';
            
            toggleMic.checked = false;
            iconMic.style.color = '#64748b';
            iconMic.style.background = '#f8fafc';
            iconMic.style.borderColor = '#f1f5f9';
        }
    }

    toggleMic.addEventListener('change', () => {
        if(toggleMic.checked) toggleAi.checked = false;
        else toggleAi.checked = true;
        updateTogglesUI();
        chrome.storage.local.set({ useMic: toggleMic.checked, useAi: toggleAi.checked });
    });

    toggleAi.addEventListener('change', () => {
        if(toggleAi.checked) toggleMic.checked = false;
        else toggleMic.checked = true;
        updateTogglesUI();
        chrome.storage.local.set({ useMic: toggleMic.checked, useAi: toggleAi.checked });
    });

    // Restaurar estado salvo dos botões
    chrome.storage.local.get(['useMic', 'useAi'], (res) => {
        if(res.useMic !== undefined) toggleMic.checked = res.useMic;
        if(res.useAi !== undefined) toggleAi.checked = res.useAi;
        updateTogglesUI();
    });

    const btnForceStop = document.getElementById('btn-force-stop');

    // Recupera o estado real ao abrir o popup
    chrome.runtime.sendMessage({action: 'get_status'}, (response) => {
        if (response && response.isRecording) {
            document.querySelector('.header h2').innerHTML = "<span style='color: #f12546;'>🔴</span> Gravando Tela...";
            document.querySelector('.content').style.display = 'none'; // Esconde as configurações
            
            btnStart.style.display = 'none';
            btnStop.style.display = 'flex';
            btnAbort.style.display = 'flex';
            btnForceStop.style.display = 'none';
        }
    });

    // Bloqueia se estiver processando
    chrome.storage.local.get(['isProcessing'], (res) => {
        if (res.isProcessing) {
            btnStart.disabled = true;
            btnStart.innerHTML = `<span class="capture-spin" style="display:inline-block; margin-right:8px; width:14px; height:14px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; vertical-align:middle; animation: capture-spin 1s linear infinite;"></span> Processando vídeo anterior...`;
            btnStart.style.opacity = '0.7';
            btnStart.style.cursor = 'not-allowed';
            
            toggleMic.disabled = true;
            toggleAi.disabled = true;
            toggleCam.disabled = true;
            
            btnForceStop.style.display = 'flex'; // Exibe o botão de forçar parada

            const style = document.createElement("style");
            style.innerHTML = `@keyframes capture-spin { 100% { transform: rotate(360deg); } }`;
            document.head.appendChild(style);
        } else {
            btnForceStop.style.display = 'none';
        }
    });

    btnStart.addEventListener('click', () => {
        chrome.runtime.sendMessage({action: 'start_recording'});
        window.close(); // Fecha o popup imediatamente após iniciar para ser frictionless
    });

    btnStop.addEventListener('click', () => {
        chrome.runtime.sendMessage({action: 'stop_recording'});
        window.close();
    });

    btnAbort.addEventListener('click', () => {
        chrome.runtime.sendMessage({action: 'abort_recording'});
        window.close();
    });

    btnForceStop.addEventListener('click', () => {
        chrome.runtime.sendMessage({action: 'abort_processing'});
        window.close();
    });
});
