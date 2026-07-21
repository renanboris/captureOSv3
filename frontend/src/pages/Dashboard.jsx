import { useState, useEffect, useMemo } from 'react';
import { Activity, Video, Users, FileBarChart, ArrowUpRight, Zap, Play, CheckCircle2, ChevronRight, Clock, Trash2 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Link } from 'react-router-dom';
import StatusPill from '../components/StatusPill';
import SkeletonRow from '../components/SkeletonRow';
import DemoBanner from '../components/DemoBanner';
import ErrorState from '../components/ErrorState';
import RunDetailsModal from '../components/RunDetailsModal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import ModalPortal from '../components/ModalPortal';
import Toast from '../components/Toast';

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
  const [selectedRun, setSelectedRun] = useState(null);
  const [runToDelete, setRunToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (toastObj) => {
    setToast(toastObj);
    setTimeout(() => setToast(null), 4000);
  };

  const handleConfirmDelete = async () => {
    if (!runToDelete) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem('dev_token');
      const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      const res = await fetch(`${API_URL}/api/v1/admin/pipeline-runs/${runToDelete.session_id}`, {
        method: 'DELETE',
        headers
      });

      if (res.ok) {
        setRuns(prev => prev.filter(r => r.session_id !== runToDelete.session_id));
        window.cachedAdminData = null;
        window.cachedDashboardData = null;
        showToast({ type: 'success', message: `Captação "${runToDelete.titulo || runToDelete.session_id}" excluída com sucesso.` });
      } else {
        showToast({ type: 'error', message: 'Erro ao excluir a captação no servidor.' });
      }
    } catch (e) {
      console.error(e);
      showToast({ type: 'error', message: 'Erro de conexão ao excluir captação.' });
    } finally {
      setDeleting(false);
      setRunToDelete(null);
    }
  };

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
          { id: '1', session_id: 's_abc123', titulo: 'Navegação SAP Fiori - Ordem de Compra', status: 'completed', recording_duration_seconds: 420, detected_interface_type: 'sap_fiori', created_at: new Date().toISOString() },
          { id: '4', session_id: 's_ghj789', titulo: 'Aprovação de Férias Senior HCM', status: 'completed', recording_duration_seconds: 500, detected_interface_type: 'sap_fiori', created_at: new Date(Date.now() - 8640000).toISOString() },
          { id: '5', session_id: 's_klm456', titulo: 'Cadastro Lead Salesforce Lightning', status: 'completed', recording_duration_seconds: 300, detected_interface_type: 'salesforce_lightning', created_at: new Date(Date.now() - 17280000).toISOString() }
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

    const handleNewScript = () => setIsNewScriptModalOpen(true);
    const handleRefresh = () => fetchData(true);
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setIsNewScriptModalOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        fetchData(true);
        showToast({ type: 'info', message: 'Dados do workspace atualizados.' });
      }
    };

    window.addEventListener('open-new-script-modal', handleNewScript);
    window.addEventListener('trigger-workspace-refresh', handleRefresh);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('open-new-script-modal', handleNewScript);
      window.removeEventListener('trigger-workspace-refresh', handleRefresh);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const chartData = useMemo(() => [
    { day: 'Seg', roteiros: 4, automacoes: 12 },
    { day: 'Ter', roteiros: 7, automacoes: 24 },
    { day: 'Qua', roteiros: 5, automacoes: 18 },
    { day: 'Qui', roteiros: 12, automacoes: 38 },
    { day: 'Sex', roteiros: 9, automacoes: 30 },
    { day: 'Sáb', roteiros: 3, automacoes: 9 },
    { day: 'Dom', roteiros: metrics.total_runs ? Math.min(metrics.total_runs, 15) : 8, automacoes: 28 },
  ], [metrics]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/10 p-3 rounded-xl shadow-2xl backdrop-blur-md text-xs font-mono">
          <p className="text-slate-500 dark:text-slate-400 font-semibold mb-1">{label}</p>
          <div className="flex items-center gap-2 text-slate-900 dark:text-white">
            <span className="w-2 h-2 rounded-full bg-slate-900 dark:bg-white"></span>
            <span>Roteiros Processados: <strong>{payload[0].value}</strong></span>
          </div>
          {payload[1] && (
            <div className="flex items-center gap-2 text-cyan-600 dark:text-cyan-400 mt-1">
              <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
              <span>Passos Automáticos: <strong>{payload[1].value}</strong></span>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in font-sans">
      <DemoBanner isVisible={isMock} />

      {/* Header Monocromático Responsivo */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-200 dark:border-white/[0.08]">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
              Workspace Central
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/10 dark:text-slate-200 dark:border-white/15 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]"></span>
              Operacional
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">
            Geração autônoma de roteiros, áudios e pacotes SCORM em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              fetchData(true);
              showToast({ type: 'info', message: 'Métricas atualizadas com sucesso!' });
            }} 
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 dark:bg-surface-850 dark:hover:bg-white/[0.08] dark:text-slate-300 dark:border-white/[0.08] font-mono text-xs font-medium rounded-xl transition-all shadow-xs cursor-pointer"
          >
            <Activity size={14} className={loading ? "animate-spin text-slate-900 dark:text-white" : "text-slate-400"} />
            <span>Atualizar</span>
            <kbd className="hidden sm:inline-block text-[9px] bg-slate-100 border border-slate-200 dark:bg-white/10 dark:border-none px-1 py-0.5 rounded text-slate-500 dark:text-slate-400">⌘R</kbd>
          </button>

          <button 
            onClick={() => setIsNewScriptModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-200 dark:text-slate-950 font-bold text-xs rounded-xl transition-all shadow-md cursor-pointer"
          >
            <Video size={15} />
            <span>Novo Roteiro</span>
            <kbd className="hidden sm:inline-block text-[9px] bg-white/20 dark:bg-slate-950/20 px-1 py-0.5 rounded font-mono">⌘N</kbd>
          </button>
        </div>
      </header>

      {error ? (
        <ErrorState message={error} onRetry={fetchData} />
      ) : (
        <>
          {/* Top Hero KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Total Roteiros Card */}
            <div className="p-6 rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl relative overflow-hidden card-linear-hover transition-colors duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="p-2.5 rounded-xl bg-slate-100 text-slate-900 border border-slate-200 dark:bg-white/10 dark:text-white dark:border-white/15">
                  <FileBarChart size={20} />
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 dark:bg-white/[0.05] dark:text-slate-400 dark:border-white/[0.05]">
                  Capturas Totais
                </span>
              </div>
              <p className="text-xs uppercase font-mono tracking-widest text-slate-500 dark:text-slate-400">Total de Roteiros</p>
              {loading ? (
                <div className="h-9 w-20 bg-slate-200 dark:bg-white/10 rounded animate-pulse mt-2"></div>
              ) : (
                <div className="flex items-baseline justify-between mt-1">
                  <p className="text-4xl font-mono font-bold tracking-tight text-slate-900 dark:text-white">{metrics.total_runs}</p>
                  <span className="text-xs font-mono text-slate-700 bg-slate-100 border border-slate-200 dark:text-slate-300 dark:bg-white/10 dark:border-none px-2 py-0.5 rounded-md flex items-center gap-0.5">
                    <ArrowUpRight size={14} /> +12% sem
                  </span>
                </div>
              )}
            </div>

            {/* Taxa de Sucesso Card */}
            <div className="p-6 rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl relative overflow-hidden card-linear-hover transition-colors duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="p-2.5 rounded-xl bg-slate-100 text-slate-900 border border-slate-200 dark:bg-white/10 dark:text-white dark:border-white/15">
                  <Zap size={20} />
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/10 dark:text-slate-300 dark:border-white/15">
                  Alta precisão
                </span>
              </div>
              <p className="text-xs uppercase font-mono tracking-widest text-slate-500 dark:text-slate-400">Taxa de Sucesso</p>
              {loading ? (
                <div className="h-9 w-20 bg-slate-200 dark:bg-white/10 rounded animate-pulse mt-2"></div>
              ) : (
                <div className="flex items-baseline justify-between mt-1">
                  <p className="text-4xl font-mono font-bold tracking-tight text-slate-900 dark:text-white">{metrics.success_rate}%</p>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">SLA &gt; 90%</span>
                </div>
              )}
            </div>

            {/* Membros Ativos Card */}
            <div className="p-6 rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl relative overflow-hidden card-linear-hover transition-colors duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="p-2.5 rounded-xl bg-cyan-100 text-cyan-800 border border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/20">
                  <Users size={20} />
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 dark:bg-white/[0.05] dark:text-slate-400">
                  Time Ativo
                </span>
              </div>
              <p className="text-xs uppercase font-mono tracking-widest text-slate-500 dark:text-slate-400">Instrutores</p>
              <div className="flex items-baseline justify-between mt-1">
                <p className="text-4xl font-mono font-bold tracking-tight text-slate-900 dark:text-white">4</p>
                <div className="flex -space-x-1.5 overflow-hidden">
                  <div className="inline-block h-6 w-6 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-950 font-bold text-[10px] flex items-center justify-center ring-2 ring-white dark:ring-surface-850">B</div>
                  <div className="inline-block h-6 w-6 rounded-full bg-cyan-500 text-white font-bold text-[10px] flex items-center justify-center ring-2 ring-white dark:ring-surface-850">M</div>
                  <div className="inline-block h-6 w-6 rounded-full bg-purple-500 text-white font-bold text-[10px] flex items-center justify-center ring-2 ring-white dark:ring-surface-850">C</div>
                </div>
              </div>
            </div>
          </div>

          {/* Graphic Section: Volume & Velocity */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl transition-colors duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Velocidade de Geração de Roteiros</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                  Volume diário de tutoriais narrados e passos automatizados
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono">
                <div className="flex items-center gap-1.5 text-slate-900 dark:text-white font-semibold">
                  <span className="w-2.5 h-2.5 rounded-sm bg-slate-900 dark:bg-white"></span>
                  <span>Roteiros</span>
                </div>
                <div className="flex items-center gap-1.5 text-cyan-600 dark:text-cyan-400">
                  <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500"></span>
                  <span>Passos IA</span>
                </div>
              </div>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRoteiros" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#64748b" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#64748b" stopOpacity={0.0}/>
                    </linearGradient>
                    <linearGradient id="colorAutomacoes" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                  <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="roteiros" stroke="#0f172a" strokeWidth={2} fillOpacity={1} fill="url(#colorRoteiros)" className="dark:stroke-white" />
                  <Area type="monotone" dataKey="automacoes" stroke="#06b6d4" strokeWidth={1.5} strokeDasharray="4 4" fillOpacity={1} fill="url(#colorAutomacoes)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Table: Recent Script Runs */}
          <div className="rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl overflow-hidden transition-colors duration-200">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-white/[0.08] flex justify-between items-center bg-slate-50/50 dark:bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Roteiros Recentes</h2>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400">
                  Clique na linha para detalhes
                </span>
              </div>
              <Link 
                to="/admin" 
                className="text-xs font-mono font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white flex items-center gap-1 transition-colors"
              >
                <span>Painel Completo</span>
                <ChevronRight size={14} />
              </Link>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse font-sans">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06] font-mono text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <th className="px-6 py-3">Sessão / Título do Roteiro</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Horário / Data</th>
                    <th className="px-6 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} columns={4} />)
                  ) : runs.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="px-6 py-12 text-center text-slate-500 font-mono text-xs">
                        Nenhum roteiro capturado ainda neste workspace.
                      </td>
                    </tr>
                  ) : (
                    runs.map((run) => (
                      <tr 
                        key={run.id} 
                        onClick={() => setSelectedRun(run)}
                        className="hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer group"
                      >
                        <td className="px-6 py-4 border-l-2 border-l-emerald-500">
                          <div className="font-semibold text-sm text-slate-900 group-hover:text-slate-900 dark:text-slate-100 dark:group-hover:text-white transition-colors" title={run.session_id}>
                            {run.titulo || `Sessão ${run.session_id.substring(0, 8)}`}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 mt-0.5 flex items-center gap-2">
                            <span>ID: {run.session_id}</span>
                            <span>•</span>
                            <span className="text-slate-500 dark:text-slate-400 font-semibold">Ready for LMS</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <StatusPill status={run.status} />
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-slate-500 dark:text-slate-400">
                          <div className="flex items-center gap-1.5">
                            <Clock size={13} className="text-slate-400" />
                            <span>{new Date(run.created_at).toLocaleString('pt-BR')}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRunToDelete(run);
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                            title="Excluir captação"
                          >
                            <Trash2 size={15} />
                          </button>
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

      {/* Modal para Detalhes da Sessão Selecionada */}
      <RunDetailsModal 
        run={selectedRun}
        isOpen={!!selectedRun}
        onClose={() => setSelectedRun(null)}
        onToast={showToast}
      />

      {/* Modal de Confirmação de Exclusão */}
      <DeleteConfirmModal 
        isOpen={!!runToDelete}
        onClose={() => setRunToDelete(null)}
        onConfirm={handleConfirmDelete}
        itemTitle={runToDelete?.titulo}
        sessionId={runToDelete?.session_id}
        loading={deleting}
      />

      {/* Modal para Gravar Novo Roteiro */}
      <ModalPortal isOpen={isNewScriptModalOpen} onClose={() => setIsNewScriptModalOpen(false)}>
        <div className="bg-white text-slate-900 dark:bg-surface-850 dark:text-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-white/10 relative">
          <button 
            onClick={() => setIsNewScriptModalOpen(false)}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 dark:hover:text-white font-mono text-xs p-1.5 cursor-pointer bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-lg transition-colors"
          >
            ESC ✕
          </button>
          
          <div className="flex items-center gap-3 mb-5">
            <div className="p-3 bg-slate-100 text-slate-900 border border-slate-200 dark:bg-white/10 dark:text-white dark:border-white/15 rounded-xl shadow-sm">
              <Video size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Gravar Novo Roteiro</h3>
              <p className="text-xs text-slate-500 dark:text-slate-300 font-mono">Extensão Capture OS v3</p>
            </div>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300 mb-5 leading-relaxed">
            A captura de roteiros é realizada nativamente através da <strong>Extensão Capture OS</strong> acoplada ao seu navegador Google Chrome.
          </p>

          <div className="space-y-3 mb-6">
            <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/[0.06] rounded-xl">
              <span className="w-5 h-5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-950 flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">1</span>
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">Abra a extensão</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Clique no ícone do Capture OS no menu de extensões do Chrome.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/[0.06] rounded-xl">
              <span className="w-5 h-5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-950 flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">2</span>
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">Acesse o sistema alvo</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-300 font-mono">Navegue até a tela do processo que deseja gravar.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/[0.06] rounded-xl">
              <span className="w-5 h-5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-950 flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">3</span>
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">Clique em Iniciar Gravação</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Grave o processo narrando normalmente. O pacote SCORM será compilado automaticamente!</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-white/[0.08]">
            <button
              onClick={() => {
                setIsNewScriptModalOpen(false);
                showToast({ type: 'success', message: 'Instruções enviadas! Abra o Chrome para iniciar a gravação.' });
              }}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-200 dark:text-slate-950 font-bold text-xs rounded-xl transition-all shadow-md cursor-pointer"
            >
              Entendi, Abrir Extensão
            </button>
          </div>
        </div>
      </ModalPortal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
