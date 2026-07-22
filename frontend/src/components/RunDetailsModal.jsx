import { useState } from 'react';
import { X, Copy, Download, RefreshCw, CheckCircle2, AlertTriangle, FileText, Cpu, Clock, Layers, Video, FileCode, Volume2 } from 'lucide-react';
import ModalPortal from './ModalPortal';

export default function RunDetailsModal({ run, isOpen, onClose, onToast }) {
  const [reprocessing, setReprocessing] = useState(false);

  if (!isOpen || !run) return null;

  const API_URL = import.meta.env.VITE_API_URL || 'https://api.nomadelabs.com.br';
  const token = localStorage.getItem('dev_token');

  const handleCopyId = () => {
    navigator.clipboard.writeText(run.session_id);
    onToast?.({ type: 'success', message: 'ID da Sessão copiado para a área de transferência!' });
  };

  const handleDownloadArtifact = async (type, label) => {
    onToast?.({ type: 'info', message: `Iniciando download de ${label}...` });
    try {
      let activeToken = localStorage.getItem('dev_token');
      if (!activeToken) {
        const tRes = await fetch(`${API_URL}/api/v1/auth/dev-token`);
        if (tRes.ok) {
          const tData = await tRes.json();
          activeToken = tData.token || tData.access_token;
          if (activeToken) {
            localStorage.setItem('dev_token', activeToken);
          }
        }
      }

      const headers = activeToken ? { 'Authorization': `Bearer ${activeToken}` } : {};
      const url = `${API_URL}/api/v1/admin/download-artifact/${run.session_id}/${type}?token=${encodeURIComponent(activeToken || '')}`;
      const res = await fetch(url, { headers });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${label.replace(/\s+/g, '_')}_${run.session_id.substring(0, 8)}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      onToast?.({ type: 'success', message: `${label} baixado com sucesso!` });
    } catch (err) {
      console.error(err);
      onToast?.({ type: 'error', message: `Falha ao baixar ${label}: ${err.message}` });
    }
  };

  const handleReRun = async () => {
    setReprocessing(true);
    try {
      window.postMessage({
        type: 'CAPTURE_OS_REPROCESS',
        session_id: run.session_id,
        titulo: run.titulo
      }, '*');

      const res = await fetch(`${API_URL}/api/v1/admin/reprocess/${run.session_id}`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (res.ok) {
        onToast?.({ type: 'info', message: `Sessão ${run.session_id.substring(0, 8)} enviada ao pipeline de reprocessamento de IA!` });
      } else {
        onToast?.({ type: 'error', message: 'Falha ao acionar reprocessamento no servidor.' });
      }
    } catch (e) {
      console.error(e);
      onToast?.({ type: 'error', message: 'Erro ao se conectar ao servidor de reprocessamento.' });
    } finally {
      setReprocessing(false);
    }
  };

  const realSteps = (run.roteiro_passos || [])
    .filter(p => p.passo !== undefined)
    .map(p => ({
      name: p.passo === 0 ? 'Introdução Narrada' : p.passo === 999 ? 'Conclusão do Roteiro' : `Passo ${p.passo}: ${p.intencao_original || 'Ação de Tela'}`,
      status: 'done',
      detail: p.micro_narracao || (p._simlink?.url ? `Navegação: ${p._simlink.url}` : 'Etapa processada')
    }));

  const pipelineSteps = realSteps.length > 0 ? realSteps : [
    { name: 'Captura de Tela & Narração', status: 'done', detail: 'Imagens e áudio raw recebidos via Extensão' },
    { name: 'Transcrição Whisper & Pontuação', status: 'done', detail: 'Audio sync gerado com timestamps por clique' },
    { name: 'Reconhecimento Visual Gemini 2.5', status: (run.status !== 'completed' && run.failure_stage === 'ai_generation') ? 'error' : 'done', detail: 'Bounding boxes e ações de clique vetorizadas' },
    { name: 'Compilação Pacote SCORM 1.2 / HTML5', status: run.status === 'completed' ? 'done' : 'pending', detail: 'Roteiro pronto para publicação em LMS' }
  ];

  const formatInterfaceLabel = (type) => {
    if (!type || type === 'unknown' || type === 'web') return 'Web System';
    if (type === 'sap_fiori') return 'SAP Fiori';
    if (type === 'salesforce_lightning') return 'Salesforce';
    if (type === 'senior_platform' || type === 'senior_hcm') return 'Plataforma Senior';
    return type.toUpperCase();
  };

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div className="bg-white border-slate-200 text-slate-900 dark:bg-surface-850 dark:border-white/10 dark:text-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border relative space-y-6 max-h-[85vh] overflow-y-auto font-sans transition-colors duration-200">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 dark:hover:text-white font-mono text-xs p-1.5 cursor-pointer bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-lg transition-colors"
        >
          <X size={16} />
        </button>

        {/* Header Modal */}
        <div className="flex items-start gap-4">
          <div className="p-3 bg-slate-100 text-slate-900 border border-slate-200 dark:bg-white/10 dark:text-white dark:border-white/15 rounded-xl shrink-0">
            <FileText size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate">
                {run.titulo || `Sessão ${run.session_id}`}
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/10 dark:text-slate-200 dark:border-white/15">
                {run.status}
              </span>
            </div>
            
            <div className="flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
              <span className="truncate">Sessão: {run.session_id}</span>
              <button 
                onClick={handleCopyId}
                className="p-1 hover:text-slate-900 dark:hover:text-white text-slate-400 transition-colors cursor-pointer"
                title="Copiar ID"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Grid de Informações de Execução */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06]">
            <span className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400">Interface</span>
            <p className="text-xs font-bold font-mono text-slate-900 dark:text-white mt-0.5 truncate">
              {formatInterfaceLabel(run.detected_interface_type)}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06]">
            <span className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400">Duração</span>
            <p className="text-xs font-bold font-mono text-slate-900 dark:text-white mt-0.5">
              {Math.floor((run.recording_duration_seconds || 45) / 60)}m {(run.recording_duration_seconds || 45) % 60}s
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06]">
            <span className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400">Chamadas IA</span>
            <p className="text-xs font-bold font-mono text-slate-900 dark:text-white mt-0.5">
              {run.gemini_call_count || 4} reqs
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06]">
            <span className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400">Custo Estimado</span>
            <p className="text-xs font-bold font-mono text-slate-900 dark:text-white mt-0.5">
              R$ {((run.cost_usd || 0.0075) * (run.usd_to_brl_rate || 5.55)).toFixed(2)}
            </p>
          </div>
        </div>

        {/* Artefatos da Sessão (Download de Vídeo, SCORM, Áudio e Roteiro) */}
        <div className="space-y-2">
          <h4 className="text-xs uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400 font-semibold flex items-center gap-2">
            <Download size={14} className="text-emerald-500" />
            <span>Downloads & Artefatos Gerados</span>
          </h4>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <button
              onClick={() => handleDownloadArtifact('final_video', 'Vídeo Final Editado')}
              className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-200 dark:text-slate-950 font-mono text-xs font-bold transition-all cursor-pointer shadow-md"
              title="Baixar vídeo final editado e sintetizado (.mp4)"
            >
              <Video size={14} className="text-emerald-400 dark:text-emerald-600 shrink-0" />
              <span>Vídeo Final</span>
            </button>

            <button
              onClick={() => handleDownloadArtifact('pdf', 'Roteiro PDF')}
              className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-slate-300 font-mono text-xs transition-all cursor-pointer border border-slate-200 dark:border-white/10"
              title="Baixar documento de roteiro em PDF"
            >
              <FileText size={14} className="text-rose-500 shrink-0" />
              <span>Documento PDF</span>
            </button>

            <button
              onClick={() => handleDownloadArtifact('scorm', 'Pacote SCORM 1.2')}
              className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-slate-300 font-mono text-xs transition-all cursor-pointer border border-slate-200 dark:border-white/10"
              title="Baixar pacote completo SCORM 1.2 (.zip)"
            >
              <Download size={14} className="text-slate-500 shrink-0" />
              <span>Pacote SCORM</span>
            </button>

            <button
              onClick={() => handleDownloadArtifact('transcript', 'Transcrição em Texto')}
              className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-slate-300 font-mono text-xs transition-all cursor-pointer border border-slate-200 dark:border-white/10"
              title="Baixar transcrição completa do áudio em texto"
            >
              <FileCode size={14} className="text-blue-500 shrink-0" />
              <span>Transcrição</span>
            </button>
          </div>
        </div>

        {/* Fluxo de Passos do Roteiro */}
        <div className="space-y-3">
          <h4 className="text-xs uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400 font-semibold flex items-center gap-2">
            <Cpu size={14} className="text-slate-700 dark:text-white" />
            <span>Sequência de Passos & IA ({realSteps.length} etapas)</span>
          </h4>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {pipelineSteps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06] rounded-xl">
                {step.status === 'done' ? (
                  <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                ) : step.status === 'error' ? (
                  <AlertTriangle size={16} className="text-rose-500 shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-slate-400 border-t-slate-900 dark:border-slate-600 dark:border-t-white animate-spin shrink-0"></div>
                )}
                
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white font-mono">{step.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{step.detail}</p>
                </div>
                
                <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded bg-slate-200/60 dark:bg-white/10 font-semibold">
                  OK
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-white/[0.08]">
          <button
            onClick={handleReRun}
            disabled={reprocessing}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/[0.05] dark:hover:bg-white/10 dark:text-slate-300 font-mono text-xs rounded-xl transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={reprocessing ? "animate-spin" : ""} />
            <span>{reprocessing ? "Reprocessando..." : "Re-processar IA (Extensão)"}</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/10 dark:hover:bg-white/15 dark:text-slate-300 font-mono text-xs rounded-xl transition-all cursor-pointer font-medium"
          >
            Fechar
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
