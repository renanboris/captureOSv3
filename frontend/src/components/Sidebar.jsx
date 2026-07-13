import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Settings } from 'lucide-react';
import { useThemeVariant } from '../context/ThemeVariantContext';

export default function Sidebar() {
  const location = useLocation();
  const { variant, setVariant } = useThemeVariant();
  const user = { email: "usuario@capture.os" }; // Mock ou vir do Auth Context futuramente

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Painel do Gestor', path: '/admin', icon: Settings },
  ];

  return (
    <aside className="w-60 bg-surface-50 border-r border-surface-150 flex flex-col h-screen fixed left-0 top-0 font-sans">
      <div className="p-space-lg flex items-center gap-space-sm border-b border-surface-150">
        <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-body">C</span>
        </div>
        <span className="font-bold text-heading text-surface-800 tracking-tight">Capture OS</span>
      </div>

      <nav className="flex-1 py-space-lg px-space-sm flex flex-col gap-space-md">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-space-sm px-space-md py-space-sm rounded-md transition-base ${
                isActive 
                  ? 'bg-brand-500/10 text-brand-500 font-semibold shadow-sombra-100' 
                  : 'text-surface-700 hover:bg-surface-150'
              }`}
            >
              <item.icon size={16} className="shrink-0" />
              <span className="text-body">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Design Variant Toggle Switch */}
      <div className="px-space-md py-space-sm border-t border-surface-150">
        <div className="bg-surface-50 p-[3px] rounded-lg flex items-center justify-between text-[11px] font-semibold text-surface-700">
          <button 
            onClick={() => setVariant('classic')}
            className={`flex-1 text-center py-1.5 rounded-md cursor-pointer transition-base ${variant === 'classic' ? 'bg-surface-100 text-surface-800 shadow-sombra-100' : 'hover:text-surface-800'}`}
          >
            Classic (Senior)
          </button>
          <button 
            onClick={() => setVariant('purist')}
            className={`flex-1 text-center py-1.5 rounded-md cursor-pointer transition-base ${variant === 'purist' ? 'bg-surface-100 text-surface-800 shadow-sombra-100' : 'hover:text-surface-800'}`}
          >
            Purist (Linear)
          </button>
        </div>
      </div>

      <div className="p-space-md border-t border-surface-150">
        <div className="flex items-center gap-space-sm">
          <div className="w-8 h-8 rounded-full bg-surface-50 flex items-center justify-center text-caption font-medium text-surface-700 border border-surface-150">
            {user.email.charAt(0).toUpperCase()}
          </div>
          <div className="truncate">
            <p className="text-caption font-medium text-surface-800 truncate">{user.email}</p>
            <p className="text-[10px] uppercase tracking-wider text-surface-700 font-medium">Gestor</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
