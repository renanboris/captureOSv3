import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Clock, AlertTriangle, TrendingDown, Hourglass } from 'lucide-react';

export default function AdminPanel() {
  const [runs, setRuns] = useState([]);
  const [metrics, setMetrics] = useState({
    total_runs: 0,
    success_rate: 0,
    avg_edit_rate: 0,
    time_saved_hours: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Mock the fetch for the UI until auth is fully injected by the extension
    const mockRuns = [
      { id: '1', session_id: 's_abc123', status: 'completed', failure_stage: null, created_at: new Date().toISOString() },
      { id: '2', session_id: 's_xyz789', status: 'tech_error', failure_stage: 'ai_generation', created_at: new Date(Date.now() - 3600000).toISOString() },
      { id: '3', session_id: 's_def456', status: 'user_reported_error', failure_stage: 'capture', created_at: new Date(Date.now() - 7200000).toISOString() },
      { id: '4', session_id: 's_ghi012', status: 'processing', failure_stage: null, created_at: new Date(Date.now() - 120000).toISOString() },
    ];
    setRuns(mockRuns);
    
    // Mock metrics that would come from /api/v1/admin/metrics
    setMetrics({
      total_runs: 45,
      success_rate: 94.5,
      avg_edit_rate: 12.5, // 12.5% of the AI text was modified
      time_saved_hours: 168.5 // hours saved this month
    });
    
    setLoading(false);
  }, []);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return <CheckCircle className="text-green-500" size={20} />;
      case 'tech_error': return <XCircle className="text-red-500" size={20} />;
      case 'user_reported_error': return <AlertTriangle className="text-orange-500" size={20} />;
      case 'processing': return <Clock className="text-blue-500" size={20} />;
      default: return <Clock className="text-slate-500" size={20} />;
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'completed': return 'Concluído';
      case 'tech_error': return 'Falha Técnica';
      case 'user_reported_error': return 'Reportado pelo Usuário';
      case 'processing': return 'Processando';
      default: return status;
    }
  };

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-900 text-slate-900 dark:text-slate-100 p-8">
      <header className="mb-8">
        <Link to="/" className="inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 mb-4 transition-colors">
          <ArrowLeft size={16} />
          <span>Voltar ao Dashboard</span>
        </Link>
        <h1 className="text-3xl font-bold">Painel do Gestor (Admin)</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">Métricas de Qualidade (ROI) e Governança Organizacional.</p>
      </header>

      {/* Metrics Section (Camada 2 - Spec) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Total de Execuções</p>
          <p className="text-3xl font-bold text-slate-800 dark:text-slate-100">{metrics.total_runs}</p>
        </div>
        
        <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Taxa de Sucesso</p>
          <p className="text-3xl font-bold text-green-600 dark:text-green-400">{metrics.success_rate}%</p>
        </div>

        <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm text-slate-500 dark:text-slate-400">Taxa Média de Edição</p>
            <TrendingDown size={18} className="text-brand-500" />
          </div>
          <p className="text-3xl font-bold text-brand-600 dark:text-brand-400">{metrics.avg_edit_rate}%</p>
          <p className="text-xs text-slate-400 mt-1">Quanto menor, mais a IA acertou de primeira.</p>
        </div>

        <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm text-slate-500 dark:text-slate-400">Tempo Economizado (ROI)</p>
            <Hourglass size={18} className="text-purple-500" />
          </div>
          <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{metrics.time_saved_hours}h</p>
          <p className="text-xs text-slate-400 mt-1">Calculado vs Produção Manual</p>
        </div>
      </div>

      <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold">Execuções Recentes (Pipeline Runs)</h2>
        </div>
        
        {loading ? (
          <div className="p-8 text-center text-slate-500">Carregando execuções...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-surface-900/50">
                  <th className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 font-medium">Sessão</th>
                  <th className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 font-medium">Status</th>
                  <th className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 font-medium">Estágio da Falha</th>
                  <th className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50 dark:hover:bg-surface-900/50 transition-colors">
                    <td className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 font-mono text-sm">
                      {run.session_id}
                    </td>
                    <td className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(run.status)}
                        <span>{getStatusText(run.status)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                      {run.failure_stage ? (
                        <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-medium uppercase">
                          {run.failure_stage.replace('_', ' ')}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 text-slate-500 text-sm">
                      {new Date(run.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && (
                  <tr>
                    <td colSpan="4" className="px-6 py-8 text-center text-slate-500">
                      Nenhuma execução registrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
