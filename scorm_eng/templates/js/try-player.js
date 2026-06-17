/**
 * =============================================================================
 * SCORM 1.2 API Usage Compliance Documentation
 * =============================================================================
 *
 * This file uses the following SCORM 1.2 Data Model Elements via ScormAPI:
 *
 * FIELD                      R/W  LIMIT    NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 * cmi.suspend_data           R/W  4096 ch  Persists progress state (JSON).
 *                                          Size enforced in salvarProgresso()
 *                                          and QuizComponent.saveQuizScore().
 *                                          Truncation priority:
 *                                            1. Trim historico to last 5 entries
 *                                            2. Remove quizAnswers array
 *                                            3. Core fields always preserved:
 *                                               passoAtual, xpTotal, quizScore
 *
 * cmi.core.lesson_status     R/W  —        Valid write values (SCORM 1.2):
 *                                            "passed", "failed", "completed",
 *                                            "incomplete", "not attempted",
 *                                            "browsed"
 *                                          This file uses: "incomplete",
 *                                            "passed", "failed"
 *
 * cmi.core.lesson_location   W    255 ch   Stores current step index as string.
 *
 * cmi.core.score.raw         R/W  —        SCORM 1.2 specifies a numeric value
 *                                          in [cmi.core.score.min,
 *                                           cmi.core.score.max].
 *                                          ⚠ DESIGN EXCEPTION: This system
 *                                          stores "{xp_simulation}|{quiz_%}"
 *                                          (e.g. "84|75") as per design spec
 *                                          (SCORM Data Format Extensions).
 *                                          Strict LMSs may reject this value.
 *                                          If the target LMS rejects it, the
 *                                          quiz score should be stored solely
 *                                          in cmi.suspend_data.quizScore and
 *                                          score.raw set to xp only.
 *
 * cmi.core.score.max         W    —        Set to modulo.xp_max when present.
 *
 * All other cmi.core.* fields are NOT written by this file.
 * cmi.core.student_id / student_name / credit / entry / total_time /
 * lesson_mode / exit / session_time are left to the LMS.
 * =============================================================================
 */

let state = {
    modulo: null,
    passoAtual: 0,
    xpTotal: 0,
    tentativasNoPasso: 0,
    sequenciaPerfeita: true,
    historico: [],
    isTransitioning: false  // blocks double-click step skipping
};

const XP_RULES = {
    ACERTO_PRIMEIRA: 10,
    ACERTO_SEGUNDA: 6,
    ACERTO_COM_DICA: 3,
    BONUS_SEQUENCIA_PERFEITA: 20
};

/**
 * Determines if debug logging should be enabled
 * @returns {boolean} true if running in standalone mode, false if running in LMS
 */
function isDebugMode() {
    return !ScormAPI.isLMS;
}

/**
 * Helper function to evaluate XPath expressions and locate DOM elements
 * @param {string} xpath - The XPath expression to evaluate
 * @returns {Element|null} - The matching element or null if not found or on error
 */
function getElementByXPath(xpath) {
    try {
        const result = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        );
        return result.singleNodeValue;
    } catch (e) {
        if (isDebugMode()) {
            console.warn(`[Click_Detector] XPath evaluation error: ${e.message}`);
        }
        return null;
    }
}

/**
 * Calculate scaled bounds for coordinate-based highlight positioning
 * Applies proportional scaling based on natural vs rendered image size
 * and accounts for image container offset
 * 
 * @param {Object} coordinates - Hotspot coordinates {x, y, w, h} in natural image pixels
 * @returns {Object} - Scaled bounds {left, top, width, height} in viewport pixels
 */
