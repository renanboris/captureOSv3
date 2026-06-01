// background.js

const BACKEND_URL = "http://localhost:8000"; // Substituir no build de produção
chrome.storage.local.set({ backendUrl: BACKEND_URL });

let blinkInterval = null;
let isDotVisible = true;
let activePollInterval = null;

function drawCameraIcon(ctx, color) {
    ctx.fillStyle = color;
    // Corpo da câmera
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(1, 4, 9, 8, 2);
    } else {
        ctx.rect(1, 4, 9, 8);
    }
    ctx.fill();
    // Lente (Triângulo)
    ctx.beginPath();
    ctx.moveTo(10, 6.5);
    ctx.lineTo(15, 3.5);
    ctx.lineTo(15, 12.5);
    ctx.lineTo(10, 9.5);
    ctx.fill();
}

function setStaticIcon() {
    if (blinkInterval) clearInterval(blinkInterval);
    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 16, 16);
    
    drawCameraIcon(ctx, '#0b5ce3'); // Azul Clean
    
    chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, 16, 16) });
}

function startBlinkingBadge() {
    chrome.action.setBadgeText({ text: "" }); // Remove o texto
    if (blinkInterval) clearInterval(blinkInterval);
    
    blinkInterval = setInterval(() => {
        isDotVisible = !isDotVisible;
        const canvas = new OffscreenCanvas(16, 16);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 16, 16);
        
        // Base da câmera desativada (cinza) para destacar o REC
        drawCameraIcon(ctx, '#64748b'); 
        
        // Notification Badge Pulsante (Canto superior direito)
        if (isDotVisible) {
            ctx.fillStyle = '#FF3B30';
            ctx.beginPath();
            ctx.arc(13, 3, 3, 0, 2 * Math.PI);
            ctx.fill();
            
            ctx.fillStyle = 'rgba(255, 59, 48, 0.4)';
            ctx.beginPath();
            ctx.arc(13, 3, 4.5, 0, 2 * Math.PI);
            ctx.fill();
        } else {
            ctx.fillStyle = 'rgba(255, 59, 48, 0.15)';
            ctx.beginPath();
            ctx.arc(13, 3, 3, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, 16, 16) });
    }, 600);
}

// Restaura estado visual do icone ao inicializar o Service Worker
chrome.storage.local.get(['isRecording'], async (res) => {
    if (res.isRecording) {
        startBlinkingBadge();
    } else {
        setStaticIcon();
    }
});

async function setupOffscreenDocument(path) {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
        url: path,
        reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
        justification: 'Gravação contínua da aba de navegação'
    });
}



chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'background' && message.action === 'recording_ready') {
        const videoBase64 = message.data;
        
        // Garante que desligamos o ícone piscante mesmo se ele parou pelo botão nativo do Chrome
        chrome.storage.local.set({ isRecording: false });
        setStaticIcon();
        
        chrome.storage.local.get(['recordingStartTime', 'eventsLog'], (res) => {
            finalizeUpload(videoBase64, res.recordingStartTime || 0, res.eventsLog || [], message.micAudioBase64 || "");
        });
    }
    
    if (message.action === 'get_status') {
        chrome.storage.local.get(['isRecording', 'recordingStartTime'], (res) => {
            sendResponse({ isRecording: !!res.isRecording, start_time: res.recordingStartTime || 0 });
        });
        return true;
    }
    
    if (message.action === 'ping') {
        sendResponse({ status: 'alive' });
        return true;
    }
    
    if (message.action === 'user_interaction') {
        chrome.storage.local.get(['isRecording', 'eventsLog'], (res) => {
            if (res.isRecording) {
                // GRAVA O TIMESTAMP IMEDIATAMENTE (Não espera o screenshot!)
                const exact_timestamp = Date.now();
                
                // Tira print screen no tempo exato extraindo o frame da stream de vídeo no Offscreen
                chrome.runtime.sendMessage({ target: 'offscreen', action: 'take_screenshot' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Erro ao pedir frame pro offscreen", chrome.runtime.lastError);
                        return;
                    }
                    if (response && response.dataUrl) {
                        let logs = res.eventsLog || [];
                        logs.push({
                            timestamp: exact_timestamp,
                            type: message.type,
                            eventData: message.data,
                            screenshotData: response.dataUrl
                        });
                        chrome.storage.local.set({ eventsLog: logs });
                        console.log("Evento gravado de forma persistente", message.type);
                    }
                });
            }
        });
    }
    
    if (message.action === 'start_recording') {
        startCapture();
    }
    
    if (message.target === 'background' && message.action === 'stream_ready') {
        // Inicia o ponto vermelho pulsante nativo no ícone da extensão
        startBlinkingBadge();
        
        // MOSTRA O COUNTDOWN!
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if(tabs[0]) chrome.tabs.sendMessage(tabs[0].id, {action: 'show_countdown'}).catch(() => {});
        });
    }

    if (message.action === 'start_recording_now') {
        const startTime = Date.now();
        chrome.storage.local.set({
            isRecording: true,
            recordingStartTime: startTime,
            eventsLog: [],
            sandboxMode: false
        });
        chrome.runtime.sendMessage({ target: 'offscreen', action: 'start_recording_now' }).catch(() => {});
    }
    
    if (message.action === 'stop_recording') {
        stopCapture();
    }
    
    if (message.action === 'abort_recording') {
        abortCapture();
    }
    
    if (message.action === 'abort_processing') {
        if (activePollInterval) {
            clearInterval(activePollInterval);
            activePollInterval = null;
        }
        chrome.storage.local.set({ isProcessing: false });
        console.log("Processamento abortado pelo usuário.");
        
        chrome.storage.local.get(['currentSessionId'], (res) => {
            if (res.currentSessionId) {
                fetch(`${BACKEND_URL}/api/v1/capture/abort/${res.currentSessionId}`, { method: 'POST' })
                .catch(() => console.error('Falha ao abortar no backend'));
            }
        });
    }
    
    if (message.action === 'stop_processing') {
        chrome.storage.local.set({ isProcessing: false });
        console.log("Processamento finalizado com sucesso.");
    }

    // ─── MODO ÁRBITRO: iniciar sessão de prática ───
    if (message.action === "INICIAR_SESSAO_ARBITRO") {
        const { moduloId, tabId } = message;
        const backendUrl = BACKEND_URL;

        fetch(`${backendUrl}/api/v1/simlink/${moduloId}`)
            .then(r => r.json())
            .then(modulo => {
                chrome.storage.local.set({
                    sandboxMode: true,
                    sandboxSessionId: moduloId,
                    sandboxTotalPassos: modulo.total_passos,
                    sandboxPassoAtual: 0
                });

                // Resetar estado do sandbox no backend
                fetch(`${backendUrl}/api/v1/sandbox/reset`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: moduloId })
                }).catch(() => {});

                // Notificar content script da aba alvo
                chrome.tabs.sendMessage(tabId, {
                    action: "update_toast",
                    msg: `🎯 Modo Prática iniciado — ${modulo.total_passos} passos`
                }).catch(() => {});

                sendResponse({ ok: true, total_passos: modulo.total_passos });
            })
            .catch(err => {
                console.error("Erro ao iniciar árbitro:", err);
                sendResponse({ ok: false, error: err.message });
            });
        return true; // async response
    }

    // ─── MODO ÁRBITRO: passo concluído ───
    if (message.type === "ARBITRO_PASSO_OK") {
        const pct = Math.round((message.passo / message.total) * 100);

        chrome.action.setBadgeText({ text: `${pct}%` });
        chrome.action.setBadgeBackgroundColor({ color: '#1D9E75' });

        if (message.concluido) {
            chrome.action.setBadgeText({ text: '✓' });
            chrome.action.setBadgeBackgroundColor({ color: '#1D9E75' });

            // Reportar conclusão ao backend
            fetch(`${BACKEND_URL}/api/v1/simlink/${message.session_id || ''}/conclusao`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    xp: message.xp,
                    modo: 'sandbox_real',
                    completado: true
                })
            }).catch(() => {});

            // Resetar badge após 5s
            setTimeout(() => {
                chrome.action.setBadgeText({ text: '' });
                setStaticIcon();
            }, 5000);
        }
    }
    
    if (message.action === 'evaluate_sandbox') {
        fetch(`${BACKEND_URL}/api/v1/sandbox/evaluate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: message.session_id,
                url: message.url,
                action_data: message.payload
            })
        })
        .then(r => r.json())
        .then(data => sendResponse(data))
        .catch(err => {
            console.error("Erro arbitro back:", err);
            sendResponse({is_correct: false, hint: "Erro no servidor (verifique os logs)"});
        });
        return true; // async response
    }
    
    if (message.action === 'resume_polling') {
        startPolling(message.session_id);
    }
});

function startPolling(sessionId) {
    if (activePollInterval) clearInterval(activePollInterval);
    chrome.storage.local.set({ isProcessing: true });
    
    activePollInterval = setInterval(() => {
        fetch(`${BACKEND_URL}/api/v1/capture/status/${sessionId}`)
            .then(r => r.json())
            .then(status => {
                if (status.status === "processing" || status.status === "rendering_final") {
                    if (status.message) {
                        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                            if (tabs[0]) {
                                chrome.tabs.sendMessage(tabs[0].id, {
                                    action: "update_toast", msg: status.message
                                }).catch(() => {});
                            }
                        });
                    }
                } else if (status.status === "roteiro_pronto") {
                    if (activePollInterval !== null) {
                        clearInterval(activePollInterval);
                        activePollInterval = null;
                        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                            if (tabs[0]) {
                                chrome.tabs.sendMessage(tabs[0].id, {
                                    action: "show_editor_modal",
                                    session_id: sessionId,
                                    backendUrl: BACKEND_URL
                                }).catch(() => {});
                            }
                        });
                    }
                } else if (status.status === "completed") {
                    if (activePollInterval !== null) {
                        clearInterval(activePollInterval);
                        activePollInterval = null;
                        chrome.storage.local.set({ isProcessing: false });
                        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                            if (tabs[0]) {
                                chrome.tabs.sendMessage(tabs[0].id, {
                                    action: "show_player_modal",
                                    url: status.url,
                                    roteiro: status.roteiro || []
                                }).catch(() => {});
                            }
                        });
                    }
                } else if (status.status === "error" || status.status === "failed") {
                    if (activePollInterval !== null) {
                        clearInterval(activePollInterval);
                        activePollInterval = null;
                        chrome.storage.local.set({ isProcessing: false });
                    }
                }
            })
            .catch(e => console.error("Erro no polling", e));
    }, 3000);
}

async function startCapture() {
    chrome.storage.local.set({ eventsLog: [], recordingStartTime: 0, isRecording: false, sandboxMode: false });
    
    // Configura offscreen
    await setupOffscreenDocument('offscreen.html');

    // Gravação delegada ao Picker nativo
    chrome.storage.local.get(['useMic'], (res) => {
        chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'start_recording',
            useMic: res.useMic || false
        }).catch(err => console.error("Erro ao iniciar gravação no offscreen:", err));
    });
    console.log("Gravação Delegada ao Offscreen via getDisplayMedia nativo");
}

async function stopCapture() {
    chrome.storage.local.set({ isRecording: false });
    chrome.action.setBadgeText({ text: "" }); 
    setStaticIcon(); // Volta para o ícone azul original
    
    console.log("Parando gravação. Aguardando vídeo do Offscreen...");
    chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'stop_recording'
    });
    // finalizeUpload() será chamado quando o offscreen devolver o videoBase64.
}

async function abortCapture() {
    chrome.storage.local.set({ isRecording: false, eventsLog: [], recordingStartTime: 0 });
    chrome.action.setBadgeText({ text: "" }); 
    setStaticIcon(); 
    
    console.log("Gravação abortada pelo usuário.");
    chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'abort_recording'
    });
}

function finalizeUpload(videoBase64, recordingStartTime, eventsLog, micAudioBase64 = "") {
    console.log("Montando Payload Final...");

    chrome.storage.local.get(['useMic', 'useAi'], (res) => {
        // --- tudo abaixo está DENTRO do callback ---

        let modoInput = "A";
        if (res.useMic && micAudioBase64) modoInput = "B";

        const payload = {
            session_id: "sess_" + Date.now(),
            recording_start_time: recordingStartTime,
            events: eventsLog,
            video_webm: videoBase64,
            audio_instrutor_webm: micAudioBase64,
            modo_input: modoInput
        };

        // Avisa a aba ativa que o upload começou
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "show_toast", type: "processing"
                }).catch(() => {});
            }
        });

        fetch(`${BACKEND_URL}/api/v1/capture/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
            console.log('Upload recebido pelo servidor, aguardando pipeline...', data);
            chrome.storage.local.set({ isProcessing: true });
            
            if (data.session_id) {
                chrome.storage.local.set({ currentSessionId: data.session_id });
                startPolling(data.session_id);
            }
        })
        .catch(err => {
            console.error('Erro no upload', err);
            chrome.storage.local.set({ isProcessing: false });
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: "show_toast", type: "error"
                    }).catch(() => {});
                }
            });
        });

    }); // ← storage callback fecha AQUI — depois do fetch
}
