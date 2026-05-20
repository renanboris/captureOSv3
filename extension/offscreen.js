// offscreen.js
let mediaRecorder = null;
let recordedChunks = [];

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.target === 'offscreen') {
        if (message.action === 'start_recording') {
            await startRecording(message.streamId);
            sendResponse({ status: 'started' });
        } else if (message.action === 'stop_recording') {
            stopRecording();
            sendResponse({ status: 'stopped' });
        }
    }
});

async function startRecording(streamId) {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        return;
    }
    recordedChunks = [];
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: streamId
                }
            }
        });

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
