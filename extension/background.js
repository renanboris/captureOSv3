// background.js
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];
let eventsLog = [];
let videoBase64 = null;

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
        videoBase64 = message.data;
        finalizeUpload();
    }
    if (message.action === 'get_status') {
        sendResponse({ isRecording: isRecording });
        return true;
    }
    
    if (message.action === 'user_interaction' && isRecording) {
        // O usuário clicou/digitou. 
        // 1. Tira print screen no tempo exato extraindo o frame da stream de vídeo no Offscreen
        chrome.runtime.sendMessage({ target: 'offscreen', action: 'take_screenshot' }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn("Erro ao pedir frame pro offscreen", chrome.runtime.lastError);
                return;
            }
            if (response && response.dataUrl) {
                const timestamp = Date.now();
                eventsLog.push({
                    timestamp: timestamp,
                    type: message.type,
                    eventData: message.data,
                    screenshotData: response.dataUrl
                });
                console.log("Evento gravado", message.type);
            }
        });
    }
    
    if (message.action === 'start_recording') {
        startCapture();
    }
    
    if (message.action === 'stop_recording') {
        stopCapture();
    }
});

async function startCapture() {
    isRecording = true;
    recordedChunks = [];
    eventsLog = [];
    videoBase64 = null;
    
    // Configura offscreen
    await setupOffscreenDocument('offscreen.html');

    chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'start_recording'
    });
    console.log("Gravação Delegada ao Offscreen via getDisplayMedia nativo");
}

async function stopCapture() {
    isRecording = false;
    console.log("Parando gravação. Aguardando vídeo do Offscreen...");
    chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'stop_recording'
    });
    // finalizeUpload() será chamado quando o offscreen devolver o videoBase64.
}

function finalizeUpload() {
    console.log("Montando Payload Final...");
    const payload = {
        session_id: "sess_" + Date.now(),
        events: eventsLog,
        video_webm: videoBase64 // Aqui mandamos o WebM em Base64
    };
    
    fetch('http://localhost:8000/api/v1/capture/ingest', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    }).then(res => res.json())
      .then(data => console.log('Upload concluído', data))
      .catch(err => console.error('Erro no upload', err));
}
