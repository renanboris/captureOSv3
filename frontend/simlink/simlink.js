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
    
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;
    
    // Como a imagem pode ter sido redimensionada, os bounds originais devem ser comparados percentualmente.
    // O radar_v3 salvou em pixels em relation to the original screen size.
    // Assumimos que coordinates={x,y,w,h} em % ou usamos tolerância genérica.
    // Vamos usar a tolerância sugerida.
    
    // A coord atual está em absolute pixels originais. Precisamos da largura original.
    // Se não tivermos a largura original, podemos assumir uma aproximação baseada nos bounds
    // (A Spec não forneceu a normalização no _simlink, então usamos tolerância frouxa ou validamos)
    // Para o MVP, validaremos um clique se cair na mesma região (usando a lógica da Spec).
    
    const acertou = true; // TODO: Implementar lógica de porcentagem quando original size estiver disponível no backend
    
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
    
    mostrarHighlight('success'); // mockup
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
        mostrarHighlight('hint');
        narrar("Está aqui. Vamos tentar!");
    } else {
        mostrarHighlight('reveal');
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

function mostrarHighlight(classeCSS) {
    // Adiciona div temporária sobre a imagem (mock)
}

function limparHighlights() {
    // Remove divs de highlight
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
