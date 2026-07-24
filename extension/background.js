// background.js

// ─── IndexedDB event storage helpers ─────────────────────────────────────────
// Events and screenshots are persisted in IndexedDB (not chrome.storage.local)
// to avoid the ~5 MB quota limit that silently drops events (bug C5).
//
// DB: captureOS_db  |  Object store: events
// Each record: { id (autoIncrement), timestamp, type, eventData, screenshotData }

const EVENTS_DB_NAME = 'captureOS_db';
const EVENTS_DB_VERSION = 1;
const EVENTS_STORE = 'events';

/**
 * Opens (or creates) the IndexedDB database and returns a Promise<IDBDatabase>.
 */
function openEventsDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(EVENTS_DB_NAME, EVENTS_DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(EVENTS_STORE)) {
                db.createObjectStore(EVENTS_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
    });
}

/**
 * Appends a single event entry to IndexedDB.
 * @param {{ timestamp: number, type: string, eventData: any, screenshotData: string }} event
 * @returns {Promise<void>}
 */
async function appendEventToDB(event) {
    const db = await openEventsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(EVENTS_STORE, 'readwrite');
        const store = tx.objectStore(EVENTS_STORE);
        const req = store.add(event);
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
        tx.oncomplete = () => db.close();
        tx.onerror    = (e) => reject(e.target.error);
    });
}

/**
 * Reads all event entries from IndexedDB, ordered by insertion order.
 * @returns {Promise<Array>}
 */
async function readAllEventsFromDB() {
    const db = await openEventsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(EVENTS_STORE, 'readonly');
        const store = tx.objectStore(EVENTS_STORE);
        const req = store.getAll();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
        tx.oncomplete = () => db.close();
        tx.onerror    = (e) => reject(e.target.error);
    });
}

/**
 * Clears all events from IndexedDB (called after a successful upload or abort).
 * @returns {Promise<void>}
 */
async function clearEventsDB() {
    const db = await openEventsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(EVENTS_STORE, 'readwrite');
        const store = tx.objectStore(EVENTS_STORE);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
        tx.oncomplete = () => db.close();
        tx.onerror    = (e) => reject(e.target.error);
    });
}

/**
 * Surfaces an error to the user when event persistence fails (no silent loss).
 * Uses chrome.notifications if available, falls back to console.error.
 */
function notifyEventPersistenceError(err) {
    console.error('[CaptureOS] Event persistence error — events may be lost:', err);
    if (chrome.notifications) {
        chrome.notifications.create('event-persist-error', {
            type: 'basic',
            iconUrl: 'icon.png',
            title: 'CaptureOS — Recording Error',
            message: 'Failed to save capture events. Some interactions may be missing from the recording. Please try again.'
        }).catch(() => {});
    }
    // Also badge the icon red so the user cannot miss it
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF3B30' });
}

// ─── Backend endpoint resolution (configurable) ───
// The backend endpoint is NOT hardcoded. It is resolved at runtime from
// chrome.storage: the `backendUrl` key is populated by the options/settings
// page (the gear in popup.html). Production builds MUST configure `backendUrl`
// through that page so the published extension targets the deployed backend
// instead of the end user's own machine.
//
// Dev-only fallback: when no endpoint has been configured we assemble a
// localhost URL from parts (so no production endpoint is ever hardcoded). This
// fallback exists purely to ease local development and is never used once a
// real `backendUrl` is configured.
const DEV_FALLBACK_BACKEND_URL = "https://api.nomadelabs.com.br";

// Resolve the backend endpoint from configurable chrome.storage at request time.
async function getBackendUrl() {
    const res = await chrome.storage.local.get(['backendUrl']);
    return res.backendUrl || DEV_FALLBACK_BACKEND_URL;
}

// Perform a fetch against the configured backend. Resolves the endpoint from
// chrome.storage at request time and attaches the auth bearer token (from the
// `authToken` key, populated by the settings/login flow) to every outgoing
// request, pairing with the api/auth.py dependency on the backend.
async function authedFetch(path, options = {}) {
    const backendUrl = await getBackendUrl();
    const { authToken } = await chrome.storage.local.get(['authToken']);
    const headers = { ...(options.headers || {}) };
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    return fetch(`${backendUrl}${path}`, { ...options, headers });
}

