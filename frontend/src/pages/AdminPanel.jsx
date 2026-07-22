import { useState, useEffect, useMemo } from 'react';
// Force Vercel rebuild v1.0.12
import { Download, AlertTriangle, ShieldCheck, DollarSign, Users, Award, Lock, Plus, CheckCircle2, RefreshCw, BarChart2, Trash2, X, Paperclip, BookOpen, UploadCloud } from 'lucide-react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

import KpiCard from '../components/KpiCard';
import StatusPill from '../components/StatusPill';
import FilterPills from '../components/FilterPills';
import ErrorState from '../components/ErrorState';
import SkeletonRow from '../components/SkeletonRow';
import EditRateGauge from '../components/EditRateGauge';
import DemoBanner from '../components/DemoBanner';
import RunDetailsModal from '../components/RunDetailsModal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import Toast from '../components/Toast';

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
  const [selectedRun, setSelectedRun] = useState(null);
  const [runToDelete, setRunToDelete] = useState(null);
  const [toast, setToast] = useState(null);

  const [ragNamespaceInput, setRagNamespaceInput] = useState('');
  const [ragSelectedFile, setRagSelectedFile] = useState(null);
  const [uploadingRag, setUploadingRag] = useState(false);
  const [ragStatusMsg, setRagStatusMsg] = useState(null);

  const showToast = (toastObj) => {
    setToast(toastObj);
    setTimeout(() => setToast(null), 4000);
  };

  const handleUploadRagDocument = async (e) => {
    e.preventDefault();
    const urlVal = ragNamespaceInput.trim();
    const isUrl = urlVal.startsWith('http://') || urlVal.startsWith('https://');

    if (!ragSelectedFile && !isUrl) {
      showToast({ type: 'warning', message: 'Selecione um arquivo (PDF/TXT/MD) ou cole uma URL (http://...).' });
      return;
    }
    setUploadingRag(true);
    setRagStatusMsg(null);
    try {
      const token = localStorage.getItem('dev_token');
      const API_URL = import.meta.env.VITE_API_URL || 'https://api.nomadelabs.com.br';
      const headers = { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) };

      if (isUrl && !ragSelectedFile) {
        const res = await fetch(`${API_URL}/api/v1/rag/upload_context`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            url: urlVal,
            namespace: 'auto'
          })
        });

        if (!res.ok) throw new Error('Falha ao vetorizar URL');
        const data = await res.json();
        setRagNamespaceInput('');
        setRagStatusMsg(`URL vetorizada com sucesso (${data.chunks} chunks no namespace "${data.namespace}")!`);
        showToast({ type: 'success', message: `Conteúdo da URL integrado no RAG (${data.chunks} chunks).` });
        setUploadingRag(false);
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Str = reader.result.split(',')[1];
          const namespace = (isUrl ? 'auto' : ragNamespaceInput.trim()) || 'auto';
          const res = await fetch(`${API_URL}/api/v1/rag/upload_context`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              filename: ragSelectedFile.name,
              file_data: base64Str,
              namespace
            })
          });

          if (!res.ok) throw new Error('Falha ao vetorizar documento');
          const data = await res.json();
          setRagSelectedFile(null);
          setRagNamespaceInput('');
          setRagStatusMsg(`Documento vetorizado com sucesso (${data.chunks} chunks no namespace "${data.namespace}")!`);
          showToast({ type: 'success', message: `Base RAG atualizada (${data.chunks} chunks).` });
        } catch (err) {
          setRagStatusMsg(`Erro ao anexar: ${err.message}`);
          showToast({ type: 'error', message: `Erro na vetorização: ${err.message}` });
        } finally {
          setUploadingRag(false);
        }
      };
      reader.readAsDataURL(ragSelectedFile);
    } catch (err) {
      setRagStatusMsg(`Erro ao ler arquivo/URL: ${err.message}`);
      setUploadingRag(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!runToDelete) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem('dev_token');
      const API_URL = import.meta.env.VITE_API_URL || 'https://api.nomadelabs.com.br';
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

  // Table states
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  // Whitelist settings states
  const [disableWhitelist, setDisableWhitelist] = useState(true);
  const [allowedDomains, setAllowedDomains] = useState([]);
  const [newDomain, setNewDomain] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  const fetchSettings = async (token) => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'https://api.nomadelabs.com.br';
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const res = await fetch(`${API_URL}/api/v1/admin/settings`, { headers });
      if (res.ok) {
        const data = await res.json();
        setDisableWhitelist(data.disable_whitelist || false);
        setAllowedDomains(data.allowed_domains || []);
      }
    } catch (e) {
      console.warn("Erro ao buscar configurações de whitelist:", e);
    }
  };

  const handleAddDomain = (e) => {
    e.preventDefault();
    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;
    if (allowedDomains.includes(domain)) {
      setNewDomain('');
      showToast({ type: 'info', message: `O domínio ${domain} já está na lista.` });
      return;
    }
    setAllowedDomains([...allowedDomains, domain]);
    setNewDomain('');
    showToast({ type: 'success', message: `Domínio ${domain} adicionado à whitelist.` });
  };

  const handleRemoveDomain = (domainToRemove) => {
    setAllowedDomains(allowedDomains.filter(d => d !== domainToRemove));
    showToast({ type: 'info', message: `Domínio ${domainToRemove} removido.` });
  };

  const handleSaveAdminSettings = async () => {
    setSavingSettings(true);
    setSettingsSuccess(false);
    try {
      const token = localStorage.getItem('dev_token');
      const API_URL = import.meta.env.VITE_API_URL || 'https://api.nomadelabs.com.br';
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };

      const res = await fetch(`${API_URL}/api/v1/admin/settings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          disable_whitelist: disableWhitelist,
          allowed_domains: allowedDomains
        })
      });

      if (res.ok) {
        setSettingsSuccess(true);
        showToast({ type: 'success', message: 'Configurações de Whitelist e Privacidade salvas!' });
        setTimeout(() => setSettingsSuccess(false), 3000);
      } else {
        showToast({ type: 'error', message: 'Erro ao salvar configurações no servidor.' });
      }
    } catch (e) {
      console.error(e);
      showToast({ type: 'error', message: 'Erro de conexão ao salvar configurações.' });
    } finally {
      setSavingSettings(false);
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

  const fetchData = async (force = false) => {
    const CACHE_TTL_MS = 30000;

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

    if (window.cachedAdminData && !force) {
      const elapsed = Date.now() - window.cachedAdminData.timestamp;
      const isFresh = elapsed < CACHE_TTL_MS;
      if (isFresh) {
        setRuns(window.cachedAdminData.runs);
        setPublications(window.cachedAdminData.publications);
        setMetrics(window.cachedAdminData.metrics);
        setCosts(window.cachedAdminData.costs);
        setLoading(false);
        return;
      }
    }

    if (!window.cachedAdminData || force) {
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
      if (token === 'null' || token === 'undefined') token = null;

      const API_URL = import.meta.env.VITE_API_URL || 'https://api.nomadelabs.com.br';

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
      fetchSettings(token);

      const [runsRes, metricsRes, pubsRes, costsRes, settingsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/pipeline-runs`, { headers }),
        fetch(`${API_URL}/api/v1/admin/metrics`, { headers }),
        fetch(`${API_URL}/api/v1/admin/publications`, { headers }),
        fetch(`${API_URL}/api/v1/admin/costs`, { headers }),
        fetch(`${API_URL}/api/v1/admin/settings`, { headers }).catch(() => null)
      ]);

      if (runsRes.ok && metricsRes.ok && pubsRes.ok && costsRes.ok) {
        const runsData = await runsRes.json();
        const metricsData = await metricsRes.json();
        const pubsData = await pubsRes.json();
        const costsData = await costsRes.json();
        
        if (settingsRes && settingsRes.ok) {
          const settingsData = await settingsRes.json();
          setDisableWhitelist(settingsData.disable_whitelist || false);
          setAllowedDomains(settingsData.allowed_domains || []);
        }

        setIsMock(false);
        const runsList = runsData.runs || [];
        const pubsList = pubsData.publications || [];
        
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
        try {
          const authRes = await fetch(`${API_URL}/api/v1/auth/dev-token`);
          if (authRes.ok) {
            const authData = await authRes.json();
            if (authData.token) {
              localStorage.setItem('dev_token', authData.token);
              fetchSettings(authData.token);
              const retryHeaders = { 'Authorization': `Bearer ${authData.token}` };
              const [rRes, mRes, pRes, cRes, sRes] = await Promise.all([
                fetch(`${API_URL}/api/v1/admin/pipeline-runs`, { headers: retryHeaders }),
                fetch(`${API_URL}/api/v1/admin/metrics`, { headers: retryHeaders }),
                fetch(`${API_URL}/api/v1/admin/publications`, { headers: retryHeaders }),
                fetch(`${API_URL}/api/v1/admin/costs`, { headers: retryHeaders }),
                fetch(`${API_URL}/api/v1/admin/settings`, { headers: retryHeaders }).catch(() => null)
              ]);
              if (rRes.ok && mRes.ok && pRes.ok && cRes.ok) {
                const runsData = await rRes.json();
                const metricsData = await mRes.json();
                const pubsData = await pRes.json();
                const costsData = await cRes.json();
                
                if (sRes && sRes.ok) {
                  const settingsData = await sRes.json();
                  setDisableWhitelist(settingsData.disable_whitelist || false);
                  setAllowedDomains(settingsData.allowed_domains || []);
                }

                setIsMock(false);
                const runsList = runsData.runs || [];
                const pubsList = pubsData.publications || [];
                
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

        setIsMock(true);
        const mockRuns = [
          { id: '1', session_id: 's_abc123', titulo: 'Navegação SAP Fiori - Ordem de Compra', status: 'completed', failure_stage: null, detected_interface_type: 'sap_fiori', recording_duration_seconds: 420, gemini_call_count: 4, cost_usd: 0.15, created_at: new Date().toISOString() },
          { id: '2', session_id: 's_xyz789', titulo: 'Geração do Pacote SCORM 1.2', status: 'tech_error', failure_stage: 'ai_generation', detected_interface_type: 'unknown', recording_duration_seconds: 180, gemini_call_count: 8, cost_usd: 0.35, created_at: new Date(Date.now() - 3600000).toISOString() },
          { id: '3', session_id: 's_def456', titulo: 'Ajuste de Prompt de Captura', status: 'user_reported_error', failure_stage: 'capture', detected_interface_type: 'salesforce_lightning', recording_duration_seconds: 300, gemini_call_count: 2, cost_usd: 0.08, created_at: new Date(Date.now() - 7200000).toISOString() },
          { id: '4', session_id: 's_ghj789', titulo: 'Consulta de Holerite Senior HCM', status: 'completed', failure_stage: null, detected_interface_type: 'sap_fiori', recording_duration_seconds: 500, gemini_call_count: 5, cost_usd: 0.22, created_at: new Date(Date.now() - 8640000).toISOString() }
        ];
        const mockPubs = [
          { id: '1', session_id: 's_abc123', destination: 'SCORM_DOWNLOAD', published_by: 'boris.renan@gmail.com', published_at: new Date().toISOString() }
        ];
        const mockMetrics = {
          total_runs: 45, success_rate: 94.5, avg_edit_rate: 12.5, time_saved_hours: 168.5,
          runs_by_instructor: [
            { instructor_id: 'boris.renan@gmail.com', display_name: 'boris.renan@gmail.com', total_runs: 20, completed_runs: 19 },
            { instructor_id: 'maria.p@empresa.com', display_name: 'maria.p@empresa.com', total_runs: 15, completed_runs: 14 },
            { instructor_id: 'carlos.r@empresa.com', display_name: 'carlos.r@empresa.com', total_runs: 10, completed_runs: 9 }
          ]
        };
        const mockCosts = {
          total_cost_usd: 12.4530,
          total_cost_brl: 69.7368,
          avg_cost_per_run_usd: 0.2767,
          cost_by_instructor: [
            { user_id: 'boris.renan@gmail.com', total_cost_usd: 5.10, run_count: 20 },
            { user_id: 'maria.p@empresa.com', total_cost_usd: 4.85, run_count: 15 }
          ],
          most_expensive_runs: [
            { session_id: 'sess_1780690407909', titulo: 'Re-Análise de Transação SAP Complexa', cost_usd: 1.85, gemini_call_count: 12, status: 'completed' },
            { session_id: 'sess_9981234567890', titulo: 'Captura com Áudio Longo Narrado', cost_usd: 0.95, gemini_call_count: 6, status: 'completed' }
          ],
          unverified_cost_warning: true
        };

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
        setDisableWhitelist(true);
        setAllowedDomains(["localhost", "127.0.0.1", "senior.com.br", "salesforce.com"]);
        setLoading(false);
      } else {
        throw new Error("Falha na API");
      }
    } catch (err) {
      setError("Não foi possível carregar as execuções do Painel do Gestor.");
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
    setPage(1);
  }, [filter]);

  const filterOptions = [
    { label: 'Todos', value: 'all' },
    { label: 'Concluído', value: 'completed' },
    { label: 'Falha Técnica', value: 'tech_error' },
    { label: 'Reportado', value: 'user_reported_error' }
  ];

  const getStatusBorderColor = (status) => {
    switch (status) {
      case 'completed': return 'border-l-emerald-500';
      case 'tech_error': return 'border-l-rose-500';
      case 'user_reported_error': return 'border-l-amber-500';
      case 'processing': return 'border-l-purple-500';
      default: return 'border-l-slate-700';
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  };

  const instructorChartData = useMemo(() => {
    return (metrics.runs_by_instructor || []).map(inst => ({
      name: (inst.display_name || inst.instructor_id).split('@')[0],
      total: inst.total_runs,
      completadas: inst.completed_runs
    }));
  }, [metrics]);

  if (error) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <DemoBanner isVisible={isMock} />
        <ErrorState message={error} onRetry={fetchData} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in font-sans">
      <DemoBanner isVisible={isMock} />

      {/* Header Gestor Diamante */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-200 dark:border-white/[0.08]">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              Painel do Gestor
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/10 dark:text-slate-200 dark:border-white/15">
              ROI & Governança
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">
            Qualidade da IA, métricas financeiras, auditoria de publicações e segurança corporativa.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              fetchData(true);
              showToast({ type: 'info', message: 'Métricas do gestor sincronizadas!' });
            }} 
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 dark:bg-surface-850 dark:hover:bg-white/[0.08] dark:text-slate-300 dark:border-white/[0.08] font-mono text-xs font-medium rounded-xl transition-all shadow-xs cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? "animate-spin text-slate-900 dark:text-white" : "text-slate-400"} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* Alerta de Execuções Atípicas / Custo Elevado */}
      {!loading && costs.most_expensive_runs?.some(run => run.gemini_call_count > 5 && run.cost_usd >= 0.10) && (
        <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200 dark:bg-amber-500/[0.06] dark:border-amber-500/30 shadow-sm dark:shadow-xl relative overflow-hidden backdrop-blur-sm transition-colors duration-200">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-500 text-slate-950 rounded-xl shadow-md font-bold flex-shrink-0">
              <AlertTriangle size={20} />
            </div>
            
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                  Alerta Operacional: Execuções com Alto Custo de IA
                </h4>
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40">
                  &gt; 5 reqs Gemini (&ge; R$ 0,55)
                </span>
              </div>
              
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-mono">
                Sessões que exigiram re-processamento intensivo pela IA. Clique no card para abrir o raio-x completo:
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                {costs.most_expensive_runs
                  .filter(run => run.gemini_call_count > 5 && run.cost_usd >= 0.10)
                  .map(run => (
                    <div 
                      key={run.session_id} 
                      onClick={() => setSelectedRun(run)}
                      className="bg-white border border-amber-200 dark:bg-surface-850 dark:border-amber-500/20 rounded-xl p-3 flex items-center justify-between gap-3 shadow-xs hover:border-amber-400 dark:hover:border-amber-500/50 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-all cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate" title={run.titulo || run.session_id}>
                          {run.titulo || `Sessão ${run.session_id.substring(0, 8)}`}
                        </p>
                        <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">{run.session_id}</p>
                      </div>
                      
                      <div className="flex items-center gap-2 text-right">
                        <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20">
                          {run.gemini_call_count} reqs
                        </span>
                        <span className="text-xs font-bold font-mono text-slate-900 dark:text-white">
                          R$ {(run.cost_usd * (costs.usd_to_brl_rate || 5.55)).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top 5 KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] p-5 rounded-2xl">
              <div className="h-3 w-16 bg-slate-200 dark:bg-white/10 rounded mb-4 animate-pulse"></div>
              <div className="h-8 w-24 bg-slate-200 dark:bg-white/10 rounded animate-pulse"></div>
            </div>
          ))
        ) : (
          <>
            <KpiCard title="Execuções Totais" value={metrics.total_runs} trend="+15%" />
            <KpiCard title="Taxa de Sucesso" value={`${metrics.success_rate}%`} status={metrics.success_rate > 90 ? 'ok' : 'warn'} />
            <KpiCard title="Tempo Economizado" value={`${metrics.time_saved_hours}h`} status="info" subtitle="ROI em Automação" />
            <KpiCard title="Falhas Reportadas" value="0" status="neutral" />
            
            {/* Custo Operacional Card */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl flex flex-col justify-between relative overflow-hidden card-linear-hover transition-colors duration-200">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
                  Custo Operacional
                </p>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20 font-semibold" title="Cotação em tempo real via AwesomeAPI">
                  USD: R$ {(costs.usd_to_brl_rate || 5.55).toFixed(2)}
                </span>
              </div>
              <div className="mt-2">
                <p className="text-2xl font-mono font-bold text-slate-900 dark:text-white">
                  R$ {(costs.total_cost_brl || (costs.total_cost_usd ? costs.total_cost_usd * (costs.usd_to_brl_rate || 5.55) : 0)).toFixed(2)}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                  ${costs.total_cost_usd ? costs.total_cost_usd.toFixed(2) : '0.00'} USD acumulado
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Section 2: AI Quality & Instructor Productivity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Usage by Instructor Chart */}
        <div className="p-6 rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl lg:col-span-2 space-y-4 transition-colors duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Users size={18} className="text-slate-700 dark:text-white" />
                <span>Uso por Instrutor</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">Produtividade de tutoriais criados no time</p>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/10 dark:text-slate-300 dark:border-white/15 font-semibold">
              Top Performers
            </span>
          </div>

          {/* Recharts BarChart */}
          <div className="h-48 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={instructorChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }} content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/10 p-3 rounded-xl shadow-2xl text-xs font-mono">
                        <p className="text-slate-900 dark:text-white font-bold">{payload[0].payload.name}</p>
                        <p className="text-slate-700 dark:text-white mt-1">Execuções Totais: {payload[0].value}</p>
                      </div>
                    );
                  }
                  return null;
                }} />
                <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                  {instructorChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === 0 ? '#0f172a' : index === 1 ? '#06b6d4' : '#8b5cf6'} className="dark:fill-white" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
            {metrics.runs_by_instructor?.map((inst, idx) => {
              const name = inst.display_name || inst.name || (inst.instructor_id.includes('@') ? inst.instructor_id : `Instrutor (${inst.instructor_id.substring(0, 8)})`);
              const initial = name.charAt(0).toUpperCase();
              return (
                <div key={idx} className="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-slate-100 dark:bg-white/[0.02] dark:hover:bg-white/[0.04] rounded-xl transition-colors text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-950 flex items-center justify-center font-bold font-mono">
                      {initial}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100" title={name}>{name}</p>
                      <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{inst.total_runs} módulos gravados</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/10 dark:text-slate-300 dark:border-white/15 rounded-md font-semibold">
                    {inst.completed_runs} 100% OK
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Precision Gauge */}
        <EditRateGauge rate={metrics.avg_edit_rate || 12.5} />
      </div>

      {/* Section 3: Main Runs Table */}
      <div className="rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl overflow-hidden transition-colors duration-200">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/[0.08] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50/50 dark:bg-white/[0.02]">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Pipeline de Captura & Gravações</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">Clique em qualquer linha para abrir o raio-x da execução</p>
          </div>
          <FilterPills options={filterOptions} selected={filter} onChange={setFilter} />
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06] font-mono text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="px-6 py-3">Sessão / Título</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Duração</th>
                <th className="px-6 py-3">Interface Detectada</th>
                <th className="px-6 py-3">Etapa de Falha</th>
                <th className="px-6 py-3">Data</th>
                <th className="px-6 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} columns={7} />)
              ) : currentRuns.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-slate-500 font-mono text-xs">
                    Nenhuma execução encontrada para este filtro.
                  </td>
                </tr>
              ) : (
                currentRuns.map((run) => (
                  <tr 
                    key={run.id} 
                    onClick={() => setSelectedRun(run)}
                    className="hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer group"
                  >
                    <td className={`px-6 py-4 border-l-2 ${getStatusBorderColor(run.status)} text-xs`}>
                      <div className="font-semibold text-slate-900 group-hover:text-slate-900 dark:text-slate-100 dark:group-hover:text-white transition-colors" title={run.session_id}>
                        {run.titulo || `Sessão ${run.session_id.substring(0, 8)}`}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">{run.session_id}</div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusPill status={run.status} type="pipeline" />
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-700 dark:text-slate-300">
                      {formatDuration(run.recording_duration_seconds)}
                    </td>
                    <td className="px-6 py-4">
                      <StatusPill status={run.detected_interface_type} type="interface" />
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-500 dark:text-slate-400">
                      {(run.status !== 'completed' && run.failure_stage) ? run.failure_stage.replace('_', ' ') : '—'}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-500 dark:text-slate-400">
                      {new Date(run.created_at).toLocaleDateString('pt-BR')}
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
        
        {/* Paginação Estilizada */}
        {!loading && filteredRuns.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-200 dark:border-white/[0.08] bg-slate-50/50 dark:bg-white/[0.02] flex items-center justify-between text-xs font-mono">
            <span className="text-slate-500 dark:text-slate-400">
              Exibindo {(page - 1) * itemsPerPage + 1}–{Math.min(page * itemsPerPage, filteredRuns.length)} de {filteredRuns.length}
            </span>
            <div className="flex items-center gap-2">
              <button 
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 dark:bg-surface-850 dark:border-white/10 dark:text-slate-300 dark:hover:border-white/20 disabled:opacity-40 rounded-lg transition-all cursor-pointer shadow-xs"
              >
                Anterior
              </button>
              <button 
                disabled={page === totalPages || totalPages === 0}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 dark:bg-surface-850 dark:border-white/10 dark:text-slate-300 dark:hover:border-white/20 disabled:opacity-40 rounded-lg transition-all cursor-pointer shadow-xs"
              >
                Próximo
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section 4: Governance & Whitelist Settings */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl space-y-6 transition-colors duration-200">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 text-slate-900 border border-slate-200 dark:bg-white/10 dark:text-white dark:border-white/15 rounded-xl">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Configurações de Segurança & Whitelist</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Governança de domínios corporativos permitidos para captura</p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-slate-50 border border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06] rounded-xl">
          <div>
            <h4 className="font-semibold text-xs text-slate-900 dark:text-white">Liberar captura em qualquer domínio (Desativar Whitelist)</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
              Se ativo, a extensão funcionará em qualquer URL sem restrições de domínios cadastrados.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input 
              type="checkbox" 
              className="sr-only peer" 
              checked={disableWhitelist} 
              onChange={(e) => setDisableWhitelist(e.target.checked)} 
            />
            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500 dark:bg-slate-800"></div>
          </label>
        </div>

        {!disableWhitelist && (
          <div className="space-y-4 animate-fade-in">
            <h4 className="font-semibold text-xs text-slate-900 dark:text-white font-mono">Domínios Autorizados</h4>
            <div className="flex flex-wrap gap-2">
              {allowedDomains.length === 0 ? (
                <span className="text-xs text-slate-500 font-mono italic">Nenhum domínio configurado. Apenas localhost é liberado.</span>
              ) : (
                allowedDomains.map(domain => (
                  <span key={domain} className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-800 border border-slate-200 dark:bg-white/10 dark:text-white dark:border-white/15 text-xs font-mono font-medium rounded-lg">
                    {domain}
                    <button 
                      type="button" 
                      onClick={() => handleRemoveDomain(domain)}
                      className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors ml-1 font-bold text-xs cursor-pointer"
                    >
                      &times;
                    </button>
                  </span>
                ))
              )}
            </div>

            <form onSubmit={handleAddDomain} className="flex gap-2 max-w-md">
              <input 
                type="text" 
                placeholder="Ex: minhaempresa.com.br" 
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="flex-1 px-3.5 py-2 border border-slate-200 dark:border-white/[0.1] rounded-xl text-xs font-mono bg-white dark:bg-surface-900 text-slate-900 dark:text-white outline-none focus:border-slate-400 dark:focus:border-white/30 transition-colors"
              />
              <button 
                type="submit"
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-200 dark:text-slate-950 rounded-xl text-xs font-bold font-mono transition-all shadow-xs cursor-pointer"
              >
                Adicionar
              </button>
            </form>
          </div>
        )}

        <div className="flex items-center gap-4 border-t border-slate-200 dark:border-white/[0.08] pt-4">
          <button 
            type="button"
            onClick={handleSaveAdminSettings}
            disabled={savingSettings}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-200 dark:text-slate-950 rounded-xl text-xs font-bold font-mono disabled:opacity-50 transition-all shadow-md cursor-pointer"
          >
            {savingSettings ? 'Salvar...' : 'Salvar Configurações'}
          </button>
          
          {settingsSuccess && (
            <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 animate-fade-in">
              <CheckCircle2 size={15} /> Configurações salvas com sucesso!
            </span>
          )}
        </div>
      </div>

      {/* Section 4.5: RAG Knowledge Base Upload */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl space-y-6 transition-colors duration-200">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/20 rounded-xl">
            <BookOpen size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Base de Conhecimento (RAG) & Documentação</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Injetar manuais, Release Notes ou links web de documentação na Inteligência Artificial</p>
          </div>
        </div>

        <form onSubmit={handleUploadRagDocument} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono font-medium text-slate-700 dark:text-slate-300">
                Módulo / Assunto (ex: BPM, GED, HCM, ERP) ou URL Web
              </label>
              <input
                type="text"
                placeholder="Cole uma URL (https://...) ou digite o Módulo..."
                value={ragNamespaceInput}
                onChange={(e) => setRagNamespaceInput(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-200 dark:border-white/[0.1] rounded-xl text-xs font-mono bg-white dark:bg-surface-900 text-slate-900 dark:text-white outline-none focus:border-slate-400 dark:focus:border-white/30 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono font-medium text-slate-700 dark:text-slate-300">
                Anexar Documento (.pdf, .txt, .md)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  id="admin-rag-file"
                  accept=".pdf,.txt,.md"
                  onChange={(e) => setRagSelectedFile(e.target.files[0] || null)}
                  className="hidden"
                />
                <label
                  htmlFor="admin-rag-file"
                  className="flex-1 px-3.5 py-2 border border-dashed border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-500/5 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-xl text-xs font-medium font-mono cursor-pointer flex items-center justify-center gap-2 transition-all"
                >
                  <Paperclip size={15} />
                  {ragSelectedFile ? ragSelectedFile.name : 'Clique para Anexar Arquivo'}
                </label>
                {ragSelectedFile && (
                  <button
                    type="button"
                    onClick={() => setRagSelectedFile(null)}
                    className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg text-xs font-bold cursor-pointer"
                    title="Remover arquivo"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={uploadingRag || !ragSelectedFile}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 rounded-xl text-xs font-bold font-mono disabled:opacity-40 transition-all shadow-md cursor-pointer flex items-center gap-2"
            >
              <UploadCloud size={16} />
              {uploadingRag ? 'Vetorizando em Lotes...' : 'Vetorizar Documento RAG'}
            </button>

            {ragStatusMsg && (
              <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 animate-fade-in">
                <CheckCircle2 size={15} /> {ragStatusMsg}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Section 5: Publication Audit Trail */}
      <div className="rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl overflow-hidden transition-colors duration-200">
        <details className="group">
          <summary className="px-6 py-4 cursor-pointer flex justify-between items-center bg-slate-50/50 hover:bg-slate-100 dark:bg-white/[0.02] dark:hover:bg-white/[0.04] transition-colors">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Trilha de Exportação SCORM & Publicações</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400">
                Auditoria LMS
              </span>
            </div>
            <Download size={16} className="text-slate-400 group-open:rotate-180 transition-transform" />
          </summary>
          
          <div className="overflow-x-auto border-t border-slate-200 dark:border-white/[0.08]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06] font-mono text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="px-6 py-3">Sessão</th>
                  <th className="px-6 py-3">Destino</th>
                  <th className="px-6 py-3">Exportado Por</th>
                  <th className="px-6 py-3">Data da Publicação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} columns={4} />)
                ) : publications.length === 0 ? (
                  <tr><td colSpan="4" className="px-6 py-12 text-center text-slate-500 font-mono text-xs">Nenhum pacote SCORM exportado até o momento.</td></tr>
                ) : (
                  publications.map((pub) => (
                    <tr 
                      key={pub.id} 
                      onClick={() => showToast({ type: 'info', message: `Publicação ${pub.destination} realizada por ${pub.published_by}` })}
                      className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-4 font-mono text-xs text-slate-800 dark:text-slate-200">{pub.session_id.substring(0, 12)}...</td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-800 border border-slate-200 dark:bg-white/10 dark:text-white dark:border-white/15 rounded-md text-[10px] font-mono font-semibold uppercase tracking-wider">
                          {pub.destination}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs font-semibold text-slate-800 dark:text-slate-200">{pub.published_by}</td>
                      <td className="px-6 py-4 text-xs font-mono text-slate-500 dark:text-slate-400">
                        {new Date(pub.published_at).toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      {/* Modal para Raio-X da Execução Selecionada */}
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

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
