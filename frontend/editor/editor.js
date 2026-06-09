const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session');
// Token passed in URL by the extension (avoids postMessage timing issues).
// Stored in sessionStorage so it survives SPA navigation within the iframe.
const urlToken = urlParams.get('token');
if (urlToken) sessionStorage.setItem('captureOsAuthToken', urlToken);

console.log('[CaptureOS Editor] BUILD 2024-token-v2 | session=', sessionId,
            '| urlToken?', !!urlToken,
            '| sessionStorageToken?', !!sessionStorage.getItem('captureOsAuthToken'));

let roteiroAtual = [];

// ---------------------------------------------------------------------------
// Auth: o editor roda como iframe/página injetada pela extensão.
// O token é armazenado em chrome.storage.local (chave 'authToken').
// Lemos via postMessage para o content script, que tem acesso ao storage.
// Fallback: lê do sessionStorage (para dev sem extensão).
// ---------------------------------------------------------------------------
let _cachedToken = null;

async function getAuthToken() {
    if (_cachedToken) return _cachedToken;
    // Tenta ler do sessionStorage primeiro (dev sem extensão)
    const stored = sessionStorage.getItem('captureOsAuthToken');
    if (stored) { _cachedToken = stored; return stored; }
    // Tenta ler via extensão (postMessage)
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 500);
        const handler = (e) => {
            if (e.data && e.data.type === 'captureOs_authToken') {
                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                _cachedToken = e.data.token || null;
                resolve(_cachedToken);
            }
        };
        window.addEventListener('message', handler);
        window.parent.postMessage({ action: 'get_auth_token' }, '*');
    });
}

async function authFetch(url, options = {}) {
    const token = await getAuthToken();
    console.log('[CaptureOS Editor] authFetch', url, '| token presente?', !!token);
    const headers = { ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, { ...options, headers });
}

// ---------------------------------------------------------------------------

if (!sessionId) {
    document.getElementById('passos-container').innerHTML = '<p class="loading">ID da sessão não fornecido.</p>';
} else {
    carregarRoteiro();
}

async function carregarRoteiro() {
    try {
        const response = await authFetch(`/api/v1/session/${sessionId}/roteiro`);
        if (!response.ok) throw new Error('Falha ao buscar roteiro');
        const data = await response.json();
        roteiroAtual = data.roteiro;
        renderizarPassos();
    } catch (e) {
        document.getElementById('passos-container').innerHTML = `<p class="loading">Erro: ${e.message}</p>`;
    }
}

