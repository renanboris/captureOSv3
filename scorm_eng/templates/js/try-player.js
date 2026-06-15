let state = {
    modulo: null,
    passoAtual: 0,
    xpTotal: 0,
    tentativasNoPasso: 0,
    sequenciaPerfeita: true,
    historico: []
};

const XP_RULES = {
    ACERTO_PRIMEIRA: 10,
    ACERTO_SEGUNDA: 6,
    ACERTO_COM_DICA: 3,
    BONUS_SEQUENCIA_PERFEITA: 20
};

// Se for rodar standalone via frontend/scorm-player/index.html?modulo=...
const urlParams = new URLSearchParams(window.location.search);
window.moduloId = urlParams.get('modulo') || 'default';

async function iniciarPlayer() {
    ScormAPI.init();
    
    try {
        let dados;
        if (ScormAPI.isLMS || !window.moduloId || window.moduloId === 'default') {
            // SCORM real, carrega do arquivo steps.js que foi incluído no index.html
            if (typeof STEPS_DATA === 'undefined') throw new Error('Dados STEPS_DATA não encontrados. Verifique se data/steps.js foi carregado.');
            dados = STEPS_DATA;
        } else {
            // Standalone (Simlink do SCORM) buscando da API
            const res = await fetch(`/api/v1/simlink/${window.moduloId}`);
            if(!res.ok) throw new Error('Módulo não encontrado');
            dados = await res.json();
            
            // Adapt API format to steps format (or simply handle it in render)
            // No backend builder, the steps.json has a similar structure,
            // let's assume it's the exact same modulo object
        }
        
        state.modulo = dados;
        
        // Atualiza moduloId usando session_id do pacote SCORM se ainda estiver como 'default'
        if (window.moduloId === 'default' && dados.session_id) {
            window.moduloId = dados.session_id;
        }
        console.log(`[SCORM] Modo: ${ScormAPI.isLMS ? 'LMS' : 'Standalone'}, moduloId: ${window.moduloId}`);
        
        // Setup inicial HUD
        document.getElementById('passo-header').innerText = `Passo 1 de ${state.modulo.total_passos}`;
        document.getElementById('ancora-texto').innerText = state.modulo.titulo || "Prática Iniciada";
        
        // Restore state se houver
        const suspendData = ScormAPI.get("cmi.suspend_data");
        if (suspendData && suspendData !== "null") {
            try {
                const savedState = JSON.parse(suspendData);
                state.passoAtual = savedState.passoAtual || 0;
                state.xpTotal = savedState.xpTotal || 0;
                state.sequenciaPerfeita = savedState.sequenciaPerfeita !== false;
                state.historico = savedState.historico || [];
            } catch(e) {}
        }
        
        // Verifica se já passou
        const lessonStatus = ScormAPI.get("cmi.core.lesson_status");
        if (lessonStatus === "passed" || lessonStatus === "completed") {
            // Se já concluiu, podemos apenas renderizar a conclusão
            // ou deixar rever
        } else {
            ScormAPI.set("cmi.core.lesson_status", "incomplete");
            ScormAPI.save();
        }
        
        // Prepara a imagem de fundo inicial
        if (state.modulo && state.modulo.hotspots && state.modulo.hotspots.length > 0) {
            const firstHotspot = state.modulo.hotspots[state.passoAtual];
            document.getElementById('imagem-bg').src = getScreenshotUrl(firstHotspot);
        }

        // Aguarda clique no botão START para evitar bloqueio de autoplay de áudio pelo navegador
        const startScreen = document.getElementById('start-screen');
        const btnStart = document.getElementById('btn-start');
        
        btnStart.addEventListener('click', () => {
            startScreen.classList.add('hidden');
            renderizarPassoAtual();
        });
    } catch (e) {
        document.getElementById('ancora-texto').innerText = `Erro: ${e.message}`;
    }
}

function salvarProgresso() {
    const saveData = JSON.stringify({
        passoAtual: state.passoAtual,
        xpTotal: state.xpTotal,
        sequenciaPerfeita: state.sequenciaPerfeita,
        historico: state.historico
    });
    
    ScormAPI.set("cmi.suspend_data", saveData);
    ScormAPI.set("cmi.core.lesson_location", String(state.passoAtual));
    ScormAPI.set("cmi.core.score.raw", state.xpTotal);
    if (state.modulo && state.modulo.xp_max) {
        ScormAPI.set("cmi.core.score.max", state.modulo.xp_max);
    }
    ScormAPI.save();
}

