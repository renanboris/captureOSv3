// offscreen.js
let mediaRecorder = null;
let recordedChunks = [];
let videoElement = document.createElement('video');
videoElement.autoplay = true;
let canvasElement = document.createElement('canvas');

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.target === 'offscreen') {
        if (message.action === 'start_recording') {
            await startRecording();
            sendResponse({ status: 'started' });
        } else if (message.action === 'stop_recording') {
            stopRecording();
            sendResponse({ status: 'stopped' });
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

async function startRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') return;
    recordedChunks = [];

    // Verificar se modo microfone está ativo
    const { useMic } = await chrome.storage.local.get(['useMic']);

    try {
        // Stream de tela (sempre)
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            audio: false,
            video: { displaySurface: "browser" }
        });

        videoElement.srcObject = displayStream;

        let micStream = null;
        let micRecorder = null;
        let micChunks = [];

        // Stream de microfone (somente Modo B)
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

        mediaRecorder = new MediaRecorder(displayStream, { mimeType: 'video/webm' });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordedChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            // Parar microfone se ativo
            if (micRecorder && micRecorder.state === 'recording') {
                micRecorder.stop();
            }
            if (micStream) micStream.getTracks().forEach(t => t.stop());

            const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
            const videoReader = new FileReader();
            videoReader.readAsDataURL(videoBlob);
            videoReader.onloadend = async () => {
                const videoBase64 = videoReader.result;

                // Aguardar o micRecorder terminar se necessário
                let micBase64 = "";
                if (micChunks.length > 0) {
                    const micBlob = new Blob(micChunks, { type: 'audio/webm' });
                    micBase64 = await new Promise((resolve) => {
                        const r = new FileReader();
                        r.readAsDataURL(micBlob);
                        r.onloadend = () => resolve(r.result);
                    });
                }

                chrome.runtime.sendMessage({
                    target: 'background',
                    action: 'recording_ready',
                    data: videoBase64,
                    micAudioBase64: micBase64  // NOVO: áudio do microfone
                });
            };
            displayStream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        console.log("Offscreen: Gravação WebM iniciada com sucesso.");
        chrome.runtime.sendMessage({ target: 'background', action: 'recording_started_successfully' });

    } catch (err) {
        console.error("Offscreen: Erro ao iniciar getUserMedia", err);
    }
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
