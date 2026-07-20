import { useState, useEffect } from 'react';
import { Activity, Settings, Video, Users, FileBarChart } from 'lucide-react';
import { Link } from 'react-router-dom';
import StatusPill from '../components/StatusPill';
import SkeletonRow from '../components/SkeletonRow';
import DemoBanner from '../components/DemoBanner';
import ErrorState from '../components/ErrorState';

export default function Dashboard() {
  const [runs, setRuns] = useState(window.cachedDashboardData ? window.cachedDashboardData.runs : []);
  const [metrics, setMetrics] = useState(window.cachedDashboardData ? window.cachedDashboardData.metrics : {
    total_runs: 0,
    success_rate: 0
  });
  const [loading, setLoading] = useState(!window.cachedDashboardData);
  const [error, setError] = useState(null);
  const [isMock, setIsMock] = useState(false);
  const [isNewScriptModalOpen, setIsNewScriptModalOpen] = useState(false);

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

  const prefetchAdminData = async (token, API_URL) => {
    console.log("[CaptureOS Prefetch] Iniciando pré-carregamento do Painel do Gestor...");
    try {
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const fetchPromise = Promise.all([
        fetch(`${API_URL}/api/v1/admin/pipeline-runs`, { headers }),
        fetch(`${API_URL}/api/v1/admin/metrics`, { headers }),
        fetch(`${API_URL}/api/v1/admin/publications`, { headers }),
        fetch(`${API_URL}/api/v1/admin/costs`, { headers })
      ]);
      
      window.activePrefetchPromise = fetchPromise;

      const [runsRes, metricsRes, pubsRes, costsRes] = await fetchPromise;

      if (runsRes.ok && metricsRes.ok && pubsRes.ok && costsRes.ok) {
        const runsData = await runsRes.json();
        const metricsData = await metricsRes.json();
        const pubsData = await pubsRes.json();
        const costsData = await costsRes.json();
        
        window.cachedAdminData = {
          runs: runsData.runs || [],
          publications: pubsData.publications || [],
          metrics: metricsData,
          costs: costsData,
          timestamp: Date.now()
        };
        console.log("[CaptureOS Prefetch] SUCESSO: Painel do Gestor pré-carregado com sucesso no cache.");
      } else {
        console.warn("[CaptureOS Prefetch] FALHA: Algum endpoint retornou status não-ok:", 
          { runs: runsRes.status, metrics: metricsRes.status, pubs: pubsRes.status, costs: costsRes.status });
      }
    } catch (e) {
      console.error("[CaptureOS Prefetch] ERRO excepcional durante prefetch:", e);
    } finally {
      window.activePrefetchPromise = null;
    }
  };

  const fetchData = async (force = false) => {
    const CACHE_TTL_MS = 30000;
    if (window.cachedDashboardData && !force) {
      const isFresh = (Date.now() - window.cachedDashboardData.timestamp) < CACHE_TTL_MS;
      if (isFresh) {
        setRuns(window.cachedDashboardData.runs);
        setMetrics(window.cachedDashboardData.metrics);
        setLoading(false);
        return;
      }
    }

    if (!window.cachedDashboardData || force) {
      setLoading(true);
    }
    setError(null);
    try {
      const urlToken = getQueryParam('token');
      if (urlToken) {
        localStorage.setItem('dev_token', urlToken);
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

      const [runsRes, metricsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/pipeline-runs`, { headers }),
        fetch(`${API_URL}/api/v1/admin/metrics`, { headers })
      ]);

      if (runsRes.ok && metricsRes.ok) {
        const runsData = await runsRes.json();
        const metricsData = await metricsRes.json();
        
        setIsMock(false);
        const recentRuns = (runsData.runs || []).filter(r => r.status === 'completed').slice(0, 5);
        
        window.cachedDashboardData = { runs: recentRuns, metrics: metricsData, timestamp: Date.now() };
        
        setRuns(recentRuns);
        setMetrics(metricsData);
        setLoading(false);

        setTimeout(() => {
          prefetchAdminData(token, API_URL);
        }, 1000);
        return;
      }
      
      if (runsRes.status === 401) {
        try {
          const authRes = await fetch(`${API_URL}/api/v1/auth/dev-token`);
          if (authRes.ok) {
            const authData = await authRes.json();
            if (authData.token) {
              localStorage.setItem('dev_token', authData.token);
              const retryHeaders = { 'Authorization': `Bearer ${authData.token}` };
              const [rRes, mRes] = await Promise.all([
                fetch(`${API_URL}/api/v1/admin/pipeline-runs`, { headers: retryHeaders }),
                fetch(`${API_URL}/api/v1/admin/metrics`, { headers: retryHeaders })
              ]);
              if (rRes.ok && mRes.ok) {
                const runsData = await rRes.json();
                const metricsData = await mRes.json();
                setIsMock(false);
                const recentRuns = (runsData.runs || []).filter(r => r.status === 'completed').slice(0, 5);
                
                window.cachedDashboardData = { runs: recentRuns, metrics: metricsData, timestamp: Date.now() };
                
                setRuns(recentRuns);
                setMetrics(metricsData);
                setLoading(false);

                setTimeout(() => {
                  prefetchAdminData(authData.token, API_URL);
                }, 1000);
                return;
              }
            }
          }
        } catch (e) {
          console.warn("Falha ao renovar token de dev:", e);
        }

        setIsMock(true);
        const mockRuns = [
          { id: '1', session_id: 's_abc123', status: 'completed', created_at: new Date().toISOString() },
          { id: '4', session_id: 's_ghj789', status: 'completed', created_at: new Date(Date.now() - 8640000).toISOString() }
        ];
        const mockMetrics = {
          total_runs: 45, success_rate: 94.5
        };

        window.cachedDashboardData = {
          runs: mockRuns,
          metrics: mockMetrics,
          timestamp: Date.now()
        };

        setRuns(mockRuns);
        setMetrics(mockMetrics);
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
          <button 
            onClick={() => fetchData(true)} 
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-surface-800 hover:bg-slate-50 dark:hover:bg-surface-700 text-slate-700 dark:text-slate-200 font-medium rounded-lg transition-colors border border-surface-200 dark:border-surface-700 shadow-sm"
          >
            <Activity size={20} className={loading ? "animate-spin" : ""} />
            <span>Atualizar</span>
          </button>
          <button 
            onClick={() => setIsNewScriptModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-lg transition-colors shadow-sm cursor-pointer"
          >
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
                    <th className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 font-medium text-slate-600 dark:text-slate-300">Sessão / Título</th>
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
                        <td className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 text-sm border-l-4 border-l-status-ok">
                          <div className="font-semibold text-slate-900 dark:text-white" title={run.session_id}>
                            {run.titulo || `Sessão ${run.session_id.substring(0, 8)}`}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">{run.session_id}</div>
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

      {/* Modal para Gravar Novo Roteiro */}
      {isNewScriptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-surface-850 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-surface-200 dark:border-surface-700 relative">
            <button 
              onClick={() => setIsNewScriptModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg font-bold p-1 cursor-pointer"
            >
              ✕
            </button>
            
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-brand-500/10 text-brand-600 dark:text-brand-400 rounded-xl">
                <Video size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Gravar Novo Roteiro</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Instruções de Captura via Extensão</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 mb-5 leading-relaxed">
              Os roteiros são capturados diretamente através da <strong>Extensão Capture OS V3</strong> instalada no seu navegador Google Chrome.
            </p>

            <div className="space-y-3 mb-6">
              <div className="flex items-start gap-3 p-3 bg-surface-50 dark:bg-surface-900/50 rounded-xl border border-surface-200 dark:border-surface-700">
                <span className="w-6 h-6 rounded-full bg-brand-500 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">1</span>
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">Abra a extensão</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Clique no ícone do Capture OS no topo do Chrome.</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-surface-50 dark:bg-surface-900/50 rounded-xl border border-surface-200 dark:border-surface-700">
                <span className="w-6 h-6 rounded-full bg-brand-500 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">2</span>
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">Acesse o sistema alvo</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Vá para o ERP/Sistema (ex: SAP, Senior HCM, Salesforce).</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-surface-50 dark:bg-surface-900/50 rounded-xl border border-surface-200 dark:border-surface-700">
                <span className="w-6 h-6 rounded-full bg-brand-500 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">3</span>
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">Clique em Iniciar Gravação</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Grave o tutorial narrado. Ao concluir, o roteiro será processado automaticamente!</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-surface-200 dark:border-surface-700">
              <button
                onClick={() => setIsNewScriptModalOpen(false)}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs rounded-xl transition-colors shadow-sm cursor-pointer"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