function renderizarPassos() {
    const container = document.getElementById('passos-container');
    container.innerHTML = '';
    
    roteiroAtual.forEach((passo, index) => {
        const item = document.createElement('div');
        item.className = 'transcript-item';
        
        const tempoFicticio = `00:0${index+1}`;
        const textoCompleto = `${passo.ancora || ''} ${passo.micro_narracao || ''}`.trim() || '(vazio)';

        item.innerHTML = `
            <div class="transcript-time">${tempoFicticio}</div>
            <div class="transcript-content">
                <div class="editable-text-container" onclick="iniciarEdicao(this, 'texto-${index}')">
                    <p class="editable-text" id="texto-view-${index}">${textoCompleto}</p>
                    <textarea id="texto-${index}" style="display:none;" onblur="finalizarEdicao(this, 'texto-view-${index}')">${textoCompleto}</textarea>
                </div>
                <div class="actions">
                    <button class="btn-icon" onclick="previewTTS(${index}, this)" title="Ouvir com a voz real (Francisca)">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                    </button>
                    <button class="btn-icon" id="btn-regerar-${index}" onclick="regerarPassoIA(${index}, ${passo.passo})" title="Regerar frase com IA">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    </button>
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

function iniciarEdicao(container, textareaId) {
    const textEl = container.querySelector('.editable-text');
    const ta = document.getElementById(textareaId);
    if(ta.style.display === 'block') return;
    
    textEl.style.display = 'none';
    ta.style.display = 'block';
    ta.focus();
    
    ta.style.height = "auto";
    ta.style.height = (ta.scrollHeight) + "px";
}

window.finalizarEdicao = function(ta, textId) {
    const textEl = document.getElementById(textId);
    textEl.innerText = ta.value.trim() || '(vazio)';
    ta.style.display = 'none';
    textEl.style.display = 'block';
};

let currentAudio = null;

async function previewTTS(index, btnElement) {
    const texto = document.getElementById(`texto-${index}`).value.trim();
    if (!texto) return;
    
    const originalHtml = btnElement.innerHTML;
    btnElement.innerHTML = `<span style="font-size:12px; margin-right:4px;">Carregando...</span>`;
    btnElement.disabled = true;

    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    try {
        const response = await authFetch('/api/v1/tts/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texto })
        });
        
        if (!response.ok) throw new Error("Erro no TTS");
        const data = await response.json();
        
        currentAudio = new Audio(data.audio_url);
        currentAudio.play();
    } catch(e) {
        alert("Falha ao gerar preview da Francisca: " + e.message);
    } finally {
        btnElement.innerHTML = originalHtml;
        btnElement.disabled = false;
    }
}

async function regerarPassoIA(indexArray, passoNum) {
    const btn = document.getElementById(`btn-regerar-${indexArray}`);
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span style="font-size:12px;">⏳</span>`;

    try {
        const res = await authFetch(`/api/v1/session/${sessionId}/passo/${passoNum}/regerar`, {
            method: 'POST'
        });
        
        if (!res.ok) throw new Error('Falha ao regerar o passo.');
        
        const data = await res.json();
        const passoAtualizado = data.passo;
        const textoUnificado = `${passoAtualizado.ancora || ''} ${passoAtualizado.micro_narracao || ''}`.trim();
        
        document.getElementById(`texto-${indexArray}`).value = textoUnificado;
        document.getElementById(`texto-view-${indexArray}`).innerText = textoUnificado || '(vazio)';
        
        roteiroAtual[indexArray].ancora = passoAtualizado.ancora;
        roteiroAtual[indexArray].micro_narracao = passoAtualizado.micro_narracao;
        
        btn.innerHTML = `<span style="font-size:12px;">✅</span>`;
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }, 2000);
    } catch (e) {
        alert(e.message);
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}

document.getElementById('btn-cancel').addEventListener('click', () => {
    const isEmbedded = new URLSearchParams(window.location.search).get('embedded') === 'true';
    if (isEmbedded) {
        window.parent.postMessage({ action: "cancel_editor_modal" }, "*");
    } else {
        window.close();
    }
});

document.getElementById('btn-render').addEventListener('click', async () => {
    roteiroAtual.forEach((passo, index) => {
        const textoUnificado = document.getElementById(`texto-${index}`).value.trim();
        passo.ancora = "";
        passo.micro_narracao = textoUnificado;
    });

    const usarOverlay = document.getElementById('toggle-overlay')?.checked ?? true;

    const payload = {
        roteiro: roteiroAtual,
        modo_input: "A",   // "C" estava incorreto — o editor edita roteiros de Modo A/B
        aprovado: true,
        usar_overlay: usarOverlay
    };

    const btn = document.getElementById('btn-render');
    btn.disabled = true;
    btn.innerText = 'Renderizando...';

    try {
        const res = await authFetch(`/api/v1/session/${sessionId}/roteiro`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            const isEmbedded = new URLSearchParams(window.location.search).get('embedded') === 'true';
            if (isEmbedded) {
                window.parent.postMessage({ action: "close_editor_modal_and_resume", session_id: sessionId }, "*");
            } else {
                window.close();
            }
        } else {
            alert('Erro ao aprovar roteiro.');
            btn.disabled = false;
            btn.innerText = 'Finalizar e Gerar Vídeo';
        }
    } catch (e) {
        alert('Falha na comunicação com o servidor.');
        btn.disabled = false;
        btn.innerText = 'Finalizar e Gerar Vídeo';
    }
});
