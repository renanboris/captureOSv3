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
    } catch {
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


  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  };

  if (error) {
    return (
      <div className="p-8 bg-surface-50 min-h-screen">
        <DemoBanner isVisible={isMock} />
        <ErrorState message={error} onRetry={fetchData} />
      </div>
    );
  }

  return (
    <div className="p-space-lg sm:p-space-xl max-w-[1140px] mx-auto font-sans">
      <DemoBanner isVisible={isMock} />

      <header className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-space-md mb-space-lg">
        <div>
          <h1 className="text-display-md font-bold text-surface-800 tracking-tight">Painel do Gestor</h1>
          <p className="text-body text-surface-700 mt-1">
            Métricas de Qualidade (ROI) e Governança Organizacional.
          </p>
        </div>
        <div className="flex gap-space-sm">
          <button 
            onClick={() => fetchData(true)} 
            disabled={loading}
            className="flex items-center gap-space-xs px-space-md py-space-sm bg-surface-100 text-surface-800 hover:bg-surface-150 font-semibold rounded-md transition-base border border-surface-150 shadow-sombra-100 hover:shadow-sombra-200 cursor-pointer text-body"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "animate-spin shrink-0" : "shrink-0"}>
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* Alerta de Execuções Extras / Caras */}
      {!loading && costs.most_expensive_runs?.some(run => run.gemini_call_count > 5) && (
        <div className="bg-status-warn/10 border border-status-warn/25 rounded-md p-space-md mb-space-lg flex items-start gap-space-sm transition-base">
          <div className="p-space-xs bg-status-warn/20 text-status-warn rounded-md shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h4 className="font-semibold text-surface-800 text-body">
              Alerta de Custo Elevado (Execuções Extras)
            </h4>
            <p className="text-caption text-surface-700 mt-1">
              As seguintes sessões ultrapassaram o limite sugerido de chamadas da API Gemini (&gt; 5 chamadas):
            </p>
            <div className="mt-space-sm flex flex-col gap-space-xs">
              {costs.most_expensive_runs
                .filter(run => run.gemini_call_count > 5)
                .map(run => (
                  <div key={run.session_id} className="text-caption font-mono bg-surface-100 border border-surface-150 px-space-md py-space-xs rounded flex items-center justify-between gap-space-md max-w-lg">
                    <span>Sessão: {run.session_id}</span>
                    <span className="font-semibold text-status-error">{run.gemini_call_count} chamadas</span>
                    <span className="font-semibold text-surface-700">${run.cost_usd.toFixed(4)} USD</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* 1. KPI Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-space-md mb-space-lg">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-surface-100 p-space-lg rounded-md shadow-sombra-200 border border-surface-150 animate-pulse">
              <div className="h-3 w-16 bg-surface-150 rounded mb-space-sm"></div>
              <div className="h-8 w-24 bg-surface-150 rounded"></div>
            </div>
          ))
        ) : (
          <>
            <KpiCard title="Total de Execuções" value={metrics.total_runs} />
            <KpiCard title="Taxa de Sucesso" value={`${metrics.success_rate}%`} status={metrics.success_rate > 90 ? 'ok' : 'warn'} />
            <KpiCard title="Tempo Economizado" value={`${metrics.time_saved_hours}h`} status="info" />
            <KpiCard title="Modos Reportados" value="0" />
            
            {/* Custo da Operação KPI Card (Stripe-Style) com Sombra Elevation 8 */}
            <div className="bg-surface-100 p-space-lg rounded-md border border-surface-150 flex flex-col justify-center relative shadow-sombra-elevation-8 transition-base">
              <div className="flex items-center justify-between mb-space-xs">
                <p className="text-caption font-semibold uppercase tracking-wider text-surface-700 font-sans">
                  Custo Operacional
                </p>
                {costs.unverified_cost_warning && (
                  <div 
                    className="w-2 h-2 rounded-full bg-status-warn cursor-help relative group"
                    title="Inclui estimativa de custo não confirmada para um dos provedores de IA"
                  >
                    <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full border border-status-warn animate-ping opacity-75"></span>
                  </div>
                )}
              </div>
              <p className="text-display-md font-bold tracking-tight text-surface-800 font-sans">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(costs.total_cost_brl)}
              </p>
              <p className="text-caption text-surface-700 mt-space-xs font-sans">
                Média/run: ${costs.avg_cost_per_run_usd.toFixed(4)} USD
              </p>
            </div>
          </>
        )}
      </div>

      {/* 2. Charts & IA Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md mb-space-lg">
        {/* Gráfico */}
        <div className="lg:col-span-2 bg-surface-100 p-space-lg rounded-md shadow-sombra-200 border border-surface-150 flex flex-col min-h-[300px] hover:shadow-sombra-400 transition-base">
          <h3 className="text-caption uppercase tracking-widest text-surface-700 mb-space-lg font-semibold">
            Desempenho por Instrutor
          </h3>
          <div className="flex-1">
            {loading ? (
               <div className="h-full flex items-center justify-center"><div className="h-48 w-full bg-surface-150 animate-pulse rounded-md"></div></div>
            ) : metrics.runs_by_instructor?.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.runs_by_instructor} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-status-ok)" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="var(--color-status-ok)" stopOpacity={0.15}/>
                    </linearGradient>
                    <linearGradient id="colorIncomplete" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-surface-300)" stopOpacity={0.6}/>
                      <stop offset="95%" stopColor="var(--color-surface-300)" stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-surface-150)" />
                  <XAxis dataKey="instructor_id" tick={{ fill: 'var(--color-surface-700)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--color-surface-700)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    cursor={{ fill: 'rgba(51, 70, 108, 0.03)' }} 
                    wrapperClassName="custom-chart-tooltip"
                    contentStyle={{ 
                      borderRadius: '8px', 
                      border: '1px solid var(--color-surface-150)', 
                      boxShadow: 'var(--shadow-sombra-elevation-8)', 
                      backgroundColor: 'rgba(255, 255, 255, 0.85)',
                      backdropFilter: 'blur(8px)',
                      color: '#3b3d3d',
                      fontSize: '12px'
                    }} 
                  />
                  <Bar dataKey="total_runs" name="Tentativas Incompletas" fill="url(#colorIncomplete)" stackId="a" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="completed_runs" name="Sucesso (SCORM)" fill="url(#colorSuccess)" stackId="a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-surface-700 text-body">Nenhum dado disponível</div>
            )}
          </div>
        </div>

        {/* IA Quality Gauge */}
        <div className="lg:col-span-1">
          {loading ? (
            <div className="h-full bg-surface-100 p-space-lg rounded-md border border-surface-150 animate-pulse shadow-sombra-200"></div>
          ) : (
             <EditRateGauge rate={metrics.avg_edit_rate} />
          )}
        </div>
      </div>

      {/* 3. Pipeline Runs Table */}
      <div className="bg-surface-100 rounded-md shadow-sombra-200 border border-surface-150 mb-space-lg overflow-hidden">
        <div className="px-space-lg py-space-md border-b border-surface-150 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-space-md bg-surface-100">
          <h2 className="text-heading font-semibold text-surface-800">Pipeline de Captura</h2>
          <FilterPills options={filterOptions} selected={filter} onChange={setFilter} />
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-50">
                <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Sessão</th>
                <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Status</th>
                <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Duração</th>
                <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Interface</th>
                <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Falha</th>
                <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Data</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} columns={6} />)
              ) : currentRuns.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-space-md py-12 text-center text-surface-700 text-body">
                    Nenhuma execução ainda. Quando um instrutor gravar o primeiro módulo, ele aparecerá aqui.
                  </td>
                </tr>
              ) : (
                currentRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-surface-50/50 transition-base group">
                    <td className="px-space-md py-space-sm border-b border-surface-150 font-mono text-body text-surface-800">
                      {run.session_id.substring(0, 8)}...
                    </td>
                    <td className="px-space-md py-space-sm border-b border-surface-150">
                      <StatusPill status={run.status} type="pipeline" />
                    </td>
                    <td className="px-space-md py-space-sm border-b border-surface-150 text-body text-surface-700">
                      {formatDuration(run.recording_duration_seconds)}
                    </td>
                    <td className="px-space-md py-space-sm border-b border-surface-150">
                      <StatusPill status={run.detected_interface_type} type="interface" />
                    </td>
                    <td className="px-space-md py-space-sm border-b border-surface-150 text-body text-surface-700">
                      {run.failure_stage ? run.failure_stage.replace('_', ' ') : '—'}
                    </td>
                    <td className="px-space-md py-space-sm border-b border-surface-150 text-surface-700 text-body">
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
          <div className="px-space-lg py-space-sm border-t border-surface-150 flex items-center justify-between bg-surface-100">
            <span className="text-caption text-surface-700">
              Mostrando {(page - 1) * itemsPerPage + 1}–{Math.min(page * itemsPerPage, filteredRuns.length)} de {filteredRuns.length}
            </span>
            <div className="flex items-center gap-space-sm">
              <button 
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-space-md py-space-xs bg-surface-50 disabled:opacity-50 rounded text-caption font-semibold transition-base hover:bg-surface-150 cursor-pointer text-surface-800 border border-surface-150"
              >
                Anterior
              </button>
              <button 
                disabled={page === totalPages || totalPages === 0}
                onClick={() => setPage(p => p + 1)}
                className="px-space-md py-space-xs bg-surface-50 disabled:opacity-50 rounded text-caption font-semibold transition-base hover:bg-surface-150 cursor-pointer text-surface-800 border border-surface-150"
              >
                Próximo
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Trilha de Publicação */}
      <div className="bg-surface-100 rounded-md shadow-sombra-200 border border-surface-150 overflow-hidden">
        <details className="group">
          <summary className="px-space-lg py-space-md cursor-pointer flex justify-between items-center bg-surface-50 hover:bg-surface-150/50 transition-base select-none">
            <h2 className="text-heading font-semibold text-surface-800">Trilha de Publicações</h2>
            <Download size={16} className="text-surface-700 group-open:rotate-180 transition-transform duration-300" />
          </summary>
          
          <div className="overflow-x-auto border-t border-surface-150">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-50">
                  <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Sessão</th>
                  <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Destino</th>
                  <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Exportado Por</th>
                  <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Data</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                   Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} columns={4} />)
                ) : publications.length === 0 ? (
                  <tr><td colSpan="4" className="px-space-md py-12 text-center text-surface-700 text-body">Nenhum módulo publicado ainda.</td></tr>
                ) : (
                  publications.map((pub) => (
                    <tr key={pub.id} className="hover:bg-surface-50/50 transition-base">
                      <td className="px-space-md py-space-sm border-b border-surface-150 font-mono text-body text-surface-800">{pub.session_id.substring(0, 8)}...</td>
                      <td className="px-space-md py-space-sm border-b border-surface-150">
                        <span className="px-space-sm py-[2px] bg-surface-50 text-surface-700 rounded text-caption font-semibold uppercase tracking-wider">
                          {pub.destination}
                        </span>
                      </td>
                      <td className="px-space-md py-space-sm border-b border-surface-150 text-body font-medium text-surface-700">{pub.published_by}</td>
                      <td className="px-space-md py-space-sm border-b border-surface-150 text-surface-700 text-body">
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
