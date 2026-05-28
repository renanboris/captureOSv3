// background.js

const BACKEND_URL = "http://localhost:8000"; // Substituir no build de produção

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
        reasons: ['USER_MEDIA'],
        justification: 'Gravação contínua da aba de navegação'
    });
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install' || details.reason === 'update') {
        chrome.storage.local.set({ needsOnboarding: true });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'background' && message.action === 'recording_ready') {
        const videoBase64 = message.data;
        
        // Garante que desligamos o ícone piscante mesmo se ele parou pelo botão nativo do Chrome
        chrome.storage.local.set({ isRecording: false });
        setStaticIcon();
        
        chrome.storage.local.get(['recordingStartTime', 'eventsLog'], (res) => {
            finalizeUpload(videoBase64, res.recordingStartTime || 0, res.eventsLog || []);
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
    
    if (message.target === 'background' && message.action === 'recording_started_successfully') {
        const startTime = Date.now();
        chrome.storage.local.set({
            isRecording: true,
            recordingStartTime: startTime,
            eventsLog: []
        });
        
        // Inicia o ponto vermelho pulsante nativo no ícone da extensão
        startBlinkingBadge();
        
        // MOSTRA O COUNTDOWN!
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if(tabs[0]) chrome.tabs.sendMessage(tabs[0].id, {action: 'show_countdown'}).catch(() => {});
        });
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
            console.log("Processamento abortado pelo usuário.");
        }
    }
});

async function startCapture() {
    chrome.storage.local.set({ eventsLog: [], recordingStartTime: 0, isRecording: false });
    
    // Configura offscreen
    await setupOffscreenDocument('offscreen.html');

    // Gravação delegada ao Picker nativo
    chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'start_recording'
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

function finalizeUpload(videoBase64, recordingStartTime, eventsLog) {
    console.log("Montando Payload Final...");
    const payload = {
        session_id: "sess_" + Date.now(),
        recording_start_time: recordingStartTime,
        events: eventsLog,
        video_webm: videoBase64 // Aqui mandamos o WebM em Base64
    };
    
    // Avisa a aba ativa que o upload começou
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if(tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {action: "show_toast", type: "processing"}).catch(()=>{});
        }
    });
    
    fetch(`${BACKEND_URL}/api/v1/capture/ingest`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    }).then(res => res.json())
      .then(data => {
          console.log('Upload recebido pelo servidor, aguardando pipeline background...', data);
          
          // Inicia o Relógio (Polling) para aguardar a renderização do Vídeo e atualizar Status
          if(data.session_id) {
              if (activePollInterval) clearInterval(activePollInterval);
              activePollInterval = setInterval(() => {
                  fetch(`${BACKEND_URL}/api/v1/capture/status/${data.session_id}`)
                      .then(r => r.json())
                      .then(status => {
                          if(status.status === "processing") {
                              // Atualiza o texto do Toast com a mensagem do backend
                              if(status.message) {
                                  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                                      if(tabs[0]) {
                                          chrome.tabs.sendMessage(tabs[0].id, {action: "update_toast", msg: status.message}).catch(()=>{});
                                      }
                                  });
                              }
                          } else if(status.status === "roteiro_pronto") {
                              clearInterval(activePollInterval);
                              activePollInterval = null;
                              console.log("Roteiro pronto! Abrindo editor...");
                              chrome.tabs.create({ url: `${BACKEND_URL}/editor?session=${data.session_id}` });
                          } else if(status.status === "completed") {
                              clearInterval(activePollInterval);
                              activePollInterval = null;
                              console.log("Vídeo finalizado! Abrindo player modal...");
                              chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                                  if(tabs[0]) {
                                      // Dispara o Modal Shadow DOM na página atual
                                      chrome.tabs.sendMessage(tabs[0].id, {
                                          action: "show_player_modal",
                                          url: status.url,
                                          roteiro: status.roteiro || []
                                      }).catch(()=>{});
                                  }
                              });
                          }
                      })
                      .catch(e => console.error("Erro no polling", e));
              }, 3000); // Pinga a cada 3 segundos
          }
      })
      .catch(err => {
          console.error('Erro no upload', err);
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
              if(tabs[0]) {
                  chrome.tabs.sendMessage(tabs[0].id, {action: "show_toast", type: "error"}).catch(()=>{});
              }
          });
      });
}
