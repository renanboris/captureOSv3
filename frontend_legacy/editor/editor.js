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
        roteiroAtual = Array.isArray(data.roteiro) ? data.roteiro.filter(p => {
            if (!p) return false;
            const ancora = (p.ancora || p.intencao_original || (p._simlink && p._simlink.target_text) || '').toLowerCase().replace(/\(vazio\)/g, '').trim();
            const micro = (p.micro_narracao || '').toLowerCase().replace(/\(vazio\)/g, '').trim();
            return ancora.length > 0 || micro.length > 0 || p.passo !== undefined;
        }) : [];
        const tituloInput = document.getElementById('treinamento-titulo');
        if (tituloInput) {
            tituloInput.value = data.titulo || ("Tutorial — Sessão " + sessionId.slice(-8));
        }
        if (roteiroAtual.length === 0) {
            document.getElementById('passos-container').innerHTML = '<p class="loading" style="color:#64748b;">Nenhum passo editável encontrado no roteiro.</p>';
        } else {
            renderizarPassos();
        }
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

        const textMain = passo.ancora || passo.intencao_original || (passo._simlink && passo._simlink.target_text) || '';
        const textoCompletoReal = `${textMain} ${passo.micro_narracao || ''}`.trim();
        const textoView = textoCompletoReal || '(vazio)';
        const simlink = passo._simlink || {};
        const hasCoords = simlink.coordinates || simlink.screenshot_path;
        const btnInspectHtml = hasCoords ? `
            <button class="btn-icon btn-inspect-target" onclick="abrirInspetorAlvo(${index})" title="Ver ponto do clique no alvo" style="font-size:11.5px; display:inline-flex; align-items:center; gap:4px; padding:4px 8px; border-radius:6px; background:#F1F5F9; border:1px solid #CBD5E1; color:#0F172A; cursor:pointer; font-weight:600; transition:all 0.2s;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00998F" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="#00998F"/></svg>
                Ver Alvo
            </button>
        ` : '';

        item.innerHTML = `
            <div class="transcript-time" title="Tempo da gravação">${tempoReal}</div>
            <div class="transcript-content">
                <div class="editable-text-container" onclick="iniciarEdicao(this, 'texto-${index}')">
                    <p class="editable-text" id="texto-view-${index}">${textoView}</p>
                    <textarea id="texto-${index}" style="display:none;" placeholder="Digite o texto deste passo..." onblur="finalizarEdicao(this, 'texto-view-${index}')">${textoCompletoReal}</textarea>
                </div>
                <div class="actions" style="display:flex; align-items:center; gap:8px;">
                    ${btnInspectHtml}
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

window.abrirInspetorAlvo = function(index) {
    const passo = roteiroAtual[index];
    if (!passo) return;
    const modal = document.getElementById('target-inspector-modal');
    const img = document.getElementById('target-inspector-img');
    const box = document.getElementById('target-inspector-box');
    const title = document.getElementById('target-inspector-title');

    const passoNum = passo.passo || (index + 1);
    const token = sessionStorage.getItem('captureOsAuthToken') || urlToken || '';
    const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : '';
    const imgUrl = `/screenshots/${sessionId}/passo_${passoNum}.png${tokenSuffix}`;

    img.onload = () => {
        const simlink = passo._simlink || {};
        const coords = simlink.coordinates || {};
        const geom = simlink.target_geometry || coords;

        if (geom && (geom.w || geom.width)) {
            const nw = img.naturalWidth || 1920;
            const nh = img.naturalHeight || 1080;
            const cw = img.clientWidth || img.width;
            const ch = img.clientHeight || img.height;

            const rx = cw / nw;
            const ry = ch / nh;

            const gx = geom.x !== undefined ? geom.x : geom.left;
            const gy = geom.y !== undefined ? geom.y : geom.top;
            const gw = geom.w !== undefined ? geom.w : geom.width;
            const gh = geom.h !== undefined ? geom.h : geom.height;

            box.style.left = `${gx * rx}px`;
            box.style.top = `${gy * ry}px`;
            box.style.width = `${gw * rx}px`;
            box.style.height = `${gh * ry}px`;
            box.style.display = 'block';
        } else {
            box.style.display = 'none';
        }
    };

    img.src = imgUrl;
    title.textContent = `Passo ${passoNum}: ${passo.ancora || passo.intencao_original || 'Alvo Clicado'}`;
    modal.style.display = 'flex';
};

document.getElementById('btn-close-target-inspector')?.addEventListener('click', () => {
    document.getElementById('target-inspector-modal').style.display = 'none';
});

const btnTraduzir = document.getElementById('btn-traduzir');
if (btnTraduzir) {
    btnTraduzir.addEventListener('click', async () => {
        const langVal = document.getElementById('idioma-selector')?.value || 'es-ES';
        const origHtml = btnTraduzir.innerHTML;
        btnTraduzir.disabled = true;
        btnTraduzir.innerHTML = '⏳ Traduzindo...';
        try {
            const res = await authFetch(`/api/v1/session/${sessionId}/traduzir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_lang: langVal })
            });
            if (!res.ok) throw new Error('Falha na tradução');
            const data = await res.json();
            if (data.titulo) {
                const tituloInput = document.getElementById('treinamento-titulo');
                if (tituloInput) tituloInput.value = data.titulo;
            }
            if (data.roteiro) {
                roteiroAtual = data.roteiro;
                renderizarPassos();
            }
            btnTraduzir.innerHTML = '✅ Traduzido!';
            setTimeout(() => { btnTraduzir.innerHTML = origHtml; btnTraduzir.disabled = false; }, 2000);
        } catch(e) {
            alert('Erro na tradução IA: ' + e.message);
            btnTraduzir.innerHTML = origHtml;
            btnTraduzir.disabled = false;
        }
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
        
        currentAudio = new Audio(data.audio_url);
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
    const idiomaVal = document.getElementById("idioma-selector")?.value || "pt-BR";
    const titulo = document.getElementById('treinamento-titulo')?.value.trim() || undefined;

    const payload = {
        roteiro: roteiroAtual,
        titulo: titulo,
        modo_input: "A",   // "C" estava incorreto — o editor edita roteiros de Modo A/B
        aprovado: true,
        usar_overlay: usarOverlay,
        voice_id: vozId,
        idioma: idiomaVal
    };

    const btn = document.getElementById('btn-render');
    btn.disabled = true;
    btn.innerText = 'Renderizando...';

    // Fecha o modal IMEDIATAMENTE (sem delay visual) e delega o progresso ao widget da extensão
    const isEmbedded = new URLSearchParams(window.location.search).get('embedded') === 'true';
    if (isEmbedded) {
        window.parent.postMessage({ action: "close_editor_modal_and_resume", session_id: sessionId }, "*");
    }

    try {
        await authFetch(`/api/v1/session/${sessionId}/roteiro`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.warn('Post ao backend iniciado', e);
    }
});
