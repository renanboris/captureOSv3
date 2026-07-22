import { AlertCircle, RefreshCw } from 'lucide-react';

export default function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-rose-500/20 bg-rose-500/[0.02] rounded-2xl p-8">
      <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 text-rose-400 shadow-lg shadow-rose-500/10">
        <AlertCircle size={22} />
      </div>
      <h3 className="text-base font-semibold text-white mb-1">
        Não foi possível sincronizar os dados
      </h3>
      <p className="text-xs text-slate-400 mb-6 max-w-sm font-mono">
        {message || "Verifique se o backend Capture OS está ativo em https://api.nomadelabs.com.br"}
      </p>
      {onRetry && (
        <button 
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-bold text-xs transition-all shadow-md shadow-emerald-500/20 cursor-pointer"
        >
          <RefreshCw size={14} />
          <span>Tentar Novamente</span>
        </button>
      )}
    </div>
  );
}