function calculateScaledBounds(coordinates) {
    if (!coordinates || Object.keys(coordinates).length === 0) {
        return null;
    }

    const imgEl = document.getElementById('imagem-bg');
    const rect = imgEl.getBoundingClientRect();

    // Get natural image dimensions (original capture resolution)
    const natW = imgEl.naturalWidth || 1920;
    const natH = imgEl.naturalHeight || 1080;

    // Calculate scaling factors between natural and rendered sizes
    const scaleX = rect.width / natW;
    const scaleY = rect.height / natH;

    // Apply scaling to hotspot coordinates
    const scaledBounds = {
        left: coordinates.x * scaleX,
        top: coordinates.y * scaleY,
        width: coordinates.w * scaleX,
        height: coordinates.h * scaleY
    };

    // Note: The bounds are already relative to the image element's top-left,
    // and the highlight box will be positioned within the simulacao-container
    // which contains the image, so no additional offset is needed
    
    if (isDebugMode()) {
        console.debug('[Highlight_Renderer] Calculated scaled bounds:', {
            natural: { w: natW, h: natH },
            rendered: { w: rect.width, h: rect.height },
            scale: { x: scaleX, y: scaleY },
            input: coordinates,
            output: scaledBounds
        });
    }

    return scaledBounds;
}

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
        
        // Reproduzir áudio de introdução (passo 0) se disponível
        if (state.modulo.intro_audio_filename) {
            const introUrl = ScormAPI.isLMS
                ? `audios/${state.modulo.intro_audio_filename}`
                : (() => {
                    const urlModulo = urlParams.get('modulo');
                    if (urlModulo && urlModulo !== 'default') {
                        return `/audios/${state.modulo.session_id}/${state.modulo.intro_audio_filename}`;
                    }
                    return `audios/${state.modulo.intro_audio_filename}`;
                })();
            currentAudio = new Audio(introUrl);
            currentAudio.play().catch(e => {
                console.warn('[Try_Player] Intro audio blocked, falling back to TTS', e);
                const introTexto = state.modulo.titulo || 'Bem-vindo ao treinamento!';
                narrarFallback(introTexto);
            });
        }
        
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
            // Já concluiu — mostra tela de conclusão diretamente com opção de reiniciar
            mostrarTelaConclusao(state.xpTotal, /* jaConcluidoAntes */ true);
            return;
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
    // Build base save object including quiz data if available (Requirements 8.2, 8.3)
    const saveObj = {
        passoAtual: state.passoAtual,
        xpTotal: state.xpTotal,
        sequenciaPerfeita: state.sequenciaPerfeita,
        historico: state.historico ? state.historico.slice() : []
    };

    // Include quiz data if QuizComponent has been used
    if (typeof QuizComponent !== 'undefined' && QuizComponent.data && QuizComponent.data.length > 0) {
        saveObj.quizAnswers = QuizComponent.userAnswers;
        saveObj.quizScore = QuizComponent.calculateScore();
    }

    let jsonStr = JSON.stringify(saveObj);

    // SCORM 1.2 limits cmi.suspend_data to 4096 characters (Requirement 8.2)
    if (jsonStr.length > 4096) {
        // Step 1: Truncate historico to last 5 entries (Requirement 8.3)
        saveObj.historico = saveObj.historico.slice(-5);
        jsonStr = JSON.stringify(saveObj);
        console.warn('[SCORM] suspend_data exceeded 4096 chars — historico truncated to last 5 entries (length: ' + jsonStr.length + ')');
    }

    if (jsonStr.length > 4096) {
        // Step 2: Remove quizAnswers if still too large (Requirement 8.3)
        delete saveObj.quizAnswers;
        jsonStr = JSON.stringify(saveObj);
        console.warn('[SCORM] suspend_data still exceeded 4096 chars — quizAnswers removed (length: ' + jsonStr.length + ')');
    }

    ScormAPI.set("cmi.suspend_data", jsonStr);
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

/**
 * Plays a fixed narration audio from the audios/ folder (SCORM mode)
 * or falls back to TTS if the file is not found.
 * @param {string} filename - e.g. 'scorm_conclusao.mp3'
 * @param {string} fallbackText - TTS text if file missing
 */
function tocarAudioFixo(filename, fallbackText) {
    // Stop any currently playing audio first
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    window.speechSynthesis && window.speechSynthesis.cancel();

    const url = ScormAPI.isLMS
        ? `audios/${filename}`
        : (() => {
            const urlModulo = urlParams.get('modulo');
            return (urlModulo && urlModulo !== 'default')
                ? `/audios/${state.modulo.session_id}/${filename}`
                : `audios/${filename}`;
        })();

    currentAudio = new Audio(url);
    currentAudio.play().catch(() => {
        // File not in package — fall back to browser TTS
        narrarFallback(fallbackText);
    });
}
/**
 * Shows the quiz transition screen ("Quiz de Validação") when all simulation
 * steps are complete and QUIZ_DATA is available.
 * Requirements: 4.3, 4.4
 */
