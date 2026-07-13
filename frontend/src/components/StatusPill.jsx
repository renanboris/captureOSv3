export default function StatusPill({ status, type = 'pipeline' }) {
  if (type === 'interface') {
    const interfaceMap = {
      'sap_fiori': { label: 'SAP Fiori', style: 'bg-amber-100/30 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border border-amber-200/40 dark:border-amber-800/10' },
      'salesforce_lightning': { label: 'Salesforce', style: 'bg-blue-100/30 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400 border border-blue-200/40 dark:border-blue-800/10' },
      'unknown': { label: 'Desconhecido', style: 'bg-zinc-100/50 text-zinc-600 dark:bg-zinc-800/30 dark:text-zinc-400 border border-zinc-200/40 dark:border-zinc-700/20' }
    };
    const mapped = interfaceMap[status] || interfaceMap['unknown'];
    return <span className={`px-space-sm py-[2px] rounded text-caption font-semibold tracking-wide ${mapped.style} font-sans`}>{mapped.label}</span>;
  }

  // Pipeline status
  const statusMap = {
    'completed': { label: 'Concluído', dotClass: 'bg-status-ok' },
    'tech_error': { label: 'Falha Técnica', dotClass: 'bg-status-error' },
    'user_reported_error': { label: 'Reportado', dotClass: 'bg-status-warn' },
    'processing': { label: 'Processando', dotClass: 'bg-status-pending animate-pulse' }
  };

  const mapped = statusMap[status] || { label: status, dotClass: 'bg-zinc-450' };
  
  return (
    <div className="flex items-center gap-space-xs font-sans">
      <div className={`w-1.5 h-1.5 rounded-full ${mapped.dotClass} shrink-0`}></div>
      <span className="text-body font-medium text-slate-700 dark:text-slate-300">{mapped.label}</span>
    </div>
  );
}
