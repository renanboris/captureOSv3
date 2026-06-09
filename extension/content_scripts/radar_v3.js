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
        
        const _isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const banner = document.createElement("div");
        banner.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${_isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.9)'};
            color: ${_isDark ? '#fca5a5' : 'white'};
            padding: 14px 24px;
            border-radius: 14px;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            font-weight: 600;
            z-index: 2147483647;
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid ${_isDark ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.2)'};
            box-shadow: 0 8px 32px rgba(239, 68, 68, 0.25), 0 0 0 1px rgba(239, 68, 68, 0.1);
            display: flex;
            align-items: center;
            gap: 12px;
            animation: _capture_banner_in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        `;
        const bannerStyle = document.createElement('style');
        bannerStyle.innerHTML = `
            @keyframes _capture_banner_in {
                from { transform: translateX(-50%) translateY(-20px); opacity: 0; }
                to { transform: translateX(-50%) translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(bannerStyle);
        banner.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            <span>O Capture OS foi atualizado. Para voltar a gravar, você <b>precisa recarregar esta página (F5)</b>.</span>
            <button onclick="window.top.location.reload(true)" style="background: ${_isDark ? 'rgba(255,255,255,0.1)' : 'white'}; color: ${_isDark ? '#fca5a5' : '#ef4444'}; border: 1px solid ${_isDark ? 'rgba(255,255,255,0.1)' : 'transparent'}; padding: 7px 14px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 13px; transition: all 0.2s;">Recarregar Agora</button>
            <button onclick="this.parentElement.remove()" style="background: transparent; color: ${_isDark ? '#fca5a5' : 'white'}; border: none; cursor: pointer; font-size: 18px; padding: 4px; line-height: 1; opacity: 0.7;">×</button>
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
                span.textContent = msg.msg;
            } else {
                // Se o usuário navegou, o toast sumiu. Recria com o design moderno.
                showToast("processing", msg.msg);
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
                background: rgba(15,23,42,0.92); z-index: 2147483647;
                display: flex; align-items: center; justify-content: center; gap: 16px;
                backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 100px; padding: 14px 32px;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                box-shadow: 0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.06);
                transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
                animation: _capture_slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            `;
            
            const style = document.createElement('style');
            style.innerHTML = `
                @keyframes _capture_slideDown {
                    from { transform: translate(-50%, -20px); opacity: 0; }
                    to { transform: translate(-50%, 0); opacity: 1; }
                }
                @keyframes _capture_countdown_pop {
                    0% { transform: scale(1.4); opacity: 0; }
                    50% { opacity: 1; }
                    100% { transform: scale(1); opacity: 1; }
                }
                @keyframes _capture_pulse_dot {
                    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
                    70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
                    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                }
                @keyframes _capture_go_flash {
                    0% { transform: scale(0.5); opacity: 0; }
                    40% { transform: scale(1.1); opacity: 1; }
                    100% { transform: scale(1); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
            
            const countText = document.createElement("div");
            countText.style.cssText = `
                font-size: 56px; font-weight: 800; color: #ef4444;
                min-width: 48px; text-align: center; line-height: 1;
                animation: _capture_countdown_pop 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                text-shadow: 0 0 30px rgba(239, 68, 68, 0.4);
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
                    // Re-trigger pop animation
                    countText.style.animation = 'none';
                    countText.offsetHeight; // force reflow
                    countText.style.animation = '_capture_countdown_pop 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards';
                } else {
                    clearInterval(interval);
                    
                    // Show "GO!" flash before fading out
                    countText.innerText = 'GO!';
                    countText.style.color = '#10B981';
                    countText.style.fontSize = '40px';
                    countText.style.textShadow = '0 0 30px rgba(16, 185, 129, 0.5)';
                    countText.style.animation = '_capture_go_flash 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards';
                    hint.innerHTML = 'Gravando!';
                    
                    setTimeout(() => {
                        overlay.style.opacity = "0";
                        overlay.style.transform = "translate(-50%, -20px)";
                        setTimeout(() => {
                            overlay.remove();
                            style.remove();
                            if (chrome.runtime && chrome.runtime.sendMessage) {
                                chrome.runtime.sendMessage({ action: 'start_recording_now' }).catch(() => {});
                            }
                        }, 500);
                    }, 600);
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
        const _isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        let toast = document.getElementById("capture-os-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "capture-os-toast";
            toast.style.cssText = `
                position: fixed;
                top: 24px;
                left: 50%;
                padding: 16px 24px;
                border-radius: 16px;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 15px;
                font-weight: 500;
                color: white;
                z-index: 2147483647;
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                box-shadow: 0 12px 48px rgba(0,0,0,0.3), 0 0 0 1px ${_isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'};
                display: flex;
                align-items: center;
                gap: 14px;
                transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
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
            toast.style.background = _isDark ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.92)';
            toast.style.border = `1px solid ${_isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`;
            toast.style.color = _isDark ? '#f8fafc' : '#0f172a';
            // Adicionada a Progress Bar na base do Toast
            toast.style.flexDirection = "column";
            toast.style.alignItems = "stretch";
            toast.style.gap = "8px";
            toast.style.padding = "14px 20px 10px 20px";
            
            toast.innerHTML = `
                <div style="display: flex; flex-direction: column; width: 100%; gap: 10px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <div style="display: flex; align-items: center; gap: 14px;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" class="capture-spin" style="flex-shrink:0;">
                                <circle cx="12" cy="12" r="10" stroke="${_isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}" stroke-width="2.5" fill="none"></circle>
                                <path d="M12 2a10 10 0 0 1 10 10" stroke="#3B82F6" stroke-width="2.5" stroke-linecap="round" fill="none"></path>
                            </svg>
                            <span id="capture-os-toast-msg" style="font-size: 14px;">${msg || 'Processando...'}</span>
                        </div>
                        <button id="capture-os-cancel-btn" style="background: ${_isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.08)'}; border: none; color: #ef4444; font-size: 13px; font-weight: 600; cursor: pointer; padding: 5px 12px; border-radius: 8px; transition: all 0.2s;">Cancelar</button>
                    </div>
                    <div style="width: 100%; height: 3px; background: ${_isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}; border-radius: 3px; overflow: hidden;">
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
                    .capture-spin { animation: capture-spin 0.8s linear infinite; }
                    @keyframes capture-progress { 
                        0% { width: 0%; } 
                        20% { width: 30%; }
                        50% { width: 60%; }
                        80% { width: 85%; }
                        100% { width: 95%; } 
                    }
                    .capture-progress-fill {
                        height: 100%;
                        background: linear-gradient(90deg, #3B82F6, #8B5CF6, #3B82F6);
                        background-size: 200% 100%;
                        width: 0%;
                        border-radius: 3px;
                        animation: capture-progress 60s cubic-bezier(0.1, 0.7, 0.1, 1) forwards, capture-progress-shimmer 2s linear infinite;
                    }
                    @keyframes capture-progress-shimmer {
                        0% { background-position: 200% 0; }
                        100% { background-position: -200% 0; }
                    }
                `;
                document.head.appendChild(style);
            }
        } else if (type === "success") {
            toast.style.background = _isDark ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.9)';
            toast.style.border = `1px solid ${_isDark ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.2)'}`;
            toast.style.color = _isDark ? '#6EE7B7' : 'white';
            toast.innerHTML = `
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span id="capture-os-toast-msg">${msg || "Vídeo finalizado! Abrindo player..."}</span>
            `;
            setTimeout(() => fecharToast(toast), 6000);
        } else if (type === "error") {
            toast.style.background = _isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.9)';
            toast.style.border = `1px solid ${_isDark ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.2)'}`;
            toast.style.color = _isDark ? '#FCA5A5' : 'white';
            toast.innerHTML = `
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
                <span id="capture-os-toast-msg">${msg || "Falha na comunicação com o servidor."}</span>
            `;
            setTimeout(() => fecharToast(toast), 6000);
        } else if (type === "warning") {
            toast.style.background = _isDark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.9)';
            toast.style.border = `1px solid ${_isDark ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.2)'}`;
            toast.style.color = _isDark ? '#FCD34D' : 'white';
            toast.innerHTML = `
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <span id="capture-os-toast-msg">${msg || "Aviso"}</span>
            `;
            setTimeout(() => fecharToast(toast), 6000);
        } else if (type === "success_arbitro") {
            toast.style.background = _isDark ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.9)';
            toast.style.border = `1px solid ${_isDark ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.2)'}`;
            toast.style.color = _isDark ? '#6EE7B7' : 'white';
            toast.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span id="capture-os-toast-msg">Correto!</span>
            `;
            setTimeout(() => fecharToast(toast), 3000);
        }
    }

    function fecharToast(toast) {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(-50%) translateY(-20px) scale(0.97)";
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 500);
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

        const _isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

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
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            background: ${_isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(15, 23, 42, 0.4)'};
            opacity: 0;
            transition: opacity 0.4s ease;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;
        
        document.body.appendChild(host);
        const shadow = host.attachShadow({mode: 'open'});

        // SVG icons for step badges (replacing emojis)
        const svgBulb = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>';
        const svgCheck = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

        let stepsHtml = '';
        if (roteiro && roteiro.length > 0) {
            roteiro.forEach((passo, index) => {
                let badge = passo.passo;
                let badgeStyle = '';
                if (passo.passo === 0) { badge = svgBulb; badgeStyle = `background: ${_isDark ? 'rgba(59,130,246,0.15)' : '#eff6ff'}; color: #3B82F6;`; }
                else if (passo.passo === 999) { badge = svgCheck; badgeStyle = `background: ${_isDark ? 'rgba(16,185,129,0.15)' : '#ecfdf5'}; color: #10B981;`; }
                
                const stepText = passo.ancora || passo.intencao_original || '';
                // Pular passos sem texto
                if (!stepText.trim()) return;

                stepsHtml += `
                    <div class="step-item">
                        <div class="step-num" style="${badgeStyle}">${badge}</div>
                        <div class="step-text">${stepText}</div>
                    </div>
                `;
            });
        } else {
            stepsHtml = `<div style="color: ${_isDark ? '#94A3B8' : '#64748b'}; font-size: 14px; text-align: center; margin-top: 40px;">Nenhum roteiro detalhado gerado.</div>`;
        }

        shadow.innerHTML = `
            <style>
                :host {
                    --primary: #3B82F6;
                    --primary-hover: #2563EB;
                    --bg: ${_isDark ? '#0F172A' : '#ffffff'};
                    --bg-secondary: ${_isDark ? '#1E293B' : '#F8FAFC'};
                    --text-main: ${_isDark ? '#F8FAFC' : '#0f172a'};
                    --text-muted: ${_isDark ? '#94A3B8' : '#64748b'};
                    --border: ${_isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0'};
                    --btn-secondary-bg: ${_isDark ? 'rgba(255,255,255,0.05)' : 'white'};
                    --btn-secondary-hover: ${_isDark ? 'rgba(255,255,255,0.1)' : '#f1f5f9'};
                    --btn-secondary-border: ${_isDark ? 'rgba(255,255,255,0.1)' : '#cbd5e1'};
                }
                @keyframes _capture_modal_in {
                    0% { transform: translateY(24px) scale(0.96); opacity: 0; }
                    60% { transform: translateY(-4px) scale(1.005); }
                    100% { transform: translateY(0) scale(1); opacity: 1; }
                }
                .modal-container {
                    width: 1000px;
                    max-width: 95vw;
                    height: 650px;
                    max-height: 90vh;
                    background: var(--bg);
                    border-radius: 20px;
                    box-shadow: 0 25px 60px -12px rgba(0, 0, 0, ${_isDark ? '0.6' : '0.25'}), 0 0 0 1px var(--border);
                    display: flex;
                    overflow: hidden;
                    position: relative;
                    animation: _capture_modal_in 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
                .video-section {
                    flex: 1.5;
                    background: #000;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    position: relative;
                    border-radius: 20px 0 0 20px;
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
                    font-weight: 700;
                    color: var(--text-main);
                    letter-spacing: -0.3px;
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
                    background: ${_isDark ? 'rgba(59,130,246,0.12)' : '#f1f5f9'};
                    color: var(--primary);
                    font-weight: 600;
                    font-size: 13px;
                    width: 30px;
                    height: 30px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .step-text {
                    font-size: 14px;
                    line-height: 1.6;
                    color: var(--text-main);
                    margin-top: 5px;
                }
                .script-footer {
                    padding: 20px 24px;
                    border-top: 1px solid var(--border);
                    display: flex;
                    gap: 10px;
                    flex-direction: column;
                    background: var(--bg-secondary);
                }
                .btn-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                }
                .btn-grid-top {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                    margin-bottom: 2px;
                }
                .btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    width: 100%;
                    padding: 11px 12px;
                    border-radius: 10px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    border: none;
                    text-decoration: none;
                    box-sizing: border-box;
                }
                .btn-primary {
                    background: var(--primary);
                    color: white;
                    box-shadow: 0 2px 8px rgba(59,130,246,0.25);
                }
                .btn-primary:hover {
                    background: var(--primary-hover);
                    box-shadow: 0 4px 12px rgba(59,130,246,0.35);
                }
                .btn-secondary {
                    background: var(--btn-secondary-bg);
                    color: var(--text-main);
                    border: 1px solid var(--btn-secondary-border);
                }
                .btn-secondary:hover {
                    background: var(--btn-secondary-hover);
                }
                .btn-accent {
                    background: ${_isDark ? 'rgba(59,130,246,0.12)' : '#eff6ff'};
                    color: #3B82F6;
                    border: 1px solid ${_isDark ? 'rgba(59,130,246,0.2)' : '#bfdbfe'};
                }
                .btn-accent:hover {
                    background: ${_isDark ? 'rgba(59,130,246,0.2)' : '#dbeafe'};
                }
                .close-btn {
                    position: absolute;
                    top: 16px;
                    right: 16px;
                    background: ${_isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255, 255, 255, 0.95)'};
                    border: 1px solid ${_isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0'};
                    width: 34px;
                    height: 34px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: ${_isDark ? '#94A3B8' : '#64748b'};
                    z-index: 10;
                    transition: all 0.2s;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                    backdrop-filter: blur(8px);
                }
                .close-btn:hover {
                    background: ${_isDark ? 'rgba(239,68,68,0.15)' : 'white'};
                    color: #ef4444;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
                }
                .script-content::-webkit-scrollbar { width: 5px; }
                .script-content::-webkit-scrollbar-track { background: transparent; }
                .script-content::-webkit-scrollbar-thumb { background: ${_isDark ? 'rgba(255,255,255,0.1)' : '#cbd5e1'}; border-radius: 10px; }
                .script-content::-webkit-scrollbar-thumb:hover { background: ${_isDark ? 'rgba(255,255,255,0.2)' : '#94a3b8'}; }
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
                        <div class="btn-grid-top">
                            <a href="${videoUrl}" target="_blank" download="tutorial_capture_os_${Date.now()}.mp4" class="btn btn-primary">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                Baixar Vídeo
                            </a>
                            <button class="btn btn-secondary" id="copy-btn">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                Copiar Roteiro
                            </button>
                        </div>
                        <div class="btn-grid">
                            <a href="${backendUrl}/artifacts/${session_id}/apostila.pdf" target="_blank" download="apostila_capture_os_${Date.now()}.pdf" class="btn btn-secondary">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                PDF
                            </a>
                            <a href="${backendUrl}/artifacts/${session_id}/transcricao.txt" target="_blank" download="transcricao_capture_os_${Date.now()}.txt" class="btn btn-secondary">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                Transcrição
                            </a>
                            <a href="${backendUrl}/artifacts/${session_id}/quiz.json" target="_blank" download="quiz_capture_os_${Date.now()}.json" class="btn btn-secondary">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                Quiz JSON
                            </a>
                            <a href="${backendUrl}/scorm/${session_id}.zip" target="_blank" download="pacote_scorm_${session_id}.zip" class="btn btn-accent">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                SCORM
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
                roteiro.forEach(p => { texto += `${p.passo}. ${p.ancora || p.intencao_original || ''}\n`; });
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
    async function mountEditorModal(backendUrl, sessionId) {
        let existing = document.getElementById('capture-os-editor-host');
        if (existing) existing.remove();

        const _isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        const host = document.createElement('div');
        host.id = 'capture-os-editor-host';
        host.style.cssText = `
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            z-index: 2147483647;
            display: flex;
            justify-content: center;
            align-items: center;
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            background: ${_isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(15, 23, 42, 0.4)'};
            opacity: 0;
            transition: opacity 0.4s ease;
        `;
        
        document.body.appendChild(host);
        const shadow = host.attachShadow({mode: 'open'});
        
        // Pass the auth token in the URL so the editor iframe has it
        // immediately on load — avoids postMessage timing issues.
        const { authToken: editorToken } = await new Promise(r =>
            chrome.storage.local.get(['authToken'], r)
        );
        const tokenParam = editorToken ? `&token=${encodeURIComponent(editorToken)}` : '';

        shadow.innerHTML = `
            <style>
                @keyframes _capture_editor_in {
                    0% { transform: translateY(24px) scale(0.96); opacity: 0; }
                    60% { transform: translateY(-3px) scale(1.003); }
                    100% { transform: translateY(0) scale(1); opacity: 1; }
                }
                @keyframes _capture_shimmer {
                    0% { background-position: -400px 0; }
                    100% { background-position: 400px 0; }
                }
                .modal-wrapper {
                    position: relative;
                }
                .modal-container {
                    width: 700px;
                    max-width: 95vw;
                    height: 85vh;
                    background: ${_isDark ? '#0F172A' : '#ffffff'};
                    border-radius: 20px;
                    display: flex;
                    flex-direction: column;
                    animation: _capture_editor_in 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                    box-shadow: 0 0 60px rgba(59,130,246,0.12), 0 25px 60px -12px rgba(0, 0, 0, ${_isDark ? '0.6' : '0.35'}), 0 0 0 1px ${_isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'};
                    overflow: hidden;
                    position: relative;
                }
                .editor-close-btn {
                    position: absolute;
                    top: -14px;
                    right: -14px;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: ${_isDark ? '#1E293B' : '#ffffff'};
                    border: 1px solid ${_isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0'};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: ${_isDark ? '#94A3B8' : '#64748b'};
                    z-index: 20;
                    transition: all 0.2s;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                }
                .editor-close-btn:hover {
                    background: ${_isDark ? 'rgba(239,68,68,0.15)' : '#FEF2F2'};
                    color: #ef4444;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
                }
                .loading-skeleton {
                    position: absolute;
                    top: 0; left: 0; width: 100%; height: 100%;
                    display: flex;
                    flex-direction: column;
                    padding: 24px;
                    gap: 16px;
                    z-index: 5;
                    background: ${_isDark ? '#0F172A' : '#ffffff'};
                    transition: opacity 0.4s ease;
                }
                .skeleton-bar {
                    height: 20px;
                    border-radius: 8px;
                    background: ${_isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'};
                    background-image: linear-gradient(
                        90deg,
                        ${_isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'} 0px,
                        ${_isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'} 200px,
                        ${_isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'} 400px
                    );
                    background-size: 800px 100%;
                    animation: _capture_shimmer 1.5s ease-in-out infinite;
                }
                iframe {
                    width: 100%;
                    height: 100%;
                    border: none;
                    background: transparent;
                    border-radius: 20px;
                    position: relative;
                    z-index: 10;
                }
            </style>
            <div class="modal-wrapper">
                <button class="editor-close-btn" id="editor-close-btn" title="Fechar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
                <div class="modal-container" id="editor-modal">
                    <div class="loading-skeleton" id="editor-loading">
                        <div class="skeleton-bar" style="width: 60%; height: 28px;"></div>
                        <div class="skeleton-bar" style="width: 100%; height: 40px;"></div>
                        <div class="skeleton-bar" style="width: 80%;"></div>
                        <div class="skeleton-bar" style="width: 45%;"></div>
                        <div class="skeleton-bar" style="width: 100%; flex: 1; border-radius: 12px;"></div>
                    </div>
                    <iframe src="${backendUrl}/editor?session=${sessionId}&embedded=true${tokenParam}" id="editor-iframe"></iframe>
                </div>
            </div>
        `;

        // Hide loading skeleton when iframe finishes loading
        const editorIframe = shadow.getElementById('editor-iframe');
        const loadingSkeleton = shadow.getElementById('editor-loading');
        if (editorIframe && loadingSkeleton) {
            editorIframe.addEventListener('load', () => {
                loadingSkeleton.style.opacity = '0';
                setTimeout(() => loadingSkeleton.remove(), 400);
            });
        }

        // Close button on overlay
        const editorCloseBtn = shadow.getElementById('editor-close-btn');
        if (editorCloseBtn) {
            editorCloseBtn.addEventListener('click', () => {
                host.style.opacity = '0';
                shadow.getElementById('editor-modal').style.transform = 'translateY(20px) scale(0.98)';
                setTimeout(() => host.remove(), 400);
                if (chrome.runtime && chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({ action: "abort_processing" }).catch(() => {});
                }
            });
        }

        requestAnimationFrame(() => {
            host.style.opacity = '1';
        });

        // Ouve mensagens do iframe para fechar o modal ou broadcast
        // Também responde ao editor pedindo o token de auth.
        const messageHandler = (e) => {
            if (e.data && e.data.action === 'get_auth_token') {
                chrome.storage.local.get(['authToken'], (res) => {
                    // Envia para todos os iframes do shadow DOM
                    const iframeEl = shadow.querySelector('iframe');
                    if (iframeEl && iframeEl.contentWindow) {
                        iframeEl.contentWindow.postMessage(
                            { type: 'captureOs_authToken', token: res.authToken || null },
                            '*'
                        );
                    }
                });
                return;
            }
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
                background: #0F172A;
                color: #fff;
                border-radius: 16px;
                box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06);
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                z-index: 999999999;
                border: 1px solid rgba(255,255,255,0.08);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                user-select: none;
            `;

            // Inject sandbox widget animations
            if (!document.getElementById('capture-os-sandbox-style')) {
                const sbxStyle = document.createElement('style');
                sbxStyle.id = 'capture-os-sandbox-style';
                sbxStyle.innerHTML = `
                    @keyframes _capture_progress_pulse {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.7; }
                    }
                `;
                document.head.appendChild(sbxStyle);
            }

            // Drag area (Header) - gradient instead of flat color
            const header = document.createElement("div");
            header.style.cssText = `
                background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%);
                padding: 0;
                display: flex;
                flex-direction: column;
                cursor: grab;
                border-bottom: 1px solid rgba(255,255,255,0.06);
            `;

            // Progress bar at top of header
            const progressTrack = document.createElement("div");
            progressTrack.id = "sandbox-progress-track";
            progressTrack.style.cssText = `
                width: 100%; height: 3px; background: rgba(255,255,255,0.06);
                border-radius: 16px 16px 0 0; overflow: hidden;
            `;
            const progressFill = document.createElement("div");
            progressFill.id = "sandbox-progress-fill";
            const progressPct = sandboxTotalPassos > 0 ? Math.round((sandboxPassoAtual / sandboxTotalPassos) * 100) : 0;
            progressFill.style.cssText = `
                width: ${progressPct}%; height: 100%;
                background: linear-gradient(90deg, #3B82F6, #10B981);
                border-radius: 0 2px 2px 0;
                transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
            `;
            progressTrack.appendChild(progressFill);

            const headerContent = document.createElement("div");
            headerContent.style.cssText = `
                padding: 10px 15px;
                display: flex;
                align-items: center;
                justify-content: space-between;
            `;
            headerContent.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);"></div>
                    <span style="font-size: 11px; font-weight: 700; color: #94A3B8; letter-spacing: 1px;">PRÁTICA ATIVA</span>
                </div>
                <div id="sandbox-xp" style="font-size: 13px; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.1); padding: 4px 12px; border-radius: 20px; letter-spacing: 0.3px;">0 XP</div>
            `;

            header.appendChild(progressTrack);
            header.appendChild(headerContent);
            
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
                background: rgba(0,0,0,0.25);
                padding: 10px 15px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-top: 1px solid rgba(255,255,255,0.06);
            `;
            footer.innerHTML = `
                <button id="btn-encerrar-pratica" style="background: transparent; color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;">Sair</button>
                <div style="display: flex; gap: 8px;">
                    <button id="btn-dica-pratica" style="background: rgba(255,255,255,0.05); color: #e5e7eb; border: 1px solid rgba(255,255,255,0.08); padding: 6px 16px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 5px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg> Dica
                    </button>
                    <button id="btn-pular-pratica" style="background: #3b82f6; color: #fff; border: none; padding: 6px 16px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 5px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);">
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

        // Update progress bar
        const progressFillEl = document.getElementById("sandbox-progress-fill");
        if (progressFillEl) {
            const pct = sandboxTotalPassos > 0 ? Math.round((sandboxPassoAtual / sandboxTotalPassos) * 100) : 0;
            progressFillEl.style.width = pct + '%';
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
            <div style="background: linear-gradient(135deg, #065F46 0%, #064E3B 100%); padding: 16px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span style="font-size: 12px; font-weight: 700; color: #6EE7B7; letter-spacing: 1px; text-transform: uppercase;">Prática Concluída</span>
            </div>
            <div style="padding: 24px 20px; display: flex; flex-direction: column; gap: 18px;">
                <div style="text-align: center;">
                    <div style="font-size: 40px; font-weight: 800; color: #F8FAFC; letter-spacing: -1px; line-height: 1;">${sandboxXP}</div>
                    <div style="font-size: 13px; font-weight: 600; color: #64748B; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px;">Pontos XP</div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; text-align: center;">
                    <div style="background: rgba(248,113,113,0.08); padding: 12px 8px; border-radius: 12px; border: 1px solid rgba(248,113,113,0.1);">
                        <div style="font-size: 20px; font-weight: 800; color: #f87171; letter-spacing: -0.5px;">${sandboxStats.errors}</div>
                        <div style="font-size: 10px; color: #94A3B8; text-transform: uppercase; margin-top: 4px; font-weight: 600; letter-spacing: 0.5px;">Erros</div>
                    </div>
                    <div style="background: rgba(251,191,36,0.08); padding: 12px 8px; border-radius: 12px; border: 1px solid rgba(251,191,36,0.1);">
                        <div style="font-size: 20px; font-weight: 800; color: #fbbf24; letter-spacing: -0.5px;">${sandboxStats.hints}</div>
                        <div style="font-size: 10px; color: #94A3B8; text-transform: uppercase; margin-top: 4px; font-weight: 600; letter-spacing: 0.5px;">Dicas</div>
                    </div>
                    <div style="background: rgba(96,165,250,0.08); padding: 12px 8px; border-radius: 12px; border: 1px solid rgba(96,165,250,0.1);">
                        <div style="font-size: 20px; font-weight: 800; color: #60a5fa; letter-spacing: -0.5px;">${sandboxStats.skips}</div>
                        <div style="font-size: 10px; color: #94A3B8; text-transform: uppercase; margin-top: 4px; font-weight: 600; letter-spacing: 0.5px;">Pulos</div>
                    </div>
                </div>
                <button id="btn-fechar-score" style="margin-top: 4px; width: 100%; background: #3b82f6; color: #fff; border: none; padding: 11px; border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 700; box-shadow: 0 4px 12px rgba(59,130,246,0.25); transition: all 0.2s;">Fechar</button>
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
