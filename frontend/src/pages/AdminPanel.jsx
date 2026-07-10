import { useState, useEffect, useMemo } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

import KpiCard from '../components/KpiCard';
import StatusPill from '../components/StatusPill';
import FilterPills from '../components/FilterPills';
import ErrorState from '../components/ErrorState';
import SkeletonRow from '../components/SkeletonRow';
import EditRateGauge from '../components/EditRateGauge';
import DemoBanner from '../components/DemoBanner';

export default function AdminPanel() {
  const [runs, setRuns] = useState(window.cachedAdminData ? window.cachedAdminData.runs : []);
  const [publications, setPublications] = useState(window.cachedAdminData ? window.cachedAdminData.publications : []);
  const [metrics, setMetrics] = useState(window.cachedAdminData ? window.cachedAdminData.metrics : {
    total_runs: 0,
    success_rate: 0,
    avg_edit_rate: 0,
    time_saved_hours: 0,
    runs_by_instructor: []
  });
  const [costs, setCosts] = useState(window.cachedAdminData ? window.cachedAdminData.costs : {
    total_cost_usd: 0.0,
    total_cost_brl: 0.0,
    avg_cost_per_run_usd: 0.0,
    cost_by_instructor: [],
    most_expensive_runs: [],
    unverified_cost_warning: false
  });
  
  const [loading, setLoading] = useState(!window.cachedAdminData);
  const [error, setError] = useState(null);
  const [isMock, setIsMock] = useState(false);

  // Table states
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  const getQueryParam = (name) => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.has(name)) return searchParams.get(name);
    const hash = window.location.hash;
    const hashSearchIndex = hash.indexOf('?');
    if (hashSearchIndex !== -1) {
      const hashSearchParams = new URLSearchParams(hash.substring(hashSearchIndex));
      if (hashSearchParams.has(name)) return hashSearchParams.get(name);
    }
    return null;
  };

  const fetchData = async (force = false) => {
    const CACHE_TTL_MS = 30000;

    // Se o prefetch em background está rodando no momento, aguarda ele terminar em vez de duplicar requisições
    if (window.activePrefetchPromise && !force) {
      console.log("[CaptureOS Admin] Prefetch em background em execução. Aguardando conclusão...");
      setLoading(true);
      try {
        await window.activePrefetchPromise;
        if (window.cachedAdminData) {
          setRuns(window.cachedAdminData.runs);
          setPublications(window.cachedAdminData.publications);
          setMetrics(window.cachedAdminData.metrics);
          setCosts(window.cachedAdminData.costs);
          setLoading(false);
          console.log("[CaptureOS Admin] SUCESSO: Renderizado usando os dados concluídos do prefetch.");
          return;
        }
      } catch (e) {
        console.warn("[CaptureOS Admin] Falha ao aguardar o prefetch em background:", e);
      }
    }

    console.log("[CaptureOS Admin] Carregando dados. Status do cache global (window.cachedAdminData):", 
      window.cachedAdminData ? "Presente" : "Ausente/Nulo");

    if (window.cachedAdminData && !force) {
      const elapsed = Date.now() - window.cachedAdminData.timestamp;
      const isFresh = elapsed < CACHE_TTL_MS;
      console.log(`[CaptureOS Admin] Cache encontrado. Idade: ${Math.round(elapsed/1000)}s | TTL: 30s | Válido/Fresh: ${isFresh}`);
      if (isFresh) {
        setRuns(window.cachedAdminData.runs);
        setPublications(window.cachedAdminData.publications);
        setMetrics(window.cachedAdminData.metrics);
        setCosts(window.cachedAdminData.costs);
        setLoading(false);
        console.log("[CaptureOS Admin] SUCESSO: Renderização instantânea usando cache válido.");
        return;
      }
    }

    console.log("[CaptureOS Admin] Cache ausente ou expirado. Iniciando busca de dados na API...");
    if (!window.cachedAdminData || force) {
      setLoading(true);
    }
    setError(null);
    try {
      // 1. Tentar obter o token dos parâmetros da URL (?token=...)
      const urlToken = getQueryParam('token');
      if (urlToken) {
        localStorage.setItem('dev_token', urlToken);
        // Limpar o token da barra de endereços para segurança e estética (evita vazamento no histórico/compartilhamento)
        try {
          if (window.location.search.includes('token=')) {
            const url = new URL(window.location.href);
            url.searchParams.delete('token');
            window.history.replaceState({}, document.title, url.pathname + url.hash);
          }
          if (window.location.hash.includes('token=')) {
            const hash = window.location.hash;
            const qIndex = hash.indexOf('?');
            if (qIndex !== -1) {
              const cleanHash = hash.substring(0, qIndex);
              window.history.replaceState({}, document.title, window.location.pathname + window.location.search + cleanHash);
            }
          }
        } catch (e) {
          console.warn("Erro ao limpar a URL:", e);
        }
      }

      let token = urlToken || localStorage.getItem('dev_token');
      const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

      // Se não houver token localmente nem na URL, tenta obter um de dev (apenas local)
      if (!token) {
        try {
          const authRes = await fetch(`${API_URL}/api/v1/auth/dev-token`);
          if (authRes.ok) {
            const authData = await authRes.json();
            if (authData.token) {
              token = authData.token;
              localStorage.setItem('dev_token', token);
            }
          }
        } catch (e) {
          console.warn("Não foi possível realizar o auto-login de desenvolvimento:", e);
        }
      }

      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      const [runsRes, metricsRes, pubsRes, costsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/pipeline-runs`, { headers }),
        fetch(`${API_URL}/api/v1/admin/metrics`, { headers }),
        fetch(`${API_URL}/api/v1/admin/publications`, { headers }),
        fetch(`${API_URL}/api/v1/admin/costs`, { headers })
      ]);

      if (runsRes.ok && metricsRes.ok && pubsRes.ok && costsRes.ok) {
        const runsData = await runsRes.json();
        const metricsData = await metricsRes.json();
        const pubsData = await pubsRes.json();
        const costsData = await costsRes.json();
        
        setIsMock(false);
        const runsList = runsData.runs || [];
        const pubsList = pubsData.publications || [];
        
        // Atualiza o cache global com timestamp
        window.cachedAdminData = {
          runs: runsList,
          publications: pubsList,
          metrics: metricsData,
          costs: costsData,
          timestamp: Date.now()
        };
        
        setRuns(runsList);
        setMetrics(metricsData);
        setPublications(pubsList);
        setCosts(costsData);
        setLoading(false);
        return;
      }
      
      if (runsRes.status === 401) {
        // Token expirou ou é inválido, tenta renovar uma vez via endpoint de dev
        try {
          const authRes = await fetch(`${API_URL}/api/v1/auth/dev-token`);
          if (authRes.ok) {
            const authData = await authRes.json();
            if (authData.token) {
              localStorage.setItem('dev_token', authData.token);
              const retryHeaders = { 'Authorization': `Bearer ${authData.token}` };
              const [rRes, mRes, pRes, cRes] = await Promise.all([
                fetch(`${API_URL}/api/v1/admin/pipeline-runs`, { headers: retryHeaders }),
                fetch(`${API_URL}/api/v1/admin/metrics`, { headers: retryHeaders }),
                fetch(`${API_URL}/api/v1/admin/publications`, { headers: retryHeaders }),
                fetch(`${API_URL}/api/v1/admin/costs`, { headers: retryHeaders })
              ]);
              if (rRes.ok && mRes.ok && pRes.ok && cRes.ok) {
                const runsData = await rRes.json();
                const metricsData = await mRes.json();
                const pubsData = await pRes.json();
                const costsData = await cRes.json();
                
                setIsMock(false);
                const runsList = runsData.runs || [];
                const pubsList = pubsData.publications || [];
                
                // Atualiza o cache global com timestamp
                window.cachedAdminData = {
                  runs: runsList,
                  publications: pubsList,
                  metrics: metricsData,
                  costs: costsData,
                  timestamp: Date.now()
                };
                
                setRuns(runsList);
                setMetrics(metricsData);
                setPublications(pubsList);
                setCosts(costsData);
                setLoading(false);
                return;
              }
            }
          }
        } catch (e) {
          console.warn("Falha ao renovar token de dev:", e);
        }

        // Se mesmo assim não autenticou, cai no mock
        setIsMock(true);
        const mockRuns = [
          { id: '1', session_id: 's_abc123', status: 'completed', failure_stage: null, detected_interface_type: 'sap_fiori', recording_duration_seconds: 420, created_at: new Date().toISOString() },
          { id: '2', session_id: 's_xyz789', status: 'tech_error', failure_stage: 'ai_generation', detected_interface_type: 'unknown', recording_duration_seconds: 180, created_at: new Date(Date.now() - 3600000).toISOString() },
          { id: '3', session_id: 's_def456', status: 'user_reported_error', failure_stage: 'capture', detected_interface_type: 'salesforce_lightning', recording_duration_seconds: 300, created_at: new Date(Date.now() - 7200000).toISOString() },
          { id: '4', session_id: 's_ghj789', status: 'completed', failure_stage: null, detected_interface_type: 'sap_fiori', recording_duration_seconds: 500, created_at: new Date(Date.now() - 8640000).toISOString() }
        ];
        const mockPubs = [
          { id: '1', session_id: 's_abc123', destination: 'SCORM_DOWNLOAD', published_by: 'João Silva', published_at: new Date().toISOString() }
        ];
        const mockMetrics = {
          total_runs: 45, success_rate: 94.5, avg_edit_rate: 12.5, time_saved_hours: 168.5,
          runs_by_instructor: [
            { instructor_id: 'João S.', total_runs: 20, completed_runs: 19 },
            { instructor_id: 'Maria P.', total_runs: 15, completed_runs: 14 },
            { instructor_id: 'Carlos R.', total_runs: 10, completed_runs: 9 }
          ]
        };
        const mockCosts = {
          total_cost_usd: 12.4530,
          total_cost_brl: 69.7368,
          avg_cost_per_run_usd: 0.2767,
          cost_by_instructor: [
            { user_id: 'João S.', total_cost_usd: 5.10, run_count: 20 },
            { user_id: 'Maria P.', total_cost_usd: 4.85, run_count: 15 }
          ],
          most_expensive_runs: [
            { session_id: 'sess_1780690407909', cost_usd: 1.85, gemini_call_count: 12 },
            { session_id: 'sess_9981234567890', cost_usd: 0.95, gemini_call_count: 6 }
          ],
          unverified_cost_warning: true
        };

        // Salvar no cache para navegação instantânea em modo mock
        window.cachedAdminData = {
          runs: mockRuns,
          publications: mockPubs,
          metrics: mockMetrics,
          costs: mockCosts,
          timestamp: Date.now()
        };

        setRuns(mockRuns);
        setPublications(mockPubs);
        setMetrics(mockMetrics);
        setCosts(mockCosts);
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

      <header className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Painel do Gestor</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Métricas de Qualidade (ROI) e Governança Organizacional.
          </p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => fetchData(true)} 
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-surface-800 hover:bg-slate-50 dark:hover:bg-surface-700 text-slate-700 dark:text-slate-200 font-medium rounded-lg transition-colors border border-surface-200 dark:border-surface-700 shadow-sm"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "animate-spin" : ""}>
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* Alerta de Execuções Extras / Caras */}
      {!loading && costs.most_expensive_runs?.some(run => run.gemini_call_count > 5) && (
        <div className="bg-status-warn/10 border border-status-warn/30 rounded-xl p-4 mb-8 flex items-start gap-3">
          <div className="p-2 bg-status-warn/20 text-status-warn rounded-lg">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h4 className="font-semibold text-slate-900 dark:text-white text-sm">
              Alerta de Custo Elevado (Execuções Extras)
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              As seguintes sessões ultrapassaram o limite sugerido de chamadas da API Gemini (&gt; 5 chamadas):
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {costs.most_expensive_runs
                .filter(run => run.gemini_call_count > 5)
                .map(run => (
                  <div key={run.session_id} className="text-xs font-mono bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 px-3 py-2 rounded flex items-center justify-between gap-4 max-w-lg">
                    <span>Sessão: {run.session_id}</span>
                    <span className="font-semibold text-status-error">{run.gemini_call_count} chamadas</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">${run.cost_usd.toFixed(4)} USD</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* 1. KPI Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
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
            
            {/* Custo da Operação KPI Card */}
            <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700 flex flex-col justify-center relative">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                  Custo Operacional
                </p>
                {costs.unverified_cost_warning && (
                  <div 
                    className="w-2.5 h-2.5 rounded-full bg-status-warn cursor-help relative group"
                    title="Inclui estimativa de custo não confirmada para um dos provedores de IA"
                  >
                    <span className="absolute -top-1 -left-1 w-4.5 h-4.5 rounded-full border border-status-warn animate-ping opacity-75"></span>
                  </div>
                )}
              </div>
              <p className="font-mono text-3xl font-bold text-slate-900 dark:text-slate-100">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(costs.total_cost_brl)}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 font-mono">
                Média/run: ${costs.avg_cost_per_run_usd.toFixed(4)} USD
              </p>
            </div>
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
