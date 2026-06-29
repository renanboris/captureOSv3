import { useState, useEffect } from 'react';
import { Activity, Settings, Video, Users, FileBarChart } from 'lucide-react';
import { Link } from 'react-router-dom';
import StatusPill from '../components/StatusPill';
import SkeletonRow from '../components/SkeletonRow';
import DemoBanner from '../components/DemoBanner';
import ErrorState from '../components/ErrorState';

export default function Dashboard() {
  const [runs, setRuns] = useState([]);
  const [metrics, setMetrics] = useState({
    total_runs: 0,
    success_rate: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMock, setIsMock] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('dev_token');
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      const [runsRes, metricsRes] = await Promise.all([
        fetch('http://127.0.0.1:8000/api/v1/admin/pipeline-runs', { headers }),
        fetch('http://127.0.0.1:8000/api/v1/admin/metrics', { headers })
      ]);

      if (runsRes.ok && metricsRes.ok) {
        const runsData = await runsRes.json();
        const metricsData = await metricsRes.json();
        
        setIsMock(false);
        // Pegar apenas os primeiros 5 concluídos (ou todos e limitar a 5)
        const recentRuns = (runsData.runs || []).filter(r => r.status === 'completed').slice(0, 5);
        setRuns(recentRuns);
        setMetrics(metricsData);
        setLoading(false);
        return;
      }
      
      if (runsRes.status === 401) {
        setIsMock(true);
        setRuns([
          { id: '1', session_id: 's_abc123', status: 'completed', created_at: new Date().toISOString() },
          { id: '4', session_id: 's_ghj789', status: 'completed', created_at: new Date(Date.now() - 8640000).toISOString() }
        ]);
        setMetrics({
          total_runs: 45, success_rate: 94.5
        });
        setLoading(false);
      } else {
        throw new Error("Falha na API");
      }
    } catch (err) {
      setError("Não foi possível carregar as métricas do Dashboard.");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <DemoBanner isVisible={isMock} />

      <header className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-mono font-bold text-slate-900 dark:text-white tracking-tight">
            Capture OS
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Bem-vindo de volta ao seu Workspace</p>
        </div>
        <div className="flex gap-4">
          <button className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-lg transition-colors shadow-sm">
            <Video size={20} />
            <span>Novo Roteiro</span>
          </button>
        </div>
      </header>

      {error ? (
        <ErrorState message={error} onRetry={fetchData} />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-surface-100 dark:bg-surface-900/50 text-slate-600 dark:text-slate-400 rounded-lg">
                  <FileBarChart size={24} />
                </div>
                <div>
                  <p className="text-sm uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">Total de Roteiros</p>
                  {loading ? (
                     <div className="h-8 w-16 bg-surface-200 dark:bg-surface-700 rounded animate-pulse"></div>
                  ) : (
                     <p className="text-3xl font-mono font-bold">{metrics.total_runs}</p>
                  )}
                </div>
              </div>
            </div>
            
            <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 rounded-lg">
                  <Activity size={24} />
                </div>
                <div>
                  <p className="text-sm uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">Taxa de Sucesso</p>
                  {loading ? (
                     <div className="h-8 w-16 bg-surface-200 dark:bg-surface-700 rounded animate-pulse"></div>
                  ) : (
                    <p className="text-3xl font-mono font-bold text-status-ok">{metrics.success_rate}%</p>
                  )}
                </div>
              </div>
            </div>
            
            <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-surface-100 dark:bg-surface-900/50 text-slate-600 dark:text-slate-400 rounded-lg">
                  <Users size={24} />
                </div>
                <div>
                  <p className="text-sm uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">Membros</p>
                  <p className="text-3xl font-mono font-bold">4</p>
                  <p className="text-[10px] text-zinc-400 mt-1">TODO: Dinâmico na Camada 4</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Roteiros Recentes (Completos)</h2>
              <Link to="/admin" className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline">
                Ver todos
              </Link>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-50 dark:bg-surface-900/50">
                    <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Sessão</th>
                    <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Status</th>
                    <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} columns={3} />)
                  ) : runs.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="px-6 py-12 text-center text-slate-500">
                        Nenhum roteiro encontrado neste workspace.
                      </td>
                    </tr>
                  ) : (
                    runs.map((run) => (
                      <tr key={run.id} className="hover:bg-surface-50 dark:hover:bg-surface-900/50 transition-colors">
                        <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 font-mono text-sm border-l-4 border-l-status-ok">
                          {run.session_id}
                        </td>
                        <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700">
                          <StatusPill status={run.status} />
                        </td>
                        <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 text-slate-500 text-sm">
                          {new Date(run.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
