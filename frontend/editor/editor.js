const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session');
let roteiroAtual = [];

if (!sessionId) {
    document.getElementById('passos-container').innerHTML = '<p class="loading">ID da sessão não fornecido.</p>';
} else {
    carregarRoteiro();
}

async function carregarRoteiro() {
    try {
        const response = await fetch(`/api/v1/session/${sessionId}/roteiro`);
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
        const card = document.createElement('div');
        card.className = 'passo-card';
        
        let imgHtml = '';
        if (passo._simlink && passo._simlink.screenshot_path) {
            // Requisita a imagem via backend se implementado endpoint estático, ou omite
            // Por simplicidade, assume-endpoint estático /screenshots
            const pathParts = passo._simlink.screenshot_path.split('/');
            const fileName = pathParts[pathParts.length - 1];
            imgHtml = `<img src="/screenshots/${sessionId}/${fileName}" class="passo-img" alt="Passo ${passo.passo}" onerror="this.style.display='none'">`;
        }

        card.innerHTML = `
            <div class="passo-header">Passo ${passo.passo}</div>
            ${imgHtml}
            <div class="input-group">
                <label>Âncora (Por quê):</label>
                <textarea id="ancora-${index}">${passo.ancora || ''}</textarea>
            </div>
            <div class="input-group">
                <label>Narração (Como):</label>
                <textarea id="micro-${index}">${passo.micro_narracao || ''}</textarea>
            </div>
            <div class="actions">
                <button class="btn-secondary" onclick="previewTTS(${index})">🔊 Preview</button>
                <button class="btn-secondary" id="btn-regerar-${index}" onclick="regerarPassoIA(${index}, ${passo.passo})">✨ Regerar com IA</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function previewTTS(index) {
    const ancora = document.getElementById(`ancora-${index}`).value;
    const micro = document.getElementById(`micro-${index}`).value;
    const texto = `${ancora} ${micro}`.trim();
    if (!texto) return;
    
    const msg = new SpeechSynthesisUtterance(texto);
    msg.lang = 'pt-BR';
    window.speechSynthesis.speak(msg);
}

async function regerarPassoIA(indexArray, passoNum) {
    const btn = document.getElementById(`btn-regerar-${indexArray}`);
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "⏳ Gerando...";

    try {
        const res = await fetch(`/api/v1/session/${sessionId}/passo/${passoNum}/regerar`, {
            method: 'POST'
        });
        
        if (!res.ok) throw new Error('Falha ao regerar o passo.');
        
        const data = await res.json();
        const passoAtualizado = data.passo;
        
        document.getElementById(`ancora-${indexArray}`).value = passoAtualizado.ancora || '';
        document.getElementById(`micro-${indexArray}`).value = passoAtualizado.micro_narracao || '';
        
        // Atualiza a memória local também
        roteiroAtual[indexArray].ancora = passoAtualizado.ancora;
        roteiroAtual[indexArray].micro_narracao = passoAtualizado.micro_narracao;
        
        btn.innerText = "✨ Sucesso!";
        setTimeout(() => {
            btn.innerText = originalText;
            btn.disabled = false;
        }, 2000);
    } catch (e) {
        alert(e.message);
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

document.getElementById('btn-render').addEventListener('click', async () => {
    // Atualiza array local
    roteiroAtual.forEach((passo, index) => {
        passo.ancora = document.getElementById(`ancora-${index}`).value;
        passo.micro_narracao = document.getElementById(`micro-${index}`).value;
    });

    const payload = {
        roteiro: roteiroAtual,
        modo_input: "C",
        aprovado: true
    };

    const btn = document.getElementById('btn-render');
    btn.disabled = true;
    btn.innerText = 'Renderizando...';

    try {
        const res = await fetch(`/api/v1/session/${sessionId}/roteiro`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            alert('Roteiro aprovado! O vídeo final está sendo gerado.');
            window.close();
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
