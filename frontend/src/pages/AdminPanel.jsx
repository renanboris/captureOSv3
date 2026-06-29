import { useState, useEffect, useMemo } from 'react';
import { Download } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

import KpiCard from '../components/KpiCard';
import StatusPill from '../components/StatusPill';
import FilterPills from '../components/FilterPills';
import ErrorState from '../components/ErrorState';
import SkeletonRow from '../components/SkeletonRow';
import EditRateGauge from '../components/EditRateGauge';
import DemoBanner from '../components/DemoBanner';

export default function AdminPanel() {
  const [runs, setRuns] = useState([]);
  const [publications, setPublications] = useState([]);
  const [metrics, setMetrics] = useState({
    total_runs: 0,
    success_rate: 0,
    avg_edit_rate: 0,
    time_saved_hours: 0,
    runs_by_instructor: []
  });
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMock, setIsMock] = useState(false);

  // Table states
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('dev_token');
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      const [runsRes, metricsRes, pubsRes] = await Promise.all([
        fetch('http://127.0.0.1:8000/api/v1/admin/pipeline-runs', { headers }),
        fetch('http://127.0.0.1:8000/api/v1/admin/metrics', { headers }),
        fetch('http://127.0.0.1:8000/api/v1/admin/publications', { headers })
      ]);

      if (runsRes.ok && metricsRes.ok && pubsRes.ok) {
        const runsData = await runsRes.json();
        const metricsData = await metricsRes.json();
        const pubsData = await pubsRes.json();
        
        setIsMock(false);
        setRuns(runsData.runs || []);
        setMetrics(metricsData);
        setPublications(pubsData.publications || []);
        setLoading(false);
        return;
      }
      
      // Fallback para mock visual sem token
      if (runsRes.status === 401) {
        setIsMock(true);
        setRuns([
          { id: '1', session_id: 's_abc123', status: 'completed', failure_stage: null, detected_interface_type: 'sap_fiori', recording_duration_seconds: 420, created_at: new Date().toISOString() },
          { id: '2', session_id: 's_xyz789', status: 'tech_error', failure_stage: 'ai_generation', detected_interface_type: 'unknown', recording_duration_seconds: 180, created_at: new Date(Date.now() - 3600000).toISOString() },
          { id: '3', session_id: 's_def456', status: 'user_reported_error', failure_stage: 'capture', detected_interface_type: 'salesforce_lightning', recording_duration_seconds: 300, created_at: new Date(Date.now() - 7200000).toISOString() },
          { id: '4', session_id: 's_ghj789', status: 'completed', failure_stage: null, detected_interface_type: 'sap_fiori', recording_duration_seconds: 500, created_at: new Date(Date.now() - 8640000).toISOString() }
        ]);
        setPublications([
          { id: '1', session_id: 's_abc123', destination: 'SCORM_DOWNLOAD', published_by: 'João Silva', published_at: new Date().toISOString() }
        ]);
        setMetrics({
          total_runs: 45, success_rate: 94.5, avg_edit_rate: 12.5, time_saved_hours: 168.5,
          runs_by_instructor: [
            { instructor_id: 'João S.', total_runs: 20, completed_runs: 19 },
            { instructor_id: 'Maria P.', total_runs: 15, completed_runs: 14 },
            { instructor_id: 'Carlos R.', total_runs: 10, completed_runs: 9 }
          ]
        });
        setLoading(false);
      } else {
        throw new Error("Falha na API");
      }
    } catch (err) {
      setError("Não foi possível carregar as execuções. Verifique se o servidor está ativo ou atualize a página.");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filter & Pagination logic
  const filteredRuns = useMemo(() => {
    if (filter === 'all') return runs;
    return runs.filter(r => r.status === filter);
  }, [runs, filter]);

  const totalPages = Math.ceil(filteredRuns.length / itemsPerPage);
  const currentRuns = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return filteredRuns.slice(start, start + itemsPerPage);
  }, [filteredRuns, page]);

  useEffect(() => {
    setPage(1); // Reset page on filter change
  }, [filter]);

  const filterOptions = [
    { label: 'Todos', value: 'all' },
    { label: 'Concluído', value: 'completed' },
    { label: 'Falha Técnica', value: 'tech_error' },
    { label: 'Reportado', value: 'user_reported_error' }
  ];

  const getStatusBorderColor = (status) => {
    switch (status) {
      case 'completed': return 'border-l-status-ok';
      case 'tech_error': return 'border-l-status-error';
      case 'user_reported_error': return 'border-l-status-warn';
      case 'processing': return 'border-l-status-pending';
      default: return 'border-l-zinc-300 dark:border-l-zinc-600';
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  };

  if (error) {
    return (
      <div className="p-8">
        <DemoBanner isVisible={isMock} />
        <ErrorState message={error} onRetry={fetchData} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <DemoBanner isVisible={isMock} />

      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Painel do Gestor</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Métricas de Qualidade (ROI) e Governança Organizacional.
        </p>
      </header>

      {/* 1. KPI Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700">
              <div className="h-3 w-16 bg-surface-200 dark:bg-surface-700 rounded mb-4 animate-pulse"></div>
              <div className="h-8 w-24 bg-surface-200 dark:bg-surface-700 rounded animate-pulse"></div>
            </div>
          ))
        ) : (
          <>
            <KpiCard title="Total de Execuções" value={metrics.total_runs} />
            <KpiCard title="Taxa de Sucesso" value={`${metrics.success_rate}%`} status={metrics.success_rate > 90 ? 'ok' : 'warn'} />
            <KpiCard title="Tempo Economizado" value={`${metrics.time_saved_hours}h`} status="info" />
            <KpiCard title="Modos Reportados" value="0" />
          </>
        )}
      </div>

      {/* 2. Charts & IA Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Gráfico */}
        <div className="lg:col-span-2 bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700 flex flex-col min-h-[300px]">
          <h3 className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-6">
            Desempenho por Instrutor
          </h3>
          <div className="flex-1">
            {loading ? (
               <div className="h-full flex items-center justify-center text-slate-500"><div className="h-48 w-full bg-surface-200 dark:bg-surface-700 animate-pulse rounded"></div></div>
            ) : metrics.runs_by_instructor?.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.runs_by_instructor} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                  <XAxis dataKey="instructor_id" tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    cursor={{ fill: '#f4f4f5' }} 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                  />
                  <Bar dataKey="total_runs" name="Tentativas Incompletas" fill="#e4e4e7" stackId="a" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="completed_runs" name="Sucesso (SCORM)" fill="#22c55e" stackId="a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400">Nenhum dado disponível</div>
            )}
          </div>
        </div>

        {/* IA Quality Gauge */}
        <div className="lg:col-span-1">
          {loading ? (
            <div className="h-full bg-white dark:bg-surface-800 p-6 rounded-xl border border-surface-200 dark:border-surface-700 animate-pulse"></div>
          ) : (
             <EditRateGauge rate={metrics.avg_edit_rate} />
          )}
        </div>
      </div>

      {/* 3. Pipeline Runs Table */}
      <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700 mb-8 overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Pipeline de Captura</h2>
          <FilterPills options={filterOptions} selected={filter} onChange={setFilter} />
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-50 dark:bg-surface-900/50">
                <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Sessão</th>
                <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Status</th>
                <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Duração</th>
                <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Interface</th>
                <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Falha</th>
                <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Data</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} columns={6} />)
              ) : currentRuns.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-slate-500">
                    Nenhuma execução ainda. Quando um instrutor gravar o primeiro módulo, ele aparecerá aqui.
                  </td>
                </tr>
              ) : (
                currentRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-surface-50 dark:hover:bg-surface-900/50 transition-colors group">
                    <td className={`px-6 py-4 border-b border-surface-200 dark:border-surface-700 border-l-4 ${getStatusBorderColor(run.status)} font-mono text-sm`}>
                      {run.session_id.substring(0, 8)}...
                    </td>
                    <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700">
                      <StatusPill status={run.status} type="pipeline" />
                    </td>
                    <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 text-sm">
                      {formatDuration(run.recording_duration_seconds)}
                    </td>
                    <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700">
                      <StatusPill status={run.detected_interface_type} type="interface" />
                    </td>
                    <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 text-sm text-slate-500">
                      {run.failure_stage ? run.failure_stage.replace('_', ' ') : '—'}
                    </td>
                    <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 text-slate-500 text-sm">
                      {new Date(run.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Paginação */}
        {!loading && filteredRuns.length > 0 && (
          <div className="px-6 py-3 border-t border-surface-200 dark:border-surface-700 flex items-center justify-between">
            <span className="text-sm text-slate-500">
              Mostrando {(page - 1) * itemsPerPage + 1}–{Math.min(page * itemsPerPage, filteredRuns.length)} de {filteredRuns.length}
            </span>
            <div className="flex items-center gap-2">
              <button 
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 bg-surface-100 dark:bg-surface-800 disabled:opacity-50 rounded text-sm font-medium transition-colors hover:bg-surface-200 dark:hover:bg-surface-700"
              >
                Anterior
              </button>
              <button 
                disabled={page === totalPages || totalPages === 0}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 bg-surface-100 dark:bg-surface-800 disabled:opacity-50 rounded text-sm font-medium transition-colors hover:bg-surface-200 dark:hover:bg-surface-700"
              >
                Próximo
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Trilha de Publicação */}
      <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700 overflow-hidden">
        <details className="group">
          <summary className="px-6 py-4 cursor-pointer flex justify-between items-center bg-surface-50 dark:bg-surface-800 hover:bg-surface-100 dark:hover:bg-surface-700/50 transition-colors">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Trilha de Publicações</h2>
            <Download size={18} className="text-slate-400 group-open:rotate-180 transition-transform" />
          </summary>
          
          <div className="overflow-x-auto border-t border-surface-200 dark:border-surface-700">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-50 dark:bg-surface-900/50">
                  <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Sessão</th>
                  <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Destino</th>
                  <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Exportado Por</th>
                  <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Data</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                   Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} columns={4} />)
                ) : publications.length === 0 ? (
                  <tr><td colSpan="4" className="px-6 py-12 text-center text-slate-500">Nenhum módulo publicado ainda.</td></tr>
                ) : (
                  publications.map((pub) => (
                    <tr key={pub.id} className="hover:bg-surface-50 dark:hover:bg-surface-900/50 transition-colors">
                      <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 font-mono text-sm">{pub.session_id.substring(0, 8)}...</td>
                      <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700">
                        <span className="px-2 py-1 bg-surface-200 dark:bg-surface-700 text-slate-700 dark:text-slate-300 rounded text-xs font-medium uppercase tracking-wider">
                          {pub.destination}
                        </span>
                      </td>
                      <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 text-sm font-medium">{pub.published_by}</td>
                      <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 text-slate-500 text-sm">
                        {new Date(pub.published_at).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </details>
      </div>

    </div>
  );
}
