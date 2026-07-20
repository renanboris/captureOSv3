export default function EditRateGauge({ rate }) {
  // rate é a taxa de edição humana (ex: 5.9%)
  // precision é a assertividade da IA (ex: 94.1%)
  const editRate = typeof rate === 'number' ? rate : 5.9;
  const precision = Math.max(0, Math.min(100, +(100 - editRate).toFixed(1)));

  let statusColor = "text-emerald-600 dark:text-emerald-400";
  let strokeColor = "#10b981"; // emerald-500
  let message = `A IA acertou ${precision}% das etapas automaticamente sem necessidade de intervenção humana.`;

  if (precision < 50) {
    statusColor = "text-rose-600 dark:text-rose-400";
    strokeColor = "#f43f5e";
    message = "Alto volume de ajustes manuais — revisar seletores da aplicação.";
  } else if (precision < 80) {
    statusColor = "text-amber-600 dark:text-amber-400";
    strokeColor = "#f59e0b";
    message = "A IA obteve boa assertividade, com pequenos ajustes de narrativas pelos instrutores.";
  }

  const radius = 40;
  const circumference = Math.PI * radius;
  const strokeDashoffset = circumference - (precision / 100) * circumference;

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] p-6 rounded-2xl shadow-sm dark:shadow-xl relative overflow-hidden transition-colors duration-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs uppercase font-mono tracking-widest text-slate-500 dark:text-slate-400 font-semibold">
          Precisão da IA
        </h3>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20 font-semibold" title="Auto-Healing e assertividade de cliques sem edição">
          Auto-Healing
        </span>
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="relative flex justify-center items-end" style={{ width: 120, height: 60 }}>
          <svg className="absolute top-0 left-0" width="120" height="60" viewBox="0 0 100 50">
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke="currentColor"
              strokeWidth="9"
              className="text-slate-200 dark:text-white/10"
              strokeLinecap="round"
            />
          </svg>
          <svg className="absolute top-0 left-0" width="120" height="60" viewBox="0 0 100 50">
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke={strokeColor}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute bottom-0 text-center w-full transform translate-y-1">
            <span className={`font-mono text-2xl font-bold tracking-tight ${statusColor}`}>
              {precision}%
            </span>
          </div>
        </div>
        
        <p className="text-center text-xs font-mono text-slate-600 dark:text-slate-400 mt-6 leading-relaxed max-w-[200px]">
          {message}
        </p>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-2">
          Taxa de Edição Humana: {editRate}%
        </span>
      </div>
    </div>
  );
}
