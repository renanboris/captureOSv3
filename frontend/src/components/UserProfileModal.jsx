import { X, User, Shield, Key, Server, CheckCircle2, Copy } from 'lucide-react';
import ModalPortal from './ModalPortal';

export default function UserProfileModal({ isOpen, onClose, userEmail, onToast }) {
  if (!isOpen) return null;

  const token = localStorage.getItem('dev_token') || 'dev_sample_token_captureos_v3';

  const handleCopyToken = () => {
    navigator.clipboard.writeText(token);
    onToast?.({ type: 'success', message: 'Token JWT copiado para a área de transferência!' });
  };

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div className="bg-white border-slate-200 text-slate-900 dark:bg-surface-850 dark:border-white/10 dark:text-white rounded-2xl max-w-md w-full p-6 shadow-2xl border relative space-y-6 font-sans transition-colors duration-200">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 dark:hover:text-white font-mono text-xs p-1.5 cursor-pointer bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-lg transition-colors"
        >
          <X size={16} />
        </button>

        {/* User Profile Header */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-950 font-bold text-lg flex items-center justify-center shadow-lg">
            {userEmail.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">{userEmail}</h3>
            <p className="text-xs font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Shield size={12} /> Gestor Principal • Tier Diamante
            </p>
          </div>
        </div>

        {/* Account & System Info */}
        <div className="space-y-3">
          <div className="p-3 bg-slate-50 border border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06] rounded-xl space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-mono">Workspace:</span>
              <span className="text-slate-900 dark:text-white font-bold font-mono">Capture OS v3</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-mono">Status Auth:</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-bold font-mono flex items-center gap-1">
                <CheckCircle2 size={12} /> Supabase JWT Ativo
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-mono">Servidor Backend:</span>
              <span className="text-cyan-600 dark:text-cyan-400 font-mono text-[11px]">http://127.0.0.1:8000</span>
            </div>
          </div>

          {/* Token Card */}
          <div className="p-3 bg-slate-50 border border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06] rounded-xl">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Key size={13} className="text-slate-500 dark:text-slate-300" /> Token Dev Local
              </span>
              <button 
                onClick={handleCopyToken}
                className="text-[10px] font-mono text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white underline flex items-center gap-1 cursor-pointer"
              >
                <Copy size={11} /> Copiar
              </button>
            </div>
            <p className="text-[10px] font-mono text-slate-600 dark:text-slate-400 truncate bg-slate-100 dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-white/5">
              {token}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-white/[0.08]">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-200 dark:text-slate-950 font-bold text-xs rounded-xl transition-all cursor-pointer shadow-md"
          >
            Fechar
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