// ─── Auth header injection via declarativeNetRequest ───
// The editor runs as an iframe served by the backend and makes its own fetch
// calls (roteiro, tts, regerar). Rather than threading the token through URL
// params or postMessage (fragile, cache-sensitive), we inject the
// Authorization header at the network layer for EVERY request to the backend.
// This covers the iframe, the content script, and the service worker uniformly.
const AUTH_RULE_ID = 1;

async function refreshAuthHeaderRule() {
    const { authToken, backendUrl } = await chrome.storage.local.get(['authToken', 'backendUrl']);

    if (!authToken) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [AUTH_RULE_ID],
        });
        console.warn('[CaptureOS] Sem authToken — header de auth NÃO será injetado.');
        return;
    }
    const base = backendUrl || DEV_FALLBACK_BACKEND_URL;
    // urlFilter matches any request whose URL contains the backend host.
    let urlFilter;
    try {
        const u = new URL(base);
        urlFilter = `||${u.host}/`;   // e.g. ||localhost:8000/
    } catch (e) {
        urlFilter = '||api.nomadelabs.com.br/';
    }
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [AUTH_RULE_ID], // Operação atômica de remoção e adição
        addRules: [{
            id: AUTH_RULE_ID,
            priority: 1,
            action: {
                type: 'modifyHeaders',
                requestHeaders: [{
                    header: 'Authorization',
                    operation: 'set',
                    value: `Bearer ${authToken}`,
                }],
            },
            condition: {
                urlFilter,
                // Apply to all request types (xmlhttprequest from iframe, etc.)
                resourceTypes: [
                    'main_frame', 'sub_frame', 'xmlhttprequest', 'other',
                ],
            },
        }],
    });
    console.log('[CaptureOS] Regra de auth header registrada para', urlFilter);
}

// Register/refresh the rule on startup and whenever the token/backend changes.
chrome.runtime.onInstalled.addListener((details) => {
    refreshAuthHeaderRule();
    if (details.reason === 'install' || details.reason === 'update') {
        injectContentScriptsToAllTabs();
    }
});
chrome.runtime.onStartup.addListener(() => { refreshAuthHeaderRule(); });
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.authToken || changes.backendUrl)) {
        refreshAuthHeaderRule();
    }
});
// Also refresh immediately when this service worker loads.
refreshAuthHeaderRule();

let blinkInterval = null;
let isDotVisible = true;
let activePollInterval = null;

function setStaticIcon() {
    if (blinkInterval) clearInterval(blinkInterval);
    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 16, 16);
    
    // Apple-style Idle Recording Icon (Silver/Gray)
    const cx = 8, cy = 8;
    
    // Outer Ring (Red for idle)
    ctx.beginPath();
    ctx.arc(cx, cy, 6.5, 0, 2 * Math.PI);
    ctx.strokeStyle = '#FF3B30'; 
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Inner Solid Circle
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#FF3B30';
    ctx.fill();
    
    chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, 16, 16) });
}

