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
        roteiroAtual = data.roteiro.filter(p => {
            const ancora = (p.ancora || '').toLowerCase().replace(/\(vazio\)/g, '').trim();
            const micro = (p.micro_narracao || '').toLowerCase().replace(/\(vazio\)/g, '').trim();
            return ancora.length > 0 || micro.length > 0;
        });
        const tituloInput = document.getElementById('treinamento-titulo');
        if (tituloInput) {
            tituloInput.value = data.titulo || ("Tutorial — Sessão " + sessionId.slice(-8));
        }
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
        let relativeSec = 0;
        const firstTs = roteiroAtual[0] && (roteiroAtual[0].timestamp || roteiroAtual[0]._timestamp);
        const thisTs = passo.timestamp || passo._timestamp;
        if (firstTs && thisTs && thisTs >= firstTs) {
            relativeSec = Math.floor((thisTs - firstTs) / 1000);
        } else {
            relativeSec = index * 5;
        }
        const mm = String(Math.floor(relativeSec / 60)).padStart(2, '0');
        const ss = String(relativeSec % 60).padStart(2, '0');
        const tempoReal = `${mm}:${ss}`;

        const textoCompletoReal = `${passo.ancora || ''} ${passo.micro_narracao || ''}`.trim();
        const textoView = textoCompletoReal || '(vazio)';

        const isLowConfidence = (passo._simlink && passo._simlink.confianca_captura === 'baixa') || false;
        const lowConfidenceBadge = isLowConfidence 
            ? `<span class="badge-warning" style="background:#FFFBEB; color:#B45309; border:1px solid #FCD34D; font-size:11px; padding:2px 8px; border-radius:12px; font-weight:600; margin-left:8px;">⚠️ Seletor Frágil</span>`
            : '';
        const recapturarBtn = `<button class="btn-recapturar" onclick="recapturarPasso(${index})" style="background:#00998F; color:white; border:none; padding:4px 8px; border-radius:6px; font-size:11px; cursor:pointer; font-weight:500; display:inline-flex; align-items:center; gap:4px; margin-left:8px;" title="Recapturar seletor deste passo na tela">🎯 Recapturar este passo</button>`;

        item.innerHTML = `
            <div class="transcript-time" title="Tempo da gravação">${tempoReal}</div>
            <div class="transcript-content">
                <div class="editable-text-container" onclick="iniciarEdicao(this, 'texto-${index}')">
                    <p class="editable-text" id="texto-view-${index}">${textoView} ${lowConfidenceBadge}</p>
                    <textarea id="texto-${index}" style="display:none;" placeholder="Digite o texto deste passo..." onblur="finalizarEdicao(this, 'texto-view-${index}')">${textoCompletoReal}</textarea>
                </div>
                <div class="actions" style="display:flex; align-items:center; gap:8px;">
                    ${recapturarBtn}
                    <button class="btn-icon" onclick="previewTTS(${index}, this)" title="Ouvir com a voz real">
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

window.recapturarPasso = function(index) {
    if (window.parent) {
        window.parent.postMessage({
            action: "recapturar_passo",
            session_id: sessionId,
            passo_index: index,
            passo_num: roteiroAtual[index].passo
        }, "*");
    }
};

window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "passo_recapturado") {
        const idx = e.data.passo_index;
        const newData = e.data.new_data;
        if (roteiroAtual[idx] && newData) {
            if (!roteiroAtual[idx]._simlink) roteiroAtual[idx]._simlink = {};
            roteiroAtual[idx]._simlink.selector = newData.css_selector || roteiroAtual[idx]._simlink.selector;
            roteiroAtual[idx]._simlink.xpath = newData.xpath || roteiroAtual[idx]._simlink.xpath;
            roteiroAtual[idx]._simlink.target_text = newData.target_text || roteiroAtual[idx]._simlink.target_text;
            roteiroAtual[idx]._simlink.confianca_captura = "alta";
            roteiroAtual[idx]._simlink.hitl_corrigido = true;
            renderizarPassos();
            alert(`Passo ${idx + 1} recapturado com sucesso!`);
        }
    }
});

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
    
    const vozId = document.getElementById("voice-selector")?.value || "Portuguese_Casual_Speaker_v1";

    if (currentAudio) {
        // Se clicar no mesmo botao que já está tocando e nao acabou
        if (currentAudio._btnRef === btnElement && !currentAudio.paused) {
            currentAudio.pause();
            btnElement.innerHTML = currentAudio._originalHtml;
            btnElement.disabled = false;
            return;
        }
        // Senao, pausa o anterior e reseta o botao antigo
        currentAudio.pause();
        if (currentAudio._btnRef) {
            currentAudio._btnRef.innerHTML = currentAudio._originalHtml;
            currentAudio._btnRef.disabled = false;
        }
        currentAudio = null;
    }
    
    const originalHtml = btnElement.innerHTML;
    btnElement.innerHTML = `<span style="font-size:12px; margin-right:4px;">Carregando...</span>`;
    btnElement.disabled = true;

    try {
        const response = await authFetch('/api/v1/tts/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texto, voice_id: vozId })
        });
        
        if (!response.ok) throw new Error("Erro no TTS");
        const data = await response.json();
        
        const token = await getAuthToken();
        let audioUrl = data.audio_url;
        if (token && !audioUrl.includes('token=')) {
            audioUrl += (audioUrl.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
        }

        currentAudio = new Audio(audioUrl);
        currentAudio._originalHtml = originalHtml;
        currentAudio._btnRef = btnElement;
        
        currentAudio.onended = () => {
            btnElement.innerHTML = originalHtml;
            btnElement.disabled = false;
            currentAudio = null;
        };

        currentAudio.play();
        btnElement.innerHTML = `<span style="font-size:12px; margin-right:4px;">Parar ⏹</span>`;
        btnElement.disabled = false;
    } catch(e) {
        alert("Falha ao gerar preview: " + e.message);
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
        const textoCompletoReal = `${passoAtualizado.ancora || ''} ${passoAtualizado.micro_narracao || ''}`.trim();
        
        document.getElementById(`texto-${indexArray}`).value = textoCompletoReal;
        document.getElementById(`texto-view-${indexArray}`).innerText = textoCompletoReal || '(vazio)';
        
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
        let textoUnificado = document.getElementById(`texto-${index}`).value.trim();
        if (textoUnificado === '(vazio)') textoUnificado = ''; // Prevenção extra
        passo.ancora = "";
        passo.micro_narracao = textoUnificado;
    });

    const usarOverlay = document.getElementById('toggle-overlay')?.checked ?? true;
    const vozId = document.getElementById("voice-selector")?.value || "Portuguese_Casual_Speaker_v1";
    const titulo = document.getElementById('treinamento-titulo')?.value.trim() || undefined;

    const payload = {
        roteiro: roteiroAtual,
        titulo: titulo,
        modo_input: "A",   // "C" estava incorreto — o editor edita roteiros de Modo A/B
        aprovado: true,
        usar_overlay: usarOverlay,
        voice_id: vozId
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

