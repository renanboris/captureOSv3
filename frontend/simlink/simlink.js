const urlParams = new URLSearchParams(window.location.search);
const moduloId = urlParams.get('modulo');

const state = {
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

async function iniciarSimlink() {
    if (!moduloId) {
        document.getElementById('titulo-modulo').innerText = 'ID do Módulo não fornecido.';
        return;
    }
    try {
        const res = await fetch(`/api/v1/simlink/${moduloId}`);
        if(!res.ok) throw new Error('Módulo não encontrado');
        state.modulo = await res.json();
        
        document.getElementById('titulo-modulo').innerText = state.modulo.titulo;
        document.getElementById('total-passos').innerText = state.modulo.total_passos;
        
        renderizarPassoAtual();
    } catch (e) {
        document.getElementById('titulo-modulo').innerText = `Erro: ${e.message}`;
    }
}

function renderizarPassoAtual() {
    if (state.passoAtual >= state.modulo.hotspots.length) {
        concluirModulo();
        return;
    }
    
    state.tentativasNoPasso = 0;
    const hotspot = state.modulo.hotspots[state.passoAtual];
    
    document.getElementById('passo-atual').innerText = state.passoAtual + 1;
    document.getElementById('xp-total').innerText = state.xpTotal;
    
    const imgEl = document.getElementById('imagem-bg');
    // Para simplificar, assumimos que a imagem pode ser carregada por um endpoint de thumbnail ou original
    const pathParts = hotspot.screenshot_path.split('/');
    const fileName = pathParts[pathParts.length - 1];
    imgEl.src = `/screenshots/${state.modulo.session_id}/${fileName}`;
    
    const instrucaoBox = document.getElementById('instrucao-container');
    const ancoraTexto = document.getElementById('ancora-texto');
    
    if (hotspot.ancora) {
        instrucaoBox.classList.remove('hidden');
        ancoraTexto.innerText = hotspot.ancora;
    } else {
        instrucaoBox.classList.add('hidden');
    }
    
    limparHighlights();
    narrar(hotspot.ancora || "Próximo passo");
}

document.getElementById('overlay-cliques').addEventListener('click', (e) => {
    const hotspot = state.modulo.hotspots[state.passoAtual];
    if (!hotspot) return;

    const imgEl = document.getElementById('imagem-bg');
    const rect = imgEl.getBoundingClientRect();

    // Coordenadas do clique como percentual da imagem renderizada
    const clickXPct = (e.clientX - rect.left) / rect.width;
    const clickYPct = (e.clientY - rect.top) / rect.height;

    // Coordenadas do hotspot salvas em pixels originais da tela capturada
    // naturalWidth/naturalHeight são os pixels reais da imagem (resolução original)
    const natW = imgEl.naturalWidth || 1920;
    const natH = imgEl.naturalHeight || 1080;
    const c = hotspot.coordinates; // {x, y, w, h} em pixels originais

    // Tolerância de 4% para compensar imprecisão de DPR e redimensionamento
    const TOL = 0.04;

    // Verificação por percentual normalizado
    const acertou = (
        Object.keys(c).length > 0 &&  // garante que coordinates não é {}
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
    
    mostrarHighlight('success', hotspot); // mockup
    narrar(hotspot.micro_narracao || "Muito bem!");
    
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
        narrar("Está aqui. Vamos tentar!");
    } else {
        mostrarHighlight('reveal', hotspot);
        narrar(hotspot.micro_narracao);
        setTimeout(() => {
            state.passoAtual++;
            renderizarPassoAtual();
        }, 2000);
    }
}

function narrar(texto) {
    if(!texto) return;
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
    // Remover highlights existentes primeiro
    limparHighlights();

    if (!hotspot || !hotspot.coordinates || Object.keys(hotspot.coordinates).length === 0) return;

    const imgEl = document.getElementById('imagem-bg');
    const simulacaoEl = document.getElementById('simulacao-container');
    const rect = imgEl.getBoundingClientRect();

    const natW = imgEl.naturalWidth || 1920;
    const natH = imgEl.naturalHeight || 1080;
    const c = hotspot.coordinates;

    // Converter pixels originais para pixels renderizados
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

    // Para 'reveal', adicionar um label com o texto do alvo
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

    // Auto-remover highlights de dica após 3s
    if (classeCSS !== 'reveal') {
        setTimeout(() => box.remove(), 3000);
    }
}

function limparHighlights() {
    const simulacaoEl = document.getElementById('simulacao-container');
    simulacaoEl.querySelectorAll('.highlight-box').forEach(el => el.remove());
}

async function concluirModulo() {
    if (state.sequenciaPerfeita) {
        state.xpTotal += XP_RULES.BONUS_SEQUENCIA_PERFEITA;
    }
    
    document.getElementById('xp-total').innerText = state.xpTotal;
    
    document.getElementById('simulacao-container').innerHTML = `
        <div style="padding: 50px; text-align: center;">
            <h2>Módulo Concluído!</h2>
            <p>Seu XP Final: ${state.xpTotal}</p>
        </div>
    `;
    
    // Callback para o backend
    fetch(`/api/v1/simlink/${moduloId}/conclusao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xp: state.xpTotal, historico: state.historico })
    });
}

iniciarSimlink();