function getScreenshotUrl(hotspot) {
    if (ScormAPI.isLMS) {
        // SCORM mode - usa caminho relativo dentro do pacote SCORM
        return `screenshots/${hotspot.screenshot_filename}`;
    } else {
        // Standalone mode - verifica se tem parâmetro 'modulo' na URL
        const urlModulo = urlParams.get('modulo');
        if (urlModulo && urlModulo !== 'default') {
            // Simlink mode - usa o backend path
            const pathParts = hotspot.screenshot_path.split('/');
            const fileName = pathParts[pathParts.length - 1];
            return `/screenshots/${state.modulo.session_id}/${fileName}`;
        } else {
            // SCORM standalone sem parâmetro - usa caminho relativo
            return `screenshots/${hotspot.screenshot_filename}`;
        }
    }
}

function renderizarPassoAtual() {
    if (state.passoAtual >= state.modulo.hotspots.length) {
        concluirModulo();
        return;
    }
    
    state.tentativasNoPasso = 0;
    const hotspot = state.modulo.hotspots[state.passoAtual];
    document.getElementById('passo-header').innerText = `Passo ${state.passoAtual + 1} de ${state.modulo.total_passos}`;
    document.getElementById('sandbox-xp').innerText = `${state.xpTotal} XP`;
    
    const imgEl = document.getElementById('imagem-bg');
    imgEl.src = getScreenshotUrl(hotspot);
    
    const ancoraTexto = document.getElementById('ancora-texto');
    
    // Mostra ancora ou a micro_narracao no HUD
    const textoApresentar = hotspot.ancora || hotspot.micro_narracao || "Interaja com a tela para avançar.";
    ancoraTexto.innerText = textoApresentar;
    
    limparHighlights();
    narrarInstrucao(hotspot);
}

document.getElementById('overlay-cliques').addEventListener('click', (e) => {
    const hotspot = state.modulo.hotspots[state.passoAtual];
    if (!hotspot) return;

    const imgEl = document.getElementById('imagem-bg');
    const rect = imgEl.getBoundingClientRect();

    const clickXPct = (e.clientX - rect.left) / rect.width;
    const clickYPct = (e.clientY - rect.top) / rect.height;

    const natW = imgEl.naturalWidth || 1920;
    const natH = imgEl.naturalHeight || 1080;
    const c = hotspot.coordinates;

    const TOL = 0.04;

    const acertou = (
        c && Object.keys(c).length > 0 &&
        clickXPct >= (c.x / natW - TOL) &&
        clickXPct <= ((c.x + c.w) / natW + TOL) &&
        clickYPct >= (c.y / natH - TOL) &&
        clickYPct <= ((c.y + c.h) / natH + TOL)
    );

    if (acertou) {
        onAcerto(hotspot);
    } else {
        onErro(hotspot);
    }
});

function onAcerto(hotspot) {
    const xpGanho = [XP_RULES.ACERTO_PRIMEIRA, XP_RULES.ACERTO_SEGUNDA, XP_RULES.ACERTO_COM_DICA][Math.min(state.tentativasNoPasso, 2)];
    state.xpTotal += xpGanho;
    state.historico.push({ passo: hotspot.passo_num, tentativas: state.tentativasNoPasso + 1, xp: xpGanho });
    
    mostrarHighlight('success', hotspot);
    // narrarFallback(hotspot.micro_narracao || "Muito bem!"); // REMOVIDO PARA EVITAR DUPLICIDADE COM A VOZ REAL
    
    salvarProgresso();
    
    setTimeout(() => {
        state.passoAtual++;
        renderizarPassoAtual();
    }, 1800);
}

function onErro(hotspot) {
    state.tentativasNoPasso++;
    state.sequenciaPerfeita = false;

    if (state.tentativasNoPasso === 1) {
        mostrarFeedback(`Dica: procure por "${hotspot.target_text}"`);
    } else if (state.tentativasNoPasso === 2) {
        mostrarHighlight('hint', hotspot);
        // narrarFallback("Está aqui. Vamos tentar!"); // REMOVIDO
    } else {
        mostrarHighlight('reveal', hotspot);
        // narrarFallback(hotspot.micro_narracao); // REMOVIDO
        setTimeout(() => {
            state.passoAtual++;
            renderizarPassoAtual();
        }, 2000);
    }
}

let currentAudio = null;

function narrarInstrucao(hotspot) {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    let audioUrl = null;
    if (hotspot && hotspot.audio_filename) {
        if (ScormAPI.isLMS) {
            // SCORM mode - usa caminho relativo dentro do pacote SCORM
            audioUrl = `audios/${hotspot.audio_filename}`;
        } else {
            // Standalone mode - verifica se tem parâmetro 'modulo' na URL
            const urlModulo = urlParams.get('modulo');
            if (urlModulo && urlModulo !== 'default') {
                // Simlink mode - usa o backend path
                const pathParts = hotspot.audio_path.split('/');
                const fileName = pathParts[pathParts.length - 1];
                audioUrl = `/audios/${state.modulo.session_id}/${fileName}`;
            } else {
                // SCORM standalone sem parâmetro - usa caminho relativo
                audioUrl = `audios/${hotspot.audio_filename}`;
            }
        }
    }

    const textoFallback = hotspot.ancora || "Próximo passo";

    if (audioUrl) {
        currentAudio = new Audio(audioUrl);
        currentAudio.play().catch(e => {
            console.warn("Audio play blocked by browser, falling back to TTS", e);
            narrarFallback(textoFallback);
        });
    } else {
        narrarFallback(textoFallback);
    }
}

