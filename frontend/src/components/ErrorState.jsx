import { AlertCircle } from 'lucide-react';

export default function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-space-2xl text-center font-sans">
      <div className="w-12 h-12 rounded-full bg-status-error/10 flex items-center justify-center mb-space-md text-status-error">
        <AlertCircle size={24} />
      </div>
      <h3 className="text-heading font-semibold text-slate-900 dark:text-slate-100 mb-space-xs">
        Não foi possível carregar os dados
      </h3>
      <p className="text-body text-slate-500 dark:text-slate-400 mb-space-md max-w-md">
        {message || "Verifique sua conexão ou tente atualizar a página."}
      </p>
      {onRetry && (
        <button 
          onClick={onRetry}
          className="px-space-md py-space-sm bg-surface-200 dark:bg-surface-700 hover:bg-surface-300 dark:hover:bg-surface-600 rounded-md font-semibold text-body transition-base cursor-pointer"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}
