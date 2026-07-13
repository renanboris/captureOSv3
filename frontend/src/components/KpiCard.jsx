export default function KpiCard({ title, value, status = 'neutral' }) {
  // Cores semânticas baseadas no status, sem dependência de tailwind colors arbitrárias
  const valueColors = {
    ok: 'text-status-ok',
    error: 'text-status-error',
    warn: 'text-status-warn',
    info: 'text-status-info',
    neutral: 'text-surface-800 font-semibold'
  };

  return (
    <div className="bg-surface-100 p-space-lg rounded-md shadow-sombra-200 border border-surface-150 flex flex-col justify-center hover:shadow-sombra-400 transition-base font-sans">
      <p className="text-caption font-semibold uppercase tracking-wider text-surface-700 mb-space-xs">
        {title}
      </p>
      <p className={`text-display-md tracking-tight ${valueColors[status]}`}>
        {value}
      </p>
    </div>
  );
}
