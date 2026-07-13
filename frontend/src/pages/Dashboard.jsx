import { useState, useEffect } from 'react';
import { Activity, Video, Users, FileBarChart } from 'lucide-react';
import { Link } from 'react-router-dom';
import StatusPill from '../components/StatusPill';
import SkeletonRow from '../components/SkeletonRow';
import DemoBanner from '../components/DemoBanner';
import ErrorState from '../components/ErrorState';
import { useThemeVariant } from '../context/ThemeVariantContext';
import PipelineGraph from '../components/PipelineGraph';

export default function Dashboard() {
  const { variant } = useThemeVariant();
  const [runs, setRuns] = useState(window.cachedDashboardData ? window.cachedDashboardData.runs : []);
  const [metrics, setMetrics] = useState(window.cachedDashboardData ? window.cachedDashboardData.metrics : {
    total_runs: 0,
    success_rate: 0
  });
  const [loading, setLoading] = useState(!window.cachedDashboardData);
  const [error, setError] = useState(null);
  const [isMock, setIsMock] = useState(false);

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

      const [runsRes, metricsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/pipeline-runs`, { headers }),
        fetch(`${API_URL}/api/v1/admin/metrics`, { headers })
      ]);

      if (runsRes.ok && metricsRes.ok) {
        const runsData = await runsRes.json();
        const metricsData = await metricsRes.json();
        
        setIsMock(false);
        const recentRuns = (runsData.runs || []).filter(r => r.status === 'completed').slice(0, 5);
        
        // Atualiza o cache global com timestamp
        window.cachedDashboardData = { runs: recentRuns, metrics: metricsData, timestamp: Date.now() };
        
        setRuns(recentRuns);
        setMetrics(metricsData);
        setLoading(false);

        // Dispara prefetch em background após 1 segundo
        setTimeout(() => {
          prefetchAdminData(token, API_URL);
        }, 1000);
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
              const [rRes, mRes] = await Promise.all([
                fetch(`${API_URL}/api/v1/admin/pipeline-runs`, { headers: retryHeaders }),
                fetch(`${API_URL}/api/v1/admin/metrics`, { headers: retryHeaders })
              ]);
              if (rRes.ok && mRes.ok) {
                const runsData = await rRes.json();
                const metricsData = await mRes.json();
                setIsMock(false);
                const recentRuns = (runsData.runs || []).filter(r => r.status === 'completed').slice(0, 5);
                
                // Atualiza o cache global com timestamp
                window.cachedDashboardData = { runs: recentRuns, metrics: metricsData, timestamp: Date.now() };
                
                setRuns(recentRuns);
                setMetrics(metricsData);
                setLoading(false);

                // Dispara prefetch com o novo token
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

        // Se mesmo assim não autenticou, cai no mock
        setIsMock(true);
        const mockRuns = [
          { id: '1', session_id: 's_abc123', status: 'completed', created_at: new Date().toISOString() },
          { id: '4', session_id: 's_ghj789', status: 'completed', created_at: new Date(Date.now() - 8640000).toISOString() }
        ];
        const mockMetrics = {
          total_runs: 45, success_rate: 94.5
        };

        // Salvar no cache para navegação instantânea em modo mock
        window.cachedDashboardData = {
          runs: mockRuns,
          metrics: mockMetrics,
          timestamp: Date.now()
        };

        // Pré-popular também o mock do AdminPanel para transição imediata no modo mock
        if (!window.cachedAdminData) {
          window.cachedAdminData = {
            runs: [
              { id: '1', session_id: 's_abc123', status: 'completed', failure_stage: null, detected_interface_type: 'sap_fiori', recording_duration_seconds: 420, created_at: new Date().toISOString() },
              { id: '2', session_id: 's_xyz789', status: 'tech_error', failure_stage: 'ai_generation', detected_interface_type: 'unknown', recording_duration_seconds: 180, created_at: new Date(Date.now() - 3600000).toISOString() },
              { id: '3', session_id: 's_def456', status: 'user_reported_error', failure_stage: 'capture', detected_interface_type: 'salesforce_lightning', recording_duration_seconds: 300, created_at: new Date(Date.now() - 7200000).toISOString() },
              { id: '4', session_id: 's_ghj789', status: 'completed', failure_stage: null, detected_interface_type: 'sap_fiori', recording_duration_seconds: 500, created_at: new Date(Date.now() - 8640000).toISOString() }
            ],
            publications: [
              { id: '1', session_id: 's_abc123', destination: 'SCORM_DOWNLOAD', published_by: 'João Silva', published_at: new Date().toISOString() }
            ],
            metrics: {
              total_runs: 45, success_rate: 94.5, avg_edit_rate: 12.5, time_saved_hours: 168.5,
              runs_by_instructor: [
                { instructor_id: 'João S.', total_runs: 20, completed_runs: 19 },
                { instructor_id: 'Maria P.', total_runs: 15, completed_runs: 14 },
                { instructor_id: 'Carlos R.', total_runs: 10, completed_runs: 9 }
              ]
            },
            costs: {
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
            },
            timestamp: Date.now()
          };
        }

        setRuns(mockRuns);
        setMetrics(mockMetrics);
        setLoading(false);
      } else {
        throw new Error("Falha na API");
      }
    } catch {
      setError("Não foi possível carregar as métricas do Dashboard.");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="p-space-lg sm:p-space-xl max-w-[1140px] mx-auto font-sans">
      <DemoBanner isVisible={isMock} />

      <header className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-space-md mb-space-lg">
        <div>
          <h1 className="text-display-md font-bold text-surface-800 tracking-tight">
            Capture OS
          </h1>
          <p className="text-body text-surface-700 mt-1">Bem-vindo de volta ao seu Workspace</p>
        </div>
        <div className="flex gap-space-sm">
          <button 
            onClick={() => fetchData(true)} 
            disabled={loading}
            className="flex items-center gap-space-xs px-space-md py-space-sm bg-surface-100 text-surface-800 hover:bg-surface-150 font-semibold rounded-md transition-base border border-surface-150 shadow-sombra-100 hover:shadow-sombra-200 cursor-pointer text-body"
          >
            <Activity size={16} className={loading ? "animate-spin shrink-0" : "shrink-0"} />
            <span>Atualizar</span>
          </button>
          <button className="flex items-center gap-space-xs px-space-md py-space-sm bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-md transition-base shadow-sombra-100 hover:shadow-sombra-200 cursor-pointer text-body">
            <Video size={16} className="shrink-0" />
            <span>Novo Roteiro</span>
          </button>
        </div>
      </header>

      {error ? (
        <ErrorState message={error} onRetry={fetchData} />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md mb-space-lg">
            {/* Total de Roteiros */}
            <div className="bg-surface-100 p-space-lg rounded-md shadow-sombra-200 border border-surface-150 flex items-center gap-space-md hover:shadow-sombra-400 transition-base">
              <div className="p-space-sm bg-surface-50 text-surface-700 rounded-md shrink-0">
                <FileBarChart size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-caption font-semibold uppercase tracking-wider text-surface-700 mb-0.5">Total de Roteiros</p>
                {loading ? (
                   <div className="h-8 w-16 bg-surface-150 rounded animate-pulse"></div>
                ) : (
                   <p className="text-display-md font-bold tracking-tight text-surface-800">{metrics.total_runs}</p>
                )}
              </div>
            </div>
            
            {/* Taxa de Sucesso */}
            <div className="bg-surface-100 p-space-lg rounded-md shadow-sombra-200 border border-surface-150 flex items-center gap-space-md hover:shadow-sombra-400 transition-base">
              <div className="p-space-sm bg-brand-50 text-brand-500 rounded-md shrink-0">
                <Activity size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-caption font-semibold uppercase tracking-wider text-surface-700 mb-0.5">Taxa de Sucesso</p>
                {loading ? (
                   <div className="h-8 w-16 bg-surface-150 rounded animate-pulse"></div>
                ) : (
                  <p className="text-display-md font-bold tracking-tight text-status-ok">{metrics.success_rate}%</p>
                )}
              </div>
            </div>
            
            {/* Membros */}
            <div className="bg-surface-100 p-space-lg rounded-md shadow-sombra-200 border border-surface-150 flex items-center gap-space-md hover:shadow-sombra-400 transition-base">
              <div className="p-space-sm bg-surface-50 text-surface-700 rounded-md shrink-0">
                <Users size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-caption font-semibold uppercase tracking-wider text-surface-700 mb-0.5">Membros</p>
                <p className="text-display-md font-bold tracking-tight text-surface-800">4</p>
                <p className="text-[10px] text-surface-700 font-medium">TODO: Dinâmico na Camada 4</p>
              </div>
            </div>
          </div>

          {variant === 'purist' && <PipelineGraph />}

          <div className="bg-surface-100 rounded-md shadow-sombra-200 border border-surface-150 overflow-hidden">
            <div className="px-space-lg py-space-md border-b border-surface-150 flex justify-between items-center">
              <h2 className="text-heading font-semibold text-surface-800">Roteiros Recentes (Completos)</h2>
              <Link to="/admin" className="text-body font-semibold text-brand-500 hover:text-brand-600 hover:underline transition-base">
                Ver todos
              </Link>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-50">
                    <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Sessão</th>
                    <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Status</th>
                    <th className="px-space-md py-space-sm border-b border-surface-150 font-semibold text-caption text-surface-700 uppercase tracking-wider">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} columns={3} />)
                  ) : runs.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="px-space-md py-12 text-center text-surface-750 text-body">
                        Nenhum roteiro encontrado neste workspace.
                      </td>
                    </tr>
                  ) : (
                    runs.map((run) => (
                      <tr key={run.id} className="hover:bg-surface-50/50 transition-base">
                        <td className="px-space-md py-space-sm border-b border-surface-150 font-mono text-body text-surface-800">
                          {run.session_id}
                        </td>
                        <td className="px-space-md py-space-sm border-b border-surface-150">
                          <StatusPill status={run.status} />
                        </td>
                        <td className="px-space-md py-space-sm border-b border-surface-150 text-surface-700 text-body">
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
