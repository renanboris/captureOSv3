// background.js

async function setupOffscreenDocument(path) {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
        url: path,
        reasons: ['USER_MEDIA'],
        justification: 'Gravação contínua da aba de navegação'
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'background' && message.action === 'recording_ready') {
        const videoBase64 = message.data;
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
                // Tira print screen no tempo exato extraindo o frame da stream de vídeo no Offscreen
                chrome.runtime.sendMessage({ target: 'offscreen', action: 'take_screenshot' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Erro ao pedir frame pro offscreen", chrome.runtime.lastError);
                        return;
                    }
                    if (response && response.dataUrl) {
                        const timestamp = Date.now();
                        let logs = res.eventsLog || [];
                        logs.push({
                            timestamp: timestamp,
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
        
        // Define o Badge vermelho piscando de REC no ícone da extensão no topo do Chrome
        chrome.action.setBadgeText({ text: "REC" });
        chrome.action.setBadgeBackgroundColor({ color: "#FF3B30" });
    }
    
    if (message.action === 'stop_recording') {
        stopCapture();
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
    chrome.action.setBadgeText({ text: "" }); // Limpa o Badge
    console.log("Parando gravação. Aguardando vídeo do Offscreen...");
    chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'stop_recording'
    });
    // finalizeUpload() será chamado quando o offscreen devolver o videoBase64.
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
    
    fetch('http://localhost:8000/api/v1/capture/ingest', {
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
              let pollInterval = setInterval(() => {
                  fetch(`http://localhost:8000/api/v1/capture/status/${data.session_id}`)
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
                          } else if(status.status === "completed") {
                              clearInterval(pollInterval);
                              console.log("Vídeo finalizado! Abrindo player...");
                              chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                                  if(tabs[0]) {
                                      chrome.tabs.sendMessage(tabs[0].id, {action: "show_toast", type: "success"}).catch(()=>{});
                                  }
                              });
                              chrome.tabs.create({ url: status.url });
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