function startBlinkingBadge() {
    chrome.action.setBadgeText({ text: "" });
    if (blinkInterval) clearInterval(blinkInterval);
    
    let isPulseHigh = true;
    
    blinkInterval = setInterval(() => {
        isPulseHigh = !isPulseHigh;
        const canvas = new OffscreenCanvas(16, 16);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 16, 16);
        
        const cx = 8, cy = 8;
        
        // Outer Ring - Apple style dim silver
        ctx.beginPath();
        ctx.arc(cx, cy, 6.5, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(142, 142, 147, 0.6)'; 
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        if (isPulseHigh) {
            // Bright Apple Red, slightly larger
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#FF3B30';
            ctx.fill();
            
            // Inner subtle glow/shine for realism
            const grad = ctx.createRadialGradient(cx - 1, cy - 1, 0, cx, cy, 4);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
            ctx.fill();
        } else {
            // Dim Red, slightly smaller (breathing effect)
            ctx.beginPath();
            ctx.arc(cx, cy, 3.5, 0, 2 * Math.PI);
            ctx.fillStyle = '#C93429';
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
        
        // Read events from IndexedDB (not chrome.storage.local) to avoid the
        // ~5 MB quota that silently drops screenshots (bug C5).
        chrome.storage.local.get(['recordingStartTime'], (res) => {
            readAllEventsFromDB()
                .then((eventsLog) => {
                    finalizeUpload(videoBase64, res.recordingStartTime || 0, eventsLog, message.micAudioBase64 || "");
                })
                .catch((err) => {
                    // Surface the error — no silent loss of events.
                    notifyEventPersistenceError(err);
                    // Still attempt finalize with an empty event log so the
                    // recording is not completely lost.
                    finalizeUpload(videoBase64, res.recordingStartTime || 0, [], message.micAudioBase64 || "");
                });
        });
    }
    
    if (message.action === 'get_status') {
        chrome.storage.local.get(['isRecording', 'recordingStartTime', 'isProcessing'], (res) => {
            sendResponse({ isRecording: !!res.isRecording, isProcessing: !!res.isProcessing, start_time: res.recordingStartTime || 0 });
        });
        return true;
    }
    
    if (message.action === 'ping') {
        sendResponse({ status: 'alive' });
        return true;
    }
    
    if (message.action === 'user_interaction') {
        chrome.storage.local.get(['isRecording'], (res) => {
            if (res.isRecording) {
                // GRAVA O TIMESTAMP IMEDIATAMENTE (Não espera o screenshot!)
                const exact_timestamp = Date.now();
                
                // Tira print screen instantâneo e sem o cursor do mouse atrasado do WebRTC
                chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
                    if (chrome.runtime.lastError || !dataUrl) {
                        // Fallback para o offscreen se der erro (ex: página restrita)
                        chrome.runtime.sendMessage({ target: 'offscreen', action: 'take_screenshot' }, (response) => {
                            if (response && response.dataUrl) {
                                salvarEvento(exact_timestamp, message, response.dataUrl);
                            }
                        });
                    } else {
                        salvarEvento(exact_timestamp, message, dataUrl);
                    }
                });

                function salvarEvento(ts, msg, picData) {
                    appendEventToDB({
                        timestamp: ts,
                        type: msg.type,
                        eventData: msg.data,
                        screenshotData: picData
                    }).then(() => {
                        console.log("Evento gravado no IndexedDB", msg.type);
                    }).catch((err) => {
                        notifyEventPersistenceError(err);
                    });
                }
            }
        });
    }
    
    if (message.action === 'start_recording') {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0] && tabs[0].id) {
                await ensureContentScriptActive(tabs[0].id);
            }
            startCapture();
        });
    }
    
    if (message.target === 'background' && message.action === 'stream_ready') {
        // Inicia o ponto vermelho pulsante nativo no ícone da extensão
        startBlinkingBadge();
        
        // MOSTRA O TOAST PREPARATÓRIO!
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if(tabs[0]) chrome.tabs.sendMessage(tabs[0].id, {action: 'show_prep_toast'}).catch(() => {});
        });
    }

    if (message.action === 'start_recording_now') {
        const startTime = Date.now();
        chrome.storage.local.set({
            isRecording: true,
            recordingStartTime: startTime,
            sandboxMode: false
        });
        // Clear events DB for the new recording (bug C5 fix: not using chrome.storage.local
        // for eventsLog any more).
        clearEventsDB().catch((err) => console.warn('[CaptureOS] Could not clear events DB on start:', err));
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
                authedFetch(`/api/v1/capture/abort/${res.currentSessionId}`, { method: 'POST' })
                .catch(() => console.error('Falha ao abortar no backend'));
            }
        });
    }
    
    if (message.action === 'stop_processing') {
        chrome.storage.local.set({ isProcessing: false });
        console.log("Processamento finalizado com sucesso.");
    }

    if (message.action === 'resume_polling_after_editor') {
        // Retoma polling no background após o editor aprovar o roteiro.
        // Mais resiliente que polling no content script (sobrevive a navegação).
        const sessionId = message.session_id;
        console.log(`Retomando polling para sessão ${sessionId} após editor.`);
        if (activePollInterval) {
            clearInterval(activePollInterval);
            activePollInterval = null;
        }
        activePollInterval = setInterval(async () => {
            const backendUrl = await getBackendUrl();
            try {
                const resp = await authedFetch(`/api/v1/capture/status/${sessionId}`);
                const status = await resp.json();
                if (status.status === "processing" || status.status === "rendering_final") {
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0]) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                action: "update_toast", msg: status.message
                            }).catch(() => {});
                        }
                    });
                } else if (status.status === "completed") {
                    clearInterval(activePollInterval);
                    activePollInterval = null;
                    chrome.storage.local.set({ isProcessing: false });
                    chrome.storage.local.remove(['toastMinimized']);
                    
                    // Dispara notificação nativa do SO
                    if (chrome.notifications && chrome.notifications.create) {
                        try {
                            chrome.notifications.create(`capture_completed_${sessionId}`, {
                                type: 'basic',
                                iconUrl: 'icons/icon-128.png',
                                title: 'Capture OS — Tutorial Pronto!',
                                message: status.titulo ? `O tutorial "${status.titulo}" foi gerado com sucesso.` : 'Seu vídeo e roteiro estão prontos para visualização.',
                                priority: 2
                            });
                        } catch (e) {
                            console.warn("Falha ao criar notificação Chrome:", e);
                        }
                    }

                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0] && tabs[0].id) {
                            const tabUrl = tabs[0].url || "";
                            if (!tabUrl.startsWith('chrome://') && !tabUrl.startsWith('chrome-extension://') && !tabUrl.startsWith('about:')) {
                                chrome.tabs.sendMessage(tabs[0].id, {
                                    action: "show_player_modal",
                                    url: status.url,
                                    roteiro: status.roteiro || [],
                                    titulo: status.titulo || "",
                                    backendUrl: backendUrl
                                }).catch((err) => {
                                    console.log("[CaptureOS] Não foi possível exibir o modal na aba atual:", err);
                                });
                            }
                        }
                    });
                } else if (status.status === "error" || status.status === "failed" || status.status === "unknown") {
                    clearInterval(activePollInterval);
                    activePollInterval = null;
                    chrome.storage.local.set({ isProcessing: false });
                    chrome.storage.local.set({ isProcessing: false });
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0]) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                action: "show_error_toast"
                            }).catch(() => {});
                        }
                    });
                }
            } catch (e) {
                console.error("Erro no polling pós-editor", e);
            }
        }, 3000);
    }

    // ─── MODO ÁRBITRO: iniciar sessão de prática ───
    if (message.action === "INICIAR_SESSAO_ARBITRO") {
        const { moduloId, tabId } = message;

        ensureContentScriptActive(tabId).then(() => {
            authedFetch(`/api/v1/simlink/${moduloId}`)
                .then(r => r.json())
                .then(modulo => {
                    chrome.storage.local.set({
                        sandboxMode: true,
                        sandboxSessionId: moduloId,
                        sandboxTotalPassos: modulo.total_passos,
                        sandboxPassoAtual: 0,
                        sandboxHotspots: modulo.hotspots,
                        sandboxXP: 0,
                        sandboxStats: { errors: 0, hints: 0, skips: 0 }
                    });

                    // Resetar estado do sandbox no backend
                    authedFetch(`/api/v1/sandbox/reset`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ session_id: moduloId })
                    }).catch(() => {});

                    sendResponse({ ok: true, total_passos: modulo.total_passos });
                })
                .catch(err => {
                    console.error("Erro ao iniciar árbitro:", err);
                    sendResponse({ ok: false, error: err.message });
                });
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
            authedFetch(`/api/v1/simlink/${message.session_id || ''}/conclusao`, {
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

    if (message.type === "ARBITRO_ENCERRADO") {
        chrome.action.setBadgeText({ text: '' });
        setStaticIcon();
    }

    if (message.action === "SHOW_HINT_BROADCAST") {
        if (sender.tab) {
            chrome.tabs.sendMessage(sender.tab.id, {
                action: "SHOW_HINT_LOCAL",
                step: message.step
            }).catch(() => {});
        }
    }

    if (message.action === "HINT_ELEMENT_FOUND") {
        if (sender.tab) {
            chrome.tabs.sendMessage(sender.tab.id, {
                action: "HINT_ELEMENT_FOUND_LOCAL"
            }).catch(() => {});
        }
    }
    
    if (message.action === 'evaluate_sandbox') {
        authedFetch(`/api/v1/sandbox/evaluate`, {
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

    if (message.action === 'auth_fetch') {
        (async () => {
            try {
                const { authToken } = await chrome.storage.local.get(['authToken']);
                const backendUrl = await getBackendUrl();
                
                let targetUrl = message.url || '';
                if (message.path) {
                    targetUrl = `${backendUrl}${message.path}`;
                }
                
                const options = { ...(message.options || {}) };
                const headers = { ...(options.headers || {}) };
                if (authToken) {
                    headers['Authorization'] = `Bearer ${authToken}`;
                }
                options.headers = headers;

                const res = await fetch(targetUrl, options);
                if (res.ok) {
                    let data = {};
                    try {
                        data = await res.json();
                    } catch(e) {}
                    sendResponse({ ok: true, status: res.status, data: data });
                } else {
                    sendResponse({ ok: false, status: res.status });
                }
            } catch (err) {
                console.error("Erro no auth_fetch do background:", err);
                sendResponse({ ok: false, status: 0, error: err.message });
            }
        })();
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
        authedFetch(`/api/v1/capture/status/${sessionId}`)
            .then(r => r.json())
            .then(async status => {
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
                        chrome.storage.local.set({ isProcessing: false });
                        const backendUrl = await getBackendUrl();
                        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                            if (tabs[0]) {
                                chrome.tabs.sendMessage(tabs[0].id, {
                                    action: "show_editor_modal",
                                    session_id: sessionId,
                                    backendUrl: backendUrl
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
                                    roteiro: status.roteiro || [],
                                    titulo: status.titulo || "",
                                    backendUrl: backendUrl
                                }).catch(() => {});
                            }
                        });
                    }
                } else if (status.status === "error" || status.status === "failed" || status.status === "unknown") {
                    if (activePollInterval !== null) {
                        clearInterval(activePollInterval);
                        activePollInterval = null;
                        chrome.storage.local.set({ isProcessing: false });
                        if (status.status !== "unknown") {
                            // Só notifica erro real; "unknown" é sessão expirada/não encontrada
                            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                                if (tabs[0]) {
                                    chrome.tabs.sendMessage(tabs[0].id, {
                                        action: "update_toast", msg: status.message || "Erro no processamento."
                                    }).catch(() => {});
                                }
                            });
                        }
                    }
                }
            })
            .catch(e => console.error("Erro no polling", e));
    }, 3000);
}

