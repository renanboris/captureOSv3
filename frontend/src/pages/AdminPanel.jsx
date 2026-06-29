import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Clock, AlertTriangle, TrendingDown, Hourglass, Download } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

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

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Na extensão, o token será injetado nativamente. Para testes locais, pode usar o localStorage.
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
          setRuns(runsData.runs || []);
          setMetrics(metricsData);
          setPublications(pubsData.publications || []);
          setLoading(false);
          return;
        }
        
        // Se der 401 (sem auth), caímos pro Mock visual para não quebrar a demo
        if (runsRes.status === 401) {
          setIsMock(true);
          setRuns([
            { id: '1', session_id: 's_abc123', status: 'completed', failure_stage: null, created_at: new Date().toISOString() },
            { id: '2', session_id: 's_xyz789', status: 'tech_error', failure_stage: 'ai_generation', created_at: new Date(Date.now() - 3600000).toISOString() },
            { id: '3', session_id: 's_def456', status: 'user_reported_error', failure_stage: 'capture', created_at: new Date(Date.now() - 7200000).toISOString() }
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
        }
      } catch (err) {
        setError("Erro ao conectar com a API local (O Backend está rodando?)");
        setLoading(false);
      }
    };
    
    fetchData();
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
        
        {isMock && (
          <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg flex items-start gap-3">
            <AlertTriangle className="text-orange-500 shrink-0 mt-0.5" size={20} />
            <div>
              <h3 className="font-medium text-orange-800 dark:text-orange-300">Modo de Demonstração (Sem Autenticação)</h3>
              <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
                A API exigiu um Token de Acesso (Supabase JWT). Como você está acessando a interface isoladamente no navegador, os dados abaixo são fictícios.
                Para ver dados reais da sua Organização, rode a aplicação inserida na Extensão ou salve o <code>dev_token</code> no LocalStorage.
              </p>
            </div>
          </div>
        )}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Gráfico de Uso por Instrutor (Camada 1.2) */}
        <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold">Uso por Instrutor</h2>
          </div>
          <div className="p-6 flex-1 min-h-[300px]">
            {loading ? (
              <div className="h-full flex items-center justify-center text-slate-500">Carregando gráfico...</div>
            ) : metrics.runs_by_instructor && metrics.runs_by_instructor.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.runs_by_instructor} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="instructor_id" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    cursor={{ fill: '#f1f5f9' }} 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                  <Bar dataKey="total_runs" name="Total Tentativas" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed_runs" name="Sucesso (SCORM)" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400">Nenhum dado disponível</div>
            )}
          </div>
        </div>

        {/* Trilha de Publicação (Camada 3.3) */}
        <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
            <h2 className="text-lg font-semibold">Trilha de Publicações</h2>
            <Download size={18} className="text-slate-400" />
          </div>
          
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-surface-900/50">
                  <th className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 font-medium">Sessão</th>
                  <th className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 font-medium">Destino</th>
                  <th className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 font-medium">Exportado Por</th>
                  <th className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="4" className="px-6 py-8 text-center text-slate-500">Carregando publicações...</td></tr>
                ) : publications.length === 0 ? (
                  <tr><td colSpan="4" className="px-6 py-8 text-center text-slate-500">Nenhum módulo publicado ainda.</td></tr>
                ) : (
                  publications.map((pub) => (
                    <tr key={pub.id} className="hover:bg-slate-50 dark:hover:bg-surface-900/50 transition-colors">
                      <td className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 font-mono text-sm">{pub.session_id.substring(0, 8)}...</td>
                      <td className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                        <span className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
                          {pub.destination}
                        </span>
                      </td>
                      <td className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 text-sm">{pub.published_by.substring(0, 10)}</td>
                      <td className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 text-slate-500 text-sm">
                        {new Date(pub.published_at).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
