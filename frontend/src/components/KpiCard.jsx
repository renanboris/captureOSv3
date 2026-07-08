export default function KpiCard({ title, value, status = 'neutral' }) {
  // Cores semânticas baseadas no status, sem dependência de tailwind colors arbitrárias
  const valueColors = {
    ok: 'text-status-ok',
    error: 'text-status-error',
    warn: 'text-status-warn',
    info: 'text-status-info',
    neutral: 'text-slate-900 dark:text-slate-100'
  };

  return (
    <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700 flex flex-col justify-center">
      <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">
        {title}
      </p>
      <p className={`font-mono text-3xl font-bold ${valueColors[status]}`}>
        {value}
      </p>
    </div>
  );
}
