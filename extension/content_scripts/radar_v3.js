// radar_v3.js (Content Script)
(function() {
    console.log("Capture OS v3 - Radar Injetado");

    let eventCounter = 1;

    function getSemanticSnapshot() {
        const iterators = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let currentNode = iterators.nextNode();
        let snapshot = [];
        
        while(currentNode) {
            const isInteractive = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(currentNode.tagName) || 
                                  currentNode.hasAttribute('role') ||
                                  currentNode.className.includes('p-button') ||
                                  currentNode.className.includes('ui-dropdown');
                                  
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

    function interceptEvent(e, type) {
        // Encontra a árvore atual
        const tree = getSemanticSnapshot();
        
        // Pega elemento clicado
        const target = e.target;
        const rect = target.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const clickPos = {
            x: Math.round(e.clientX * dpr),
            y: Math.round(e.clientY * dpr)
        };

        const payload = {
            action: type,
            url: window.location.href,
            click_position: clickPos,
            target_tag: target.tagName,
            target_text: (target.innerText || '').substring(0, 50),
            a11y_tree: tree
        };

        chrome.runtime.sendMessage({
            action: 'user_interaction',
            type: type,
            data: payload
        });
    }

    // Bind events
    document.addEventListener('click', (e) => interceptEvent(e, 'click'), true);
    
    // Add simple debounce for input
    let typingTimer;
    document.addEventListener('input', (e) => {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            interceptEvent(e, 'input');
        }, 800);
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
                chrome.runtime.sendMessage({
                    action: 'user_interaction',
                    type: 'navigation',
                    data: {
                        action: 'navigation',
                        url: urlAtual,
                        click_position: {x: 0, y: 0},
                        target_tag: 'BODY',
                        target_text: '',
                        a11y_tree: getSemanticSnapshot()
                    }
                });
            }
        }, 500);
    });
    observerSPA.observe(document.body, { childList: true, subtree: true });

})();
