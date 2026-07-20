export default function DemoBanner({ isVisible }) {
  if (!isVisible) return null;

  return (
    <>
      <div className="fixed top-0 left-0 w-full h-[2px] bg-gradient-to-r from-emerald-500 via-amber-500 to-emerald-500 z-50"></div>
      <div className="fixed top-4 right-4 z-50 group">
        <div className="bg-amber-500/10 text-amber-300 border border-amber-500/30 backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-mono font-semibold shadow-xl cursor-help transition-all flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
          <span>MODO MOCK / DEMO</span>
        </div>
        
        <div className="absolute top-full right-0 mt-2 w-72 bg-surface-850 border border-white/10 shadow-2xl rounded-xl p-3 text-xs text-slate-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all backdrop-blur-xl">
          <p className="font-mono text-[11px] text-amber-400 mb-1 font-semibold">Sem Token Supabase Ativo</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Como você abriu a página diretamente sem login via Extensão, os dados exibidos são simulados para demonstração da interface Diamante.
          </p>
        </div>
      </div>
    </>
  );
}
