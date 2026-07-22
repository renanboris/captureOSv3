import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, ShieldCheck, Sparkles, Command, ChevronRight, Layers, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function Sidebar({ onOpenCommandPalette, onOpenUserProfile }) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [userEmail, setUserEmail] = useState('boris.renan@gmail.com');

  useEffect(() => {
    const storedEmail = localStorage.getItem('user_email');
    if (storedEmail) {
      setUserEmail(storedEmail);
      return;
    }

    const token = localStorage.getItem('dev_token') || localStorage.getItem('sb-access-token');
    if (token && token.includes('.')) {
      try {
        const payloadBase64 = token.split('.')[1];
        const decodedJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(decodedJson);
        if (payload.email) {
          setUserEmail(payload.email);
          return;
        }
        if (payload.user_metadata?.email) {
          setUserEmail(payload.user_metadata.email);
          return;
        }
      } catch (e) {
        console.warn("[Sidebar] Erro ao decodificar token:", e);
      }
    }

    const API_URL = import.meta.env.VITE_API_URL || 'https://api.nomadelabs.com.br';
    if (token) {
      fetch(`${API_URL}/api/v1/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.email) {
            setUserEmail(data.email);
            localStorage.setItem('user_email', data.email);
          }
        })
        .catch(() => {});
    }
  }, []);

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard, badge: 'Main' },
    { name: 'Painel do Gestor', path: '/admin', icon: ShieldCheck, badge: 'ROI' },
  ];

  return (
    <aside className="w-64 bg-white border-r border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] flex flex-col h-screen fixed left-0 top-0 z-30 select-none transition-colors duration-200">
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-950 flex items-center justify-center shadow-md font-bold transition-colors">
            <Sparkles size={15} />
          </div>
          <div className="flex flex-col">
            <span className="font-sans font-bold text-sm text-slate-900 dark:text-white tracking-tight flex items-center gap-1.5">
              Capture OS <span className="px-1.5 py-0.2 text-[9px] font-mono font-semibold rounded bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/10 dark:text-slate-300 dark:border-white/15">DIAMOND</span>
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">v3.0.5 • Dual Mode</span>
          </div>
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-white dark:bg-white/5 dark:hover:bg-white/10 transition-all cursor-pointer"
          title={theme === 'dark' ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      {/* Quick Search Bar Trigger (Linear Style) */}
      <div className="px-3 pt-3 pb-1">
        <button
          onClick={onOpenCommandPalette}
          className="w-full bg-slate-100 hover:bg-slate-200/70 border border-slate-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] dark:border-white/[0.06] dark:hover:border-white/20 rounded-lg px-2.5 py-1.5 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 dark:hover:text-white transition-all cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Command size={13} className="text-slate-400" />
            <span>Buscar workspace...</span>
          </span>
          <kbd className="font-mono text-[10px] bg-white border border-slate-200 dark:bg-white/10 dark:border-none px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-400">⌘K</kbd>
        </button>
      </div>

      {/* Navigation Section */}
      <div className="flex-1 py-4 px-2.5 flex flex-col gap-6 overflow-y-auto">
        <div>
          <div className="px-2 mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase font-mono tracking-widest text-slate-400 dark:text-slate-500 font-semibold">Plataforma</span>
          </div>
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`group flex items-center justify-between px-3 py-2 rounded-lg transition-all text-xs font-medium ${
                    isActive 
                      ? 'bg-slate-900 text-white font-semibold shadow-xs dark:bg-white/10 dark:text-white dark:border dark:border-white/15' 
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <item.icon size={16} className={isActive ? "text-white" : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200"} />
                    <span>{item.name}</span>
                  </div>
                  {item.badge && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-500'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Quick System Readiness Indicator */}
        <div className="mt-auto px-2">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06] flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              Extensão Capture OS
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-300 font-mono">Conectado</span>
          </div>
        </div>
      </div>

      {/* User Footer */}
      <div className="p-3 border-t border-slate-200 dark:border-white/[0.08] bg-slate-50/50 dark:bg-white/[0.02]">
        <button
          onClick={onOpenUserProfile}
          className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors cursor-pointer text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-950 font-bold flex items-center justify-center text-xs shadow-sm transition-colors">
              {userEmail.charAt(0).toUpperCase()}
            </div>
            <div className="truncate">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate" title={userEmail}>
                {userEmail}
              </p>
              <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">Gestor • Tier Diamante</p>
            </div>
          </div>
          <ChevronRight size={14} className="text-slate-400" />
        </button>
      </div>
    </aside>
  );
}
