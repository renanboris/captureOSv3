import { AlertCircle } from 'lucide-react';

export default function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4 text-red-500">
        <AlertCircle size={24} />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
        Não foi possível carregar os dados
      </h3>
      <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-md">
        {message || "Verifique sua conexão ou tente atualizar a página."}
      </p>
      {onRetry && (
        <button 
          onClick={onRetry}
          className="px-4 py-2 bg-surface-200 dark:bg-surface-700 hover:bg-surface-300 dark:hover:bg-surface-600 rounded-md font-medium text-sm transition-colors"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}
