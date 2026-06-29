import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Settings } from 'lucide-react';

export default function Sidebar() {
  const location = useLocation();
  const user = { email: "usuario@capture.os" }; // Mock ou vir do Auth Context futuramente

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
          <div className="w-8 h-8 rounded-full bg-surface-200 dark:bg-surface-700 flex items-center justify-center text-xs font-medium text-slate-600 dark:text-slate-300">
            {user.email.charAt(0).toUpperCase()}
          </div>
          <div className="truncate">
            <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{user.email}</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Gestor</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