function narrarFallback(texto) {
    if(!texto) return;
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(texto);
    msg.lang = 'pt-BR';
    window.speechSynthesis.speak(msg);
}

function mostrarFeedback(msg) {
    const fbox = document.getElementById('feedback-container');
    fbox.innerText = msg;
    fbox.classList.remove('hidden');
    setTimeout(() => fbox.classList.add('hidden'), 3000);
}

function mostrarHighlight(classeCSS, hotspot) {
    limparHighlights();
    if (!hotspot || !hotspot.coordinates || Object.keys(hotspot.coordinates).length === 0) return;

    const imgEl = document.getElementById('imagem-bg');
    const simulacaoEl = document.getElementById('simulacao-container');
    const rect = imgEl.getBoundingClientRect();

    const natW = imgEl.naturalWidth || 1920;
    const natH = imgEl.naturalHeight || 1080;
    const c = hotspot.coordinates;

    const scaleX = rect.width / natW;
    const scaleY = rect.height / natH;

    const box = document.createElement('div');
    box.className = `highlight-box ${classeCSS}`;
    box.style.position = 'absolute';
    box.style.left   = `${c.x * scaleX}px`;
    box.style.top    = `${c.y * scaleY}px`;
    box.style.width  = `${c.w * scaleX}px`;
    box.style.height = `${c.h * scaleY}px`;
    box.style.pointerEvents = 'none';
    box.style.zIndex = '15';
    box.style.transition = 'all 0.3s ease';

    if (classeCSS === 'reveal' && hotspot.target_text) {
        const label = document.createElement('div');
        label.style.cssText = `
            position: absolute; top: -24px; left: 0;
            background: rgba(231,76,60,0.9); color: white;
            font-size: 11px; padding: 2px 6px; border-radius: 4px;
            white-space: nowrap;
        `;
        label.textContent = hotspot.target_text;
        box.appendChild(label);
    }

    simulacaoEl.appendChild(box);

    if (classeCSS !== 'reveal') {
        setTimeout(() => box.remove(), 3000);
    }
}

function limparHighlights() {
    const simulacaoEl = document.getElementById('simulacao-container');
    simulacaoEl.querySelectorAll('.highlight-box').forEach(el => el.remove());
}

function concluirModulo() {
    if (state.sequenciaPerfeita) {
        state.xpTotal += XP_RULES.BONUS_SEQUENCIA_PERFEITA;
    }
    document.getElementById('sandbox-xp').innerText = `${state.xpTotal} XP`;
    document.getElementById('passo-header').innerText = `Concluído`;
    document.getElementById('ancora-texto').innerText = `Treinamento finalizado com sucesso!`;
    
    document.getElementById('simulacao-container').innerHTML = `
        <div style="padding: 50px; text-align: center; color: white; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center;">
            <h2 style="font-size: 2rem; color: #00AF9B;">Treinamento Concluído!</h2>
            <p style="font-size: 1.2rem;">Seu XP Final: ${state.xpTotal}</p>
        </div>
    `;
    
    salvarProgresso();
    
    const passed = state.xpTotal >= (state.modulo.xp_max * 0.6);
    ScormAPI.set("cmi.core.lesson_status", passed ? "passed" : "failed");
    ScormAPI.save();
    ScormAPI.quit();
    
    // Envia conclusão para o backend apenas em modo Simlink (com parâmetro modulo na URL)
    const urlModulo = urlParams.get('modulo');
    if (!ScormAPI.isLMS && urlModulo && urlModulo !== 'default') {
        fetch(`/api/v1/simlink/${urlModulo}/conclusao`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ xp: state.xpTotal, historico: state.historico, completado: true })
        });
    }
}

window.addEventListener('unload', () => {
    ScormAPI.quit();
});

// Ações dos botões do HUD
document.getElementById('btn-voltar-passo').addEventListener('click', () => {
    if (state.passoAtual > 0) {
        state.passoAtual--;
        renderizarPassoAtual();
    }
});

document.getElementById('btn-dica-pratica').addEventListener('click', () => {
    const hotspot = state.modulo.hotspots[state.passoAtual];
    if (hotspot) {
        mostrarHighlight('hint', hotspot);
    }
});

iniciarPlayer();
