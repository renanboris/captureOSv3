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
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        return;
    }
    recordedChunks = [];
    
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            audio: false,
            video: {
                displaySurface: "browser"
            }
        });

        // Conecta o stream no video invisível para podermos extrair os frames
        videoElement.srcObject = stream;

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            // Converte Blob para DataURL para passar para o Background (ou enviar direto daqui via fetch)
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = function() {
                const base64data = reader.result;
                chrome.runtime.sendMessage({
                    target: 'background',
                    action: 'recording_ready',
                    data: base64data
                });
            }
            // Stop tracks
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        console.log("Offscreen: Gravação WebM iniciada com sucesso.");
        
        // Avisa o background que tudo funcionou e que ele pode iniciar o relógio e widget
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
