// radar_v3.js (Content Script)
(function() {
    const currentScriptId = Math.random().toString(36).substring(2) + "_" + Date.now();
    window.__capture_os_active_script_id = currentScriptId;

    console.log("Capture OS v3 - Radar Injetado", currentScriptId);

    let eventCounter = 1;
    let isSandboxMode = false;
    let sandboxSessionId = null;
    let sandboxTotalPassos = 0;
    let sandboxXP = 0;
    let sandboxHotspots = [];
    let sandboxStats = { errors: 0, hints: 0, skips: 0 };

    chrome.storage.local.get(['sandboxMode', 'sandboxSessionId', 'sandboxTotalPassos', 'sandboxPassoAtual', 'sandboxXP', 'sandboxHotspots', 'sandboxStats'], (res) => {
        if (window.__capture_os_active_script_id !== currentScriptId) {
            return;
        }
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
        if (window.__capture_os_active_script_id !== currentScriptId) {
            return;
        }
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
        if (window.__capture_os_active_script_id !== currentScriptId) {
            return;
        }
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
        if (window.__capture_os_active_script_id !== currentScriptId) {
            console.log("Capture OS: Instância de script antiga ignorando aviso de contexto invalidado.");
            return;
        }
        if (hasShownInvalidated) return;
        hasShownInvalidated = true;
        
        const banner = document.createElement("div");
        banner.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #FEF2F2;
            color: #B91C1C;
            padding: 14px 24px;
            border-radius: 8px;
            font-family: 'Aptos', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            font-size: 14px;
            font-weight: 500;
            z-index: 2147483647;
            border: 1px solid #FECACA;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
            display: flex;
            align-items: center;
            gap: 12px;
            animation: _capture_banner_in 0.3s forwards;
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
            <button onclick="window.top.location.reload(true)" style="background: #FFFFFF; color: #DC2626; border: 1px solid #FECACA; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.2s;">Recarregar</button>
            <button onclick="this.parentElement.remove()" style="background: transparent; color: #B91C1C; border: none; cursor: pointer; font-size: 18px; padding: 4px; line-height: 1; opacity: 0.7;">×</button>
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
        if (window.__capture_os_active_script_id !== currentScriptId) return;
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
        if (window.__capture_os_active_script_id !== currentScriptId) {
            return;
        }

        if (msg && msg.action === "ping") {
            sendResponse({ status: "pong" });
            return;
        }

        // Bloqueia a renderização de UI dentro de Iframes! O UI deve aparecer apenas na janela principal.
        const isUIAction = ["show_toast", "update_toast", "show_player_modal", "show_pin_tooltip", "show_editor_modal", "show_prep_toast"].includes(msg.action);
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
            const toastEl = document.getElementById("capture-os-toast");
            if (toastEl) {
                toastEl.style.opacity = "0";
                toastEl.style.transform = "translateX(-50%) translateY(-30px) scale(0.95)";
                setTimeout(() => toastEl.remove(), 400);
            }
            
            mountPlayerModal(msg.url, msg.roteiro, msg.backendUrl, msg.titulo);
        } else if (msg.action === "show_error_toast") {
            showToast("error");
        } else if (msg.action === "show_editor_modal") {
            const toastOverlay = document.getElementById("capture-os-toast");
            if(toastOverlay) toastOverlay.remove();
            
            mountEditorModal(msg.backendUrl, msg.session_id);
        } else if (msg.action === "show_prep_toast") {
            if (window !== window.top) return; // Impede que iframes renderizem contadores duplicados
            
            // Remove o overlay antigo se existir
            let oldOverlay = document.getElementById("capture-os-countdown");
            if (oldOverlay) oldOverlay.remove();
            
            const overlay = document.createElement("div");
            overlay.id = "capture-os-countdown";
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
                z-index: 2147483647; display: flex; align-items: center; justify-content: center;
                transition: opacity 0.3s ease; opacity: 0;
            `;
            
            const style = document.createElement('style');
            style.innerHTML = `
                @keyframes _capture_pop {
                    0% { transform: scale(0.95); opacity: 0; }
                    20% { transform: scale(1); opacity: 1; }
                    80% { transform: scale(1); opacity: 1; }
                    100% { transform: scale(1.05); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
            
            const numberEl = document.createElement("div");
            numberEl.style.cssText = "font-size: 64px; font-weight: 300; color: #FFFFFF; font-family: 'Aptos', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; opacity: 0;";

            overlay.appendChild(numberEl);
            document.documentElement.appendChild(overlay);

            // Animate opacity in
            setTimeout(() => { overlay.style.opacity = "1"; }, 10);

            let count = 3;
            numberEl.innerText = count;
            numberEl.style.animation = "_capture_pop 1s cubic-bezier(0.16, 1, 0.3, 1) forwards";

            const interval = setInterval(() => {
                count--;
                if (count > 0) {
                    numberEl.innerText = count;
                    // Retrigger animation
                    numberEl.style.animation = 'none';
                    numberEl.offsetHeight; /* force reflow */
                    numberEl.style.animation = "_capture_pop 1s cubic-bezier(0.16, 1, 0.3, 1) forwards";
                } else {
                    clearInterval(interval);
                    overlay.style.opacity = "0";
                    setTimeout(() => {
                        overlay.remove();
                        style.remove();
                        if (chrome.runtime && chrome.runtime.sendMessage) {
                            chrome.runtime.sendMessage({ action: 'start_recording_now' }).catch(() => {});
                        }
                    }, 300);
                }
            }, 1000);
        }
    });

    // Heartbeat para manter o Service Worker vivo durante a gravação
    setInterval(() => {
        if (window.__capture_os_active_script_id !== currentScriptId) {
            return;
        }
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
                font-family: 'Aptos', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
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
            toast.style.background = '#FFFFFF';
            toast.style.border = '1px solid #E5E7EB';
            toast.style.color = '#111827';
            // Adicionada a Progress Bar na base do Toast
            toast.style.flexDirection = "column";
            toast.style.alignItems = "stretch";
            toast.style.gap = "8px";
            toast.style.padding = "14px 20px 10px 20px";
            
            toast.innerHTML = `
                <div style="display: flex; flex-direction: column; width: 100%; gap: 10px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; margin-right: 12px;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" class="capture-spin" style="flex-shrink:0;">
                                <circle cx="12" cy="12" r="10" stroke="#F3F4F6" stroke-width="2.5" fill="none"></circle>
                                <path d="M12 2a10 10 0 0 1 10 10" stroke="#00998F" stroke-width="2.5" stroke-linecap="round" fill="none"></path>
                            </svg>
                            <span id="capture-os-toast-msg" style="font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${msg || 'Processando...'}</span>
                        </div>
                        <button id="capture-os-cancel-btn" style="background: #FEF2F2; border: none; color: #EF4444; font-size: 13px; font-weight: 600; cursor: pointer; padding: 5px 12px; border-radius: 8px; transition: all 0.2s;">Cancelar</button>
                    </div>
                    <div style="width: 100%; height: 3px; background: #F3F4F6; border-radius: 3px; overflow: hidden;">
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
                        background: #2AC4AA;
                        width: 0%;
                        border-radius: 3px;
                        animation: capture-progress 60s cubic-bezier(0.1, 0.7, 0.1, 1) forwards;
                    }
                `;
                document.head.appendChild(style);
            }
        } else if (type === "success") {
            toast.style.background = '#F0FDF4';
            toast.style.border = '1px solid #BBF7D0';
            toast.style.color = '#15803D';
            toast.innerHTML = `
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span id="capture-os-toast-msg">${msg || "Vídeo finalizado! Abrindo player..."}</span>
            `;
            setTimeout(() => fecharToast(toast), 6000);
        } else if (type === "error") {
            toast.style.background = '#FEF2F2';
            toast.style.border = '1px solid #FECACA';
            toast.style.color = '#B91C1C';
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
            toast.style.background = '#FFFBEB';
            toast.style.border = '1px solid #FDE68A';
            toast.style.color = '#B45309';
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
            toast.style.background = '#F0FDF4';
            toast.style.border = '1px solid #BBF7D0';
            toast.style.color = '#15803D';
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
    function mountPlayerModal(videoUrl, roteiro, receivedBackendUrl, titulo = "") {
        // Extrai session_id da URL (ex: sess_1780090948221)
        const match = videoUrl.match(/(sess_\d+)/);
        const session_id = match ? match[1] : '';

        const cleanTitle = titulo ? titulo.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_') : '';
        const pdfFilename = cleanTitle ? `${cleanTitle}_apostila.pdf` : `apostila_capture_os_${Date.now()}.pdf`;
        const scormFilename = cleanTitle ? `${cleanTitle}_scorm.zip` : `pacote_scorm_${session_id}.zip`;

        // Usa o backendUrl enviado pelo background.js
        const backendUrl = receivedBackendUrl || 'https://api.nomadelabs.com.br';

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
            font-family: 'Aptos', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
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
                if (passo.passo === 0) { badge = svgBulb; badgeStyle = 'background: #E6F5F4; color: #00998F;'; }
                else if (passo.passo === 999) { badge = svgCheck; badgeStyle = 'background: #E0F5F3; color: #2AC4AA;'; }
                
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
            stepsHtml = '<div style="color: #6B7280; font-size: 14px; text-align: center; margin-top: 40px;">Nenhum roteiro detalhado gerado.</div>';
        }

        shadow.innerHTML = `
            <style>
                :host {
                    --primary: #00998F;
                    --primary-hover: #00AF9B;
                    --bg: #FFFFFF;
                    --bg-secondary: #F9FAFB;
                    --text-main: #111827;
                    --text-muted: #6B7280;
                    --border: #E5E7EB;
                    --btn-secondary-bg: #FFFFFF;
                    --btn-secondary-hover: #F3F4F6;
                    --btn-secondary-border: #D1D5DB;
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
                    border-radius: 12px;
                    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
                    display: flex;
                    overflow: hidden;
                    position: relative;
                    transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1), height 0.3s cubic-bezier(0.16, 1, 0.3, 1);
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
                    background: #111827;
                    color: white;
                    box-shadow: 0 2px 8px rgba(17,24,39,0.25);
                }
                .btn-primary:hover {
                    background: #1f2937;
                    box-shadow: 0 4px 12px rgba(17,24,39,0.35);
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
                    background: #E6F5F4;
                    color: #00998F;
                    border: 1px solid #B3E0DC;
                }
                .btn-accent:hover {
                    background: #CCECE9;
                }
                .btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                .btn-share-video {
                    background: #F0F9FF;
                    color: #0284C7;
                    border: 1px solid #BAE6FD;
                }
                .btn-share-video:hover:not(:disabled) {
                    background: #E0F2FE;
                }
                .close-btn {
                    position: absolute;
                    top: 16px;
                    right: 16px;
                    background: #FFFFFF;
                    border: 1px solid #E5E7EB;
                    width: 32px;
                    height: 32px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: #6B7280;
                    z-index: 10;
                    transition: all 0.2s;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                }
                .close-btn:hover {
                    background: #F3F4F6;
                    color: #111827;
                }
                .script-content::-webkit-scrollbar { width: 5px; }
                .script-content::-webkit-scrollbar-track { background: transparent; }
                .script-content::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 10px; }
                .script-content::-webkit-scrollbar-thumb:hover { background: #9CA3AF; }
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
                        <h2>${titulo || 'Roteiro do Tutorial'}</h2>
                    </div>
                    
                    <div class="script-content">
                        ${stepsHtml}
                               <div class="script-footer">
                        <div class="btn-grid-top">
                            <button id="download-video-btn" class="btn btn-primary">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                Baixar Vídeo
                            </button>
                        </div>
                        <div class="btn-grid">
                            <a href="${backendUrl}/artifacts/${session_id}/apostila.pdf" target="_blank" download="${pdfFilename}" class="btn btn-secondary">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                PDF
                            </a>
                            <a href="${backendUrl}/scorm/${session_id}.zip" target="_blank" download="${scormFilename}" class="btn btn-accent">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                SCORM
                            </a>
                        </div>
                        <div class="share-section" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border); display: flex; flex-direction: column; gap: 8px;">
                            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Compartilhar com terceiros</div>
                            <button id="share-video-btn" class="btn btn-share-video" disabled style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
                                Carregando Link do Vídeo...
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const closeBtn = shadow.getElementById('close-btn');
        closeBtn.addEventListener('click', () => {
            // Ao fechar, mostramos o modal de Rating no mesmo host, mas bem menor
            const modal = shadow.getElementById('modal');
            modal.style.width = '400px';
            modal.style.height = '280px';
            modal.innerHTML = `
                <div style="padding: 32px 24px; text-align: center; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #ffffff; border-radius: 12px; box-sizing: border-box;">
                    <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #0f172a;">Processo Concluído!</h2>
                    <p style="margin: 0 0 24px 0; font-size: 15px; color: #475569;">Como foi sua experiência gravando este material hoje?</p>
                    <div id="ext-stars-container" style="display: flex; gap: 8px; justify-content: center; margin-bottom: 24px;">
                        <span class="ext-star" data-val="1" style="font-size: 36px; color: #cbd5e1; cursor: pointer; transition: 0.2s; user-select: none;">★</span>
                        <span class="ext-star" data-val="2" style="font-size: 36px; color: #cbd5e1; cursor: pointer; transition: 0.2s; user-select: none;">★</span>
                        <span class="ext-star" data-val="3" style="font-size: 36px; color: #cbd5e1; cursor: pointer; transition: 0.2s; user-select: none;">★</span>
                        <span class="ext-star" data-val="4" style="font-size: 36px; color: #cbd5e1; cursor: pointer; transition: 0.2s; user-select: none;">★</span>
                        <span class="ext-star" data-val="5" style="font-size: 36px; color: #cbd5e1; cursor: pointer; transition: 0.2s; user-select: none;">★</span>
                    </div>
                    <div id="ext-rating-msg" style="display: none; color: #10b981; font-weight: 500; margin-bottom: 24px;">Obrigado pela sua avaliação! ✅</div>
                    <button id="ext-btn-skip" class="btn btn-secondary" style="background: white; border: 1px solid #cbd5e1; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; color: #64748b; transition: 0.2s;">Pular e Fechar</button>
                    
                    <p id="ext-report-link" style="margin-top: 24px; font-size: 12px; color: #94a3b8; cursor: pointer; text-decoration: underline; transition: 0.2s;">Encontrou algum problema? Reportar erro</p>
                    <div id="ext-report-container" style="display: none; width: 100%; margin-top: 16px;">
                        <textarea id="ext-report-text" placeholder="Descreva o problema ou erro encontrado..." style="width: 100%; height: 70px; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-family: inherit; resize: none; outline: none; margin-bottom: 12px; box-sizing: border-box;"></textarea>
                        <button id="ext-btn-report" class="btn btn-primary" style="width: 100%; padding: 10px; font-size: 13px; margin: 0; box-sizing: border-box;">Enviar Relato</button>
                    </div>
                </div>
            `;

            // Lógica das estrelas
            const stars = shadow.querySelectorAll('.ext-star');
            let nota = 0;
            const fecharFinal = () => {
                host.style.opacity = '0';
                shadow.getElementById('modal').style.transform = 'translateY(20px) scale(0.98)';
                setTimeout(() => host.remove(), 400);
            };

            shadow.getElementById('ext-btn-skip').addEventListener('click', fecharFinal);

            shadow.getElementById('ext-report-link').addEventListener('click', (e) => {
                e.target.style.display = 'none';
                shadow.getElementById('ext-stars-container').style.display = 'none';
                shadow.querySelector('h2').innerText = 'Reportar um Problema';
                shadow.querySelector('p').style.display = 'none';
                shadow.getElementById('ext-btn-skip').style.display = 'none';
                shadow.getElementById('ext-report-container').style.display = 'block';
                shadow.getElementById('modal').style.height = '320px';
            });

            shadow.getElementById('ext-btn-report').addEventListener('click', () => {
                const text = shadow.getElementById('ext-report-text').value.trim();
                if (!text) return;
                
                shadow.getElementById('ext-btn-report').innerText = 'Enviando...';
                shadow.getElementById('ext-btn-report').disabled = true;
                
                chrome.runtime.sendMessage({
                    action: "auth_fetch",
                    url: `${backendUrl}/api/v1/ratings`,
                    options: {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            context_type: 'recording_bug_report',
                            context_id: session_id,
                            score: 0,
                            comment: text
                        })
                    }
                });
                
                shadow.getElementById('ext-report-container').innerHTML = '<p style="color: #10b981; font-weight: 500; font-size: 14px; margin: 0;">Relato enviado com sucesso! Muito obrigado.</p>';
                setTimeout(fecharFinal, 2500);
            });

            stars.forEach(star => {
                star.addEventListener('mouseenter', function() {
                    if (nota > 0) return;
                    const val = parseInt(this.getAttribute('data-val'));
                    stars.forEach(s => {
                        if (parseInt(s.getAttribute('data-val')) <= val) {
                            s.style.color = '#fbbf24';
                            s.style.textShadow = '0 2px 10px rgba(251, 191, 36, 0.4)';
                        } else {
                            s.style.color = '#cbd5e1';
                            s.style.textShadow = 'none';
                        }
                    });
                });
                star.addEventListener('mouseleave', function() {
                    if (nota > 0) return;
                    stars.forEach(s => {
                        s.style.color = '#cbd5e1';
                        s.style.textShadow = 'none';
                    });
                });
                star.addEventListener('click', function() {
                    if (nota > 0) return;
                    nota = parseInt(this.getAttribute('data-val'));
                    stars.forEach(s => {
                        if (parseInt(s.getAttribute('data-val')) <= nota) {
                            s.style.color = '#fbbf24';
                            s.style.textShadow = '0 2px 10px rgba(251, 191, 36, 0.4)';
                        } else {
                            s.style.color = '#cbd5e1';
                            s.style.textShadow = 'none';
                        }
                        s.style.cursor = 'default';
                    });
                    
                    shadow.getElementById('ext-rating-msg').style.display = 'block';
                    shadow.getElementById('ext-btn-skip').innerText = 'Fechar';
                    
                    // Enviar API via mensagem para usar o token em background, ou via fetch direto
                    chrome.runtime.sendMessage({
                        action: "auth_fetch",
                        url: `${backendUrl}/api/v1/ratings`,
                        options: {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                context_type: 'recording',
                                context_id: session_id,
                                score: nota
                            })
                        }
                    });

                    setTimeout(fecharFinal, 2000);
                });
            });
        });

        // Download nativo (Blob)
        shadow.getElementById('download-video-btn').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = 'Baixando...';
            btn.disabled = true;
            try {
                const resp = await fetch(videoUrl);
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `tutorial_capture_os_${Date.now()}.mp4`;
                a.click();
                URL.revokeObjectURL(url);
            } catch(err) {
                console.error("Erro no download blob:", err);
                window.open(videoUrl, '_blank');
            }
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        });

        // Lógica de compartilhamento
        const shareVideoBtn = shadow.getElementById('share-video-btn');

        let videoLinkUrl = null;

        const copyToClipboard = async (text, btn, originalHtml) => {
            try {
                await navigator.clipboard.writeText(text);
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copiado!`;
                const origBg = btn.style.background;
                const origColor = btn.style.color;
                const origBorder = btn.style.borderColor;
                btn.style.background = '#ECFDF5';
                btn.style.color = '#10B981';
                btn.style.borderColor = '#A7F3D0';
                setTimeout(() => {
                    btn.innerHTML = originalHtml;
                    btn.style.background = origBg;
                    btn.style.color = origColor;
                    btn.style.borderColor = origBorder;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy: ', err);
                const input = document.createElement('textarea');
                input.value = text;
                shadow.appendChild(input);
                input.select();
                try {
                    document.execCommand('copy');
                    btn.innerHTML = `Copiado!`;
                } catch(e) {
                    btn.innerHTML = `Erro ao copiar`;
                }
                shadow.removeChild(input);
                setTimeout(() => {
                    btn.innerHTML = originalHtml;
                }, 2000);
            }
        };

        const videoOrigHtml = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg> Compartilhar Link do Vídeo`;

        shareVideoBtn.addEventListener('click', () => {
            if (videoLinkUrl) copyToClipboard(videoLinkUrl, shareVideoBtn, videoOrigHtml);
        });

        chrome.runtime.sendMessage({
            action: "auth_fetch",
            path: `/api/v1/session/${session_id}/artifacts`
        }, (response) => {
            if (response && response.ok) {
                const data = response.data;
                if (data.video_url) {
                    videoLinkUrl = data.video_url;
                    shareVideoBtn.innerHTML = videoOrigHtml;
                    shareVideoBtn.disabled = false;
                } else {
                    shareVideoBtn.textContent = "Vídeo Indisponível";
                }
            } else {
                const status = (response && response.status) || 'Conexão';
                shareVideoBtn.textContent = `Erro ${status}`;
            }
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
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            background: rgba(17, 24, 39, 0.5);
            opacity: 0;
            transition: opacity 0.3s ease;
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
                    background: #FFFFFF;
                    border-radius: 12px;
                    display: flex;
                    flex-direction: column;
                    animation: _capture_editor_in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
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
                    background: #FFFFFF;
                    border: 1px solid #E5E7EB;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: #6B7280;
                    z-index: 20;
                    transition: all 0.2s;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                }
                .editor-close-btn:hover {
                    background: #FEF2F2;
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
                    background: #FFFFFF;
                    transition: opacity 0.4s ease;
                }
                .skeleton-bar {
                    height: 20px;
                    border-radius: 8px;
                    background: rgba(0,0,0,0.04);
                    background-image: linear-gradient(
                        90deg,
                        rgba(0,0,0,0.04) 0px,
                        rgba(0,0,0,0.08) 200px,
                        rgba(0,0,0,0.04) 400px
                    );
                    background-size: 800px 100%;
                    animation: _capture_shimmer 1.5s ease-in-out infinite;
                }
                iframe {
                    width: 100%;
                    height: 100%;
                    border: none;
                    background: transparent;
                    border-radius: 12px;
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
                    <iframe src="${backendUrl}/editor/?session=${sessionId}&embedded=true${tokenParam}" id="editor-iframe"></iframe>
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
        if (window.__capture_os_active_script_id !== currentScriptId) {
            return;
        }
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
                targetEl.style.boxShadow = "0 0 0 4px rgba(0, 153, 143, 0.6), 0 0 20px rgba(0, 153, 143, 0.4)";
                targetEl.style.outline = "2px solid #00998F";
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
                background: #FFFFFF;
                color: #111827;
                border-radius: 12px;
                box-shadow: 0 4px 24px rgba(0,0,0,0.1);
                font-family: 'Aptos', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                z-index: 999999999;
                border: 1px solid #E5E7EB;
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
                background: #F9FAFB;
                padding: 0;
                display: flex;
                flex-direction: column;
                cursor: grab;
                border-bottom: 1px solid #E5E7EB;
            `;

            // Progress bar at top of header
            const progressTrack = document.createElement("div");
            progressTrack.id = "sandbox-progress-track";
            progressTrack.style.cssText = `
                width: 100%; height: 3px; background: #E5E7EB;
                border-radius: 12px 12px 0 0; overflow: hidden;
            `;
            const progressFill = document.createElement("div");
            progressFill.id = "sandbox-progress-fill";
            const progressPct = sandboxTotalPassos > 0 ? Math.round((sandboxPassoAtual / sandboxTotalPassos) * 100) : 0;
            progressFill.style.cssText = `
                width: ${progressPct}%; height: 100%;
                background: #2AC4AA;
                border-radius: 0 2px 2px 0;
                transition: width 0.3s ease;
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
                    <div style="width: 8px; height: 8px; border-radius: 50%; background: #2AC4AA;"></div>
                    <span style="font-size: 11px; font-weight: 600; color: #6B7280; letter-spacing: 0.5px;">PRÁTICA ATIVA</span>
                </div>
                <div id="sandbox-xp" style="font-size: 12px; font-weight: 600; color: #00998F; background: #E0F5F3; padding: 4px 10px; border-radius: 12px;">0 XP</div>
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
                background: #F9FAFB;
                padding: 10px 15px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-top: 1px solid #E5E7EB;
            `;
            footer.innerHTML = `
                <button id="btn-encerrar-pratica" style="background: transparent; color: #DC2626; border: 1px solid #FECACA; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s;">Sair</button>
                <div style="display: flex; gap: 8px;">
                    <button id="btn-dica-pratica" style="background: #FFFFFF; color: #374151; border: 1px solid #D1D5DB; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s; display: flex; align-items: center; gap: 5px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg> Dica
                    </button>
                    <button id="btn-pular-pratica" style="background: #00998F; color: #FFFFFF; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s; display: flex; align-items: center; gap: 5px;">
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
            addHover("btn-encerrar-pratica", "#FEF2F2", "transparent");
            addHover("btn-dica-pratica", "#F3F4F6", "#FFFFFF");
            addHover("btn-pular-pratica", "#00AF9B", "#00998F");
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
                <div style="font-size: 11px; color: #6B7280; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Passo ${sandboxPassoAtual + 1} de ${sandboxTotalPassos}</div>
                <div style="font-size: 14px; line-height: 1.5; color: #111827; margin-top: 4px;">${step.micro_narracao || step.ancora || "Interaja com a tela para avançar."}</div>
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
            <div style="background: #F0FDF4; padding: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; border-bottom: 1px solid #E5E7EB;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span style="font-size: 12px; font-weight: 700; color: #15803D; letter-spacing: 1px; text-transform: uppercase;">Prática Concluída</span>
            </div>
            <div style="padding: 24px 20px; display: flex; flex-direction: column; gap: 18px; background: #FFFFFF;">
                <div style="text-align: center;">
                    <div style="font-size: 40px; font-weight: 800; color: #111827; letter-spacing: -1px; line-height: 1;">${sandboxXP}</div>
                    <div style="font-size: 13px; font-weight: 600; color: #6B7280; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px;">Pontos XP</div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; text-align: center;">
                    <div style="background: #FEF2F2; padding: 12px 8px; border-radius: 8px; border: 1px solid #FECACA;">
                        <div style="font-size: 20px; font-weight: 800; color: #B91C1C; letter-spacing: -0.5px;">${sandboxStats.errors}</div>
                        <div style="font-size: 10px; color: #7F1D1D; text-transform: uppercase; margin-top: 4px; font-weight: 600; letter-spacing: 0.5px;">Erros</div>
                    </div>
                    <div style="background: #FFFBEB; padding: 12px 8px; border-radius: 8px; border: 1px solid #FDE68A;">
                        <div style="font-size: 20px; font-weight: 800; color: #B45309; letter-spacing: -0.5px;">${sandboxStats.hints}</div>
                        <div style="font-size: 10px; color: #78350F; text-transform: uppercase; margin-top: 4px; font-weight: 600; letter-spacing: 0.5px;">Dicas</div>
                    </div>
                    <div style="background: #EFF6FF; padding: 12px 8px; border-radius: 8px; border: 1px solid #BFDBFE;">
                        <div style="font-size: 20px; font-weight: 800; color: #1D4ED8; letter-spacing: -0.5px;">${sandboxStats.skips}</div>
                        <div style="font-size: 10px; color: #1E3A8A; text-transform: uppercase; margin-top: 4px; font-weight: 600; letter-spacing: 0.5px;">Pulos</div>
                    </div>
                </div>
                <button id="btn-fechar-score" style="margin-top: 4px; width: 100%; background: #00998F; color: #FFFFFF; border: none; padding: 11px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s;">Fechar</button>
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
