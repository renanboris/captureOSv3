// shield.js - Escudo contra conflito de AMD Loaders
// Atua preventivamente desativando o RequireJS em sistemas legados (ex: ERPs como Senior)
// para permitir a injeção segura de scripts da extensão. Em sites normais que não usam 
// RequireJS no document_start, ele simplesmente não fará nada (Pensamento Macro).

(function() {
    if (window.define && window.define.amd) {
        window._captureOldDefine = window.define;
        window.define = null;
        console.log("Capture Shield: RequireJS desativado temporariamente para evitar conflitos.");

        // Restaura assim que o DOM estiver pronto.
        const restaurar = () => {
            if (window._captureOldDefine) {
                window.define = window._captureOldDefine;
                delete window._captureOldDefine;
                console.log("Capture Shield: RequireJS restaurado com sucesso.");
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', restaurar, { once: true });
        } else {
            restaurar();
        }
    }
})();