async function startCapture() {
    chrome.storage.local.set({ recordingStartTime: 0, isRecording: false, sandboxMode: false });
    // Clear the IndexedDB events store for the new session (events are no longer
    // persisted to chrome.storage.local — bug C5 fix).
    clearEventsDB().catch((err) => console.warn('[CaptureOS] Could not clear events DB before capture:', err));
    
    try {
        // Inicializa o offscreen
        await setupOffscreenDocument('offscreen.html');

        // Dispara gravação delegada ao Picker nativo do getDisplayMedia no Offscreen
        chrome.storage.local.get(['useMic', 'systemAudio'], (res) => {
            chrome.runtime.sendMessage({
                target: 'offscreen',
                action: 'start_recording',
                useMic: res.useMic || false,
                systemAudio: res.systemAudio || false
            }).catch(err => console.error("Erro ao iniciar gravação no offscreen:", err));
        });
        console.log("Gravação Delegada ao Offscreen via getDisplayMedia nativo");
    } catch (err) {
        console.error("Erro ao preparar documento offscreen:", err);
    }
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
    chrome.storage.local.set({ isRecording: false, recordingStartTime: 0 });
    // Clear the IndexedDB events store on abort (bug C5 fix: events are no longer
    // kept in chrome.storage.local).
    clearEventsDB().catch((err) => console.warn('[CaptureOS] Could not clear events DB on abort:', err));
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

    chrome.storage.local.get(['useMic', 'useAi', 'ragNamespace'], (res) => {
        // --- tudo abaixo está DENTRO do callback ---

        let modoInput = "A";
        if (res.useMic && micAudioBase64) modoInput = "B";

        const sessionId = "sess_" + self.crypto.randomUUID();

        // Task 14.4 (C4): convert base64 video to a binary Blob and upload via
        // multipart/form-data instead of embedding it as a base64 string inside
        // a JSON payload.  This avoids the network-timeout / Service-Worker
        // memory-exhaustion failure on long recordings.
        let videoBlob;
        try {
            // videoBase64 may include a data-URI prefix ("data:video/webm;base64,…")
            const b64 = videoBase64.includes(',') ? videoBase64.split(',')[1] : videoBase64;
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            videoBlob = new Blob([bytes], { type: 'video/webm' });
        } catch (e) {
            console.error('[CaptureOS] Failed to convert video to Blob:', e);
            // Fallback: send an empty blob rather than crashing silently
            videoBlob = new Blob([], { type: 'video/webm' });
        }

        const formData = new FormData();
        formData.append('session_id', sessionId);
        formData.append('recording_start_time', String(recordingStartTime || 0));
        formData.append('events', JSON.stringify(eventsLog));
        formData.append('modo_input', modoInput);
        formData.append('roteiro_manual', '[]');
        formData.append('rag_namespace', res.ragNamespace || "auto");
        formData.append('video', videoBlob, 'recording.webm');

        if (modoInput === 'B' && micAudioBase64) {
            try {
                const b64audio = micAudioBase64.includes(',') ? micAudioBase64.split(',')[1] : micAudioBase64;
                const binaryAudio = atob(b64audio);
                const bytesAudio = new Uint8Array(binaryAudio.length);
                for (let i = 0; i < binaryAudio.length; i++) bytesAudio[i] = binaryAudio.charCodeAt(i);
                const audioBlob = new Blob([bytesAudio], { type: 'audio/webm' });
                formData.append('audio', audioBlob, 'instructor.webm');
            } catch (e) {
                console.error('[CaptureOS] Failed to convert audio to Blob:', e);
            }
        }

        // Avisa a aba ativa que o upload começou
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "show_toast", type: "processing"
                }).catch(() => {});
            }
        });

        fetch_ingest(sessionId, formData);

    }); // ← storage callback fecha AQUI — depois do fetch
}

