// radar_v3.js (Content Script)
(function() {
    console.log("Capture OS v3 - Radar Injetado");

    let eventCounter = 1;

    function getSemanticSnapshot() {
        const iterators = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let currentNode = iterators.nextNode();
        let snapshot = [];
        
        while(currentNode) {
            const cName = typeof currentNode.className === 'string' ? currentNode.className : '';
            const isInteractive = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(currentNode.tagName) || 
                                  currentNode.hasAttribute('role') ||
                                  cName.includes('p-button') ||
                                  cName.includes('ui-dropdown');
                                  
            if(isInteractive) {
                const rect = currentNode.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    const dpr = window.devicePixelRatio || 1;
                    
                    // Geometria precisa baseada em Device Pixel Ratio
                    const geometry = {
                        x: Math.round(rect.x * dpr),
                        y: Math.round(rect.y * dpr),
                        w: Math.round(rect.width * dpr),
                        h: Math.round(rect.height * dpr)
                    };

                    snapshot.push({
                        som_id: eventCounter++,
                        tag: currentNode.tagName.toLowerCase(),
                        role: currentNode.getAttribute('role') || '',
                        text: (currentNode.innerText || currentNode.getAttribute('aria-label') || '').trim().substring(0, 50),
                        geometry: geometry,
                        state: {
                            expanded: currentNode.getAttribute('aria-expanded'),
                            disabled: currentNode.disabled || currentNode.getAttribute('aria-disabled') === 'true',
                            checked: currentNode.checked || currentNode.getAttribute('aria-checked') === 'true'
                        }
                    });
                }
            }
            currentNode = iterators.nextNode();
        }
        return snapshot;
    }

    // --- RPA: Motor Avançado de Seletores ---
    function getXPath(element) {
        if (!element) return '';
        if (element.id) return `//*[@id="${element.id}"]`;
        if (element.tagName === 'BODY') return '/html/body';

        let ix = 0;
        let siblings = element.parentNode ? element.parentNode.childNodes : [];
        for (let i = 0; i < siblings.length; i++) {
            let sibling = siblings[i];
            if (sibling === element) {
                return getXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
            }
            if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
                ix++;
            }
        }
        return '';
    }

    function getCssSelector(el) {
        if (!el) return '';
        if (el.id) return `#${el.id}`;
        
        // Se tiver data-testid (padrão react/moderno), usa!
        if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
        if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;

        let path = [];
        while (el.nodeType === Node.ELEMENT_NODE) {
            let selector = el.nodeName.toLowerCase();
            if (el.id) {
                selector += '#' + el.id;
                path.unshift(selector);
                break;
            } else {
                let sib = el, nth = 1;
                while (sib = sib.previousElementSibling) {
                    if (sib.nodeName.toLowerCase() == selector) nth++;
                }
                if (nth != 1) selector += ":nth-of-type(" + nth + ")";
            }
            path.unshift(selector);
            el = el.parentNode;
            if (!el || el.nodeType !== Node.ELEMENT_NODE || el.tagName === 'BODY') break;
        }
        return path.join(' > ');
    }

    function isSensitive(el) {
        if (!el) return false;
        if (el.type === 'password') return true;
        
        const attributes = [el.name, el.id, el.className, el.placeholder].join(' ').toLowerCase();
        const keywords = ['senha', 'password', 'pwd', 'credit', 'card', 'cvv', 'cpf', 'ssn', 'secret'];
        for (let w of keywords) {
            if (attributes.includes(w)) return true;
        }
        return false;
    }

    function getElementContext(target) {
        let text = (target.innerText || target.value || target.getAttribute('aria-label') || '').substring(0, 100).trim();
        
        if (isSensitive(target)) {
            text = '*** [DADO SENSÍVEL OCULTO] ***';
        }

        return {
            target_tag: target.tagName,
            target_text: text,
            xpath: getXPath(target),
            css_selector: getCssSelector(target),
            attributes: {
                id: target.id || null,
                class: target.className || null,
                name: target.name || null,
                type: target.type || null,
                href: target.href || null,
                placeholder: target.placeholder || null,
                value: target.value && !isSensitive(target) ? target.value.substring(0, 100) : null
            }
        };
    }

    function interceptEvent(e, type) {
        // Encontra a árvore atual
        const tree = getSemanticSnapshot();
        
        // Pega elemento clicado
        const target = e.target;
        
        // Impede que a IA narre cliques nos nossos próprios componentes do Capture OS
        if (target.closest && (target.closest('#capture-os-widget') || target.closest('#capture-os-toast'))) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const clickPos = {
            x: Math.round(e.clientX * dpr),
            y: Math.round(e.clientY * dpr)
        };

        const context = getElementContext(target);

        const payload = {
            action: type,
            url: window.location.href,
            click_position: clickPos,
            target_tag: context.target_tag,
            target_text: context.target_text,
            xpath: context.xpath,
            css_selector: context.css_selector,
            target_attributes: context.attributes,
            a11y_tree: tree
        };

        try {
            if (chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({
                    action: 'user_interaction',
                    type: type,
                    data: payload
                });
            }
        } catch (err) {
            console.warn("Capture OS v3: Contexto da extensão foi invalidado durante o clique.", err);
        }
    }

    // Bind events
    document.addEventListener('click', (e) => interceptEvent(e, 'click'), true);
    document.addEventListener('dblclick', (e) => interceptEvent(e, 'dblclick'), true);
    
    // Add simple debounce for input and change
    let typingTimer;
    document.addEventListener('input', (e) => {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            interceptEvent(e, 'input');
        }, 1200); // 1.2s para garantir que o usuário parou de digitar
    }, true);
    
    document.addEventListener('change', (e) => {
        interceptEvent(e, 'change');
    }, true);

    // Observer SPA (Single Page Application) - Macro Compatible
    // Dispara apenas quando detectar mudança real de URL via HTML5 History API/Mutações
    let urlAtual = window.location.href;
    let spaDebounce = null;
    const observerSPA = new MutationObserver(() => {
        if (spaDebounce) return;
        spaDebounce = setTimeout(() => {
            spaDebounce = null;
            if (urlAtual !== window.location.href) {
                urlAtual = window.location.href;
                console.log("Capture OS v3 - Navegação SPA Detectada:", urlAtual);
                try {
                    if (chrome.runtime && chrome.runtime.sendMessage) {
                        chrome.runtime.sendMessage({
                            action: 'user_interaction',
                            type: 'navigation',
                            data: {
                                action: 'navigation',
                                url: urlAtual,
                                click_position: {x: 0, y: 0},
                                target_tag: 'BODY',
                                target_text: 'Navegação de Página',
                                xpath: '/html/body',
                                css_selector: 'body',
                                target_attributes: {},
                                a11y_tree: getSemanticSnapshot()
                            }
                        });
                    }
                } catch (err) {
                    console.warn("Capture OS v3: Falha ao enviar evento SPA", err);
                }
            }
        }, 500);
    });
    observerSPA.observe(document.body, { childList: true, subtree: true });

    // --- UX Feedback (Toast & Widget) ---
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        // Bloqueia a renderização de UI dentro de Iframes! O UI deve aparecer apenas na janela principal.
        const isUIAction = ["show_toast", "update_toast", "show_player_modal", "show_pin_tooltip"].includes(msg.action);
        if (isUIAction && window !== window.top) return;

        if (msg.action === "show_toast") {
            showToast(msg.type);
        } else if (msg.action === "update_toast") {
            let span = document.getElementById("capture-os-toast-msg");
            if (span) {
                span.innerHTML = `<b>Capture OS:</b> ${msg.msg}`;
            } else {
                // Se o usuário trocou de aba, o toast sumiu. Vamos reconstruí-lo!
                const toast = document.createElement("div");
                toast.id = "capture-os-toast";
                toast.style.cssText = `
                    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
                    background: #fef08a; color: #854d0e; padding: 12px 24px;
                    border-radius: 8px; font-family: sans-serif; font-size: 14px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); z-index: 999999;
                    display: flex; align-items: center; gap: 8px;
                `;
                toast.innerHTML = `<div class="capture-spinner"></div><span id="capture-os-toast-msg"><b>Capture OS:</b> ${msg.msg}</span>
                <style>
                    .capture-spinner { width: 16px; height: 16px; border: 2px solid #ca8a04; border-top-color: transparent; border-radius: 50%; animation: capture-spin 1s linear infinite; }
                    @keyframes capture-spin { to { transform: rotate(360deg); } }
                </style>`;
                document.body.appendChild(toast);
            }
        } else if (msg.action === "show_player_modal") {
            // Força a destruição imediata de qualquer Toast remanescente na tela
            let toast = document.getElementById("capture-os-toast");
            if(toast) toast.remove();
            
            mountPlayerModal(msg.url, msg.roteiro);
        } else if (msg.action === "show_countdown") {
            if (window !== window.top) return; // Impede que iframes renderizem contadores duplicados
            
            // Remove o overlay antigo se existir
            let oldOverlay = document.getElementById("capture-os-countdown");
            if (oldOverlay) oldOverlay.remove();
            
            const overlay = document.createElement("div");
            overlay.id = "capture-os-countdown";
            overlay.style.cssText = `
                position: fixed; top: 40px; left: 50%; transform: translateX(-50%);
                background: rgba(15,23,42,0.9); z-index: 2147483647;
                display: flex; align-items: center; justify-content: center; gap: 14px;
                backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.12);
                border-radius: 100px; padding: 12px 28px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                box-shadow: 0 12px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05);
                transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
                animation: _capture_slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            `;
            
            const style = document.createElement('style');
            style.innerHTML = `
                @keyframes _capture_slideDown {
                    from { transform: translate(-50%, -20px); opacity: 0; }
                    to { transform: translate(-50%, 0); opacity: 1; }
                }
                @keyframes _capture_pulse_dot {
                    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
                    70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
                    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                }
            `;
            document.head.appendChild(style);
            
            const countText = document.createElement("div");
            countText.style.cssText = `
                font-size: 22px; font-weight: 700; color: #ef4444;
                min-width: 20px; text-align: center;
            `;
            
            const hint = document.createElement("div");
            hint.innerHTML = "Preparando a gravação...";
            hint.style.cssText = `
                font-size: 15px; font-weight: 500; color: #f8fafc; letter-spacing: 0.2px;
            `;

            overlay.appendChild(countText);
            overlay.appendChild(hint);
            document.documentElement.appendChild(overlay);

            let counter = 3;
            countText.innerText = counter;

            const interval = setInterval(() => {
                counter--;
                if (counter > 0) {
                    countText.innerText = counter;
                } else {
                    clearInterval(interval);
                    
                    // Some imediatamente, sem tela de 'Gravando'
                    overlay.style.opacity = "0";
                    overlay.style.transform = "translate(-50%, -20px)";
                    setTimeout(() => {
                        overlay.remove();
                        style.remove();
                    }, 500);
                }
            }, 1000);
        }
    });

    // Heartbeat para manter o Service Worker vivo durante a gravação
    setInterval(() => {
        try {
            if (chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ action: "ping" }).catch(() => {});
            }
        } catch (e) {
            // Se o contexto for invalidado (extensão atualizada), ignora silenciosamente
        }
    }, 15000);

    function showToast(type) {
        let toast = document.getElementById("capture-os-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "capture-os-toast";
            toast.style.cssText = `
                position: fixed;
                bottom: 24px;
                right: 24px;
                padding: 16px 24px;
                border-radius: 12px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                font-size: 15px;
                font-weight: 500;
                color: white;
                z-index: 2147483647; /* Máximo do navegador */
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                box-shadow: 0 10px 40px rgba(0,0,0,0.25);
                display: flex;
                align-items: center;
                gap: 14px;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                opacity: 0;
                transform: translateY(30px) scale(0.95);
            `;
            document.body.appendChild(toast);
        }

        // Anima a entrada
        setTimeout(() => {
            toast.style.opacity = "1";
            toast.style.transform = "translateY(0) scale(1)";
        }, 10);

        if (type === "processing") {
            toast.style.background = "rgba(20, 20, 20, 0.85)";
            toast.style.border = "1px solid rgba(255, 255, 255, 0.1)";
            // Adicionada a Progress Bar na base do Toast
            toast.style.flexDirection = "column";
            toast.style.alignItems = "stretch";
            toast.style.gap = "8px";
            toast.style.padding = "14px 20px 10px 20px";
            
            toast.innerHTML = `
                <div style="display: flex; flex-direction: column; width: 100%; gap: 10px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <div style="display: flex; align-items: center; gap: 14px;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2979ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="capture-spin">
                                <circle cx="12" cy="12" r="10"></circle>
                                <path d="M12 2v4"></path>
                            </svg>
                            <span id="capture-os-toast-msg" style="font-size: 14px;"><b>Capture OS:</b> Processando...</span>
                        </div>
                        <button id="capture-os-cancel-btn" style="background: none; border: none; color: #ef4444; font-size: 13px; font-weight: 600; cursor: pointer; padding: 4px 8px; border-radius: 4px;">Cancelar</button>
                    </div>
                    <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                        <div class="capture-progress-fill"></div>
                    </div>
                </div>
            `;
            
            setTimeout(() => {
                const cancelBtn = document.getElementById("capture-os-cancel-btn");
                if (cancelBtn) {
                    cancelBtn.onclick = () => {
                        chrome.runtime.sendMessage({ action: "abort_processing" }).catch(() => {});
                        fecharToast(toast);
                    };
                }
            }, 100);
            if (!document.getElementById("capture-os-toast-style")) {
                const style = document.createElement("style");
                style.id = "capture-os-toast-style";
                style.innerHTML = `
                    @keyframes capture-spin { 100% { transform: rotate(360deg); } } 
                    .capture-spin { animation: capture-spin 1s linear infinite; }
                    @keyframes capture-progress { 
                        0% { width: 0%; } 
                        20% { width: 30%; }
                        50% { width: 60%; }
                        80% { width: 85%; }
                        100% { width: 95%; } 
                    }
                    .capture-progress-fill {
                        height: 100%;
                        background: #2979ff;
                        width: 0%;
                        animation: capture-progress 60s cubic-bezier(0.1, 0.7, 0.1, 1) forwards;
                    }
                `;
                document.head.appendChild(style);
            }
        } else if (type === "success") {
            toast.style.background = "rgba(0, 200, 83, 0.85)";
            toast.style.border = "1px solid rgba(0, 200, 83, 0.3)";
            toast.innerHTML = `
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span id="capture-os-toast-msg"><b>Capture OS:</b> Vídeo finalizado! Abrindo player...</span>
            `;
            setTimeout(() => fecharToast(toast), 6000);
        } else if (type === "error") {
            toast.style.background = "rgba(255, 23, 68, 0.85)";
            toast.style.border = "1px solid rgba(255, 23, 68, 0.3)";
            toast.innerHTML = `
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
                <span><b>Erro:</b> Falha na comunicação com o servidor.</span>
            `;
            setTimeout(() => fecharToast(toast), 6000);
        }
    }

    function fecharToast(toast) {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(30px) scale(0.95)";
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 400);
    }

    // --- Onboarding (Pin Extension Tooltip) ---
    chrome.storage.local.get(['needsOnboarding'], (res) => {
        if (res.needsOnboarding) {
            mountOnboardingTooltip();
            chrome.storage.local.set({ needsOnboarding: false });
        }
    });

    function mountOnboardingTooltip() {
        const tooltip = document.createElement('div');
        tooltip.id = 'capture-os-onboarding';
        tooltip.style.cssText = `
            position: fixed;
            top: 24px;
            right: 120px;
            background: rgba(255, 255, 255, 0.85);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            color: #0f172a;
            font-family: 'Inter', -apple-system, sans-serif;
            padding: 16px 20px;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(11, 92, 227, 0.15), 0 0 0 1px rgba(255,255,255,0.5) inset;
            border: 1px solid rgba(11, 92, 227, 0.1);
            z-index: 2147483647;
            width: 280px;
            opacity: 0;
            transform: translateY(-10px) scale(0.95);
            transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
        `;
        
        tooltip.innerHTML = `
            <div style="display: flex; gap: 14px; align-items: flex-start;">
                <div style="font-size: 24px; animation: bouncePin 2s infinite; display: inline-block; transform-origin: bottom center;">📌</div>
                <div>
                    <h3 style="margin: 0 0 4px 0; font-size: 15px; font-weight: 700; color: #1e293b;">Fixe a Extensão</h3>
                    <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
                        Para habilitar os atalhos e controles rápidos, clique no ícone de <b>Quebra-cabeça</b> do Chrome (acima) e fixe o Capture OS.
                    </p>
                </div>
            </div>
            <!-- Setinha apontando pra cima (Light) -->
            <div style="
                position: absolute;
                top: -8px;
                right: 40px;
                width: 0; 
                height: 0; 
                border-left: 8px solid transparent;
                border-right: 8px solid transparent;
                border-bottom: 8px solid rgba(255, 255, 255, 0.95);
                filter: drop-shadow(0 -2px 2px rgba(11, 92, 227, 0.05));
            "></div>
            <style>
                @keyframes bouncePin {
                    0%, 100% { transform: translateY(0) rotate(0deg); }
                    50% { transform: translateY(-4px) rotate(5deg); }
                }
            </style>
        `;
        
        document.body.appendChild(tooltip);
        
        requestAnimationFrame(() => {
            tooltip.style.opacity = '1';
            tooltip.style.transform = 'translateY(0) scale(1)';
        });
        
        // Remove automaticamente após 12 segundos
        setTimeout(() => {
            tooltip.style.opacity = '0';
            tooltip.style.transform = 'translateY(-10px) scale(0.95)';
            setTimeout(() => { if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip); }, 500);
        }, 12000);
    }

    // --- Player Modal (Vimeo Record Aesthetic) ---
    function mountPlayerModal(videoUrl, roteiro) {
        // Se já existir, remove
        let existing = document.getElementById('capture-os-player-host');
        if (existing) existing.remove();

        // Cria o host do Shadow DOM para isolar CSS da página
        const host = document.createElement('div');
        host.id = 'capture-os-player-host';
        host.style.cssText = `
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            z-index: 2147483647;
            display: flex;
            justify-content: center;
            align-items: center;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            background: rgba(0, 0, 0, 0.4);
            opacity: 0;
            transition: opacity 0.4s ease;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;
        
        document.body.appendChild(host);
        const shadow = host.attachShadow({mode: 'open'});

        let stepsHtml = '';
        if (roteiro && roteiro.length > 0) {
            roteiro.forEach((passo, index) => {
                let badge = passo.passo;
                if (passo.passo === 0) badge = '💡';
                if (passo.passo === 999) badge = '✅';
                
                // Se a IA não retornou o passo 0 ou 999, e quisemos apenas sequenciar:
                // Mas os guardrails garantem o 0 e o 999.
                
                stepsHtml += `
                    <div class="step-item">
                        <div class="step-num" style="${passo.passo === 0 || passo.passo === 999 ? 'background: #eff6ff; color: #0b5ce3; font-size: 14px;' : ''}">${badge}</div>
                        <div class="step-text">${passo.intencao_original}</div>
                    </div>
                `;
            });
        } else {
            stepsHtml = `<div style="color: #64748b; font-size: 14px; text-align: center; margin-top: 40px;">Nenhum roteiro detalhado gerado.</div>`;
        }

        shadow.innerHTML = `
            <style>
                :host {
                    --primary: #0b5ce3;
                    --primary-hover: #084bbb;
                    --bg: #ffffff;
                    --text-main: #0f172a;
                    --text-muted: #64748b;
                    --border: #e2e8f0;
                }
                .modal-container {
                    width: 1000px;
                    max-width: 95vw;
                    height: 650px;
                    max-height: 90vh;
                    background: var(--bg);
                    border-radius: 16px;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    display: flex;
                    overflow: hidden;
                    position: relative;
                    transform: translateY(20px) scale(0.98);
                    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .video-section {
                    flex: 1.5;
                    background: #000;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    position: relative;
                }
                video {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    outline: none;
                }
                .script-section {
                    flex: 1;
                    background: var(--bg);
                    border-left: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                }
                .script-header {
                    padding: 24px;
                    border-bottom: 1px solid var(--border);
                }
                .script-header h2 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 600;
                    color: var(--text-main);
                }
                .script-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }
                .step-item {
                    display: flex;
                    gap: 16px;
                    align-items: flex-start;
                }
                .step-num {
                    background: #f1f5f9;
                    color: var(--primary);
                    font-weight: 600;
                    font-size: 13px;
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .step-text {
                    font-size: 14px;
                    line-height: 1.5;
                    color: var(--text-main);
                    margin-top: 4px;
                }
                .script-footer {
                    padding: 20px 24px;
                    border-top: 1px solid var(--border);
                    display: flex;
                    gap: 12px;
                    flex-direction: column;
                    background: #f8fafc;
                }
                .btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    width: 100%;
                    padding: 12px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    border: none;
                }
                .btn-primary {
                    background: var(--primary);
                    color: white;
                }
                .btn-primary:hover {
                    background: var(--primary-hover);
                }
                .btn-secondary {
                    background: white;
                    color: var(--text-main);
                    border: 1px solid #cbd5e1;
                }
                .btn-secondary:hover {
                    background: #f1f5f9;
                }
                .close-btn {
                    position: absolute;
                    top: 16px;
                    right: 16px;
                    background: rgba(255, 255, 255, 0.95);
                    border: 1px solid #e2e8f0;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: #64748b;
                    z-index: 10;
                    transition: all 0.2s;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                }
                .close-btn:hover {
                    background: white;
                    color: #ef4444;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .script-content::-webkit-scrollbar { width: 6px; }
                .script-content::-webkit-scrollbar-track { background: transparent; }
                .script-content::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
            </style>

            <div class="modal-container" id="modal">
                <div class="video-section">
                    <video src="${videoUrl}" controls autoplay></video>
                </div>
                
                <div class="script-section">
                    <button class="close-btn" id="close-btn" title="Fechar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                    
                    <div class="script-header">
                        <h2>Roteiro do Tutorial</h2>
                    </div>
                    
                    <div class="script-content">
                        ${stepsHtml}
                    </div>
                    
                    <div class="script-footer">
                        <a href="${videoUrl}" target="_blank" download="tutorial_capture_os_${Date.now()}.mp4" class="btn btn-primary">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            Baixar Vídeo (MP4)
                        </a>
                        <button class="btn btn-secondary" id="copy-btn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            Copiar Texto do Roteiro
                        </button>
                    </div>
                </div>
            </div>
        `;

        const closeBtn = shadow.getElementById('close-btn');
        closeBtn.addEventListener('click', () => {
            host.style.opacity = '0';
            shadow.getElementById('modal').style.transform = 'translateY(20px) scale(0.98)';
            setTimeout(() => host.remove(), 400);
        });

        // Removido o event listener do download-btn que estava quebrando o Javascript
        // O HTML já possui o a href com o atributo download nativo.

        const copyBtn = shadow.getElementById('copy-btn');
        copyBtn.addEventListener('click', () => {
            let texto = "Roteiro do Tutorial:\n\n";
            if (roteiro && roteiro.length > 0) {
                roteiro.forEach(p => { texto += `${p.passo}. ${p.intencao_original}\n`; });
            } else {
                texto += "Nenhum roteiro detalhado gerado.\n";
            }
            navigator.clipboard.writeText(texto).then(() => {
                const originalHtml = copyBtn.innerHTML;
                copyBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    <span style="color: #10b981;">Copiado com sucesso!</span>
                `;
                setTimeout(() => { copyBtn.innerHTML = originalHtml; }, 3000);
            });
        });

        requestAnimationFrame(() => {
            host.style.opacity = '1';
            shadow.getElementById('modal').style.transform = 'translateY(0) scale(1)';
        });
    }

})();
