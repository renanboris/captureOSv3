document.addEventListener('DOMContentLoaded', () => {
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');

    // Recupera o estado real ao abrir o popup
    chrome.runtime.sendMessage({action: 'get_status'}, (response) => {
        if (response && response.isRecording) {
            btnStart.style.display = 'none';
            btnStop.style.display = 'block';
        }
    });

    btnStart.addEventListener('click', () => {
        chrome.runtime.sendMessage({action: 'start_recording'});
        btnStart.style.display = 'none';
        btnStop.style.display = 'block';
    });

    btnStop.addEventListener('click', () => {
        chrome.runtime.sendMessage({action: 'stop_recording'});
        btnStop.style.display = 'none';
        btnStart.style.display = 'block';
        btnStart.innerText = "Enviado! Gravar Novamente";
    });
});
