export default function StatusPill({ status, type = 'pipeline' }) {
  if (type === 'interface') {
    const interfaceMap = {
      'sap_fiori': { label: 'SAP Fiori', style: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
      'salesforce_lightning': { label: 'Salesforce', style: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
      'unknown': { label: 'Desconhecido', style: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' }
    };
    const mapped = interfaceMap[status] || interfaceMap['unknown'];
    return <span className={`px-2 py-1 rounded text-xs font-medium ${mapped.style}`}>{mapped.label}</span>;
  }

  // Pipeline status
  const statusMap = {
    'completed': { label: 'Concluído', color: 'status-ok' },
    'tech_error': { label: 'Falha Técnica', color: 'status-error' },
    'user_reported_error': { label: 'Reportado', color: 'status-warn' },
    'processing': { label: 'Processando', color: 'status-pending' }
  };

  const mapped = statusMap[status] || { label: status, color: 'zinc-500' };
  
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full bg-${mapped.color}`}></div>
      <span className="text-sm font-medium">{mapped.label}</span>
    </div>
  );
}
