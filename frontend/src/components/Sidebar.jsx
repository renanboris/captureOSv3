import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Settings } from 'lucide-react';

export default function Sidebar() {
  const location = useLocation();
  const [userEmail, setUserEmail] = useState('boris.renan@gmail.com');

  useEffect(() => {
    // 1. Tentar ler do localStorage primeiro
    const storedEmail = localStorage.getItem('user_email');
    if (storedEmail) {
      setUserEmail(storedEmail);
      return;
    }

    // 2. Tentar decodificar do JWT dev_token se disponível
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
        console.warn("[Sidebar] Erro ao decodificar token de auth:", e);
      }
    }

    // 3. Tentar buscar no endpoint backend /api/v1/auth/me
    const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
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
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Painel do Gestor', path: '/admin', icon: Settings },
  ];

  return (
    <aside className="w-60 bg-surface-50 dark:bg-surface-900 border-r border-surface-200 dark:border-surface-700 flex flex-col h-screen fixed left-0 top-0">
      <div className="p-6 flex items-center gap-3 border-b border-surface-200 dark:border-surface-700">
        <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-sm">C</span>
        </div>
        <span className="font-mono font-bold text-lg text-slate-900 dark:text-white tracking-tight">Capture OS</span>
      </div>

      <nav className="flex-1 py-6 px-3 flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${
                isActive 
                  ? 'bg-surface-100 dark:bg-surface-800 text-brand-600 dark:text-brand-400 border-l-2 border-brand-500' 
                  : 'text-slate-600 dark:text-slate-400 hover:bg-surface-100 dark:hover:bg-surface-800 border-l-2 border-transparent'
              }`}
            >
              <item.icon size={18} />
              <span className="font-medium text-sm">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-surface-200 dark:border-surface-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center text-xs font-semibold">
            {userEmail.charAt(0).toUpperCase()}
          </div>
          <div className="truncate">
            <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate" title={userEmail}>
              {userEmail}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Gestor</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
