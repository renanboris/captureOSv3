// Senior Training OS - Radar Script
// Capture event-driven script for browser automation
// Extracted from capture_dual_output.py for better maintainability

console.log('[RADAR] ========================================');
console.log('[RADAR] Script loading - Version 2.2.0-CONTEXTUAL-ROW-SELECTOR');
console.log('[RADAR] Timestamp:', new Date().toISOString());
console.log('[RADAR] ========================================');

if (window.__radarInjetado) {
    console.log('[RADAR] Script already injected, skipping');
    return;
}
window.__radarInjetado = true;
window.__radarVersion = '2.2.0-CONTEXTUAL-ROW-SELECTOR';
console.log('[RADAR] Script injected successfully');

if (window === window.top && !document.getElementById('senior-rec-widget')) {
    const recWidget = document.createElement('div');
    recWidget.id = 'senior-rec-widget';
    recWidget.style.cssText = 'position:fixed;bottom:30px;right:30px;background:rgba(15,23,42,0.85);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);border-radius:100px;padding:10px 20px;display:flex;align-items:center;gap:10px;z-index:2147483647;font-family:Segoe UI,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,0.5);pointer-events:none;';
    recWidget.innerHTML = '<div style="width:12px;height:12px;background:#ef4444;border-radius:50%;animation:pulse-red 1.5s infinite;"></div><div style="color:white;font-size:13px;font-weight:bold;letter-spacing:1px;">MAPEAMENTO ATIVO</div>';
    if (!document.getElementById('senior-rec-styles')) {
        const st = document.createElement('style'); st.id = 'senior-rec-styles';
        st.innerHTML = '@keyframes pulse-red{0%{transform:scale(0.95);box-shadow:0 0 0 0 rgba(239,68,68,0.7)}70%{transform:scale(1);box-shadow:0 0 0 10px rgba(239,68,68,0)}100%{transform:scale(0.95);box-shadow:0 0 0 0 rgba(239,68,68,0)}}';
        document.head.appendChild(st);
    }
    document.documentElement.appendChild(recWidget);
}

const getElementName = (el) => {
    // HACK: textContent no lugar de innerText para varrer o DOM invisivel do Angular
    const isCheckbox = el.closest('p-checkbox, mat-checkbox, [type="checkbox"], .ui-chkbox');
    if (isCheckbox) {
        const parentRow = el.closest('tr, item, li, .ui-g, .list-item, .row');
        if (parentRow) {
            let text = parentRow.textContent || '';
            text = text.replace(/\s+/g, ' ').trim();
            if (text.length > 2) {
                return `Checkbox de: ${text.substring(0, 40)}`;
            }
        }
        return 'Caixa de selecao Angular';
    }

    // Itens de menu de contexto (ngx-contextmenu, CDK overlay)
    // O clique pode cair no <em> (ícone) dentro do <a> ou <li> do menu.
    // Sobe para o item do menu e pega o texto visível.
    const menuItem = el.closest('.ngx-contextmenu li, [class*="contextmenu"] li, .cdk-overlay-pane li, .dropdown-menu li');
    if (menuItem) {
        // Pega apenas o texto, ignorando ícones (<em>, <i>, <svg>)
        const textoMenu = Array.from(menuItem.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && !['EM','I','SVG','SPAN'].includes(n.tagName)))
            .map(n => (n.textContent || '').trim())
            .join(' ').replace(/\s+/g, ' ').trim();
        if (textoMenu && textoMenu.length > 1) return textoMenu;
        // Fallback: innerText do item inteiro sem ícones
        const textoFull = (menuItem.innerText || menuItem.textContent || '').replace(/\s+/g, ' ').trim();
        if (textoFull && textoFull.length > 1 && textoFull.length < 60) return textoFull;
    }
    const tag = el.tagName.toLowerCase();
    const isEditable = tag === 'input' || tag === 'textarea' || el.getAttribute('contenteditable') === 'true';
    if (isEditable) {
        // Filtra atributos Angular não resolvidos (name="undefined", placeholder="undefined")
        const clean = (v) => (v && v !== 'undefined' && v !== 'null') ? v : '';
        return clean(el.placeholder) || clean(el.name) || clean(el.title) || 'Campo de entrada';
    }
    const text = el.innerText?.trim().replace(/\n/g, ' ') || '';
    if (text && text.length > 0 && text.length < 100 && text !== 'undefined') return text;
    let cur = el;
    for (let i = 0; i < 6; i++) {
        if (!cur) break;
        if (cur.getAttribute('aria-label')) return cur.getAttribute('aria-label');
        if (cur.getAttribute('title')) return cur.getAttribute('title');
        // Tenta o id como label legível quando contém texto descritivo (ex: menu-item-Senior Flow)
        const elId = cur.getAttribute('id') || '';
        if (elId && !elId.match(/^(ng-|mat-|cdk-|\d)/) && elId.includes('-') && elId.length < 60) {
            // Extrai a parte descritiva do id (ex: "menu-item-Senior Flow" -> "Senior Flow")
            const partes = elId.split('-');
            const descritivo = partes.slice(2).join(' ').trim();
            if (descritivo && descritivo.length > 2) return descritivo;
        }
        // Tenta texto de filhos diretos (irmãos do ícone dentro do mesmo pai)
        if (i === 0) {
            const irmaoTexto = Array.from(cur.parentElement?.children || [])
                .filter(c => c !== cur && c.tagName !== 'I' && c.tagName !== 'SVG')
                .map(c => (c.innerText || c.textContent || '').trim())
                .find(t => t && t.length > 1 && t.length < 80);
            if (irmaoTexto) return irmaoTexto;
        }
        cur = cur.parentElement;
    }
    return tag;
};