// Sends the ingest payload to the configured backend with the auth token
// attached. Task 14.4: uses multipart/form-data (binary upload) instead of
// the old base64-in-JSON body (C4 fix).
function fetch_ingest(sessionId, formData) {
    // NOTE: do NOT set Content-Type manually — the browser sets it automatically
    // with the correct multipart boundary when using FormData.
    authedFetch(`/api/v1/capture/ingest`, {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        console.log('Upload recebido pelo servidor, aguardando pipeline...', data);
        chrome.storage.local.set({ isProcessing: true });
        // Clear the IndexedDB events store now that events have been successfully
        // uploaded (bug C5 fix).
        clearEventsDB().catch((err) => console.warn('[CaptureOS] Could not clear events DB after upload:', err));

        const resolvedSessionId = (data && data.session_id) ? data.session_id : sessionId;
        if (resolvedSessionId) {
            chrome.storage.local.set({ currentSessionId: resolvedSessionId });
            startPolling(resolvedSessionId);
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
}

// ─── Content Script Resiliency and Injection Helpers ─────────────────────────

/**
 * Helper to dynamically inject scripts into a tab, trying allFrames first
 * and falling back to main frame only if a sub-frame is restricted/blocked.
 * @param {number} tabId
 * @param {string[]} files
 * @param {boolean} allFrames
 * @returns {Promise<boolean>}
 */
async function injectScriptsIntoTab(tabId, files, allFrames = true) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: allFrames },
            files: files
        });
        return true;
    } catch (err) {
        const errMsg = (err && err.message) || "";
        const isRestricted = errMsg.includes("cannot be scripted") || 
                             errMsg.includes("extensions gallery") || 
                             errMsg.includes("restricted") || 
                             errMsg.includes("privileged") ||
                             errMsg.includes("Cannot access");

        if (allFrames) {
            if (!isRestricted) {
                console.warn(`[CaptureOS] Injection failed for all frames on tab ${tabId}. Retrying for main frame only...`, err);
            }
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId, allFrames: false },
                    files: files
                });
                return true;
            } catch (fallbackErr) {
                const fallbackMsg = (fallbackErr && fallbackErr.message) || "";
                const fallbackRestricted = fallbackMsg.includes("cannot be scripted") || 
                                           fallbackMsg.includes("extensions gallery") || 
                                           fallbackMsg.includes("restricted") || 
                                           fallbackMsg.includes("privileged") ||
                                           fallbackMsg.includes("Cannot access");
                if (!fallbackRestricted) {
                    console.error(`[CaptureOS] Fallback injection failed on tab ${tabId}:`, fallbackErr);
                } else {
                    console.log(`[CaptureOS] Suppressed injection on restricted tab ${tabId}: ${fallbackMsg}`);
                }
            }
        } else {
            if (!isRestricted) {
                console.error(`[CaptureOS] Main frame injection failed on tab ${tabId}:`, err);
            } else {
                console.log(`[CaptureOS] Suppressed injection on restricted tab ${tabId}: ${errMsg}`);
            }
        }
    }
    return false;
}