function mostrarTransicaoQuiz() {
    // Stop last step audio and play quiz-intro narration
    tocarAudioFixo('scorm_quiz_intro.mp3', 'Muito bem! Agora vamos testar seu conhecimento com um quiz rápido.');
    const container = document.getElementById('simulacao-container');
    container.innerHTML = `
        <div id="quiz-transition-wrapper" style="
            width: 100%; height: 100%;
            display: flex; flex-direction: column;
            justify-content: center; align-items: center;
            background: #1a1a2e; color: white;
            font-family: inherit; padding: 40px;
            box-sizing: border-box;
        ">
            <div style="
                max-width: 520px; width: 100%;
                text-align: center;
                display: flex; flex-direction: column; gap: 24px;
                align-items: center;
            ">
                <div style="
                    font-size: 3rem; line-height: 1;
                ">🎯</div>

                <div>
                    <div style="
                        font-size: 1.6rem; font-weight: 700;
                        color: #f1f5f9; margin-bottom: 10px;
                    ">Quiz de Validação</div>
                    <div style="
                        font-size: 1rem; color: #94a3b8; line-height: 1.6;
                    ">
                        Parabéns por concluir a prática!<br>
                        Responda às questões a seguir para validar seu conhecimento.
                    </div>
                </div>

                <button
                    id="btn-iniciar-quiz"
                    onclick="iniciarQuizDoPlayer()"
                    style="
                        padding: 14px 40px; border-radius: 8px;
                        border: none; font-size: 1rem; font-weight: 600;
                        cursor: pointer; background: #6366f1; color: white;
                        margin-top: 8px; transition: background 0.15s ease;
                    "
                    onmouseover="this.style.background='#4f46e5'"
                    onmouseout="this.style.background='#6366f1'"
                >Iniciar Quiz</button>
            </div>
        </div>
    `;

    document.getElementById('passo-header').innerText = 'Quiz de Validação';
    document.getElementById('ancora-texto').innerText = 'Pratique concluída — hora de testar o conhecimento';
}

/**
 * Initialises and renders the QuizComponent when the user advances from the
 * quiz transition screen. Falls back to concluirModulo() if init fails.
 * Requirements: 4.3, 4.4
 */
function iniciarQuizDoPlayer() {
    if (!QuizComponent.init()) {
        console.error('[Try_Player] QuizComponent.init() failed, falling through to concluirModulo');
        concluirModulo();
        return;
    }
    QuizComponent.render();
}

