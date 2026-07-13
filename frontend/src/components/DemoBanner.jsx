export default function DemoBanner({ isVisible }) {
  if (!isVisible) return null;

  return (
    <>
      <div className="fixed top-0 left-0 w-full h-[2px] bg-status-warn z-50"></div>
      <div className="fixed top-space-md right-space-md z-50 group font-sans">
        <div className="bg-amber-100/80 text-amber-800 dark:bg-amber-950/20 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/30 px-space-md py-space-xs rounded-full text-caption font-semibold shadow-elevation-1 cursor-help transition-base">
          Dados de demonstração
        </div>
        
        <div className="absolute top-full right-0 mt-space-xs w-64 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 shadow-elevation-3 rounded-lg p-space-md text-caption text-slate-600 dark:text-slate-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-base">
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
