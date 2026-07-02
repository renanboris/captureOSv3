// radar_v3.js (Content Script)
(function() {
    console.log("Capture OS v3 - Radar Injetado");

    console.log("Capture OS v3 - Radar Injetado");

    let eventCounter = 1;
    let isSandboxMode = false;
    let sandboxCurrentMode = 'guided'; // 'guided' ou 'challenge'
    let sandboxSessionId = null;
    let sandboxVideoUrl = '';
    let sandboxTotalPassos = 0;
    let sandboxXP = 0;
    let sandboxHotspots = [];
    let sandboxStats = { errors: 0, hints: 0, skips: 0 };
    let sandboxModuleName = 'Módulo Prático';

    chrome.storage.local.get(['sandboxMode', 'sandboxCurrentMode', 'sandboxSessionId', 'sandboxVideoUrl', 'sandboxTotalPassos', 'sandboxPassoAtual', 'sandboxXP', 'sandboxHotspots', 'sandboxStats', 'sandboxModuleName'], (res) => {
        isSandboxMode = res.sandboxMode || false;
        sandboxCurrentMode = res.sandboxCurrentMode || 'guided';
        sandboxSessionId = res.sandboxSessionId || null;
        sandboxVideoUrl = res.sandboxVideoUrl || '';
        sandboxTotalPassos = res.sandboxTotalPassos || 0;
        sandboxPassoAtual = res.sandboxPassoAtual || 0;
        sandboxXP = res.sandboxXP || 0;
        sandboxHotspots = res.sandboxHotspots || [];
        sandboxStats = res.sandboxStats || { errors: 0, hints: 0, skips: 0 };
        if (res.sandboxModuleName) sandboxModuleName = res.sandboxModuleName;

        if (isSandboxMode) {
            setTimeout(() => {
                if (typeof renderSandboxWidget === 'function') {
                    renderSandboxWidget();
                    if (typeof highlightSandboxCurrentStep === 'function') highlightSandboxCurrentStep();
                }
            }, 500);
        }
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.sandboxMode) isSandboxMode = changes.sandboxMode.newValue;
        if (changes.sandboxModuleName) sandboxModuleName = changes.sandboxModuleName.newValue;
        if (changes.sandboxCurrentMode) sandboxCurrentMode = changes.sandboxCurrentMode.newValue;
        if (changes.sandboxSessionId) sandboxSessionId = changes.sandboxSessionId.newValue;
        if (changes.sandboxVideoUrl) sandboxVideoUrl = changes.sandboxVideoUrl.newValue;
        if (changes.sandboxTotalPassos) sandboxTotalPassos = changes.sandboxTotalPassos.newValue;
        if (changes.sandboxXP) sandboxXP = changes.sandboxXP.newValue;
        if (changes.sandboxHotspots) sandboxHotspots = changes.sandboxHotspots.newValue;
        if (changes.sandboxStats) sandboxStats = changes.sandboxStats.newValue;
        
        if (changes.sandboxPassoAtual) {
            sandboxPassoAtual = changes.sandboxPassoAtual.newValue;
            if (isSandboxMode) {
                if (typeof highlightSandboxCurrentStep === 'function') {
                    setTimeout(() => highlightSandboxCurrentStep(), 100);
                }
                
                // Sincronizar o vídeo (pula para o timestamp do passo atual)
                const videoEl = document.getElementById('pip-video-el');
                if (videoEl && sandboxHotspots && sandboxHotspots[sandboxPassoAtual]) {
                    const stepTimestamp = sandboxHotspots[sandboxPassoAtual].video_timestamp;
                    if (stepTimestamp !== undefined && stepTimestamp !== null) {
                        videoEl.currentTime = stepTimestamp;
                        videoEl.play().catch(e => console.warn('Autoplay prevented:', e));
                    }
                }
            }
        }

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

    let sandboxSonarTimeout = null;

    function interceptEvent(e, type) {
        if (!chrome.runtime?.id) return;
        
        // Remove the sonar when any click/interaction happens
        if (type === 'click' || type === 'dblclick') {
            if (window.sandboxSonarTimeout) clearTimeout(window.sandboxSonarTimeout);
            const sonar = document.getElementById("capture-os-sonar");
            if (sonar) sonar.remove();
        }

        // Encontra a árvore atual
        const tree = getSemanticSnapshot();
        
        // Pega elemento clicado
        const target = e.target;
        
        // Impede que a IA narre cliques nos nossos próprios componentes do Capture OS
        if (target.closest && (target.closest('#capture-os-widget') || target.closest('#capture-os-sandbox-widget') || target.closest('#capture-os-toast') || target.closest('#capture-os-pip-video'))) {
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
            let toast = document.getElementById("capture-os-toast");
            if(toast) toast.remove();
            
            mountPlayerModal(msg.url, msg.roteiro, msg.backendUrl);
        } else if (msg.action === "show_error_toast") {
            showToast("error");
        } else if (msg.action === "show_editor_modal") {
            let toast = document.getElementById("capture-os-toast");
            if(toast) toast.remove();
            
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
    function mountPlayerModal(videoUrl, roteiro, receivedBackendUrl) {
        // Extrai session_id da URL (ex: sess_1780090948221)
        const match = videoUrl.match(/(sess_\d+)/);
        const session_id = match ? match[1] : '';

        // Usa o backendUrl enviado pelo background.js
        const backendUrl = receivedBackendUrl || 'http://localhost:8000';

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
                        <h2>Roteiro do Tutorial</h2>
                    </div>
                    
                    <div class="script-content">
                        ${stepsHtml}
                    </div>
                    
                    <div class="script-footer">
                        <div class="btn-grid-top">
                            <button id="download-video-btn" class="btn btn-primary">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                Baixar Vídeo
                            </button>
                        </div>
                        <div class="btn-grid">
                            <a href="${backendUrl}/artifacts/${session_id}/apostila.pdf" target="_blank" download="apostila_capture_os_${Date.now()}.pdf" class="btn btn-secondary">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                PDF
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
            // Ao fechar, mostramos o modal de Rating no mesmo host, mas bem menor
            const modal = shadow.getElementById('modal');
            modal.style.width = '420px';
            modal.style.height = 'auto';
            modal.innerHTML = `
                <div style="padding: 32px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #111317; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.08); box-sizing: border-box; color: #fff;">
                    <div style="width: 48px; height: 48px; background: rgba(16, 185, 129, 0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; border: 1px solid rgba(16, 185, 129, 0.2);">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    </div>
                    <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #fff;">Processo Concluído!</h2>
                    <p style="margin: 0 0 24px 0; font-size: 15px; color: #94a3b8;">Como foi sua experiência gravando este material hoje?</p>
                    <div id="ext-stars-container" style="display: flex; gap: 8px; justify-content: center; margin-bottom: 24px;">
                        <span class="ext-star" data-val="1" style="font-size: 36px; color: #334155; cursor: pointer; transition: 0.2s; user-select: none;">★</span>
                        <span class="ext-star" data-val="2" style="font-size: 36px; color: #334155; cursor: pointer; transition: 0.2s; user-select: none;">★</span>
                        <span class="ext-star" data-val="3" style="font-size: 36px; color: #334155; cursor: pointer; transition: 0.2s; user-select: none;">★</span>
                        <span class="ext-star" data-val="4" style="font-size: 36px; color: #334155; cursor: pointer; transition: 0.2s; user-select: none;">★</span>
                        <span class="ext-star" data-val="5" style="font-size: 36px; color: #334155; cursor: pointer; transition: 0.2s; user-select: none;">★</span>
                    </div>
                    <div id="ext-rating-msg" style="display: none; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: #10b981; font-weight: 500; padding: 10px 16px; border-radius: 8px; margin-bottom: 24px; width: 100%; box-sizing: border-box;">Obrigado pela sua avaliação! ✅</div>
                    <button id="ext-btn-skip" class="btn btn-secondary" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); padding: 10px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; color: #cbd5e1; transition: 0.2s; width: 100%;">Pular e Fechar</button>
                    
                    <p id="ext-report-link" style="margin-top: 24px; margin-bottom: 0; font-size: 13px; color: #64748b; cursor: pointer; text-decoration: underline; transition: 0.2s;">Encontrou algum problema? Reportar erro</p>
                    <div id="ext-report-container" style="display: none; width: 100%; margin-top: 16px;">
                        <textarea id="ext-report-text" placeholder="Descreva o problema ou erro encontrado..." style="width: 100%; height: 80px; padding: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; border-radius: 8px; font-size: 13px; font-family: inherit; resize: none; outline: none; margin-bottom: 12px; box-sizing: border-box;"></textarea>
                        <button id="ext-btn-report" class="btn btn-primary" style="background: #10b981; color: #111317; border: none; font-weight: 600; width: 100%; padding: 10px; border-radius: 8px; font-size: 14px; cursor: pointer; transition: 0.2s; margin: 0; box-sizing: border-box;">Enviar Relato</button>
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
                
                shadow.getElementById('ext-report-container').innerHTML = '<p style="color: #10b981; font-weight: 500; font-size: 14px; margin: 0; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); padding: 12px; border-radius: 8px;">Relato enviado com sucesso! Muito obrigado.</p>';
                setTimeout(fecharFinal, 2500);
            });

            stars.forEach(star => {
                star.addEventListener('mouseenter', function() {
                    if (nota > 0) return;
                    const val = parseInt(this.getAttribute('data-val'));
                    stars.forEach(s => {
                        if (parseInt(s.getAttribute('data-val')) <= val) {
                            s.style.color = '#10b981';
                            s.style.textShadow = '0 0 12px rgba(16, 185, 129, 0.4)';
                        } else {
                            s.style.color = '#334155';
                            s.style.textShadow = 'none';
                        }
                    });
                });
                star.addEventListener('mouseleave', function() {
                    if (nota > 0) return;
                    stars.forEach(s => {
                        s.style.color = '#334155';
                        s.style.textShadow = 'none';
                    });
                });
                star.addEventListener('click', function() {
                    if (nota > 0) return;
                    nota = parseInt(this.getAttribute('data-val'));
                    stars.forEach(s => {
                        if (parseInt(s.getAttribute('data-val')) <= nota) {
                            s.style.color = '#10b981';
                            s.style.textShadow = '0 2px 10px rgba(16, 185, 129, 0.4)';
                        } else {
                            s.style.color = '#334155';
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
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Remover sonar antigo se existir
                const oldSonar = document.getElementById("capture-os-sonar");
                if (oldSonar) oldSonar.remove();
                if (window.sandboxSonarTimeout) clearTimeout(window.sandboxSonarTimeout);
                
                window.renderSonarCore = function(el) {
                    if (!document.body.contains(el)) return;
                    
                    const rect = el.getBoundingClientRect();
                    const centerX = rect.left + window.scrollX + (rect.width / 2);
                    const centerY = rect.top + window.scrollY + (rect.height / 2);
                    
                    const sonar = document.createElement("div");
                    sonar.id = "capture-os-sonar";
                    sonar.style.cssText = `
                        position: absolute;
                        left: ${centerX}px;
                        top: ${centerY}px;
                        width: 0;
                        height: 0;
                        z-index: 999999998;
                        pointer-events: none;
                    `;
                    
                    sonar.innerHTML = `
                        <style>
                        @keyframes radarPing {
                            0% { transform: scale(0.2); opacity: 0.8; }
                            80% { transform: scale(2.5); opacity: 0; }
                            100% { transform: scale(2.5); opacity: 0; }
                        }
                        @keyframes radarCore {
                            0%, 100% { transform: scale(1); opacity: 1; }
                            50% { transform: scale(0.8); opacity: 0.8; }
                        }
                        .capture-sonar-container {
                            position: absolute;
                            left: 0; top: 0;
                            z-index: 999999999;
                        }
                        .capture-sonar-core {
                            position: absolute;
                            left: -4px;
                            top: -4px;
                            width: 8px;
                            height: 8px;
                            background: rgba(16, 185, 129, 0.9);
                            border-radius: 50%;
                            box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
                            animation: radarCore 1.5s ease-in-out infinite;
                        }
                        .capture-sonar-ring {
                            position: absolute;
                            left: -24px;
                            top: -24px;
                            width: 48px;
                            height: 48px;
                            border: 2px solid #10B981;
                            border-radius: 50%;
                            background: rgba(16, 185, 129, 0.15);
                            animation: radarPing 2s cubic-bezier(0, 0, 0.2, 1) infinite;
                        }
                        .capture-sonar-ring:nth-child(2) {
                            animation-delay: 0.6s;
                        }
                        </style>
                        <div class="capture-sonar-container">
                            <div class="capture-sonar-ring"></div>
                            <div class="capture-sonar-ring"></div>
                            <div class="capture-sonar-core"></div>
                        </div>
                    `;
                    document.body.appendChild(sonar);
                };

                // Fallback para tutoriais antigos sem video_timestamp ou se não houver vídeo
                if (step.video_timestamp === undefined || step.video_timestamp === null) {
                    window.sandboxSonarTimeout = setTimeout(() => {
                        window.renderSonarCore(targetEl);
                    }, 1500);
                } else {
                    // Novo fluxo Video-Driven: Salva o targetEl globalmente para ser renderizado pelo ontimeupdate do vídeo
                    window.pendingSonarTarget = targetEl;
                }
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
                top: 24px;
                right: 24px;
                width: 280px;
                background: #181A1F;
                color: #FFFFFF;
                border-radius: 10px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.5);
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                z-index: 999999999;
                border: 1px solid #2D323B;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                user-select: none;
            `;
            
            document.body.appendChild(widget); // Append early so getElementById works

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

            // Global SVGs
            const svgCheck = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="#181A1F" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-circle-2 text-[#1FBB75]" style="color: #1FBB75;"><circle cx="12" cy="12" r="10" fill="currentColor"></circle><path d="m9 12 2 2 4-4" stroke="#181A1F"></path></svg>`;
            const svgCircle = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#555C67" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle"><circle cx="12" cy="12" r="10"></circle></svg>`;
            const svgMinimize = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`;
            const svgList = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`;

            const formatTaskLabel = (step, index) => {
                if (!step) return `Passo ${index + 1}`;
                if (step.action === 'navigation') return 'Aguarde a página carregar';
                
                const actionMap = {
                    'click': 'Clique em',
                    'input': 'Preencha',
                    'scroll': 'Role a tela até',
                    'hover': 'Passe o mouse em'
                };
                const verb = actionMap[step.action] || 'Interaja com';
                
                if (step.target_text && step.target_text.trim() !== '') {
                    let txt = step.target_text.trim();
                    if (txt.length > 25) txt = txt.substring(0, 25) + '...';
                    return `${verb} "${txt}"`;
                }
                
                if (step.micro_narracao && step.micro_narracao.trim() !== '') {
                    let micro = step.micro_narracao.trim();
                    if (micro.length <= 40) return micro; // Só usa se for uma instrução curta
                }
                
                const extractName = (xpath, cssSelector) => {
                    let idStr = null;
                    if (xpath) {
                        const xpathMatch = xpath.match(/id=['"]([^'"]+)['"]/i);
                        if (xpathMatch) idStr = xpathMatch[1];
                    }
                    if (!idStr && cssSelector) {
                        const cssMatch = cssSelector.match(/#([^.\s>:]+)/);
                        if (cssMatch) idStr = cssMatch[1];
                    }
                    if (idStr) {
                        idStr = idStr.replace(/^(menu-item-|apps-menu-item-|btn-|button-|nav-|icon-|btn_|menu_)/i, '');
                        if (idStr.trim().length > 0 && !idStr.match(/^[0-9]+$/)) {
                            idStr = idStr.replace(/[-_]/g, ' ');
                            return idStr.replace(/\b\w/g, c => c.toUpperCase()).trim();
                        }
                    }
                    return null;
                };

                const extracted = extractName(step.xpath, step.css_selector);
                if (extracted && extracted.length > 2) {
                    let txt = extracted;
                    if (txt.length > 25) txt = txt.substring(0, 25) + '...';
                    return `${verb} "${txt}"`;
                }

                const fallbackMap = {
                    'click': 'Clique no elemento',
                    'input': 'Preencha o campo',
                    'scroll': 'Role a tela',
                    'hover': 'Passe o mouse no elemento'
                };
                return fallbackMap[step.action] || `Interaja com o elemento`;
            };

            // Helper function to render tasks
            const renderTasks = () => {
                let tasksHtml = '';
                for (let i = 0; i < sandboxTotalPassos; i++) {
                    const isCompleted = i < sandboxPassoAtual;
                    const isCurrent = i === sandboxPassoAtual;
                    const label = formatTaskLabel(sandboxHotspots[i], i);
                    
                    const color = isCompleted ? '#646B75' : (isCurrent ? '#E2E4E9' : '#A9B1BD');
                    const fontWeight = isCurrent ? '600' : '400';
                    const opacity = isCurrent ? '1' : (isCompleted ? '0.5' : '0.8');
                    const icon = isCompleted ? svgCheck : svgCircle;
                    
                    tasksHtml += `
                        <div style="display: flex; align-items: center; gap: 12px; transition: all 0.3s; color: ${color}; opacity: ${opacity};">
                            <div style="flex-shrink: 0; display: flex;">${icon}</div>
                            <span style="font-size: 13px; font-weight: ${fontWeight}; letter-spacing: 0.2px; line-height: 1.4;">${label}</span>
                        </div>
                    `;
                }
                return tasksHtml;
            };

            const renderFullWidget = () => {
                const isInitialRender = (widget.innerHTML === '');
                if (!isInitialRender) {
                    const rect = widget.getBoundingClientRect();
                    widget.style.bottom = 'auto';
                    widget.style.top = rect.top + 'px';
                }
                const pct = sandboxTotalPassos > 0 ? Math.round((sandboxPassoAtual / sandboxTotalPassos) * 100) : 0;
                widget.innerHTML = `
                    <div id="sandbox-drag-header" style="padding: 16px; padding-bottom: 12px; border-bottom: 1px solid #2D323B; background: rgba(28, 31, 37, 0.5); cursor: grab;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <h3 style="margin: 0; font-size: 11px; font-weight: 500; text-transform: uppercase; color: #A9B1BD; letter-spacing: 0.5px;">${sandboxModuleName}</h3>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <span style="font-size: 13px; font-weight: 700; color: #E2E4E9;">${pct}%</span>
                                <button id="sandbox-btn-minimize" style="background: none; border: none; color: #6B7280; cursor: pointer; padding: 0; display: flex;">${svgMinimize}</button>
                            </div>
                        </div>
                        <div style="width: 100%; height: 6px; background: #122A22; border-radius: 9999px; overflow: hidden;">
                            <div style="height: 100%; background: #1FBB75; border-radius: 9999px; transition: width 0.5s ease-out; width: ${pct}%;"></div>
                        </div>
                    </div>
                    <div style="padding: 16px; display: flex; flex-direction: column; gap: 12px; max-height: 250px; overflow-y: auto;">
                        ${renderTasks()}
                    </div>
                    <div style="padding: 0 16px 16px 16px;">
                        <button id="btn-encerrar-pratica" style="width: 100%; padding: 6px 0; background: transparent; color: #A9B1BD; border: 1px solid #3A414B; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;">Sair da Prática</button>
                    </div>
                `;
                
                // Bind inner events
                document.getElementById('sandbox-btn-minimize').onclick = () => renderMinimizedWidget();
                document.getElementById('btn-encerrar-pratica').onclick = window.endSandboxPractice;
                
                const addHover = (id, hoverBg, hoverColor) => {
                    const el = document.getElementById(id);
                    if(el) {
                        el.onmouseenter = () => { el.style.background = hoverBg; el.style.color = hoverColor; };
                        el.onmouseleave = () => { el.style.background = 'transparent'; el.style.color = '#A9B1BD'; };
                    }
                };
                addHover('btn-encerrar-pratica', '#252A32', '#E2E4E9');
                
                // Header Dragging
                bindDragLogic(document.getElementById('sandbox-drag-header'), widget);
                
                if (!isInitialRender) {
                    setTimeout(() => {
                        const rect = widget.getBoundingClientRect();
                        if (rect.bottom > window.innerHeight - 24) {
                            widget.style.top = Math.max(24, window.innerHeight - rect.height - 24) + 'px';
                        }
                    }, 0);
                }
            };

            const renderMinimizedWidget = () => {
                const rect = widget.getBoundingClientRect();
                widget.style.bottom = 'auto';
                widget.style.top = rect.top + 'px';
                
                const pct = sandboxTotalPassos > 0 ? Math.round((sandboxPassoAtual / sandboxTotalPassos) * 100) : 0;
                widget.innerHTML = `
                    <div id="sandbox-drag-pill" style="display: flex; align-items: center; gap: 12px; padding: 8px 16px; cursor: pointer;">
                        ${svgList}
                        <div style="display: flex; flex-direction: column; gap: 4px; width: 96px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: 500; color: #A9B1BD;">
                                <span>Progresso</span><span>${pct}%</span>
                            </div>
                            <div style="width: 100%; height: 4px; background: #122A22; border-radius: 9999px; overflow: hidden;">
                                <div style="height: 100%; background: #1FBB75; border-radius: 9999px; transition: width 0.5s ease-out; width: ${pct}%;"></div>
                            </div>
                        </div>
                    </div>
                `;
                
                const pill = document.getElementById('sandbox-drag-pill');
                pill.ondblclick = () => renderFullWidget();
                pill.onmouseenter = () => widget.style.background = '#20242B';
                pill.onmouseleave = () => widget.style.background = '#181A1F';
                
                // Pill Dragging
                bindDragLogic(pill, widget);
            };

            const bindDragLogic = (handle, target) => {
                let isDragging = false;
                let startX, startY, initialRight, initialTop;
                handle.addEventListener("mousedown", (e) => {
                    isDragging = true;
                    handle.style.cursor = "grabbing";
                    startX = e.clientX;
                    startY = e.clientY;
                    const rect = target.getBoundingClientRect();
                    initialRight = window.innerWidth - rect.right;
                    initialTop = rect.top;
                    target.style.bottom = 'auto'; // Force top anchor
                });
                document.addEventListener("mousemove", (e) => {
                    if (!isDragging) return;
                    const dx = startX - e.clientX;
                    const dy = e.clientY - startY; // mouse moves down, top increases
                    target.style.right = (initialRight + dx) + "px";
                    target.style.top = (initialTop + dy) + "px";
                });
                document.addEventListener("mouseup", () => {
                    if (isDragging) {
                        isDragging = false;
                        handle.style.cursor = "pointer"; // reset to pointer since pill/header have different defaults
                    }
                });
            };

            // Store render functions globally so they can be triggered on state change
            window._renderSandboxChecklistFull = renderFullWidget;
            window._renderSandboxChecklistMini = renderMinimizedWidget;

            // Initial render
            renderFullWidget();
            
            // --- INJECT FLOATING VIDEO TUTORIAL (PiP) ---
            if (sandboxCurrentMode === 'guided') {
                injectFloatingVideoTutorial();
            }
        } else {
            // Update existing widget progress
            if (window._renderSandboxChecklistFull) {
                // Determine which view is active and re-render
                if (document.getElementById('sandbox-drag-header')) window._renderSandboxChecklistFull();
                if (document.getElementById('sandbox-drag-pill')) window._renderSandboxChecklistMini();
            }
        }
    };
    
    function injectFloatingVideoTutorial() {
        if (document.getElementById("capture-os-pip-video")) return;
        
        const pip = document.createElement("div");
        pip.id = "capture-os-pip-video";
        pip.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            width: 320px;
            background: #1C2025;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            font-family: 'Inter', sans-serif;
            z-index: 999999999;
            border: 1px solid rgba(113, 113, 122, 0.5);
            overflow: hidden;
            user-select: none;
        `;
        
        document.body.appendChild(pip); // Append early
        
        const svgCap = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`;
        const svgCap24 = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`;
        const svgMin = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`;
        const svgMax = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;
        const svgRestore = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
        const svgPlay = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
        const svgPause = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;

        let isMinimized = false;
        let isMaximized = false;
        let pipVideoTime = 0;
        let pipVideoPlaying = false;
        
        const renderPip = () => {
            if (isMinimized) {
                pip.style.width = '48px';
                pip.style.height = '48px';
                pip.style.borderRadius = '50%';
                pip.innerHTML = `
                    <div id="pip-drag-pill" style="width: 100%; height: 100%; cursor: move; display: flex; align-items: center; justify-content: center;" title="Arraste ou duplo clique para expandir">
                        ${svgCap24}
                    </div>
                `;
                const pill = document.getElementById('pip-drag-pill');
                pill.ondblclick = () => { isMinimized = false; renderPip(); };
                pill.onmouseenter = () => pip.style.background = '#1F2937';
                pill.onmouseleave = () => pip.style.background = '#1C2025';
                bindPipDrag(pill);
            } else {
                pip.style.width = isMaximized ? '45vw' : '320px';
                if (isMaximized) pip.style.maxWidth = '800px';
                pip.style.height = 'auto';
                pip.style.borderRadius = '12px';
                pip.innerHTML = `
                    <div style="position: relative; aspect-ratio: 16/9; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center; cursor: move;" id="pip-video-container">
                        <video id="pip-video-el" src="${sandboxVideoUrl || 'https://www.w3schools.com/html/mov_bbb.mp4'}" style="width: 100%; height: 100%; object-fit: cover;"></video>
                        <div id="pip-hover-overlay" style="position: absolute; inset: 0; background: rgba(0,0,0,0.6); display: flex; flex-direction: column; opacity: 1; transition: opacity 0.2s;">
                            <div style="display: flex; justify-content: space-between; padding: 12px; pointer-events: none;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    ${svgCap}
                                    <span style="color: white; font-size: 12px; font-weight: 500; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">Tutorial</span>
                                </div>
                                <div style="display: flex; gap: 8px; color: #fff; pointer-events: auto;">
                                    <button id="pip-btn-min" title="Ocultar" style="background: none; border: none; color: inherit; cursor: pointer; padding: 4px; border-radius: 4px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8)); transition: 0.2s;">${svgMin}</button>
                                    <button id="pip-btn-max" title="${isMaximized ? 'Restaurar Tamanho' : 'Maximizar'}" style="background: none; border: none; color: inherit; cursor: pointer; padding: 4px; border-radius: 4px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8)); transition: 0.2s;">${isMaximized ? svgRestore : svgMax}</button>
                                </div>
                            </div>
                            <div id="pip-play-btn" style="margin: auto; width: 48px; height: 48px; border-radius: 50%; background: rgba(16, 185, 129, 0.9); display: flex; align-items: center; justify-content: center; color: white; cursor: pointer; pointer-events: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                                ${svgPlay}
                            </div>
                            <div id="pip-timeline" style="padding: 12px; display: flex; align-items: center; gap: 8px; pointer-events: auto;">
                                <div id="pip-time-curr" style="font-size: 10px; font-weight: 500; color: rgba(255,255,255,0.9); text-shadow: 0 1px 2px rgba(0,0,0,0.8);">0:00</div>
                                <div id="pip-track" style="flex: 1; height: 6px; background: rgba(255,255,255,0.3); border-radius: 9999px; cursor: pointer; overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,0.3);">
                                    <div id="pip-fill" style="height: 100%; width: 0%; background: #10B981; transition: width 0.1s;"></div>
                                </div>
                                <div id="pip-time-dur" style="font-size: 10px; font-weight: 500; color: rgba(255,255,255,0.9); text-shadow: 0 1px 2px rgba(0,0,0,0.8);">0:00</div>
                            </div>
                        </div>
                    </div>
                `;
                
                const vid = document.getElementById('pip-video-el');
                const overlay = document.getElementById('pip-hover-overlay');
                const playBtn = document.getElementById('pip-play-btn');
                
                let isPlaying = pipVideoPlaying;
                let isHovering = false;
                
                if (pipVideoTime > 0) {
                    vid.currentTime = pipVideoTime;
                }
                
                const updateOverlay = () => {
                    overlay.style.opacity = (isPlaying && !isHovering) ? '0' : '1';
                };
                
                if (isPlaying) {
                    vid.play().catch(e => console.log('Autoplay prevent', e));
                    playBtn.innerHTML = svgPause;
                    updateOverlay();
                }
                
                const togglePlay = () => {
                    if(isPlaying) vid.pause(); else vid.play();
                    isPlaying = !isPlaying;
                    playBtn.innerHTML = isPlaying ? svgPause : svgPlay;
                    updateOverlay();
                };
                
                vid.onclick = togglePlay;
                playBtn.onclick = togglePlay;
                
                vid.onended = () => {
                    isPlaying = false;
                    playBtn.innerHTML = svgPlay;
                    updateOverlay();
                };
                
                const fmt = (t) => isNaN(t) ? "0:00" : `${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,'0')}`;
                
                vid.onloadedmetadata = () => {
                    const durEl = document.getElementById('pip-time-dur');
                    if(durEl) durEl.innerText = fmt(vid.duration);
                };
                
                vid.ontimeupdate = () => {
                    const currEl = document.getElementById('pip-time-curr');
                    if(currEl) currEl.innerText = fmt(vid.currentTime);
                    const fillEl = document.getElementById('pip-fill');
                    if(fillEl) fillEl.style.width = ((vid.currentTime / vid.duration) * 100) + '%';
                    
                    // Video-Driven Sonar Logic
                    if (window.pendingSonarTarget && sandboxHotspots) {
                        let endTimestamp = vid.duration;
                        if (sandboxPassoAtual + 1 < sandboxHotspots.length) {
                            const nextStep = sandboxHotspots[sandboxPassoAtual + 1];
                            if (nextStep.video_timestamp !== undefined && nextStep.video_timestamp !== null) {
                                endTimestamp = nextStep.video_timestamp;
                            }
                        }
                        
                        // Check if we reached the end of the current step's instruction
                        if (vid.currentTime >= endTimestamp) {
                            // Pause the video
                            if (isPlaying) {
                                togglePlay(); 
                            }
                            // Show the Sonar
                            if (typeof window.renderSonarCore === 'function') {
                                window.renderSonarCore(window.pendingSonarTarget);
                            }
                            // Clear pending flag so we don't keep firing
                            window.pendingSonarTarget = null;
                        }
                    }
                };
                
                const track = document.getElementById('pip-track');
                if(track) {
                    track.onclick = (e) => {
                        if(!vid.duration) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const clickPos = (e.clientX - rect.left) / rect.width;
                        vid.currentTime = clickPos * vid.duration;
                    };
                }
                
                // Hover reveal controls
                const container = document.getElementById('pip-video-container');
                if(container) {
                    container.onmouseenter = () => { isHovering = true; updateOverlay(); };
                    container.onmouseleave = () => { isHovering = false; updateOverlay(); };
                }
                
                const btnMin = document.getElementById('pip-btn-min');
                if(btnMin) btnMin.onmousedown = (e) => { 
                    e.stopPropagation(); 
                    pipVideoTime = vid.currentTime;
                    pipVideoPlaying = !vid.paused;
                    isMinimized = true; 
                    renderPip(); 
                };
                
                const btnMax = document.getElementById('pip-btn-max');
                if(btnMax) btnMax.onmousedown = (e) => { 
                    e.stopPropagation(); 
                    isMaximized = !isMaximized; 
                    pip.style.width = isMaximized ? '45vw' : '320px';
                    pip.style.maxWidth = isMaximized ? '800px' : 'none';
                    btnMax.title = isMaximized ? 'Restaurar Tamanho' : 'Maximizar';
                    btnMax.innerHTML = isMaximized ? svgRestore : svgMax;
                };
                
                bindPipDrag(container);
            }
        };

        const bindPipDrag = (handle) => {
            let isDragging = false;
            let startX, startY, initialRight, initialBottom;
            handle.addEventListener("mousedown", (e) => {
                isDragging = true;
                handle.style.cursor = "grabbing";
                startX = e.clientX;
                startY = e.clientY;
                const rect = pip.getBoundingClientRect();
                initialRight = window.innerWidth - rect.right;
                initialBottom = window.innerHeight - rect.bottom;
            });
            document.addEventListener("mousemove", (e) => {
                if (!isDragging) return;
                const dx = startX - e.clientX;
                const dy = startY - e.clientY;
                pip.style.right = (initialRight + dx) + "px";
                pip.style.bottom = (initialBottom + dy) + "px";
            });
            document.addEventListener("mouseup", () => {
                if (isDragging) {
                    isDragging = false;
                    handle.style.cursor = "move";
                }
            });
        };
        
        renderPip();
    };

    window.removeSandboxWidget = function() {
        if (window !== window.top) return;
        const widget = document.getElementById("capture-os-sandbox-widget");
        if (widget) widget.remove();
        
        const pip = document.getElementById("capture-os-pip-video");
        if (pip) pip.remove();

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

        window.highlightSandboxCurrentStep();
        
        // Em 200ms a gente confere se alguém pintou o highlight. Se não, exibe aviso (no top window).
        if (window === window.top) {
            setTimeout(() => {
                // we assume if it worked, some frame scrolled to it.
                // It's hard to synchronously know if an iframe succeeded without direct messaging.
                // We'll trust it worked if they clicked the button.
            }, 300);
        }
    };

    window.highlightSandboxCurrentStep = function() {
        const step = sandboxHotspots[sandboxPassoAtual];
        if (!step) return;

        // Avisa TODAS as janelas (iframes inclusos) para tentar mostrar o hint
        chrome.runtime.sendMessage({
            action: "SHOW_HINT_BROADCAST",
            step: step
        }).catch(() => {});
    };

    window.endSandboxPractice = function() {
        chrome.storage.local.set({ sandboxMode: false });
        chrome.runtime.sendMessage({ type: "ARBITRO_ENCERRADO" }).catch(() => {});
        showToast("warning", "Modo Prática suspenso. Te esperamos na próxima!");
    };

    window.renderSandboxScoreWidget = function() {
        if (window !== window.top) return;
        
        // Auto-minimize PiP Se estiver maximizado (ou até se estiver normal, para liberar espaço)
        const pipBtnMin = document.getElementById('pip-btn-min');
        if (pipBtnMin) {
            pipBtnMin.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
        
        let widget = document.getElementById("capture-os-sandbox-widget");
        if (!widget) return;
        
        const maxXP = sandboxTotalPassos * 10;
        let earnedXP = maxXP - (sandboxStats.errors*5) - (sandboxStats.hints*5) - (sandboxStats.skips*10);
        if (earnedXP < 0) earnedXP = 0;
        const perc = maxXP > 0 ? (earnedXP / maxXP) * 100 : 0;
        
        let stars = 0;
        if (perc === 100) stars = 3;
        else if (perc >= 70) stars = 2;
        else if (perc >= 30) stars = 1;

        let message = "Prática concluída! Tente novamente para melhorar a precisão.";
        if (stars === 3) message = "Perfeito! Você dominou este módulo.";
        else if (stars === 2) message = "Muito bem! Faltou pouco para a perfeição.";

        const svgStarFilled = `<svg width="40" height="40" viewBox="0 0 24 24" fill="#FBBF24" stroke="#F59E0B" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.5));"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        const svgStarEmpty = `<svg width="40" height="40" viewBox="0 0 24 24" fill="rgba(75, 85, 99, 0.2)" stroke="#4B5563" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        const svgStarFilledLarge = `<svg width="48" height="48" viewBox="0 0 24 24" fill="#FBBF24" stroke="#F59E0B" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 14px rgba(251, 191, 36, 0.6));"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        const svgStarEmptyLarge = `<svg width="48" height="48" viewBox="0 0 24 24" fill="rgba(75, 85, 99, 0.2)" stroke="#4B5563" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        
        widget.innerHTML = `
            <style>
            @keyframes starPop {
                0% { transform: scale(0) rotate(-15deg); opacity: 0; }
                70% { transform: scale(1.15) rotate(5deg); opacity: 1; }
                100% { transform: scale(1) rotate(0deg); opacity: 1; }
            }
            .capture-star-anim {
                animation: starPop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
                opacity: 0;
            }
            .capture-star-1 { animation-delay: 0.1s; }
            .capture-star-2 { animation-delay: 0.4s; transform-origin: center; margin-bottom: 12px; }
            .capture-star-3 { animation-delay: 0.7s; }
            </style>
            <div style="background: rgba(31, 187, 117, 0.1); padding: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; border-bottom: 1px solid #122A22;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1FBB75" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span style="font-size: 12px; font-weight: 700; color: #1FBB75; letter-spacing: 1px; text-transform: uppercase;">Prática Concluída</span>
            </div>
            <div style="padding: 32px 20px; display: flex; flex-direction: column; align-items: center; gap: 24px; background: rgba(28, 31, 37, 0.95);">
                
                <div style="display: flex; gap: 12px; align-items: flex-end; height: 60px;">
                    <div class="capture-star-anim capture-star-1">${stars >= 1 ? svgStarFilled : svgStarEmpty}</div>
                    <div class="capture-star-anim capture-star-2" style="width: 48px; height: 48px;">${stars >= 2 ? svgStarFilledLarge : svgStarEmptyLarge}</div>
                    <div class="capture-star-anim capture-star-3">${stars >= 3 ? svgStarFilled : svgStarEmpty}</div>
                </div>

                <div style="text-align: center; max-width: 240px;">
                    <div style="font-size: 14px; font-weight: 600; color: #E2E4E9; margin-bottom: 6px;">${message}</div>
                    <div style="font-size: 12px; color: #6B7280;">Aproveitamento: <strong style="color: #A9B1BD;">${Math.round(perc)}%</strong> (${earnedXP} XP)</div>
                </div>

                <button id="btn-fechar-score" style="margin-top: 8px; width: 100%; background: #1FBB75; color: #181A1F; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 700; transition: background 0.2s; box-shadow: 0 4px 12px rgba(31, 187, 117, 0.2);">Finalizar Prática</button>
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