function renderizarPassoAtual() {
    if (state.passoAtual >= state.modulo.hotspots.length) {
        // Requirements 4.3, 4.4: show quiz transition when QUIZ_DATA is present and valid,
        // otherwise fall through directly to concluirModulo().
        const quizAvailable = (typeof QUIZ_DATA !== 'undefined') &&
            Array.isArray(QUIZ_DATA) && QUIZ_DATA.length > 0;
        if (quizAvailable) {
            mostrarTransicaoQuiz();
        } else {
            concluirModulo();
        }
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

/**
 * Detects if a click matches the target hotspot using selector-priority algorithm
 * @param {MouseEvent} event - The click event
 * @param {Object} hotspot - The current hotspot with selectors and coordinates
 * @returns {Object} - { matched: boolean, method: string }
 */
function detectClickMatch(event, hotspot) {
    let matched = false;
    let method = 'none';
    
    // Priority 1: CSS Selector
    if (hotspot.css_selector) {
        const element = document.querySelector(hotspot.css_selector);
        if (element) {
            matched = element.contains(event.target) || element === event.target;
            method = 'css_selector';
            if (isDebugMode()) {
                console.debug(`[Click_Detector] CSS selector found: ${hotspot.css_selector}`, element);
            }
        } else if (isDebugMode()) {
            console.debug(`[Click_Detector] CSS selector not found: ${hotspot.css_selector}`);
        }
    }
    
    // Priority 2: XPath (if CSS failed)
    if (!matched && hotspot.xpath) {
        const element = getElementByXPath(hotspot.xpath);
        if (element) {
            matched = element.contains(event.target) || element === event.target;
            method = 'xpath';
            if (isDebugMode()) {
                console.debug(`[Click_Detector] XPath found: ${hotspot.xpath}`, element);
            }
        } else if (isDebugMode()) {
            console.debug(`[Click_Detector] XPath not found: ${hotspot.xpath}`);
        }
    }
    
    // Priority 3: Coordinate fallback
    if (!matched) {
        matched = detectClickByCoordinates(event, hotspot);
        method = 'coordinates';
        if (isDebugMode()) {
            console.debug(`[Click_Detector] Fallback to coordinate detection:`, matched);
        }
    }
    
    return { matched, method };
}

/**
 * Detects click match using coordinate-based detection with tolerance
 * @param {MouseEvent} event - The click event
 * @param {Object} hotspot - The hotspot with coordinates
 * @returns {boolean} - true if click is within tolerance of hotspot coordinates
 */
function detectClickByCoordinates(event, hotspot) {
    const imgEl = document.getElementById('imagem-bg');
    const rect = imgEl.getBoundingClientRect();

    const clickXPct = (event.clientX - rect.left) / rect.width;
    const clickYPct = (event.clientY - rect.top) / rect.height;

    const natW = imgEl.naturalWidth || 1920;
    const natH = imgEl.naturalHeight || 1080;
    const c = hotspot.coordinates;

    const TOL = 0.04;

    return (
        c && Object.keys(c).length > 0 &&
        clickXPct >= (c.x / natW - TOL) &&
        clickXPct <= ((c.x + c.w) / natW + TOL) &&
        clickYPct >= (c.y / natH - TOL) &&
        clickYPct <= ((c.y + c.h) / natH + TOL)
    );
}

document.getElementById('overlay-cliques').addEventListener('click', (e) => {
    if (state.isTransitioning) return;  // ignore clicks during step transition
    const hotspot = state.modulo.hotspots[state.passoAtual];
    if (!hotspot) return;

    const result = detectClickMatch(e, hotspot);

    if (result.matched) {
        onAcerto(hotspot);
    } else {
        onErro(hotspot);
    }
});

function onAcerto(hotspot) {
    state.isTransitioning = true;  // lock clicks until next step renders
    const xpGanho = [XP_RULES.ACERTO_PRIMEIRA, XP_RULES.ACERTO_SEGUNDA, XP_RULES.ACERTO_COM_DICA][Math.min(state.tentativasNoPasso, 2)];
    state.xpTotal += xpGanho;
    state.historico.push({ passo: hotspot.passo_num, tentativas: state.tentativasNoPasso + 1, xp: xpGanho });
    
    mostrarHighlight('success', hotspot);
    
    salvarProgresso();
    
    setTimeout(() => {
        state.passoAtual++;
        state.isTransitioning = false;
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
    } else {
        state.isTransitioning = true;  // lock during reveal auto-advance
        mostrarHighlight('reveal', hotspot);
        setTimeout(() => {
            state.passoAtual++;
            state.isTransitioning = false;
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

/**
 * Renders highlight box (hint/reveal/success) with selector-priority positioning
 * @param {string} classeCSS - CSS class for highlight type ('hint', 'reveal', 'success')
 * @param {Object} hotspot - Hotspot object with selectors and coordinates
 */
function mostrarHighlight(classeCSS, hotspot) {
    limparHighlights();
    if (!hotspot) return;

    const simulacaoEl = document.getElementById('simulacao-container');
    
    // Selector-priority bounds calculation
    let bounds = null;
    let method = 'none';
    
    // Priority 1: CSS Selector
    if (hotspot.css_selector) {
        const element = document.querySelector(hotspot.css_selector);
        if (element) {
            const rect = element.getBoundingClientRect();
            const containerRect = simulacaoEl.getBoundingClientRect();
            
            // Convert viewport coordinates to container-relative coordinates
            bounds = {
                left: rect.left - containerRect.left,
                top: rect.top - containerRect.top,
                width: rect.width,
                height: rect.height
            };
            method = 'css_selector';
            if (isDebugMode()) {
                console.debug('[Highlight_Renderer] Using CSS bounds:', bounds);
            }
        } else if (isDebugMode()) {
            console.debug(`[Highlight_Renderer] CSS selector not found: ${hotspot.css_selector}`);
        }
    }
    
    // Priority 2: XPath
    if (!bounds && hotspot.xpath) {
        const element = getElementByXPath(hotspot.xpath);
        if (element) {
            const rect = element.getBoundingClientRect();
            const containerRect = simulacaoEl.getBoundingClientRect();
            
            // Convert viewport coordinates to container-relative coordinates
            bounds = {
                left: rect.left - containerRect.left,
                top: rect.top - containerRect.top,
                width: rect.width,
                height: rect.height
            };
            method = 'xpath';
            if (isDebugMode()) {
                console.debug('[Highlight_Renderer] Using XPath bounds:', bounds);
            }
        } else if (isDebugMode()) {
            console.debug(`[Highlight_Renderer] XPath not found: ${hotspot.xpath}`);
        }
    }
    
    // Priority 3: Coordinate scaling fallback
    if (!bounds && hotspot.coordinates && Object.keys(hotspot.coordinates).length > 0) {
        bounds = calculateScaledBounds(hotspot.coordinates);
        method = 'coordinates';
        if (isDebugMode()) {
            console.debug('[Highlight_Renderer] Using scaled coordinates:', bounds);
        }
    }
    
    // If no bounds could be determined, exit early
    if (!bounds) {
        if (isDebugMode()) {
            console.warn('[Highlight_Renderer] Could not determine bounds for hotspot', hotspot);
        }
        return;
    }

    const box = document.createElement('div');
    box.className = `highlight-box ${classeCSS}`;
    box.style.position = 'absolute';
    box.style.left   = `${bounds.left}px`;
    box.style.top    = `${bounds.top}px`;
    box.style.width  = `${bounds.width}px`;
    box.style.height = `${bounds.height}px`;
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

/**
 * Quiz_Component — manages end-of-module multiple-choice quiz
 * Loads questions from QUIZ_DATA (data/quiz.js), tracks answers,
 * calculates scores, and persists results to SCORM.
 * Requirements: 5.1, 6.4, 6.5
 */
const QuizComponent = {
    /** @type {Array<{pergunta: string, opcoes: string[], correta: number, explicacao: string}>} */
    data: [],

    /** @type {number} Index of the currently displayed question */
    currentIndex: 0,

    /** @type {Array<number|null>} User's selected answer index per question, null if unanswered */
    userAnswers: [],

    /**
     * Initialises the component by loading and validating QUIZ_DATA.
     * @returns {boolean} true if quiz data is valid and ready to render, false otherwise
     */
    init() {
        if (typeof QUIZ_DATA === 'undefined') {
            console.warn('[Quiz_Component] quiz.js not found, skipping quiz');
            return false;
        }

        if (!this.validateQuizData(QUIZ_DATA)) {
            console.error('[Quiz_Component] Invalid quiz data structure');
            return false;
        }

        this.data = QUIZ_DATA;
        this.currentIndex = 0;
        this.userAnswers = new Array(this.data.length).fill(null);
        return true;
    },

    /**
     * Validates that quiz data conforms to the required schema.
     * Each question must have:
     *   - pergunta: non-empty string
     *   - opcoes: array of exactly 4 strings
     *   - correta: integer in [0, 3]
     * @param {any} data - Value to validate
     * @returns {boolean} true if data is a valid non-empty array of well-formed questions
     */
    validateQuizData(data) {
        if (!Array.isArray(data) || data.length === 0) return false;
        return data.every(q =>
            q.pergunta &&
            typeof q.pergunta === 'string' &&
            Array.isArray(q.opcoes) &&
            q.opcoes.length === 4 &&
            q.opcoes.every(o => typeof o === 'string') &&
            typeof q.correta === 'number' &&
            Number.isInteger(q.correta) &&
            q.correta >= 0 &&
            q.correta < 4
        );
    },

    /**
     * Renders the current question into the simulacao-container.
     * Displays the question text and 4 clickable option buttons.
     * The "Próxima" button is enabled only after an answer is selected.
     * Requirements: 5.1, 5.2
     */
    render() {
        const container = document.getElementById('simulacao-container');
        const question = this.data[this.currentIndex];
        const totalQuestions = this.data.length;
        const questionNumber = this.currentIndex + 1;
        const selectedAnswer = this.userAnswers[this.currentIndex];

        container.innerHTML = `
            <div id="quiz-wrapper" style="
                width: 100%; height: 100%;
                display: flex; flex-direction: column;
                justify-content: center; align-items: center;
                padding: 32px; box-sizing: border-box;
                background: #1a1a2e; color: white;
                font-family: inherit;
            ">
                <div style="
                    width: 100%; max-width: 720px;
                    display: flex; flex-direction: column; gap: 20px;
                ">
                    <!-- Progress indicator -->
                    <div style="
                        font-size: 0.85rem; color: #94a3b8;
                        text-align: right;
                    ">Questão ${questionNumber} de ${totalQuestions}</div>

                    <!-- Question text -->
                    <div style="
                        font-size: 1.15rem; font-weight: 600;
                        line-height: 1.5; color: #f1f5f9;
                        background: rgba(255,255,255,0.05);
                        border-left: 4px solid #6366f1;
                        padding: 16px 20px; border-radius: 6px;
                    ">${question.pergunta}</div>

                    <!-- Options -->
                    <div id="quiz-options" style="
                        display: flex; flex-direction: column; gap: 12px;
                    ">
                        ${question.opcoes.map((opcao, idx) => {
                            const isSelected = selectedAnswer === idx;
                            return `<button
                                data-option-index="${idx}"
                                onclick="QuizComponent._onOptionClick(${idx})"
                                style="
                                    width: 100%; text-align: left;
                                    padding: 14px 18px; border-radius: 8px;
                                    border: 2px solid ${isSelected ? '#6366f1' : 'rgba(255,255,255,0.15)'};
                                    background: ${isSelected ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)'};
                                    color: white; font-size: 0.95rem;
                                    cursor: pointer; transition: all 0.15s ease;
                                "
                                onmouseover="if(${!isSelected}) this.style.background='rgba(255,255,255,0.1)'"
                                onmouseout="if(${!isSelected}) this.style.background='rgba(255,255,255,0.05)'"
                            >${String.fromCharCode(65 + idx)}) ${opcao}</button>`;
                        }).join('')}
                    </div>

                    <!-- Next button -->
                    <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
                        <button
                            id="quiz-next-btn"
                            onclick="QuizComponent.next()"
                            ${selectedAnswer === null ? 'disabled' : ''}
                            style="
                                padding: 12px 28px; border-radius: 8px;
                                border: none; font-size: 0.95rem; font-weight: 600;
                                cursor: ${selectedAnswer === null ? 'not-allowed' : 'pointer'};
                                background: ${selectedAnswer === null ? '#374151' : '#6366f1'};
                                color: ${selectedAnswer === null ? '#9ca3af' : 'white'};
                                transition: all 0.15s ease;
                            "
                        >${questionNumber === totalQuestions ? 'Ver Resultado' : 'Próxima'}</button>
                    </div>
                </div>
            </div>
        `;

        // Update HUD
        document.getElementById('passo-header').innerText = `Quiz — ${questionNumber} / ${totalQuestions}`;
        document.getElementById('ancora-texto').innerText = 'Selecione a resposta correta';
    },

    /**
     * Internal handler called when the user clicks an answer option.
     * Records the selection and re-renders to reflect the new state.
     * @param {number} optionIndex - The option that was clicked (0-3)
     */
    _onOptionClick(optionIndex) {
        this.selectAnswer(optionIndex);
        this.render();
    },

    /**
     * Records the user's answer for the current question.
     * @param {number} optionIndex - Selected answer index (0-3)
     */
    selectAnswer(optionIndex) {
        this.userAnswers[this.currentIndex] = optionIndex;
    },

    /**
     * Advances to the next question or shows results when all are answered.
     */
    next() {
        if (this.currentIndex < this.data.length - 1) {
            this.currentIndex++;
            this.render();
        } else {
            this.showResults();
        }
    },

    /**
     * Calculates the quiz score as a percentage of correct answers.
     * @returns {number} Integer percentage 0-100
     */
    calculateScore() {
        if (this.data.length === 0) return 0;
        let correct = 0;
        this.data.forEach((q, i) => {
            if (this.userAnswers[i] === q.correta) correct++;
        });
        return Math.round((correct / this.data.length) * 100);
    },

    /**
     * Displays the results screen with colour-coded feedback and answer review.
     * Green for >= 70%, Yellow for 50-69%, Red for < 50%.
     * Allows the user to review each question with correct/wrong indication.
     * Requirements: 5.3, 5.4, 5.5, 6.2
     */
    showResults() {
        const score = this.calculateScore();
        const total = this.data.length;
        const correct = this.data.filter((q, i) => this.userAnswers[i] === q.correta).length;

        // Colour-coded feedback thresholds (Requirement 5.4)
        let feedbackColor, feedbackLabel, feedbackBorder;
        if (score >= 70) {
            feedbackColor = '#10b981';   // green
            feedbackBorder = '#059669';
            feedbackLabel = 'Aprovado';
        } else if (score >= 50) {
            feedbackColor = '#f59e0b';   // yellow
            feedbackBorder = '#d97706';
            feedbackLabel = 'Regular';
        } else {
            feedbackColor = '#ef4444';   // red
            feedbackBorder = '#dc2626';
            feedbackLabel = 'Reprovado';
        }

        // Build per-question review rows (Requirement 5.5)
        const reviewRows = this.data.map((q, i) => {
            const userAnswer = this.userAnswers[i];
            const isCorrect = userAnswer === q.correta;
            const rowBg = isCorrect ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)';
            const icon = isCorrect ? '✔' : '✘';
            const iconColor = isCorrect ? '#10b981' : '#ef4444';

            const optionsHtml = q.opcoes.map((opcao, idx) => {
                let optStyle = 'color: #94a3b8; font-size: 0.82rem; padding: 2px 0;';
                if (idx === q.correta) {
                    optStyle = 'color: #10b981; font-weight: 600; font-size: 0.82rem; padding: 2px 0;';
                } else if (idx === userAnswer && !isCorrect) {
                    optStyle = 'color: #ef4444; text-decoration: line-through; font-size: 0.82rem; padding: 2px 0;';
                }
                const marker = idx === q.correta ? ' ← correta' : (idx === userAnswer && !isCorrect ? ' ← sua resposta' : '');
                return `<div style="${optStyle}">${String.fromCharCode(65 + idx)}) ${opcao}${marker}</div>`;
            }).join('');

            const explicacaoHtml = q.explicacao
                ? `<div style="margin-top: 8px; font-size: 0.82rem; color: #cbd5e1; font-style: italic; border-left: 3px solid rgba(255,255,255,0.2); padding-left: 10px;">${q.explicacao}</div>`
                : '';

            return `
                <div style="
                    background: ${rowBg};
                    border: 1px solid ${isCorrect ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'};
                    border-radius: 8px; padding: 14px 16px; display: flex; gap: 14px;
                ">
                    <div style="font-size: 1.2rem; color: ${iconColor}; flex-shrink: 0; padding-top: 2px;">${icon}</div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 0.92rem; font-weight: 600; color: #f1f5f9; margin-bottom: 8px;">
                            ${i + 1}. ${q.pergunta}
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            ${optionsHtml}
                        </div>
                        ${explicacaoHtml}
                    </div>
                </div>`;
        }).join('');

        const container = document.getElementById('simulacao-container');
        container.innerHTML = `
            <div id="quiz-results-wrapper" style="
                width: 100%; height: 100%;
                display: flex; flex-direction: column;
                align-items: center;
                padding: 32px; box-sizing: border-box;
                background: #1a1a2e; color: white;
                font-family: inherit;
                overflow-y: auto;
            ">
                <div style="width: 100%; max-width: 720px; display: flex; flex-direction: column; gap: 24px;">

                    <!-- Score card -->
                    <div style="
                        background: rgba(255,255,255,0.05);
                        border: 2px solid ${feedbackBorder};
                        border-radius: 12px; padding: 28px 32px;
                        text-align: center;
                    ">
                        <div style="font-size: 0.85rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px;">
                            Resultado do Quiz
                        </div>
                        <div style="font-size: 3.5rem; font-weight: 800; color: ${feedbackColor}; line-height: 1;">
                            ${score}%
                        </div>
                        <div style="font-size: 1.1rem; font-weight: 600; color: ${feedbackColor}; margin-top: 8px;">
                            ${feedbackLabel}
                        </div>
                        <div style="font-size: 0.9rem; color: #94a3b8; margin-top: 10px;">
                            ${correct} de ${total} respostas corretas
                        </div>
                    </div>

                    <!-- Review section header -->
                    <div style="font-size: 1rem; font-weight: 600; color: #cbd5e1; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
                        Revisão das Respostas
                    </div>

                    <!-- Per-question review rows -->
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        ${reviewRows}
                    </div>

                    <!-- Finish button -->
                    <div style="display: flex; justify-content: center; margin-top: 8px; margin-bottom: 16px;">
                        <button
                            onclick="concluirModulo()"
                            style="
                                padding: 13px 40px; border-radius: 8px;
                                border: none; font-size: 1rem; font-weight: 600;
                                cursor: pointer; background: #6366f1; color: white;
                                transition: background 0.15s ease;
                            "
                            onmouseover="this.style.background='#4f46e5'"
                            onmouseout="this.style.background='#6366f1'"
                        >Concluir Treinamento</button>
                    </div>
                </div>
            </div>
        `;

        // Update HUD
        document.getElementById('passo-header').innerText = 'Resultado do Quiz';
        document.getElementById('ancora-texto').innerText = `${score}% — ${feedbackLabel}`;

        // Persist score to SCORM (Requirement 5.6, 6.2)
        this.saveQuizScore(score);
    },

    /**
     * Persists the quiz score to SCORM fields.
     *
     * SCORM 1.2 compliance notes:
     *   - cmi.core.score.raw: SCORM 1.2 expects a numeric value. This system intentionally
     *     stores a composite string "{xp_simulation}|{quiz_percentage}" as documented in the
     *     design spec (SCORM Data Format Extensions). LMSs that strictly validate numeric
     *     score.raw may reject this value; the LMS must be configured to accept it, or the
     *     quiz score should be stored exclusively in cmi.suspend_data.
     *   - cmi.suspend_data: Enforced to 4096 chars (SCORM 1.2 limit, Requirement 8.2).
     *
     * @param {number} percentage - Quiz score percentage 0-100
     */
    saveQuizScore(percentage) {
        // SCORM 1.2 note: cmi.core.score.raw should be numeric per spec, but this system
        // stores a composite "{xp}|{quiz%}" string as per design doc (Req 8.1).
        const currentRaw = ScormAPI.get('cmi.core.score.raw');
        const xpSimulation = parseInt(currentRaw) || state.xpTotal;
        const combinedScore = `${xpSimulation}|${percentage}`;
        ScormAPI.set('cmi.core.score.raw', combinedScore);

        // Read existing suspend_data and merge quiz results
        let suspendData = {};
        try {
            suspendData = JSON.parse(ScormAPI.get('cmi.suspend_data') || '{}');
        } catch (e) { /* use empty object on parse failure */ }

        suspendData.quizAnswers = this.userAnswers;
        suspendData.quizScore = percentage;

        // Enforce SCORM 1.2 cmi.suspend_data 4096-char limit (Requirement 8.2, 8.3)
        let jsonStr = JSON.stringify(suspendData);
        if (jsonStr.length > 4096) {
            // Step 1: Truncate historico to last 5 entries
            if (Array.isArray(suspendData.historico)) {
                suspendData.historico = suspendData.historico.slice(-5);
                jsonStr = JSON.stringify(suspendData);
                console.warn('[SCORM] saveQuizScore: suspend_data exceeded 4096 chars — historico truncated (length: ' + jsonStr.length + ')');
            }
        }
        if (jsonStr.length > 4096) {
            // Step 2: Remove quizAnswers if still too large
            delete suspendData.quizAnswers;
            jsonStr = JSON.stringify(suspendData);
            console.warn('[SCORM] saveQuizScore: suspend_data still exceeded 4096 chars — quizAnswers removed (length: ' + jsonStr.length + ')');
        }

        ScormAPI.set('cmi.suspend_data', jsonStr);
        ScormAPI.save();
    }
};

function reiniciarTreinamento() {
    // Limpa estado SCORM persistido
    ScormAPI.set("cmi.suspend_data", "");
    ScormAPI.set("cmi.core.lesson_location", "0");
    ScormAPI.set("cmi.core.lesson_status", "incomplete");
    ScormAPI.set("cmi.core.score.raw", "0");
    ScormAPI.save();

    // Reseta estado em memória
    state.passoAtual = 0;
    state.xpTotal = 0;
    state.tentativasNoPasso = 0;
    state.sequenciaPerfeita = true;
    state.historico = [];
    state.isTransitioning = false;

    // Restaura o HUD
    const widget = document.getElementById('capture-os-sandbox-widget');
    if (widget) widget.style.display = '';

    // Restaura o container de simulação e reinicia
    const simulacaoEl = document.getElementById('simulacao-container');
    simulacaoEl.innerHTML = '<img id="imagem-bg" src="" alt="Simulação"><div id="overlay-cliques"></div>';

    // Re-attach click listener
    document.getElementById('overlay-cliques').addEventListener('click', (e) => {
        if (state.isTransitioning) return;
        const hotspot = state.modulo.hotspots[state.passoAtual];
        if (!hotspot) return;
        const result = detectClickMatch(e, hotspot);
        if (result.matched) { onAcerto(hotspot); } else { onErro(hotspot); }
    });

    renderizarPassoAtual();
}

function mostrarTelaConclusao(xpFinal, jaConcluidoAntes) {
    document.getElementById('sandbox-xp').innerText = `${xpFinal} XP`;
    document.getElementById('passo-header').innerText = 'Concluído';
    document.getElementById('ancora-texto').innerText = 'Parabéns, treinamento finalizado com sucesso!';

    // Ocultar o HUD — não é mais necessário na tela de conclusão
    const widget = document.getElementById('capture-os-sandbox-widget');
    if (widget) widget.style.display = 'none';

    const aviso = jaConcluidoAntes
        ? `<div style="font-size:0.9rem; color:#f59e0b; margin-top:8px;">Você já completou este treinamento anteriormente.</div>`
        : '';

    document.getElementById('simulacao-container').innerHTML = `
        <div style="padding: 50px; text-align: center; color: white; width: 100%; height: 100%;
                    display: flex; flex-direction: column; justify-content: center; align-items: center;
                    background: #1a1a2e; box-sizing: border-box;">
            <div style="font-size: 3rem; margin-bottom: 16px;">🏆</div>
            <h2 style="font-size: 2rem; color: #10b981; margin: 0 0 12px;">Parabéns!</h2>
            <p style="font-size: 1.1rem; color: #cbd5e1; margin: 0 0 6px;">Treinamento finalizado com sucesso!</p>
            <p style="font-size: 1.3rem; font-weight: 700; color: #f1f5f9; margin: 0 0 4px;">XP Final: ${xpFinal}</p>
            ${aviso}
            <button
                onclick="reiniciarTreinamento()"
                style="margin-top: 28px; padding: 12px 32px; border-radius: 8px; border: none;
                       font-size: 0.95rem; font-weight: 600; cursor: pointer;
                       background: #6366f1; color: white; transition: background 0.15s ease;"
                onmouseover="this.style.background='#4f46e5'"
                onmouseout="this.style.background='#6366f1'"
            >🔄 Reiniciar Treinamento</button>
        </div>
    `;

    // Play conclusion narration via MiniMax (falls back to TTS if file missing)
    tocarAudioFixo('scorm_conclusao.mp3', 'Parabéns, treinamento finalizado com sucesso!');
}

function concluirModulo() {
    if (state.sequenciaPerfeita) {
        state.xpTotal += XP_RULES.BONUS_SEQUENCIA_PERFEITA;
    }

    mostrarTelaConclusao(state.xpTotal, false);  // plays scorm_conclusao.mp3 internally

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
