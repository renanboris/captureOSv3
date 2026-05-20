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
    if (message.action === 'user_interaction' && isRecording) {
        // O usuário clicou/digitou. 
        // 1. Tira print screen no tempo exato
        chrome.tabs.captureVisibleTab(null, {format: 'jpeg', quality: 80}, (dataUrl) => {
            const timestamp = Date.now();
            eventsLog.push({
                timestamp: timestamp,
                type: message.type,
                eventData: message.data,
                screenshotData: dataUrl
            });
            console.log("Evento gravado", message.type);
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

    // Pega streamId da aba atual
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.desktopCapture.chooseDesktopMedia(['tab'], tabs[0], (streamId) => {
            if (streamId) {
                chrome.runtime.sendMessage({
                    target: 'offscreen',
                    action: 'start_recording',
                    streamId: streamId
                });
                console.log("Gravação Delegada ao Offscreen");
            }
        });
    });
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
