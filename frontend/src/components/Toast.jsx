import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export default function Toast({ toast, onClose }) {
  if (!toast) return null;

  const icons = {
    success: <CheckCircle2 size={16} className="text-emerald-400" />,
    error: <AlertCircle size={16} className="text-rose-400" />,
    info: <Info size={16} className="text-cyan-400" />
  };

  const borderColors = {
    success: 'border-emerald-500/30 bg-surface-850',
    error: 'border-rose-500/30 bg-surface-850',
    info: 'border-cyan-500/30 bg-surface-850'
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-fade-in">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-xl max-w-sm ${borderColors[toast.type || 'info']}`}>
        {icons[toast.type || 'info']}
        <div className="flex-1 font-mono text-xs text-slate-200">
          {toast.message}
        </div>
        <button 
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 text-xs cursor-pointer rounded hover:bg-white/10"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
