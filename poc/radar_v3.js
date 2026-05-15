// Capture OS v3 - Radar Script (Hybrid Intelligence Layer POC)
(() => {

console.log('[RADAR] ========================================');
console.log('[RADAR] Script loading - Version 3.0.0-POC');
console.log('[RADAR] Timestamp:', new Date().toISOString());
console.log('[RADAR] ========================================');

if (window.__radarInjetado) {
    console.log('[RADAR] Script already injected, skipping');
    return;
}
window.__radarInjetado = true;
window.__radarVersion = '3.0.0-POC';
console.log('[RADAR] Script injected successfully');

// Patch History API para capturar navegação Angular/SPA
const _patchNav = (method) => {
    const orig = history[method].bind(history);
    history[method] = function(...args) {
        orig(...args);
        if (typeof window.capturarElemento === 'function') {
            window.capturarElemento(JSON.stringify({
                acao: 'navegar',
                tag: 'navigation',
                texto_encontrado: document.title,
                seletor: '',
                posicao_visual: 'x:0,y:0,w:0,h:0',
                iframe: 'Pagina Principal',
                html_snapshot: '',
                url_destino: location.href,
                url_origem: document.referrer || '',
            }));
        }
    };
};
['pushState', 'replaceState'].forEach(_patchNav);
window.addEventListener('popstate', () => {
    if (typeof window.capturarElemento === 'function') {
        window.capturarElemento(JSON.stringify({
            acao: 'navegar',
            tag: 'navigation',
            texto_encontrado: document.title,
            seletor: '',
            posicao_visual: 'x:0,y:0,w:0,h:0',
            iframe: 'Pagina Principal',
            html_snapshot: '',
            url_destino: location.href,
            url_origem: '',
        }));
    }
});

// Scroll com throttle (lazy-load coverage)
let _scrollTimer, _lastScrollY = 0;
document.addEventListener('scroll', () => {
    clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(() => {
        const delta = Math.abs(window.scrollY - _lastScrollY);
        if (delta > 150 && typeof window.capturarElemento === 'function') {
            window.capturarElemento(JSON.stringify({
                acao: 'scroll',
                tag: 'scroll',
                texto_encontrado: '',
                seletor: '',
                posicao_visual: `x:0,y:${Math.round(window.scrollY)},w:0,h:0`,
                iframe: getFrameId(),
                html_snapshot: '',
            }));
            _lastScrollY = window.scrollY;
        }
    }, 400);
}, { passive: true });

const getElementName = (el) => {
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

    const menuItem = el.closest('.ngx-contextmenu li, [class*="contextmenu"] li, .cdk-overlay-pane li, .dropdown-menu li');
    if (menuItem) {
        const textoMenu = Array.from(menuItem.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && !['EM','I','SVG','SPAN'].includes(n.tagName)))
            .map(n => (n.textContent || '').trim())
            .join(' ').replace(/\s+/g, ' ').trim();
        if (textoMenu && textoMenu.length > 1) return textoMenu;
        const textoFull = (menuItem.innerText || menuItem.textContent || '').replace(/\s+/g, ' ').trim();
        if (textoFull && textoFull.length > 1 && textoFull.length < 60) return textoFull;
    }
    const tag = el.tagName.toLowerCase();
    const isEditable = tag === 'input' || tag === 'textarea' || el.getAttribute('contenteditable') === 'true';
    if (isEditable) {
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
        const elId = cur.getAttribute('id') || '';
        if (elId && !elId.match(/^(ng-|mat-|cdk-|\d)/) && elId.includes('-') && elId.length < 60) {
            const partes = elId.split('-');
            const descritivo = partes.slice(2).join(' ').trim();
            if (descritivo && descritivo.length > 2) return descritivo;
        }
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
    const modalAncestor = el.closest('p-dialog, ui-dialog, s-dialog, p-confirmdialog, [role="dialog"]');
    
    const addModalScope = (seletor) => {
        if (!modalAncestor) return seletor;
        const modalScope = modalAncestor.getAttribute('role') === 'dialog' 
            ? 'p-dialog[role="dialog"]' 
            : modalAncestor.tagName.toLowerCase();
        return `${modalScope} ${seletor}`;
    };
    
    if (modalAncestor && (el.tagName.toLowerCase() === 'tr' || el.tagName.toLowerCase() === 'td')) {
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
        const sLookup = el.closest('s-lookup');
        if (sLookup) {
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
            const tooltip = sLookup.getAttribute('tooltipposition') || sLookup.getAttribute('tooltip');
            if (tooltip) {
                return {
                    seletor: addModalScope(`s-lookup[tooltipposition="${tooltip}"] button.button-addon`),
                    componentType: 's-lookup:search_button',
                    partName: 'search_button',
                    identifier: `[tooltipposition="${tooltip}"]`
                };
            }
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
        const primeHost = el.closest('.p-inputgroup, .ui-inputgroup');
        if (primeHost) {
            suffix = 'button'; partName = 'addon_button'; hostId = 'p-inputgroup';
        }
    } else if (modalAncestor && (el.tagName.toLowerCase() === 'button' || el.closest('button'))) {
        suffix = 'button'; partName = 'modal_button'; hostId = 'p-dialog';
    } else if (el.tagName.toLowerCase() === 'input' || el.closest('input')) {
        const primeHost = el.closest('p-autocomplete, .ui-autocomplete, p-calendar, .ui-calendar, p-spinner, .ui-spinner, p-chips, .ui-chips, .p-inputgroup, .ui-inputgroup, s-autocomplete');
        if (primeHost) {
            suffix = 'input'; partName = 'input';
            hostId = primeHost.tagName.toLowerCase().includes('calendar') ? 'p-calendar' :
                     primeHost.tagName.toLowerCase().includes('spinner') ? 'p-spinner' :
                     primeHost.tagName.toLowerCase().includes('chips') ? 'p-chips' : 'p-autocomplete';
        }
    }

    if (!suffix) return null;

    let cur = el;
    let identifier = '';
    let borrowedFromInput = false;

    for (let i = 0; i < 8; i++) {
        if (!cur) break;
        const name = cur.getAttribute('name') || cur.getAttribute('formcontrolname');
        const testid = cur.getAttribute('data-testid') || cur.getAttribute('data-test');
        const idAttr = cur.id && !cur.id.match(/(ng-|mat-|cdk-|^\d)/) && !cur.id.includes('autocomplete') ? cur.id : null;
        if (name) { identifier = `[name='${name}']`; break; }
        if (testid) { identifier = `[data-testid='${testid}']`; break; }
        if (idAttr) { identifier = `#${idAttr}`; break; }
        
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
    const modalAncestor = el.closest('p-dialog, ui-dialog, s-dialog, p-confirmdialog, [role="dialog"]');
    const addModalScopeToFallback = (seletor) => {
        if (!modalAncestor) return seletor;
        const modalScope = modalAncestor.getAttribute('role') === 'dialog' 
            ? '[role="dialog"]' 
            : modalAncestor.tagName.toLowerCase();
        if (seletor.startsWith('text=')) return `${modalScope} >> ${seletor}`;
        return `${modalScope} ${seletor}`;
    };

    const resolveRowContext = (el) => {
        const ROW_SELECTORS = [
            'tr', '[role="row"]', 'li', '[role="listitem"]', '.ui-g[class*="row"]',
            '.p-datatable-row', '.mat-row', '.ag-row', '[class*="-row"]:not(input)'
        ];
        const rowEl = el.closest(ROW_SELECTORS.join(', '));
        if (!rowEl || rowEl === el) return null;

        const getRowIdentifier = (row) => {
            const cells = Array.from(row.querySelectorAll('td, th, [role="cell"], [role="gridcell"], .ui-g-cell, .p-datatable-cell'));
            const candidates = cells.length > 0 ? cells : Array.from(row.children);
            for (const cell of candidates) {
                const hasOnlyButtons = Array.from(cell.children).every(c => 
                    c.tagName === 'BUTTON' || c.tagName === 'A' || c.getAttribute('role') === 'button' || 
                    c.classList.contains('ui-button') || c.classList.contains('p-button')
                );
                if (hasOnlyButtons && cell.children.length > 0) continue;
                const text = (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim();
                if (text.length > 2 && !/^\d+$/.test(text)) {
                    return text.substring(0, 50).replace(/["\\]/g, '');
                }
            }
            const fullText = (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim();
            if (fullText.length > 2) return fullText.substring(0, 50).replace(/["\\]/g, '');
            return null;
        };

        const rowText = getRowIdentifier(rowEl);
        if (!rowText) return null;

        const getElementSelector = (el) => {
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
                    if (txt && txt.length > 0 && txt.length < 40) return `[role="${role}"]:has-text("${txt.replace(/"/g, '\\"')}")`;
                    return `[role="${role}"]`;
                }
                cur = cur.parentElement;
            }
            const txt = (el.innerText || '').trim().replace(/\s+/g, ' ');
            if (txt && txt.length > 0 && txt.length < 40) return `text="${txt.replace(/"/g, '\\"')}"`;
            return el.tagName.toLowerCase();
        };

        const elSelector = getElementSelector(el);
        let rowTag = rowEl.tagName.toLowerCase();
        if (rowEl.getAttribute('role') === 'row') rowTag = '[role="row"]';
        else if (rowEl.getAttribute('role') === 'listitem') rowTag = '[role="listitem"]';

        const combiner = elSelector.startsWith('text=') ? ' >> ' : ' ';
        return `${rowTag}:has-text("${rowText}")${combiner}${elSelector}`;
    };

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

    const isInTable = !!el.closest('table, [role="grid"], [role="treegrid"], p-table, .p-datatable, .ui-datatable');
    if (isInTable || !_hasStableAttr(el)) {
        const rowContextSelector = resolveRowContext(el);
        if (rowContextSelector) return addModalScopeToFallback(rowContextSelector);
    }

    const MENU_CONTAINER_SELECTORS = [
        '.ngx-contextmenu', '.cdk-overlay-pane .ngx-contextmenu', '[class*="ngx-contextmenu"]',
        '.p-contextmenu', '.p-menu', '[role="menu"]', '.dropdown-menu', '.mat-menu-panel', '.cdk-overlay-pane [role="menu"]'
    ];
    const menuContainer = el.closest(MENU_CONTAINER_SELECTORS.join(', '));
    if (menuContainer) {
        const menuItem = el.closest('li, [role="menuitem"], a');
        const itemEl = menuItem || el;
        const textoItem = Array.from(itemEl.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && !['EM', 'I', 'SVG', 'SPAN', 'IMG'].includes(n.tagName)))
            .map(n => (n.textContent || '').trim()).join(' ').replace(/\s+/g, ' ').trim();
        const textoFinal = textoItem || (itemEl.innerText || '').replace(/\s+/g, ' ').trim().substring(0, 50);
        if (textoFinal && textoFinal.length > 1) {
            let containerSel = '';
            for (const sel of MENU_CONTAINER_SELECTORS) {
                try { if (menuContainer.matches(sel)) { containerSel = sel; break; } } catch(e) {}
            }
            if (!containerSel) containerSel = menuContainer.tagName.toLowerCase();
            const itemTag = menuItem ? menuItem.tagName.toLowerCase() : el.tagName.toLowerCase();
            const escapedText = textoFinal.replace(/["\\]/g, '\\$&');
            return `${containerSel} ${itemTag}:has-text("${escapedText}")`;
        }
    }

    const calendarCell = el.closest('.ui-datepicker-calendar td, .p-datepicker-calendar td, table.ui-datepicker-calendar td');
    if (calendarCell || (el.tagName.toLowerCase() === 'a' && el.closest('.ui-datepicker, .p-datepicker'))) {
        const dayText = (el.innerText || el.textContent || '').trim();
        if (dayText && /^\d{1,2}$/.test(dayText)) {
            const calendarHost = el.closest('p-calendar, .ui-calendar, span.ui-calendar');
            if (calendarHost) {
                const innerInput = calendarHost.querySelector('input:not([type="hidden"])');
                const inputName = innerInput && (innerInput.getAttribute('name') || innerInput.getAttribute('formcontrolname'));
                if (inputName) {
                    return addModalScopeToFallback(`span.ui-calendar:has([name='${inputName}']) a:text-is('${dayText}')`);
                }
            }
            return addModalScopeToFallback(`.ui-datepicker a:text-is('${dayText}')`);
        }
    }

    const customCheckbox = el.closest('p-checkbox, mat-checkbox, [role="checkbox"], .ui-chkbox');
    if (customCheckbox) {
        let tagCheck = customCheckbox.tagName.toLowerCase();
        let cliqueInterno = tagCheck;
        if (tagCheck === 'p-checkbox') cliqueInterno = 'p-checkbox .ui-chkbox-box';
        else if (tagCheck === 'div' && customCheckbox.classList.contains('ui-chkbox')) cliqueInterno = '.ui-chkbox .ui-chkbox-box';

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
        if (parentComId && parentComId.id) return addModalScopeToFallback(`${parentComId.tagName.toLowerCase()}#${parentComId.id} ${cliqueInterno}`);
    }

    const _primeResult = resolvePrimeNGComponent(el);
    if (_primeResult) return _primeResult.seletor;

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
    
    // Tratamento para icones (FontAwesome, PrimeIcons, etc)
    if (el.classList && el.classList.length > 0) {
        const iconClass = Array.from(el.classList).find(c => c.startsWith('fa-') || c.startsWith('pi-') || c.startsWith('icon-'));
        if (iconClass) return addModalScopeToFallback(`${el.tagName.toLowerCase()}.${iconClass}`);
    }
    
    const siblings = Array.from(el.parentElement?.children || []);
    return addModalScopeToFallback(`${el.tagName.toLowerCase()}:nth-child(${siblings.indexOf(el) + 1})`);
};

const getFrameId = () => {
    if (window === window.top) return 'Pagina Principal';
    try {
        const parentFrames = window.parent.document.querySelectorAll('iframe');
        for (let i = 0; i < parentFrames.length; i++) {
            const iframeEl = parentFrames[i];
            try {
                if (iframeEl.contentWindow === window) {
                    const name = iframeEl.getAttribute('name');
                    if (name && !name.match(/^(ng-|mat-|cdk-|\d)/)) return `fp:name=${name}`;
                    const id = iframeEl.getAttribute('id');
                    if (id && !id.match(/^(ng-|mat-|cdk-|\d)/)) return `fp:id=${id}`;
                    const src = iframeEl.getAttribute('src');
                    if (src) {
                        const stableSrc = src.split('?')[0].split('#')[0].split('/').filter(Boolean).slice(-2).join('/');
                        if (stableSrc && stableSrc.length > 2) return `fp:src=${stableSrc}`;
                    }
                    const title = iframeEl.getAttribute('title');
                    if (title && title.length > 1) return `fp:title=${title}`;
                    return `fp:index=${i}`;
                }
            } catch(e) {}
        }
    } catch(e) {}
    if (window.name) return window.name;
    try {
        const href = window.location.href;
        if (href && href !== window.top?.location?.href) {
            return href.split('?')[0].split('#')[0].split('/').filter(Boolean).slice(-2).join('/') || 'iframe';
        }
    } catch(e) {}
    return 'iframe';
};

const getRectComFallback = (el) => {
    let cur = el;
    for (let i = 0; i < 6; i++) {
        if (!cur) break;
        const r = cur.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return r;
        cur = cur.parentElement;
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2, width: 40, height: 20 };
};

const processarEvento = (target, acao, valor = '') => {
    const rect = getRectComFallback(target);
    const _pResult = resolvePrimeNGComponent(target);
    const _seletor = _pResult ? _pResult.seletor : getBestSelector(target);
    
    const modalAncestor = target.closest('p-dialog, ui-dialog, s-dialog, p-confirmdialog, [role="dialog"]');
    const modalContext = modalAncestor ? {
        type: modalAncestor.tagName.toLowerCase(),
        role: modalAncestor.getAttribute('role') || '',
        visible: modalAncestor.getAttribute('aria-hidden') !== 'true' && modalAncestor.getBoundingClientRect().width > 0
    } : null;
    
    // Semantic HTML Hint
    const htmlHint = JSON.stringify({
        tag: target.tagName.toLowerCase(),
        role: target.getAttribute('role'),
        ariaLabel: target.getAttribute('aria-label'),
        name: target.getAttribute('name') || target.getAttribute('formcontrolname'),
        type: target.getAttribute('type'),
        placeholder: target.getAttribute('placeholder'),
        classes: Array.from(target.classList).filter(c => !c.startsWith('ng-') && !c.startsWith('cdk-')).slice(0, 6),
        parentTag: target.parentElement?.tagName.toLowerCase(),
        parentText: (target.parentElement?.innerText || '').trim().substring(0, 60),
    });
    
    if (typeof window.capturarElemento === 'function') {
        window.capturarElemento(JSON.stringify({
            tag: target.tagName.toLowerCase(),
            texto_encontrado: valor || getElementName(target),
            seletor: _seletor,
            primeng_component: _pResult ? _pResult.componentType : '',
            modal_context: modalContext,
            iframe: getFrameId(),
            acao,
            posicao_visual: `x:${Math.round(rect.x)},y:${Math.round(rect.y)},w:${Math.round(rect.width)},h:${Math.round(rect.height)}`,
            html_snapshot: htmlHint
        }));
    }
};

let clickTimeout = null;
document.addEventListener('mousedown', (e) => {
    // Intercept: item selecionado em overlay de dropdown
    const dropdownItem = e.target.closest(
        '.ui-dropdown-item, .p-dropdown-item, ' +
        '.ui-multiselect-item, .p-multiselect-item, ' +
        '.ui-autocomplete-list-item, .p-autocomplete-item'
    );
    if (dropdownItem) {
        const valor = (dropdownItem.innerText || '').trim();
        processarEvento(dropdownItem, 'selecionar_dropdown', valor);
        return; 
    }

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
    if (tipo === 'checkbox' || tipo === 'radio') return;
    const val = e.target.value || '';
    if (!val.trim() || val === 'undefined' || val === 'null') return;
    if (e.target === ultimoEnterTarget && Date.now() - ultimoEnterTime < 500) return;
    
    if ((tag === 'input' || tag === 'textarea' || e.target.isContentEditable) && e.target.value) {
        if (e.target.dataset.userTyped === 'true') {
            processarEvento(e.target, 'preencher_campo', e.target.value);
            e.target.dataset.userTyped = 'false';
        }
    }
}, true);
})();