const resolvePrimeNGComponent = (el) => {
    console.log('[RADAR] resolvePrimeNGComponent called', {
        tag: el.tagName,
        className: el.className,
        id: el.id
    });
    
    // MODAL DETECTION: Log para debug
    const modalAncestor = el.closest('p-dialog, ui-dialog, s-dialog, p-confirmdialog, [role="dialog"]');
    console.log('[MODAL DEBUG]', {
        hasModal: !!modalAncestor,
        modalType: modalAncestor?.tagName,
        modalRole: modalAncestor?.getAttribute('role'),
        element: el.tagName,
        elementClass: el.className
    });
    
    // Helper function to add modal scope prefix to selector
    const addModalScope = (seletor) => {
        if (!modalAncestor) return seletor;
        
        // BUGFIX: Removida verificação de aria-hidden e width
        // Se o elemento foi clicado, o modal ESTÁ visível (por definição)
        // A verificação anterior causava falsos negativos durante animações/transições
        
        const modalScope = modalAncestor.getAttribute('role') === 'dialog' 
            ? 'p-dialog[role="dialog"]' 
            : modalAncestor.tagName.toLowerCase();
        
        return `${modalScope} ${seletor}`;
    };
    
    // Special handling for table rows in modals
    if (modalAncestor && (el.tagName.toLowerCase() === 'tr' || el.tagName.toLowerCase() === 'td')) {
        // BUGFIX: Removida verificação de aria-hidden e width
        // Se o elemento foi clicado, o modal ESTÁ visível (por definição)
        
        const modalScope = modalAncestor.getAttribute('role') === 'dialog' 
            ? 'p-dialog[role="dialog"]' 
            : modalAncestor.tagName.toLowerCase();
        
        const rowText = el.textContent.trim().substring(0, 40).replace(/['"\\]/g, '');
        if (rowText) {
            return {
                seletor: `${modalScope} tr:has-text("${rowText}")`,
                componentType: 'p-table:table_row',
                partName: 'table_row',
                identifier: ''
            };
        }
    }
    
    // 1. Identifica se a sub-parte clicada é de um widget composto PrimeNG
    let suffix = '', partName = '', hostId = '';
    
    if (el.closest('.ui-datepicker-trigger, button[icon*="calendar"], p-calendar button, .ui-calendar button')) {
        suffix = 'button'; partName = 'calendar_trigger'; hostId = 'p-calendar';
    } else if (el.closest('.ui-dropdown-trigger, .p-dropdown-trigger')) {
        suffix = '.ui-dropdown-trigger'; partName = 'dropdown_trigger'; hostId = 'p-dropdown';
    } else if (el.closest('.ui-dropdown-label, .p-dropdown-label')) {
        suffix = '.ui-dropdown-label'; partName = 'label'; hostId = 'p-dropdown';
    } else if (el.closest('.ui-multiselect-trigger, .p-multiselect-trigger')) {
        suffix = '.ui-multiselect-trigger'; partName = 'trigger'; hostId = 'p-multiselect';
    } else if (el.closest('.ui-spinner-up, .p-inputnumber-button-up')) {
        suffix = '.ui-spinner-up'; partName = 'increment'; hostId = 'p-spinner';
    } else if (el.closest('.ui-spinner-down, .p-inputnumber-button-down')) {
        suffix = '.ui-spinner-down'; partName = 'decrement'; hostId = 'p-spinner';
    } else if (el.closest('.ui-splitbutton-menubutton, .p-splitbutton-menubutton')) {
        suffix = '.ui-splitbutton-menubutton'; partName = 'menu_trigger'; hostId = 'p-splitbutton';
    } else if (el.closest('.ui-inputswitch-slider, .p-inputswitch-slider')) {
        suffix = '.ui-inputswitch-slider'; partName = 'slider'; hostId = 'p-inputswitch';
    } else if (el.closest('.ui-chips-token-icon, .p-chips-token-icon')) {
        suffix = '.ui-chips-token-icon'; partName = 'remove_chip'; hostId = 'p-chips';
    } else if (el.closest('.ui-fileupload-choose, .p-fileupload-choose')) {
        suffix = '.ui-fileupload-choose'; partName = 'choose_button'; hostId = 'p-fileupload';
    } else if (el.closest('button.button-addon, button.ui-autocomplete-dropdown, s-autocomplete button, .ui-autocomplete-dropdown')) {
        suffix = 'button'; partName = 'search_button'; hostId = 'p-autocomplete';
        // SENIOR X: botão de lupa dentro de s-lookup — tenta usar o name do input interno como âncora
        // Estrutura: s-lookup > div.inputgroup > p-autocomplete > input[name='e070emp'] + button.button-addon
        // O seletor correto é: [name='e070emp'] ~ button.button-addon (irmão do input com esse name)
        const sLookup = el.closest('s-lookup');
        if (sLookup) {
            // Estratégia 1: roubar o name do input interno do p-autocomplete
            const innerInput = sLookup.querySelector('input[name]:not([type="hidden"])');
            if (innerInput) {
                const inputName = innerInput.getAttribute('name') || innerInput.getAttribute('formcontrolname');
                if (inputName) {
                    return {
                        seletor: addModalScope(`[name='${inputName}'] ~ button.button-addon`),
                        componentType: 's-lookup:search_button',
                        partName: 'search_button',
                        identifier: `[name='${inputName}']`
                    };
                }
            }
            // Estratégia 2: tooltipposition do s-lookup
            const tooltip = sLookup.getAttribute('tooltipposition') || sLookup.getAttribute('tooltip');
            if (tooltip) {
                return {
                    seletor: addModalScope(`s-lookup[tooltipposition="${tooltip}"] button.button-addon`),
                    componentType: 's-lookup:search_button',
                    partName: 'search_button',
                    identifier: `[tooltipposition="${tooltip}"]`
                };
            }
            // Estratégia 3: posição ordinal (último recurso)
            const allLookups = Array.from(document.querySelectorAll('s-lookup'));
            const idx = allLookups.indexOf(sLookup);
            if (idx >= 0) {
                return {
                    seletor: addModalScope(`s-lookup:nth-of-type(${idx + 1}) button.button-addon`),
                    componentType: 's-lookup:search_button',
                    partName: 'search_button',
                    identifier: `:nth-of-type(${idx + 1})`
                };
            }
        }
    } else if (el.closest('button.ui-button-icon-only, button[pbutton]')) {
        // Genérico em um inputgroup
        const primeHost = el.closest('.p-inputgroup, .ui-inputgroup');
        if (primeHost) {
            suffix = 'button'; partName = 'addon_button'; hostId = 'p-inputgroup';
        }
    } else if (modalAncestor && (el.tagName.toLowerCase() === 'button' || el.closest('button'))) {
        // BUGFIX: Captura botões genéricos dentro de modais (ex: botões "Selecionar")
        // Estes botões não têm padrões PrimeNG específicos, mas precisam de escopo de modal
        suffix = 'button'; partName = 'modal_button'; hostId = 'p-dialog';
    } else if (el.tagName.toLowerCase() === 'input' || el.closest('input')) {
        // Para inputs, verificamos parent
        const primeHost = el.closest('p-autocomplete, .ui-autocomplete, p-calendar, .ui-calendar, p-spinner, .ui-spinner, p-chips, .ui-chips, .p-inputgroup, .ui-inputgroup, s-autocomplete');
        if (primeHost) {
            suffix = 'input'; partName = 'input';
            hostId = primeHost.tagName.toLowerCase().includes('calendar') ? 'p-calendar' :
                     primeHost.tagName.toLowerCase().includes('spinner') ? 'p-spinner' :
                     primeHost.tagName.toLowerCase().includes('chips') ? 'p-chips' : 'p-autocomplete';
        }
    }

    if (!suffix) return null;

    // 2. Encontrar o identificador (âncora)
    let cur = el;
    let identifier = '';
    let borrowedFromInput = false;

    for (let i = 0; i < 8; i++) {
        if (!cur) break;
        
        const name = cur.getAttribute('name') || cur.getAttribute('formcontrolname');
        const testid = cur.getAttribute('data-testid') || cur.getAttribute('data-test');
        // Alterado \d para evitar o SyntaxWarning do Python
        const idAttr = cur.id && !cur.id.match(/(ng-|mat-|cdk-|^\d)/) && !cur.id.includes('autocomplete') ? cur.id : null;
        
        if (name) { identifier = `[name='${name}']`; break; }
        if (testid) { identifier = `[data-testid='${testid}']`; break; }
        if (idAttr) { identifier = `#${idAttr}`; break; }
        
        // NOVO: 'Roubar' o identificador do input interno se o wrapper for um componente PrimeNG conhecido
        if (cur.tagName.toLowerCase().startsWith('p-') || cur.classList.contains('ui-calendar') || cur.classList.contains('ui-autocomplete') || cur.classList.contains('ui-dropdown') || cur.classList.contains('ui-multiselect') || cur.classList.contains('ui-inputgroup')) {
            const innerInput = cur.querySelector('input:not([type="hidden"])');
            if (innerInput && innerInput !== el) {
                const iname = innerInput.getAttribute('name') || innerInput.getAttribute('formcontrolname');
                if (iname) { identifier = `[name='${iname}']`; borrowedFromInput = true; break; }
                const itest = innerInput.getAttribute('data-testid') || innerInput.getAttribute('data-test');
                if (itest) { identifier = `[data-testid='${itest}']`; borrowedFromInput = true; break; }
                const iid = innerInput.id && !innerInput.id.match(/(ng-|mat-|cdk-|^\d)/) && !innerInput.id.includes('autocomplete') ? innerInput.id : null;
                if (iid) { identifier = `#${iid}`; borrowedFromInput = true; break; }
            }
        }
        
        cur = cur.parentElement;
    }

    if (identifier) {
        if (borrowedFromInput) {
            const wrapperTag = cur.tagName.toLowerCase();
            let wrapperClass = '';
            if (cur.classList.length > 0) {
                const c = Array.from(cur.classList).find(cls => cls.startsWith('ui-') || cls.startsWith('p-'));
                if (c) wrapperClass = `.${c}`;
            }
            const wrapperSel = `${wrapperTag}${wrapperClass}`;
            const seletor = addModalScope(`${wrapperSel}:has(${identifier}) ${suffix}`);
            return { seletor, componentType: `${hostId}:${partName}`, partName, identifier };
        }

        let isSameElement = false;
        try { isSameElement = (cur === el) || cur.matches(suffix); } catch(e) {}
        
        if (isSameElement) {
            const tagPart = suffix.split('.')[0];
            const tag = ['input', 'button'].includes(tagPart) ? tagPart : cur.tagName.toLowerCase();
            const seletor = addModalScope(`${tag}${identifier}`);
            return { seletor, componentType: `${hostId}:${partName}`, partName, identifier };
        } else {
            const seletor = addModalScope(`${identifier} ${suffix}`);
            return { seletor, componentType: `${hostId}:${partName}`, partName, identifier };
        }
    }

    const seletor = addModalScope(`${hostId} ${suffix}`);
    return { seletor, componentType: `${hostId}:${partName}`, partName, identifier: '' };
};


const getBestSelector = (el) => {
    // MODAL DETECTION: Apply modal scope to fallback selectors too
    const modalAncestor = el.closest('p-dialog, ui-dialog, s-dialog, p-confirmdialog, [role="dialog"]');
    const addModalScopeToFallback = (seletor) => {
        if (!modalAncestor) return seletor;
        
        // BUGFIX: Removida verificação de aria-hidden e width
        // Se o elemento foi clicado, o modal ESTÁ visível (por definição)
        // A verificação anterior causava falsos negativos durante animações/transições
        
        const modalScope = modalAncestor.getAttribute('role') === 'dialog' 
            ? '[role="dialog"]' 
            : modalAncestor.tagName.toLowerCase();
        
        return `${modalScope} ${seletor}`;
    };

    // ── SELETOR CONTEXTUAL DE LINHA (universal) ──────────────────────────────
    // Princípio: qualquer elemento dentro de uma linha de tabela/lista deve ser
    // identificado pelo CONTEÚDO da linha, não pela posição.
    //
    // Funciona para: HTML tables, PrimeNG p-table, Angular Material mat-table,
    // listas ul/ol, divs com role="row", e qualquer estrutura de lista genérica.
    //
    // Estratégia:
    //   1. Detecta se o elemento está dentro de uma linha (tr, [role="row"], li, etc.)
    //   2. Extrai o texto identificador da linha (primeiro campo não-vazio, max 50 chars)
    //   3. Obtém o seletor do próprio elemento (aria-label, data-testid, texto, etc.)
    //   4. Combina: rowSelector:has-text("texto") elementSelector
    //
    // Isso garante que "botão Ações da linha Aula SIGN 001" seja sempre encontrado
    // independente de quantas linhas existam ou da ordem delas.
    const resolveRowContext = (el) => {
        // Detecta linha de tabela/lista — padrões universais
        const ROW_SELECTORS = [
            'tr',                          // HTML table row
            '[role="row"]',                // ARIA table row (qualquer framework)
            'li',                          // lista HTML
            '[role="listitem"]',           // ARIA list item
            '.ui-g[class*="row"]',         // PrimeNG grid row
            '.p-datatable-row',            // PrimeNG DataTable row
            '.mat-row',                    // Angular Material row
            '.ag-row',                     // AG Grid row
            '[class*="-row"]:not(input)',  // padrão genérico: qualquer elemento com "-row" na classe
        ];

        const rowEl = el.closest(ROW_SELECTORS.join(', '));
        if (!rowEl) return null;

        // Não aplica se o próprio elemento clicado É a linha (clique na linha inteira)
        if (rowEl === el) return null;

        // Extrai texto identificador da linha
        // Estratégia: pega o texto de cada célula/filho direto, ignora ícones e botões,
        // usa o primeiro texto com conteúdo semântico real (> 2 chars, não só números)
        const getRowIdentifier = (row) => {
            // Tenta células explícitas primeiro (td, th, [role="cell"], [role="gridcell"])
            const cells = Array.from(row.querySelectorAll(
                'td, th, [role="cell"], [role="gridcell"], .ui-g-cell, .p-datatable-cell'
            ));

            // Se não há células, usa filhos diretos
            const candidates = cells.length > 0 ? cells : Array.from(row.children);

            for (const cell of candidates) {
                // Ignora células que contêm apenas botões/ícones (colunas de ação)
                const hasOnlyButtons = Array.from(cell.children).every(
                    c => c.tagName === 'BUTTON' || c.tagName === 'A' ||
                         c.getAttribute('role') === 'button' ||
                         c.classList.contains('ui-button') ||
                         c.classList.contains('p-button')
                );
                if (hasOnlyButtons && cell.children.length > 0) continue;

                // Pega o texto visível da célula, ignorando sub-elementos de ação
                const text = (cell.innerText || cell.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim();

                // Texto válido: mais de 2 chars, não é só número, não é só ícone
                if (text.length > 2 && !/^\d+$/.test(text)) {
                    // Limita a 50 chars e escapa aspas
                    return text.substring(0, 50).replace(/["\\]/g, '');
                }
            }

            // Fallback: texto completo da linha (sem botões)
            const fullText = (row.innerText || row.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
            if (fullText.length > 2) {
                return fullText.substring(0, 50).replace(/["\\]/g, '');
            }

            return null;
        };

        const rowText = getRowIdentifier(rowEl);
        if (!rowText) return null;

        // Obtém o seletor do elemento dentro da linha
        // Prioridade: aria-label > data-testid > texto > tag
        const getElementSelector = (el) => {
            // Sobe até 5 níveis buscando atributo estável (mas não sai da linha)
            let cur = el;
            for (let i = 0; i < 5; i++) {
                if (!cur || cur === rowEl) break;
                const aria = cur.getAttribute('aria-label');
                if (aria) return `[aria-label="${aria.replace(/"/g, '\\"')}"]`;
                const testid = cur.getAttribute('data-testid') || cur.getAttribute('data-test');
                if (testid) return `[data-testid="${testid}"]`;
                const role = cur.getAttribute('role');
                if (role && role !== 'presentation' && role !== 'none') {
                    const txt = (cur.innerText || '').trim().replace(/\s+/g, ' ');
                    if (txt && txt.length > 0 && txt.length < 40) {
                        return `[role="${role}"]:has-text("${txt.replace(/"/g, '\\"')}")`;
                    }
                    return `[role="${role}"]`;
                }
                cur = cur.parentElement;
            }

            // Texto do próprio elemento
            const txt = (el.innerText || '').trim().replace(/\s+/g, ' ');
            if (txt && txt.length > 0 && txt.length < 40) {
                return `text="${txt.replace(/"/g, '\\"')}"`;
            }

            // Tag como último recurso dentro da linha
            return el.tagName.toLowerCase();
        };

        const elSelector = getElementSelector(el);

        // Determina o seletor da linha (tag ou role)
        let rowTag = rowEl.tagName.toLowerCase();
        if (rowEl.getAttribute('role') === 'row') rowTag = '[role="row"]';
        else if (rowEl.getAttribute('role') === 'listitem') rowTag = '[role="listitem"]';

        // Seletor final: linha com texto âncora > elemento
        const contextualSelector = `${rowTag}:has-text("${rowText}") ${elSelector}`;

        console.log(`[RADAR] Contextual row selector: ${contextualSelector}`);
        return contextualSelector;
    };

    // Tenta seletor contextual de linha ANTES de qualquer outro fallback
    // Só aplica se o elemento não tem atributo estável próprio (evita over-engineering)
    const _hasStableAttr = (el) => {
        let cur = el;
        for (let i = 0; i < 4; i++) {
            if (!cur) break;
            if (cur.getAttribute('data-testid') || cur.getAttribute('data-test')) return true;
            if (cur.getAttribute('aria-label')) return true;
            if (cur.getAttribute('name') && cur.getAttribute('name').length < 40) return true;
            cur = cur.parentElement;
        }
        return false;
    };

    // Aplica contexto de linha apenas quando o elemento não tem atributo estável próprio
    // OU quando está em uma tabela (onde mesmo aria-label pode ser ambíguo entre linhas)
    const isInTable = !!el.closest('table, [role="grid"], [role="treegrid"], p-table, .p-datatable, .ui-datatable');
    if (isInTable || !_hasStableAttr(el)) {
        const rowContextSelector = resolveRowContext(el);
        if (rowContextSelector) return addModalScopeToFallback(rowContextSelector);
    }

    // PADRÃO ESPECIAL: Menu de contexto (universal)
    // Quando o elemento clicado está dentro de um menu de contexto (overlay CDK,
    // ngx-contextmenu, PrimeNG p-contextmenu, dropdown-menu, etc.), o seletor
    // deve incluir o escopo do container do menu para evitar ambiguidade.
    //
    // Sem escopo: text="Editar" -> pode clicar no botão "Editar" da toolbar
    // Com escopo: .ngx-contextmenu li:has-text("Editar") -> sempre o item do menu
    //
    // Funciona para: ngx-contextmenu, CDK overlay, PrimeNG, Bootstrap dropdown,
    // Material menu, e qualquer container com role="menu".
    const MENU_CONTAINER_SELECTORS = [
        '.ngx-contextmenu',
        '.cdk-overlay-pane .ngx-contextmenu',
        '[class*="ngx-contextmenu"]',
        '.p-contextmenu',
        '.p-menu',
        '[role="menu"]',
        '.dropdown-menu',
        '.mat-menu-panel',
        '.cdk-overlay-pane [role="menu"]',
    ];
    const menuContainer = el.closest(MENU_CONTAINER_SELECTORS.join(', '));
    if (menuContainer) {
        const menuItem = el.closest('li, [role="menuitem"], a');
        const itemEl = menuItem || el;

        // Texto limpo: ignora ícones internos (<em>, <i>, <svg>, <span>)
        const textoItem = Array.from(itemEl.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE ||
                (n.nodeType === Node.ELEMENT_NODE &&
                 !['EM', 'I', 'SVG', 'SPAN', 'IMG'].includes(n.tagName)))
            .map(n => (n.textContent || '').trim())
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        const textoFinal = textoItem ||
            (itemEl.innerText || '').replace(/\s+/g, ' ').trim().substring(0, 50);

        if (textoFinal && textoFinal.length > 1) {
            // Determina o seletor do container (mais específico possível)
            let containerSel = '';
            for (const sel of MENU_CONTAINER_SELECTORS) {
                try {
                    if (menuContainer.matches(sel)) { containerSel = sel; break; }
                } catch(e) {}
            }
            if (!containerSel) containerSel = menuContainer.tagName.toLowerCase();

            const itemTag = menuItem ? menuItem.tagName.toLowerCase() : el.tagName.toLowerCase();
            const escapedText = textoFinal.replace(/["\\]/g, '\\$&');
            console.log(`[RADAR] Context menu selector: ${containerSel} ${itemTag}:has-text("${escapedText}")`);
            return `${containerSel} ${itemTag}:has-text("${escapedText}")`;
        }
    }

    // PADRÃO ESPECIAL: Dia de calendário PrimeNG/Angular
    // Quando o usuário clica em um dia dentro do datepicker aberto, o elemento é um <a>
    // com texto numérico (ex: "6") dentro de .ui-datepicker-calendar ou similar.
    // O fallback genérico geraria nth-child — aqui geramos um seletor semântico com contexto.
    const calendarCell = el.closest('.ui-datepicker-calendar td, .p-datepicker-calendar td, table.ui-datepicker-calendar td');
    if (calendarCell || (el.tagName.toLowerCase() === 'a' && el.closest('.ui-datepicker, .p-datepicker'))) {
        const dayText = (el.innerText || el.textContent || '').trim();
        if (dayText && /^\d{1,2}$/.test(dayText)) {
            // Encontra o calendário pai e tenta obter o identificador do input associado
            const calendarHost = el.closest('p-calendar, .ui-calendar, span.ui-calendar');
            if (calendarHost) {
                const innerInput = calendarHost.querySelector('input:not([type="hidden"])');
                const inputName = innerInput && (innerInput.getAttribute('name') || innerInput.getAttribute('formcontrolname'));
                if (inputName) {
                    // Seletor semântico: calendário do campo X, dia com texto exato N
                    // :text-is() é o pseudo-seletor Playwright para match exato (não encontra "2026" ao buscar "6")
                    return addModalScopeToFallback(`span.ui-calendar:has([name='${inputName}']) a:text-is('${dayText}')`);
                }
            }
            // Fallback: qualquer datepicker visível, dia com texto exato
            return addModalScopeToFallback(`.ui-datepicker a:text-is('${dayText}')`);
        }
    }

    const customCheckbox = el.closest('p-checkbox, mat-checkbox, [role="checkbox"], .ui-chkbox');
    if (customCheckbox) {
        let tagCheck = customCheckbox.tagName.toLowerCase();
        
        // HACK: Direciona o clique para a caixa visual interna do PrimeNG
        let cliqueInterno = tagCheck;
        if (tagCheck === 'p-checkbox') {
            cliqueInterno = 'p-checkbox .ui-chkbox-box';
        } else if (tagCheck === 'div' && customCheckbox.classList.contains('ui-chkbox')) {
            cliqueInterno = '.ui-chkbox .ui-chkbox-box';
        }

        // SELETOR SUPREMO: "Linha que tem este texto" > Checkbox
        const parentRow = customCheckbox.closest('tr, item, li, .ui-g, .list-item, .row');
        if (parentRow) {
            let text = parentRow.textContent || '';
            text = text.replace(/\s+/g, ' ').trim();
            if (text.length > 2) {
                const cleanText = text.substring(0, 40).replace(/['"\\\/]/g, '');
                let pTag = parentRow.tagName.toLowerCase();
                if (pTag === 'div' && parentRow.classList.contains('ui-g')) pTag = '.ui-g';
                return addModalScopeToFallback(`${pTag}:has-text("${cleanText}") ${cliqueInterno}`);
            }
        }

        const parentComId = customCheckbox.closest('[id]:not([id*="ng-"]):not([id*="mat-"])');
        if (parentComId && parentComId.id) {
            return addModalScopeToFallback(`${parentComId.tagName.toLowerCase()}#${parentComId.id} ${cliqueInterno}`);
        }
    }

    // PrimeNG composite component: resolve ANTES do fallback genérico
    const _primeResult = resolvePrimeNGComponent(el);
    if (_primeResult) return _primeResult.seletor;

    // Fallback genérico: sobe na árvore DOM buscando atributo estável
    // Profundidade aumentada para 8 para cobrir componentes aninhados
    let cur = el;
    for (let i = 0; i < 8; i++) {
        if (!cur) break;
        const tid = cur.getAttribute('data-testid') || cur.getAttribute('data-test');
        if (tid) return addModalScopeToFallback(`[data-testid='${tid}']`);
        const aria = cur.getAttribute('aria-label');
        if (aria) return addModalScopeToFallback(`[aria-label='${aria}']`);
        const name = cur.getAttribute('name');
        if (name && name.length < 40) return addModalScopeToFallback(`[name='${name}']`);
        if (cur.id && !cur.id.match(/^[\d\-_]/) && !cur.id.match(/ng-|mat-|cdk-/)) return addModalScopeToFallback(`[id='${cur.id}']`);
        cur = cur.parentElement;
    }
    const ph = el.getAttribute('placeholder');
    if (ph) return addModalScopeToFallback(`[placeholder='${ph}']`);
    const role = el.getAttribute('role');
    if (role && role !== 'presentation') {
        const t = el.innerText?.trim().replace(/\n/g, ' ') || '';
        if (t && t.length < 50) return addModalScopeToFallback(`[role='${role}']:has-text('${t}')`);
    }
    const txt = el.innerText?.trim().replace(/\n/g, ' ') || '';
    if (txt && txt.length > 1 && txt.length < 50) return addModalScopeToFallback(`text="${txt}"`);
    const parentAria = el.closest('[aria-label]')?.getAttribute('aria-label');
    if (parentAria) return addModalScopeToFallback(`[aria-label='${parentAria}'] ${el.tagName.toLowerCase()}`);
    const siblings = Array.from(el.parentElement?.children || []);
    return addModalScopeToFallback(`${el.tagName.toLowerCase()}:nth-child(${siblings.indexOf(el) + 1})`);
};

const getFrameId = () => {
    // Estratégia de fingerprint estável para iframes.
    // Problema: window.name e URL podem ser dinâmicos entre sessões.
    // Solução: gerar um fingerprint baseado em atributos ESTÁVEIS do elemento
    // <iframe> no DOM pai — na ordem de preferência:
    //   1. name (se não for gerado automaticamente)
    //   2. id (se não for gerado automaticamente)
    //   3. src sem query string e sem hash (parte do path estável)
    //   4. title
    //   5. posição ordinal entre iframes irmãos (último recurso)
    //
    // O fingerprint é prefixado com "fp:" para que o executor saiba
    // que deve usar a lógica de fingerprint, não busca por URL.

    // Se estamos no frame principal, retorna marcador especial
    if (window === window.top) return 'Pagina Principal';

    try {
        // Tenta acessar o elemento <iframe> no DOM do pai
        const parentFrames = window.parent.document.querySelectorAll('iframe');
        for (let i = 0; i < parentFrames.length; i++) {
            const iframeEl = parentFrames[i];
            try {
                // Verifica se este iframe contém nossa janela
                if (iframeEl.contentWindow === window) {
                    // 1. name estável (não gerado por Angular/framework)
                    const name = iframeEl.getAttribute('name');
                    if (name && !name.match(/^(ng-|mat-|cdk-|\d)/)) {
                        return `fp:name=${name}`;
                    }
                    // 2. id estável
                    const id = iframeEl.getAttribute('id');
                    if (id && !id.match(/^(ng-|mat-|cdk-|\d)/)) {
                        return `fp:id=${id}`;
                    }
                    // 3. src sem query string (parte do path é estável)
                    const src = iframeEl.getAttribute('src');
                    if (src) {
                        // Remove query string e hash, pega apenas o path
                        const srcPath = src.split('?')[0].split('#')[0];
                        // Pega os últimos 2 segmentos do path (mais específico)
                        const parts = srcPath.split('/').filter(Boolean);
                        const stableSrc = parts.slice(-2).join('/');
                        if (stableSrc && stableSrc.length > 2) {
                            return `fp:src=${stableSrc}`;
                        }
                    }
                    // 4. title
                    const title = iframeEl.getAttribute('title');
                    if (title && title.length > 1) {
                        return `fp:title=${title}`;
                    }
                    // 5. posição ordinal (último recurso — frágil mas melhor que nada)
                    return `fp:index=${i}`;
                }
            } catch(e) {
                // Cross-origin: não consegue acessar contentWindow
                continue;
            }
        }
    } catch(e) {
        // Sem acesso ao DOM pai (cross-origin top-level)
    }

    // Fallback: usa window.name se disponível
    if (window.name) return window.name;

    // Fallback final: fragmento da URL sem query string
    try {
        const href = window.location.href;
        if (href && href !== window.top?.location?.href) {
            const path = href.split('?')[0].split('#')[0];
            const parts = path.split('/').filter(Boolean);
            return parts.slice(-2).join('/') || 'iframe';
        }
    } catch(e) {}

    return 'iframe';
};

const getRectComFallback = (el) => {
    // Elementos Angular da sidebar (position:fixed, ng-star-inserted) podem retornar
    // rect zerado se ainda estao em transicao de layout. Sobe na arvore ate achar
    // um ancestral com dimensoes validas, ou usa o centro da viewport como ultimo recurso.
    let cur = el;
    for (let i = 0; i < 6; i++) {
        if (!cur) break;
        const r = cur.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return r;
        cur = cur.parentElement;
    }
    // Fallback: centro da viewport (melhor que zero para o cursor_engine)
    return { x: window.innerWidth / 2, y: window.innerHeight / 2, width: 40, height: 20 };
};

const processarEvento = (target, acao, valor = '') => {
    console.log('[RADAR] processarEvento called', {
        action: acao,
        tag: target.tagName,
        className: target.className
    });
    
    const rect = getRectComFallback(target);
    // Resolve PrimeNG uma vez: reutiliza para seletor + metadado
    const _pResult = resolvePrimeNGComponent(target);
    console.log('[RADAR] PrimeNG result:', _pResult);
    
    const _seletor = _pResult ? _pResult.seletor : getBestSelector(target);
    console.log('[RADAR] Final selector:', _seletor);
    
    // Detect modal context for telemetry
    const modalAncestor = target.closest('p-dialog, ui-dialog, s-dialog, p-confirmdialog, [role="dialog"]');
    const modalContext = modalAncestor ? {
        type: modalAncestor.tagName.toLowerCase(),
        role: modalAncestor.getAttribute('role') || '',
        visible: modalAncestor.getAttribute('aria-hidden') !== 'true' 
            && modalAncestor.getBoundingClientRect().width > 0
    } : null;
    console.log('[RADAR] Modal context:', modalContext);
    
    window.capturarElemento(JSON.stringify({
        tag: target.tagName.toLowerCase(),
        texto_encontrado: valor || getElementName(target),
        seletor: _seletor,
        primeng_component: _pResult ? _pResult.componentType : '',
        modal_context: modalContext,
        iframe: getFrameId(), acao,
        posicao_visual: `x:${Math.round(rect.x)},y:${Math.round(rect.y)},w:${Math.round(rect.width)},h:${Math.round(rect.height)}`,
        html_snapshot: target.outerHTML.substring(0, 300)
    }));
    const orig = target.style.outline;
    target.style.outline = '2px solid red';
    setTimeout(() => target.style.outline = orig, 200);
};

let clickTimeout = null;
document.addEventListener('mousedown', (e) => {
    if (e.button === 2) { processarEvento(e.target, 'clique_direito'); return; }
    if (e.button === 0) {
        if (clickTimeout !== null) { clearTimeout(clickTimeout); clickTimeout = null; return; }
        clickTimeout = setTimeout(() => { processarEvento(e.target, 'clique'); clickTimeout = null; }, 250);
    }
}, true);
document.addEventListener('dblclick', (e) => {
    clearTimeout(clickTimeout); clickTimeout = null;
    processarEvento(e.target, 'duplo_clique');
}, true);
let ultimoEnterTarget = null, ultimoEnterTime = 0;
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        ultimoEnterTarget = e.target; ultimoEnterTime = Date.now();
        processarEvento(e.target, 'digitar_e_enter', e.target.value || e.target.innerText || '');
    }
}, true);

// --- ANTI-FANTASMA: rastrear se o usuario realmente interagiu via teclado, mouse ou paste
document.addEventListener('input', (e) => {
    if (e.isTrusted && e.target && e.target.tagName) {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
            e.target.dataset.userTyped = 'true';
        }
    }
}, true);

document.addEventListener('blur', (e) => {
    if (!e.target || !e.target.tagName) return;
    const tag = e.target.tagName.toLowerCase();
    const tipo = (e.target.getAttribute('type') || '').toLowerCase();
    // Ignora checkboxes e radios — nunca geram preencher_campo
    // Ignora valores "undefined"/"null" que vazam de inputs ocultos do PrimeNG/Angular
    if (tipo === 'checkbox' || tipo === 'radio') return;
    const val = e.target.value || '';
    if (!val.trim() || val === 'undefined' || val === 'null') return;
    if (e.target === ultimoEnterTarget && Date.now() - ultimoEnterTime < 500) return;
    
    if ((tag === 'input' || tag === 'textarea' || e.target.isContentEditable) && e.target.value) {
        // SÓ EMITE SE O USUARIO EFETIVAMENTE DIGITOU ALGO (isTrusted input)
        if (e.target.dataset.userTyped === 'true') {
            processarEvento(e.target, 'preencher_campo', e.target.value);
            e.target.dataset.userTyped = 'false'; // Reseta após emitir
        }
    }
}, true);
