// offscreen.js
let mediaRecorder = null;
let recordedChunks = [];
let videoElement = document.createElement('video');
videoElement.autoplay = true;
let canvasElement = document.createElement('canvas');

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.target === 'offscreen') {
        if (message.action === 'start_recording') {
            await startRecording(message.useMic, message.streamId, message.systemAudio);
            sendResponse({ status: 'started' });
        } else if (message.action === 'stop_recording') {
            stopRecording();
            sendResponse({ status: 'stopped' });
        } else if (message.action === 'start_recording_now') {
            if (mediaRecorder && mediaRecorder.state !== 'recording') {
                mediaRecorder.start();
                console.log("Offscreen: Gravação WebM iniciada com sucesso.");
            }
            sendResponse({ status: 'started_now' });
        } else if (message.action === 'abort_recording') {
            abortRecording();
            sendResponse({ status: 'aborted' });
        } else if (message.action === 'take_screenshot') {
            if (videoElement.videoWidth > 0) {
                canvasElement.width = videoElement.videoWidth;
                canvasElement.height = videoElement.videoHeight;
                const ctx = canvasElement.getContext('2d');
                ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
                const dataUrl = canvasElement.toDataURL('image/jpeg', 0.8);
                sendResponse({ dataUrl: dataUrl });
            } else {
                sendResponse({ dataUrl: null });
            }
        }
    }
    return true; // Keep message channel open for async response
});

async function startRecording(useMic, streamId = null, systemAudio = false) {
    if (mediaRecorder && mediaRecorder.state === 'recording') return;
    recordedChunks = [];

    try {
        // Captura direta via getDisplayMedia nativo no Offscreen (evita erros de origem e expiração do chooseDesktopMedia)
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            audio: systemAudio,
            video: {
                displaySurface: "browser",
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            }
        });

        videoElement.srcObject = displayStream;

        let micRecorder = null;
        let micChunks = [];
        let micStream = null;

        if (useMic) {
            try {
                micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                micRecorder = new MediaRecorder(micStream, { mimeType: 'audio/webm' });
                micRecorder.ondataavailable = (ev) => {
                    if (ev.data.size > 0) micChunks.push(ev.data);
                };
                micRecorder.start();
                console.log("Offscreen: Microfone capturado para Modo B.");
            } catch (micErr) {
                console.warn("Offscreen: Permissão de microfone negada, continuando sem áudio.", micErr);
            }
        }

        let options = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8000000 };
        if (typeof MediaRecorder.isTypeSupported === 'function' && !MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { mimeType: 'video/webm', videoBitsPerSecond: 8000000 };
        }
        
        try {
            mediaRecorder = new MediaRecorder(displayStream, options);
        } catch (recErr) {
            console.warn("Offscreen: Falha ao instanciar MediaRecorder com opções. Usando padrão...", recErr);
            mediaRecorder = new MediaRecorder(displayStream);
        }

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordedChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            // Converter vídeo para base64
            const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
            const videoBase64 = await blobToBase64(videoBlob);

            // Aguardar o micRecorder terminar corretamente antes de processar o áudio
            let micBase64 = "";
            if (micRecorder && micRecorder.state !== 'inactive') {
                micBase64 = await new Promise((resolve) => {
                    micRecorder.onstop = async () => {
                        if (micChunks.length > 0) {
                            const micBlob = new Blob(micChunks, { type: 'audio/webm' });
                            resolve(await blobToBase64(micBlob));
                        } else {
                            resolve("");
                        }
                        if (micStream) micStream.getTracks().forEach(t => t.stop());
                    };
                    micRecorder.stop(); // ← parar AQUI, dentro da Promise
                });
            } else if (micStream) {
                micStream.getTracks().forEach(t => t.stop());
            }

            chrome.runtime.sendMessage({
                target: 'background',
                action: 'recording_ready',
                data: videoBase64,
                micAudioBase64: micBase64
            });

            displayStream.getTracks().forEach(t => t.stop());
        };

        console.log("Offscreen: Stream capturado. Aguardando countdown...");
        chrome.runtime.sendMessage({ target: 'background', action: 'stream_ready' });

    } catch (err) {
        console.error("Offscreen: Erro ao iniciar gravação", err);
        console.error("Detalhes do Erro - Nome:", err?.name);
        console.error("Detalhes do Erro - Mensagem:", err?.message);
        console.error("Detalhes do Erro - Stack:", err?.stack);
    }
}

// Helper — converter Blob para base64 DataURL
function blobToBase64(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => resolve(reader.result);
    });
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        console.log("Offscreen: Gravação WebM parada.");
    }
}

function abortRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        // Remove the onstop listener so it doesn't send the payload to background
        mediaRecorder.onstop = () => {
            const stream = videoElement.srcObject;
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            console.log("Offscreen: Gravação descartada com sucesso.");
        };
        mediaRecorder.stop();
    }
}
