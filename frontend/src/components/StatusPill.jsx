export default function StatusPill({ status, type = 'pipeline' }) {
  if (type === 'interface') {
    const interfaceMap = {
      'sap_fiori': { label: 'SAP Fiori', style: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20' },
      'salesforce_lightning': { label: 'Salesforce', style: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-500/20' },
      'senior_platform': { label: 'Plataforma Senior', style: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/20' },
      'senior_hcm': { label: 'Plataforma Senior', style: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/20' },
      'web': { label: 'Web System', style: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20' },
      'unknown': { label: 'Web System', style: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-white/5' }
    };
    const mapped = interfaceMap[status] || { label: status?.toUpperCase() || 'Web System', style: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-white/5' };
    return (
      <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-mono font-medium border ${mapped.style}`}>
        {mapped.label}
      </span>
    );
  }

  // Pipeline status
  const statusMap = {
    'completed': { label: 'Concluído', style: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20', dot: 'bg-emerald-500' },
    'tech_error': { label: 'Falha Técnica', style: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20', dot: 'bg-rose-500' },
    'user_reported_error': { label: 'Reportado', style: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20', dot: 'bg-amber-500' },
    'processing': { label: 'Processando', style: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20', dot: 'bg-purple-500 animate-ping' }
  };

  const mapped = statusMap[status] || { label: status, style: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-white/5', dot: 'bg-slate-400' };
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-medium border ${mapped.style}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${mapped.dot}`}></span>
      <span>{mapped.label}</span>
    </span>
  );
}
