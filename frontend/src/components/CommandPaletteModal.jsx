import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command, LayoutDashboard, ShieldCheck, Video, RefreshCw, Search, Sparkles, FileText, ArrowRight } from 'lucide-react';
import ModalPortal from './ModalPortal';

export default function CommandPaletteModal({ isOpen, onClose, onOpenNewScript, onRefresh, runs = [] }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const actions = [
    {
      id: 'nav-dashboard',
      title: 'Ir para Dashboard Central',
      category: 'Navegação',
      icon: LayoutDashboard,
      shortcut: '⌘1',
      action: () => { navigate('/'); onClose(); }
    },
    {
      id: 'nav-admin',
      title: 'Ir para Painel do Gestor (ROI & Governança)',
      category: 'Navegação',
      icon: ShieldCheck,
      shortcut: '⌘2',
      action: () => { navigate('/admin'); onClose(); }
    },
    {
      id: 'act-new-script',
      title: 'Gravar Novo Roteiro via Extensão',
      category: 'Ações',
      icon: Video,
      shortcut: '⌘N',
      action: () => { onClose(); onOpenNewScript(); }
    },
    {
      id: 'act-refresh',
      title: 'Atualizar Dados do Workspace',
      category: 'Ações',
      icon: RefreshCw,
      shortcut: '⌘R',
      action: () => { onClose(); onRefresh(true); }
    }
  ];

  const runItems = runs.map(r => ({
    id: `run-${r.id}`,
    title: r.titulo || `Sessão ${r.session_id.substring(0, 8)}`,
    subtitle: `ID: ${r.session_id} • Status: ${r.status}`,
    category: 'Roteiros Recentes',
    icon: FileText,
    action: () => {
      navigate('/admin');
      onClose();
    }
  }));

  const allItems = [...actions, ...runItems];

  const filteredItems = allItems.filter(item => {
    const q = query.toLowerCase();
    return item.title.toLowerCase().includes(q) || 
           (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
           item.category.toLowerCase().includes(q);
  });

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => (i + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => (i - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div 
        className="bg-white border-slate-200 text-slate-900 dark:bg-surface-850 dark:border-white/10 dark:text-white rounded-2xl max-w-xl w-full border shadow-2xl overflow-hidden flex flex-col transition-colors duration-200"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="p-4 border-b border-slate-200 dark:border-white/[0.08] flex items-center gap-3">
          <Search size={18} className="text-slate-400 dark:text-white" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Digite um comando, página ou ID de sessão..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            className="flex-1 bg-transparent text-sm font-mono text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          <kbd className="text-[10px] font-mono bg-slate-100 border border-slate-200 dark:bg-white/10 dark:border-none px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-400">ESC para fechar</kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs font-mono">
              Nenhum resultado encontrado para "{query}".
            </div>
          ) : (
            filteredItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center justify-between p-3 rounded-xl transition-all cursor-pointer font-mono text-xs ${
                    isSelected ? 'bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white font-semibold' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon size={16} className={isSelected ? 'text-slate-900 dark:text-white' : 'text-slate-400'} />
                    <div className="truncate">
                      <p className="font-semibold truncate">{item.title}</p>
                      {item.subtitle && <p className="text-[10px] text-slate-400 truncate">{item.subtitle}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-400">{item.category}</span>
                    {item.shortcut && (
                      <kbd className="text-[9px] bg-slate-200/60 dark:bg-white/10 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400 font-mono">
                        {item.shortcut}
                      </kbd>
                    )}
                    <ArrowRight size={12} className={isSelected ? 'text-slate-900 dark:text-white' : 'opacity-0'} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Command Palette Footer */}
        <div className="p-3 border-t border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.02] flex items-center justify-between text-[11px] font-mono text-slate-500">
          <div className="flex items-center gap-3">
            <span>↑↓ para navegar</span>
            <span>↵ para selecionar</span>
          </div>
          <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-semibold">
            <Sparkles size={12} /> Capture OS Command Engine
          </span>
        </div>
      </div>
    </ModalPortal>
  );
}
