import { AlertTriangle, Trash2, X } from 'lucide-react';
import ModalPortal from './ModalPortal';

export default function DeleteConfirmModal({ isOpen, onClose, onConfirm, itemTitle, sessionId, loading }) {
  if (!isOpen) return null;

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div className="bg-white border-slate-200 text-slate-900 dark:bg-surface-850 dark:border-white/10 dark:text-white rounded-2xl max-w-md w-full p-6 shadow-2xl border relative space-y-5 font-sans transition-colors duration-200">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 dark:hover:text-white font-mono text-xs p-1.5 cursor-pointer bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-lg transition-colors"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3">
          <div className="p-3 bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20 rounded-xl shrink-0">
            <Trash2 size={22} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Excluir Captação?</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Confirmação de Exclusão</p>
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Tem certeza de que deseja excluir o roteiro <strong>"{itemTitle || sessionId}"</strong>? Esta ação excluirá os arquivos de áudio, capturas e o pacote SCORM associados permanentemente.
        </p>

        <div className="p-3 bg-rose-50 border border-rose-200 dark:bg-rose-500/[0.04] dark:border-rose-500/20 rounded-xl text-[11px] font-mono text-rose-800 dark:text-rose-300 flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0" />
          <span>Atenção: Esta ação não pode ser desfeita.</span>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-white/[0.08]">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-slate-300 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs font-mono rounded-xl transition-all shadow-md cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <Trash2 size={14} />
            <span>{loading ? 'Excluindo...' : 'Sim, Excluir'}</span>
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
