export default function DemoBanner({ isVisible }) {
  if (!isVisible) return null;

  return (
    <>
      <div className="fixed top-0 left-0 w-full h-[2px] bg-amber-500 z-50"></div>
      <div className="fixed top-4 right-4 z-50 group">
        <div className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm cursor-help transition-all">
          Dados de demonstração
        </div>
        
        <div className="absolute top-full right-0 mt-2 w-64 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 shadow-lg rounded-lg p-3 text-xs text-slate-600 dark:text-slate-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
          <p>
            A API exigiu um Token de Acesso válido (Supabase JWT). 
            Como você acessou a interface sem estar logado na Extensão, 
            estes são dados fictícios de demonstração.
          </p>
        </div>
      </div>
    </>
  );
}