/**
 * Sweeps all open HTTP/HTTPS tabs and injects the content scripts defined
 * in the manifest. This runs on installation or update to ensure all open pages
 * are interactive immediately without needing a refresh.
 */
async function injectContentScriptsToAllTabs() {
    const manifest = chrome.runtime.getManifest();
    const contentScripts = manifest.content_scripts || [];
    
    try {
        const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
        console.log(`[CaptureOS] Injecting content scripts into ${tabs.length} tabs on install/update...`);
        for (const tab of tabs) {
            if (!tab.id || !tab.url) continue;
            
            // Avoid injecting into restricted pages
            if (tab.url.startsWith('chrome://') || 
                tab.url.startsWith('chrome-extension://') || 
                tab.url.startsWith('about:') || 
                tab.url.startsWith('edge://') ||
                tab.url.includes('chromewebstore.google.com')) {
                continue;
            }

            for (const script of contentScripts) {
                if (script.js && script.js.length > 0) {
                    await injectScriptsIntoTab(tab.id, script.js, script.allFrames || false);
                }
            }
        }
    } catch (err) {
        console.error('[CaptureOS] Error during bulk injection of content scripts:', err);
    }
}

/**
 * Verifies if the content script is active in the specified tab. If it's not
 * (or the context is invalidated), it dynamically injects shield.js and radar_v3.js.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function ensureContentScriptActive(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || !tab.url || 
            tab.url.startsWith('chrome://') || 
            tab.url.startsWith('chrome-extension://') || 
            tab.url.startsWith('about:') ||
            tab.url.startsWith('edge://') ||
            tab.url.includes('chromewebstore.google.com')) {
            console.log(`[CaptureOS] Tab ${tabId} is not eligible for script injection.`);
            return false;
        }
    } catch (e) {
        console.warn(`[CaptureOS] Could not get tab info for tab ${tabId}:`, e);
        return false;
    }

    try {
        const response = await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { action: 'ping' }, (res) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(res);
                }
            });
        });
        if (response && response.status === 'pong') {
            console.log(`[CaptureOS] Content script already active on tab ${tabId}`);
            return true;
        }
    } catch (err) {
        console.log(`[CaptureOS] Content script not responding on tab ${tabId}. Attempting dynamic injection...`);
    }

    // Try injecting shield.js and radar_v3.js dynamically (with allFrames: true, falling back if needed)
    const shieldOk = await injectScriptsIntoTab(tabId, ['content_scripts/shield.js'], true);
    const radarOk = await injectScriptsIntoTab(tabId, ['content_scripts/radar_v3.js'], true);
    
    if (shieldOk && radarOk) {
        console.log(`[CaptureOS] Dynamically injected content scripts successfully into tab ${tabId}`);
        // Small delay to allow the script to evaluate and set up listeners
        await new Promise(resolve => setTimeout(resolve, 150));
        return true;
    }
    return false;
}

// Ao inicializar o service worker, retoma o polling se estava processando
chrome.storage.local.get(['isProcessing', 'currentSessionId'], (res) => {
    if (res.isProcessing && res.currentSessionId) {
        console.log("[CaptureOS] Retomando polling após reinicialização do background:", res.currentSessionId);
        startPolling(res.currentSessionId);
    }
});
