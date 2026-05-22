document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['finalVideoData'], (res) => {
        if(res.finalVideoData) {
            const data = res.finalVideoData;
            
            // Corrige possível redundância de localhost
            const videoUrl = data.url.startsWith("http") ? data.url : "http://localhost:8000" + data.url;
            
            document.getElementById('player').src = videoUrl;
            document.getElementById('btn-download').href = videoUrl;
            
            const sidebar = document.getElementById('sidebar');
            if(data.roteiro && data.roteiro.length > 0) {
                // Remove o title e cria a lista
                const listHtml = data.roteiro.map(step => `
                    <div class="step">
                        <div class="step-time">00:${String(Math.floor(step.time)).padStart(2, '0')}</div>
                        <h4 class="step-action">${step.action}</h4>
                        ${step.screenshot ? `<img class="step-img" src="${step.screenshot}" />` : ''}
                    </div>
                `).join('');
                
                sidebar.innerHTML += listHtml;
            } else {
                sidebar.innerHTML += `<p style="color:#64748b; font-size:14px;">Nenhum evento registrado.</p>`;
            }
        }
    });
});
