// radar_v3.js (Content Script)
(function() {
    console.log("Capture OS v3 - Radar Injetado");

    console.log("Capture OS v3 - Radar Injetado");

    let eventCounter = 1;
    let isSandboxMode = false;
    let sandboxSessionId = null;
    let sandboxTotalPassos = 0;
    let sandboxXP = 0;
    let sandboxHotspots = [];
    let sandboxStats = { errors: 0, hints: 0, skips: 0 };

    chrome.storage.local.get(['sandboxMode', 'sandboxSessionId', 'sandboxTotalPassos', 'sandboxPassoAtual', 'sandboxXP', 'sandboxHotspots', 'sandboxStats'], (res) => {
        isSandboxMode = res.sandboxMode || false;
        sandboxSessionId = res.sandboxSessionId || null;
        sandboxTotalPassos = res.sandboxTotalPassos || 0;
        sandboxPassoAtual = res.sandboxPassoAtual || 0;
        sandboxXP = res.sandboxXP || 0;
        sandboxHotspots = res.sandboxHotspots || [];
        sandboxStats = res.sandboxStats || { errors: 0, hints: 0, skips: 0 };

        if (isSandboxMode) {
            setTimeout(() => {
                if (typeof renderSandboxWidget === 'function') renderSandboxWidget();
            }, 500);
        }
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.sandboxMode) isSandboxMode = changes.sandboxMode.newValue;
        if (changes.sandboxSessionId) sandboxSessionId = changes.sandboxSessionId.newValue;
        if (changes.sandboxTotalPassos) sandboxTotalPassos = changes.sandboxTotalPassos.newValue;
        if (changes.sandboxPassoAtual) sandboxPassoAtual = changes.sandboxPassoAtual.newValue;
        if (changes.sandboxXP) sandboxXP = changes.sandboxXP.newValue;
        if (changes.sandboxHotspots) sandboxHotspots = changes.sandboxHotspots.newValue;
        if (changes.sandboxStats) sandboxStats = changes.sandboxStats.newValue;

        // Atualizar renderização se os hotspots ou sessão mudarem
        if (changes.sandboxSessionId || changes.sandboxHotspots) {
            sandboxXP = 0; // zera xp na nova sessao
            sandboxStats = { errors: 0, hints: 0, skips: 0 };
            chrome.storage.local.set({ sandboxStats });
            if (isSandboxMode && typeof renderSandboxWidget === 'function') {
                renderSandboxWidget();
            }
        }

        // Se o passo mudar, renderiza novamente o widget ou a tela de score
        if (changes.sandboxPassoAtual || changes.sandboxXP || changes.sandboxStats) {
            if (isSandboxMode) {
                if (sandboxTotalPassos > 0 && sandboxPassoAtual >= sandboxTotalPassos) {
                    if (typeof renderSandboxScoreWidget === 'function') renderSandboxScoreWidget();
                } else {
                    if (typeof renderSandboxWidget === 'function') renderSandboxWidget();
                }
            }
        }

        // Se o modo sandbox for desligado explicitamente
        if (changes.sandboxMode && changes.sandboxMode.newValue === false) {
            if (typeof removeSandboxWidget === 'function') removeSandboxWidget();
        } else if (changes.sandboxMode && changes.sandboxMode.newValue === true) {
            if (typeof renderSandboxWidget === 'function') renderSandboxWidget();
        }
    });

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
    window.closeScoreWidget = function() {
        chrome.storage.local.set({ sandboxMode: false });
    };

    function startHighlightingElement(el) {
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
        if (target.closest && (target.closest('#capture-os-widget') || target.closest('#capture-os-sandbox-widget') || target.closest('#capture-os-toast'))) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const clickPos = {
            x: Math.round(e.clientX * dpr),
            y: Math.round(e.clientY * dpr)
        };

        // NOVO: captura a geometria do elemento clicado (não do ponto de clique)
        const targetRect = target.getBoundingClientRect();
        const target_geometry = {
            x: Math.round(targetRect.x * dpr),
            y: Math.round(targetRect.y * dpr),
            w: Math.round(targetRect.width * dpr),
            h: Math.round(targetRect.height * dpr)
        };

        const context = getElementContext(target);

        const payload = {
            action: type,
            url: window.location.href,
            click_position: clickPos,
            target_geometry: target_geometry,
            target_tag: context.target_tag,
            target_text: context.target_text,
            xpath: context.xpath,
            css_selector: context.css_selector,
            target_attributes: context.attributes,
            a11y_tree: tree
        };

        if (isSandboxMode && type === 'click') {
            const step = sandboxHotspots[sandboxPassoAtual];
            if (!step) return;

            // Se for navigation, não avalia click, apenas ignora
            if (step.action === 'navigation') {
                e.preventDefault();
                e.stopPropagation();
                showToast("error", "Aguarde a navegação ou pule este passo.");
                return;
            }

            let isCorrect = false;
            try {
                if (step.css_selector && step.css_selector !== "body") {
                    const elements = document.querySelectorAll(step.css_selector);
                    for (let el of elements) {
                        if (el === target || el.contains(target) || target.contains(el)) {
                            isCorrect = true;
                            break;
                        }
                    }
                }
            } catch(e) {}

            if (!isCorrect && step.xpath && step.xpath !== "/html/body") {
                try {
                    const result = document.evaluate(step.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    if (result && result.singleNodeValue) {
                        const el = result.singleNodeValue;
                        if (el === target || el.contains(target) || target.contains(el)) {
                            isCorrect = true;
                        }
                    }
                } catch(e) {}
            }

            if (isCorrect) {
                // PASS-THROUGH! O clique real vai acontecer.
                advanceSandboxStep();
            } else {
                e.preventDefault();
                e.stopPropagation();
                sandboxStats.errors += 1;
                sandboxXP = Math.max(0, sandboxXP - 5);
                chrome.storage.local.set({ sandboxXP, sandboxStats });
                showToast("error", "Clique incorreto. Tente novamente.");
            }
            return;
        } else if (isSandboxMode) {
            // Bloqueia interações indesejadas (teclado, etc) se não for o elemento certo
            if (type !== 'scroll') {
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }

        try {
            if (!chrome.runtime?.id) return;
            if (chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({
                    action: 'user_interaction',
                    type: type,
                    data: payload
                }).catch(err => {
                    if (err.message && err.message.includes("Extension context invalidated")) {
                        showContextInvalidatedWarning();
                    }
                });
            }
        } catch (err) {
            if (err.message && err.message.includes("Extension context invalidated")) {
                showContextInvalidatedWarning();
            }
        }
    }

    let hasShownInvalidated = false;
    function showContextInvalidatedWarning() {
        if (hasShownInvalidated) return;
        hasShownInvalidated = true;
        
        const banner = document.createElement("div");
        banner.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #ef4444;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-family: sans-serif;
            font-size: 14px;
            font-weight: 600;
            z-index: 2147483647;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            display: flex;
            align-items: center;
            gap: 12px;
        `;
        banner.innerHTML = `
            <span>🚨 O Capture OS foi atualizado. Para voltar a gravar, você <b>precisa recarregar esta página (F5)</b>.</span>
            <button onclick="window.top.location.reload(true)" style="background: white; color: #ef4444; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;">Recarregar Agora</button>
            <button onclick="this.parentElement.remove()" style="background: transparent; color: white; border: none; cursor: pointer; font-size: 16px;">×</button>
        `;
        document.body.appendChild(banner);
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
                    if (!chrome.runtime?.id) return;
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
                        }).catch(()=>{});
                    }
                } catch (err) {
                }
            }
        }, 500);
    });
    observerSPA.observe(document.body, { childList: true, subtree: true });

    // --- UX Feedback (Toast & Widget) ---
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        // Bloqueia a renderização de UI dentro de Iframes! O UI deve aparecer apenas na janela principal.
        const isUIAction = ["show_toast", "update_toast", "show_player_modal", "show_pin_tooltip", "show_editor_modal", "show_countdown"].includes(msg.action);
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
            let toast = document.getElementById("capture-os-toast");
            if(toast) toast.remove();
            
            mountPlayerModal(msg.url, msg.roteiro);
        } else if (msg.action === "show_error_toast") {
            showToast("error");
        } else if (msg.action === "show_editor_modal") {
            let toast = document.getElementById("capture-os-toast");
            if(toast) toast.remove();
            
            mountEditorModal(msg.backendUrl, msg.session_id);
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
                        if (chrome.runtime && chrome.runtime.sendMessage) {
                            chrome.runtime.sendMessage({ action: 'start_recording_now' }).catch(() => {});
                        }
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

    function showToast(type, msg) {
        let toast = document.getElementById("capture-os-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "capture-os-toast";
            toast.style.cssText = `
                position: fixed;
                top: 24px;
                left: 50%;
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
                transform: translateX(-50%) translateY(-30px) scale(0.95);
            `;
            document.body.appendChild(toast);
        }

        // Anima a entrada
        setTimeout(() => {
            toast.style.opacity = "1";
            toast.style.transform = "translateX(-50%) translateY(0) scale(1)";
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
                            <span id="capture-os-toast-msg" style="font-size: 14px;">Processando...</span>
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
                <span id="capture-os-toast-msg">${msg || "Vídeo finalizado! Abrindo player..."}</span>
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
                <span id="capture-os-toast-msg">${msg || "Falha na comunicação com o servidor."}</span>
            `;
            setTimeout(() => fecharToast(toast), 6000);
        } else if (type === "warning") {
            toast.style.background = "rgba(245, 158, 11, 0.85)";
            toast.style.border = "1px solid rgba(245, 158, 11, 0.3)";
            toast.innerHTML = `
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <span id="capture-os-toast-msg">${msg || "Aviso"}</span>
            `;
            setTimeout(() => fecharToast(toast), 6000);
        } else if (type === "success_arbitro") {
            toast.style.background = "rgba(0, 200, 83, 0.85)";
            toast.style.border = "1px solid rgba(0, 200, 83, 0.3)";
            toast.innerHTML = `<span id="capture-os-toast-msg">Correto!</span>`;
            setTimeout(() => fecharToast(toast), 3000);
        }
    }

    function fecharToast(toast) {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(-50%) translateY(-30px) scale(0.95)";
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 400);
    }



    // --- Player Modal (Vimeo Record Aesthetic) ---
    function mountPlayerModal(videoUrl, roteiro) {
        // Extrai session_id da URL (ex: sess_1780090948221)
        const match = videoUrl.match(/(sess_\d+)/);
        const session_id = match ? match[1] : '';

        // Extrai o backendUrl do videoUrl
        let backendUrl = '';
        try {
            const urlObj = new URL(videoUrl);
            backendUrl = urlObj.origin;
        } catch (e) {
            backendUrl = 'http://127.0.0.1:8000';
        }

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
                        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                            <a href="${videoUrl}" target="_blank" download="tutorial_capture_os_${Date.now()}.mp4" class="btn btn-primary" style="flex: 1; min-width: 200px;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                Baixar Vídeo (MP4)
                            </a>
                            <button class="btn btn-secondary" id="copy-btn" style="flex: 1; min-width: 200px;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                Copiar Roteiro
                            </button>
                        </div>
                        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                            <a href="${backendUrl}/artifacts/${session_id}/apostila.pdf" target="_blank" download="apostila_capture_os_${Date.now()}.pdf" class="btn btn-secondary" style="flex: 1; min-width: 140px; font-size: 13px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                Baixar PDF
                            </a>
                            <a href="${backendUrl}/artifacts/${session_id}/transcricao.txt" target="_blank" download="transcricao_capture_os_${Date.now()}.txt" class="btn btn-secondary" style="flex: 1; min-width: 140px; font-size: 13px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                Transcrição
                            </a>
                            <a href="${backendUrl}/artifacts/${session_id}/quiz.json" target="_blank" download="quiz_capture_os_${Date.now()}.json" class="btn btn-secondary" style="flex: 1; min-width: 140px; font-size: 13px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                JSON do Quiz
                            </a>
                            <a href="${backendUrl}/scorm/${session_id}.zip" target="_blank" download="pacote_scorm_${session_id}.zip" class="btn btn-secondary" style="flex: 1; min-width: 140px; font-size: 13px; color: #0b5ce3; border-color: #bfdbfe; background: #eff6ff;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                Pacote SCORM
                            </a>
                        </div>
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

    // --- Editor Modal Injetado ---
    function mountEditorModal(backendUrl, sessionId) {
        let existing = document.getElementById('capture-os-editor-host');
        if (existing) existing.remove();

        const host = document.createElement('div');
        host.id = 'capture-os-editor-host';
        host.style.cssText = `
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            z-index: 2147483647;
            display: flex;
            justify-content: center;
            align-items: center;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            background: rgba(15, 23, 42, 0.4);
            opacity: 0;
            transition: opacity 0.4s ease;
        `;
        
        document.body.appendChild(host);
        const shadow = host.attachShadow({mode: 'open'});
        
        shadow.innerHTML = `
            <style>
                .modal-container {
                    width: 700px;
                    max-width: 95vw;
                    height: 85vh;
                    background: transparent;
                    border-radius: 16px;
                    display: flex;
                    flex-direction: column;
                    transform: translateY(20px) scale(0.98);
                    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    overflow: hidden;
                }
                iframe {
                    width: 100%;
                    height: 100%;
                    border: none;
                    background: transparent;
                }
            </style>
            <div class="modal-container" id="editor-modal">
                <iframe src="${backendUrl}/editor?session=${sessionId}&embedded=true"></iframe>
            </div>
        `;

        requestAnimationFrame(() => {
            host.style.opacity = '1';
            shadow.getElementById('editor-modal').style.transform = 'translateY(0) scale(1)';
        });

        // Ouve mensagens do iframe para fechar o modal ou broadcast
        const messageHandler = (e) => {
            if (e.data && (e.data.action === "close_editor_modal" || e.data.action === "close_editor_modal_and_resume" || e.data.action === "cancel_editor_modal")) {
                host.style.opacity = '0';
                shadow.getElementById('editor-modal').style.transform = 'translateY(20px) scale(0.98)';
                setTimeout(() => {
                    host.remove();
                    window.removeEventListener("message", messageHandler);
                }, 400);

                if (e.data.action === "close_editor_modal_and_resume") {
                    showToast("processing", "Renderizando vídeo final...");
                    
                    // Delega polling ao background (resiliente à navegação da página)
                    if (chrome.runtime && chrome.runtime.sendMessage) {
                        chrome.runtime.sendMessage({ 
                            action: 'resume_polling_after_editor', 
                            session_id: e.data.session_id 
                        }).catch(() => {});
                    }
                    
                } else if (e.data.action === "cancel_editor_modal") {
                    if (chrome.runtime && chrome.runtime.sendMessage) {
                        chrome.runtime.sendMessage({ action: "abort_processing" }).catch(() => {});
                    }
                }
            }
        };
        window.addEventListener("message", messageHandler);
    }

    // Escuta mensagens do background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "SHOW_HINT_LOCAL") {
            const step = request.step;
            if (!step) return;
            
            let targetEl = null;
            if (step.css_selector && step.css_selector !== "body") {
                try { targetEl = document.querySelector(step.css_selector); } catch(e){}
            }
            if (!targetEl && step.xpath && step.xpath !== "/html/body") {
                try { 
                    const res = document.evaluate(step.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    targetEl = res.singleNodeValue;
                } catch(e){}
            }

            if (targetEl) {
                targetEl.classList.add("capture-os-hint-highlight");
                targetEl.style.boxShadow = "0 0 0 4px rgba(59, 130, 246, 0.6), 0 0 20px rgba(59, 130, 246, 0.4)";
                targetEl.style.outline = "2px solid #3b82f6";
                targetEl.style.borderRadius = "4px";
                targetEl.style.transition = "all 0.3s ease";
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });

    // --- Funções do Sandbox Widget ---
    let sandboxNavTimeout = null;

    window.renderSandboxWidget = function() {
        if (!isSandboxMode || sandboxHotspots.length === 0) return;
        if (window !== window.top) return; // Não renderiza o widget dentro de iframes!
        
        // Limpa qualquer timeout anterior para evitar race conditions
        if (sandboxNavTimeout) {
            clearTimeout(sandboxNavTimeout);
            sandboxNavTimeout = null;
        }

        let widget = document.getElementById("capture-os-sandbox-widget");
        if (!widget) {
            widget = document.createElement("div");
            widget.id = "capture-os-sandbox-widget";
            // Estilos iniciais. A posição pode ser arrastada depois.
            widget.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 340px;
                background: #1e1e1e;
                color: #fff;
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                z-index: 999999999;
                border: 1px solid rgba(255,255,255,0.1);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                user-select: none;
            `;

            // Drag area (Header)
            const header = document.createElement("div");
            header.style.cssText = `
                background: #2a2a2a;
                padding: 10px 15px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: grab;
                border-bottom: 1px solid rgba(255,255,255,0.05);
            `;
            header.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);"></div>
                    <span style="font-size: 12px; font-weight: 700; color: #f3f4f6; letter-spacing: 0.8px;">PRÁTICA ATIVA</span>
                </div>
                <div id="sandbox-xp" style="font-size: 13px; font-weight: bold; color: #10b981; background: rgba(16, 185, 129, 0.1); padding: 4px 10px; border-radius: 12px;">0 XP</div>
            `;
            
            // Drag Logic
            let isDragging = false;
            let startX, startY, initialRight, initialBottom;
            header.addEventListener("mousedown", (e) => {
                isDragging = true;
                header.style.cursor = "grabbing";
                startX = e.clientX;
                startY = e.clientY;
                const rect = widget.getBoundingClientRect();
                initialRight = window.innerWidth - rect.right;
                initialBottom = window.innerHeight - rect.bottom;
                e.preventDefault();
            });
            document.addEventListener("mousemove", (e) => {
                if (!isDragging) return;
                const dx = startX - e.clientX;
                const dy = startY - e.clientY;
                widget.style.right = (initialRight + dx) + "px";
                widget.style.bottom = (initialBottom + dy) + "px";
            });
            document.addEventListener("mouseup", () => {
                if (isDragging) {
                    isDragging = false;
                    header.style.cursor = "grab";
                }
            });

            const content = document.createElement("div");
            content.id = "sandbox-widget-content";
            content.style.cssText = "padding: 16px 15px; display: flex; flex-direction: column; gap: 12px;";

            const footer = document.createElement("div");
            footer.style.cssText = `
                background: rgba(0,0,0,0.2);
                padding: 10px 15px;
                display: flex;
                justify-content: space-between;
                border-top: 1px solid rgba(255,255,255,0.05);
            `;
            footer.innerHTML = `
                <button id="btn-encerrar-pratica" style="background: transparent; color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;">Sair</button>
                <div style="display: flex; gap: 8px;">
                    <button id="btn-dica-pratica" style="background: rgba(255,255,255,0.05); color: #e5e7eb; border: 1px solid rgba(255,255,255,0.1); padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 4px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg> Dica
                    </button>
                    <button id="btn-pular-pratica" style="background: #3b82f6; color: #fff; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 4px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">
                        Pular <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="M12 5l7 7-7 7"></path></svg>
                    </button>
                </div>
            `;

            widget.appendChild(header);
            widget.appendChild(content);
            widget.appendChild(footer);
            document.body.appendChild(widget);

            // Bind events
            document.getElementById("btn-encerrar-pratica").onclick = window.endSandboxPractice;
            document.getElementById("btn-dica-pratica").onclick = window.showSandboxHint;
            document.getElementById("btn-pular-pratica").onclick = window.skipSandboxStep;
            
            // Hover effects
            const addHover = (id, hoverBg, normalBg) => {
                const el = document.getElementById(id);
                if(el) {
                    el.onmouseenter = () => el.style.background = hoverBg;
                    el.onmouseleave = () => el.style.background = normalBg;
                }
            };
            addHover("btn-encerrar-pratica", "rgba(239, 68, 68, 0.1)", "transparent");
            addHover("btn-dica-pratica", "rgba(255,255,255,0.1)", "rgba(255,255,255,0.05)");
            addHover("btn-pular-pratica", "#2563eb", "#3b82f6");
        }

        const step = sandboxHotspots[sandboxPassoAtual];
        if (step) {
            document.getElementById("sandbox-xp").innerText = `${sandboxXP} XP`;
            document.getElementById("sandbox-widget-content").innerHTML = `
                <div style="font-size: 11px; color: #a1a1aa; text-transform: uppercase; font-weight: 700; letter-spacing: 0.8px;">Passo ${sandboxPassoAtual + 1} de ${sandboxTotalPassos}</div>
                <div style="font-size: 14px; line-height: 1.5; color: #f4f4f5;">${step.micro_narracao || step.ancora || "Interaja com a tela para avançar."}</div>
            `;
            if (step.action === "navigation") {
                document.getElementById("btn-dica-pratica").style.display = "none";
                document.getElementById("btn-pular-pratica").style.display = "none";
                document.getElementById("sandbox-widget-content").innerHTML = `
                    <div style="font-size: 11px; color: #a1a1aa; text-transform: uppercase; font-weight: 700; letter-spacing: 0.8px;">Passo ${sandboxPassoAtual + 1} de ${sandboxTotalPassos}</div>
                    <div style="font-size: 14px; line-height: 1.5; color: #f4f4f5;">Aguarde, carregando...</div>
                `;
                // Auto-advance after 2 seconds to let the user see it, or if they navigated
                sandboxNavTimeout = setTimeout(() => {
                    if (sandboxPassoAtual === sandboxTotalPassos - 1) {
                         // Se for o último passo, encerra
                         advanceSandboxStep();
                    } else {
                         sandboxXP += 10;
                         sandboxPassoAtual += 1;
                         const concluido = sandboxPassoAtual >= sandboxTotalPassos;
                         chrome.storage.local.set({ sandboxXP, sandboxPassoAtual, sandboxStats });
                         chrome.runtime.sendMessage({
                             type: 'ARBITRO_PASSO_OK',
                             session_id: sandboxSessionId,
                             passo: sandboxPassoAtual,
                             total: sandboxTotalPassos,
                             xp: sandboxXP,
                             concluido: concluido
                         }).catch(() => {});
                         // A renderização ocorrerá via listener do chrome.storage.onChanged
                    }
                }, 1500);
            } else {
                document.getElementById("btn-dica-pratica").style.display = "flex";
                document.getElementById("btn-pular-pratica").style.display = "flex";
            }
        }
    };

    window.removeSandboxWidget = function() {
        if (window !== window.top) return;
        const widget = document.getElementById("capture-os-sandbox-widget");
        if (widget) widget.remove();
        // Remove also any existing hint highlights
        document.querySelectorAll(".capture-os-hint-highlight").forEach(el => {
            el.classList.remove("capture-os-hint-highlight");
            el.style.boxShadow = "";
            el.style.outline = "";
        });
    };

    window.advanceSandboxStep = function() {
        sandboxXP += 10;
        sandboxPassoAtual += 1;
        chrome.storage.local.set({ sandboxXP, sandboxPassoAtual });
        showToast("success_arbitro");
        
        // Limpa dicas antigas
        document.querySelectorAll(".capture-os-hint-highlight").forEach(el => {
            el.classList.remove("capture-os-hint-highlight");
            el.style.boxShadow = "";
            el.style.outline = "";
        });

        const concluido = sandboxPassoAtual >= sandboxTotalPassos;
        chrome.runtime.sendMessage({
            type: 'ARBITRO_PASSO_OK',
            session_id: sandboxSessionId,
            passo: sandboxPassoAtual,
            total: sandboxTotalPassos,
            xp: sandboxXP,
            concluido: concluido
        }).catch(() => {});

        if (!concluido) {
            // O chrome.storage.onChanged lidará com a renderização.
            // Apenas para garantir que o iframe não renderize, deixamos limpo.
        }
    };

    window.skipSandboxStep = function() {
        const step = sandboxHotspots[sandboxPassoAtual];
        if (!step) return;
        
        if (step.action !== "navigation") {
            sandboxXP -= 10;
            sandboxStats.skips += 1;
        }
        sandboxPassoAtual += 1;
        chrome.storage.local.set({ sandboxXP, sandboxPassoAtual, sandboxStats });
        
        document.querySelectorAll(".capture-os-hint-highlight").forEach(el => {
            el.classList.remove("capture-os-hint-highlight");
            el.style.boxShadow = "";
            el.style.outline = "";
        });

        const concluido = sandboxPassoAtual >= sandboxTotalPassos;
        chrome.runtime.sendMessage({
            type: 'ARBITRO_PASSO_OK',
            session_id: sandboxSessionId,
            passo: sandboxPassoAtual,
            total: sandboxTotalPassos,
            xp: sandboxXP,
            concluido: concluido
        }).catch(() => {});

        if (concluido) {
            renderSandboxScoreWidget();
        } else {
            if (window === window.top) renderSandboxWidget();
        }
    };

    window.showSandboxHint = function() {
        sandboxXP -= 5;
        sandboxStats.hints += 1;
        chrome.storage.local.set({ sandboxXP, sandboxStats });
        renderSandboxWidget();

        const step = sandboxHotspots[sandboxPassoAtual];
        if (!step) return;

        // Avisa TODAS as janelas (iframes inclusos) para tentar mostrar o hint
        chrome.runtime.sendMessage({
            action: "SHOW_HINT_BROADCAST",
            step: step
        }).catch(() => {});
        
        // Em 200ms a gente confere se alguém pintou o highlight. Se não, exibe aviso (no top window).
        if (window === window.top) {
            setTimeout(() => {
                // we assume if it worked, some frame scrolled to it.
                // It's hard to synchronously know if an iframe succeeded without direct messaging.
                // We'll trust it worked if they clicked the button.
            }, 300);
        }
    };

    window.endSandboxPractice = function() {
        chrome.storage.local.set({ sandboxMode: false });
        chrome.runtime.sendMessage({ type: "ARBITRO_ENCERRADO" }).catch(() => {});
        showToast("warning", "Modo Prática suspenso. Te esperamos na próxima!");
    };

    window.renderSandboxScoreWidget = function() {
        if (window !== window.top) return;
        
        let widget = document.getElementById("capture-os-sandbox-widget");
        if (!widget) return;
        
        const perc = Math.max(0, Math.round(((sandboxTotalPassos * 10) - (sandboxStats.errors*5) - (sandboxStats.hints*5) - (sandboxStats.skips*10)) / (sandboxTotalPassos * 10) * 100)) || 0;
        
        widget.innerHTML = `
            <div style="background: #2a2a2a; padding: 15px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 14px; font-weight: 700; color: #10b981; letter-spacing: 0.5px;">PRÁTICA CONCLUÍDA</span>
            </div>
            <div style="padding: 20px; display: flex; flex-direction: column; gap: 16px;">
                <div style="text-align: center;">
                    <div style="font-size: 32px; font-weight: 800; color: #fff;">${sandboxXP} <span style="font-size: 16px; color: #9ca3af;">XP</span></div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; text-align: center;">
                    <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 16px; font-weight: bold; color: #f87171;">${sandboxStats.errors}</div>
                        <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; margin-top: 2px;">Erros</div>
                    </div>
                    <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 16px; font-weight: bold; color: #fbbf24;">${sandboxStats.hints}</div>
                        <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; margin-top: 2px;">Dicas</div>
                    </div>
                    <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 16px; font-weight: bold; color: #60a5fa;">${sandboxStats.skips}</div>
                        <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; margin-top: 2px;">Pulos</div>
                    </div>
                </div>
                <button id="btn-fechar-score" style="margin-top: 10px; width: 100%; background: #3b82f6; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;">Fechar</button>
            </div>
        `;
        
        setTimeout(() => {
            const btn = document.getElementById("btn-fechar-score");
            if (btn) {
                btn.addEventListener("click", () => {
                    chrome.storage.local.set({ sandboxMode: false });
                });
            }
        }, 100);
    };


})();
