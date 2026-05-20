window.getSemanticSnapshot = function() {
    const iterators = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let currentNode = iterators.nextNode();
    let snapshot = [];
    
    while(currentNode) {
        // Filtra apenas elementos interativos e visíveis (width/height > 0)
        const isInteractive = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(currentNode.tagName) || 
                              currentNode.hasAttribute('role');
                              
        if(isInteractive) {
            const rect = currentNode.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                snapshot.push({
                    som_id: currentNode.getAttribute('data-som-id') || null,
                    tag: currentNode.tagName.toLowerCase(),
                    role: currentNode.getAttribute('role') || '',
                    text: (currentNode.innerText || currentNode.getAttribute('aria-label') || '').trim(),
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
};
