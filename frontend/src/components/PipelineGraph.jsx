import { useState } from 'react';
import { Activity, Database, Cpu, Volume2, Film, FileArchive, Terminal } from 'lucide-react';

export default function PipelineGraph() {
  const [hoveredNode, setHoveredNode] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');

  const nodes = [
    {
      id: 'radar',
      label: 'DOM Radar V3',
      x: 100,
      y: 150,
      category: 'dom',
      floatClass: 'animate-float-node-1',
      icon: Terminal,
      color: '#12f7d1', // Verde Neon
      details: {
        title: 'Radar V3 Engine',
        desc: 'Captura semântica do DOM em tempo real e geometria de clicks (Set-of-Marks).',
        status: 'Online',
        latency: '45ms',
        throughput: '1.2 Mbps'
      }
    },
    {
      id: 'fastapi',
      label: 'FastAPI Core',
      x: 300,
      y: 150,
      category: 'core',
      floatClass: 'animate-float-node-2',
      icon: Cpu,
      color: '#ffffff',
      details: {
        title: 'Orquestrador Central',
        desc: 'Gateway de APIs, controle de timeline (Time Bender) e árbitro de eventos.',
        status: 'Online',
        latency: '8ms',
        throughput: '15 reqs/s'
      }
    },
    {
      id: 'pinecone',
      label: 'Pinecone RAG',
      x: 200,
      y: 60,
      category: 'ai',
      floatClass: 'animate-float-node-3',
      icon: Database,
      color: '#844ec3', // Roxo
      details: {
        title: 'Pinecone Vector DB',
        desc: 'Recuperação semântica e injeção RAG de manuais e apostilas da marca.',
        status: 'Online',
        latency: '95ms',
        throughput: '4.8k vetores'
      }
    },
    {
      id: 'gemini',
      label: 'Gemini 2.5 Flash',
      x: 400,
      y: 60,
      category: 'ai',
      floatClass: 'animate-float-node-1',
      icon: Activity,
      color: '#ef8833', // Laranja
      details: {
        title: 'Gemini AI Engine',
        desc: 'Redação de timelines de vídeo, roteiro de áudio e fallback para árbitro subjetivo.',
        status: 'Online',
        latency: '840ms',
        throughput: '140 tokens/s'
      }
    },
    {
      id: 'aura',
      label: 'Aura AI (TTS)',
      x: 200,
      y: 240,
      category: 'ai',
      floatClass: 'animate-float-node-2',
      icon: Volume2,
      color: '#8ea0c5',
      details: {
        title: 'Aura TTS Engine',
        desc: 'Geração de síntese de voz realista (Text-to-Speech) para narração dos passos.',
        status: 'Online',
        latency: '340ms',
        throughput: '24kHz áudio'
      }
    },
    {
      id: 'ffmpeg',
      label: 'FFmpeg Renderer',
      x: 400,
      y: 240,
      category: 'core',
      floatClass: 'animate-float-node-3',
      icon: Film,
      color: '#ff0069', // Pink
      details: {
        title: 'FFmpeg Video Render',
        desc: 'Sintetizador e montador de frames, sincronizando vídeo e áudio.',
        status: 'Idle',
        latency: '4.2s / run',
        throughput: '1080p 60fps'
      }
    },
    {
      id: 'scorm',
      label: 'SCORM 1.2 Export',
      x: 500,
      y: 150,
      category: 'core',
      floatClass: 'animate-float-node-1',
      icon: FileArchive,
      color: '#00af9c',
      details: {
        title: 'SCORM Packager',
        desc: 'Geração nativa de módulos ZIP SCORM 1.2 com HUD do Sandbox e simulações.',
        status: 'Online',
        latency: '1.5s / build',
        throughput: '100% offline'
      }
    }
  ];

  const connections = [
    { from: 'radar', to: 'fastapi', color: '#12f7d1' },
    { from: 'fastapi', to: 'pinecone', color: '#844ec3' },
    { from: 'pinecone', to: 'fastapi', color: '#844ec3' },
    { from: 'fastapi', to: 'gemini', color: '#ef8833' },
    { from: 'gemini', to: 'fastapi', color: '#ef8833' },
    { from: 'fastapi', to: 'aura', color: '#8ea0c5' },
    { from: 'fastapi', to: 'ffmpeg', color: '#ff0069' },
    { from: 'ffmpeg', to: 'scorm', color: '#00af9c' }
  ];

  const isNodeVisible = (node) => {
    if (activeFilter === 'all') return true;
    return node.category === activeFilter;
  };

  const isConnectionVisible = (c) => {
    if (activeFilter === 'all') return true;
    const fromNode = nodes.find(n => n.id === c.from);
    const toNode = nodes.find(n => n.id === c.to);
    return fromNode?.category === activeFilter && toNode?.category === activeFilter;
  };

  const getNodeCoords = (id) => {
    const node = nodes.find(n => n.id === id);
    return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
  };

  const getPathData = (fromId, toId) => {
    const from = getNodeCoords(fromId);
    const to = getNodeCoords(toId);
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  };

  return (
    <div className="bg-zinc-950/40 dark:bg-zinc-950/80 border border-zinc-900 rounded-md p-space-lg mb-space-lg relative overflow-hidden shadow-sombra-elevation-8 transition-base font-sans">
      
      {/* Background Dots Pattern */}
      <div className="absolute inset-0 pointer-events-none opacity-25">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="dot-grid" width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="0.75" fill="rgba(255, 255, 255, 0.4)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dot-grid)" />
        </svg>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md mb-space-lg relative z-10">
        <div>
          <h3 className="text-caption font-semibold uppercase tracking-wider text-zinc-400">
            Pipeline Architecture Graph
          </h3>
          <p className="text-xs text-zinc-550 mt-0.5">
            Orquestração do pipeline em rede semântica (Estilo Obsidian). Passe o mouse nos nós e filtre categorias.
          </p>
        </div>

        {/* Filter controls inside Graph (Obsidian-Style) */}
        <div className="flex gap-1.5 bg-zinc-900/50 p-1 rounded-md border border-zinc-800/80 text-[10px] font-semibold text-zinc-400 relative z-20">
          {['all', 'dom', 'ai', 'core'].map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveFilter(cat)}
              className={`px-2.5 py-1 rounded transition-base cursor-pointer uppercase tracking-wider ${activeFilter === cat ? 'bg-zinc-800 text-white shadow-sombra-100' : 'hover:text-white'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-space-lg items-center relative z-10">
        {/* SVG Graph area */}
        <div className="lg:col-span-3 flex justify-center relative bg-zinc-950/20 rounded-md border border-zinc-900/40 p-4">
          <svg className="w-full max-w-[600px] h-[300px] select-none" viewBox="0 0 600 300">
            
            {/* Glowing SVG filter */}
            <defs>
              <filter id="glow-neon" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Draw connection lines */}
            {connections.map((c, i) => {
              const pathStr = getPathData(c.from, c.to);
              const isHovered = hoveredNode === c.from || hoveredNode === c.to;
              const isFilterActive = isConnectionVisible(c);
              
              return (
                <g key={i} opacity={isFilterActive ? 1 : 0.05} className="transition-all duration-300">
                  <path
                    d={pathStr}
                    fill="none"
                    stroke={isHovered ? c.color : '#1f1f2e'}
                    strokeWidth={isHovered ? '2' : '1'}
                    filter={isHovered ? 'url(#glow-neon)' : 'none'}
                    className="transition-all duration-300"
                    opacity={hoveredNode ? (isHovered ? 0.9 : 0.15) : 0.4}
                  />
                  {/* Moving particle along path */}
                  <circle r={isHovered ? 3.5 : 2} fill={c.color} opacity={hoveredNode ? (isHovered ? 1 : 0.1) : 0.7}>
                    <animateMotion
                      dur={c.from === 'radar' || c.to === 'scorm' ? '1.8s' : '3s'}
                      repeatCount="indefinite"
                      path={pathStr}
                    />
                  </circle>
                </g>
              );
            })}

            {/* Draw nodes */}
            {nodes.map((n) => {
              const isHovered = hoveredNode === n.id;
              const isAnyHovered = hoveredNode !== null;
              const isFilterActive = isNodeVisible(n);
              
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x}, ${n.y})`}
                  className={`cursor-pointer ${n.floatClass}`}
                  onMouseEnter={() => setHoveredNode(n.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  opacity={isFilterActive ? 1 : 0.15}
                >
                  {/* Outer glowing aura */}
                  <circle
                    r="24"
                    fill={n.color}
                    opacity={isHovered ? 0.15 : 0}
                    className="transition-all duration-300 animate-pulse"
                  />
                  {/* Node Background */}
                  <circle
                    r="18"
                    fill="#09090b"
                    stroke={isHovered ? n.color : '#27272a'}
                    strokeWidth="1.5"
                    filter={isHovered ? 'url(#glow-neon)' : 'none'}
                    className="transition-all duration-300 shadow-sombra-100"
                    opacity={isAnyHovered ? (isHovered ? 1 : 0.4) : 1}
                  />
                  {/* Icon */}
                  <g opacity={isAnyHovered ? (isHovered ? 1 : 0.4) : 0.8}>
                    <n.icon
                      size={16}
                      x={-8}
                      y={-8}
                      className="transition-all duration-300"
                      style={{ color: n.color }}
                    />
                  </g>
                  {/* Label */}
                  <text
                    y="32"
                    textAnchor="middle"
                    className="text-[9px] font-semibold tracking-wider uppercase transition-all duration-300 font-mono"
                    fill={isHovered ? n.color : '#a1a1aa'}
                    opacity={isAnyHovered ? (isHovered ? 1 : 0.3) : 0.85}
                  >
                    {n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Node detail panel */}
        <div className="lg:col-span-1 h-full flex flex-col justify-center">
          {hoveredNode ? (() => {
            const activeNode = nodes.find(n => n.id === hoveredNode);
            return (
              <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-space-md shadow-sombra-400 backdrop-blur-md transition-all duration-300">
                <div className="flex items-center gap-space-xs mb-space-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-status-ok animate-pulse" style={{ backgroundColor: activeNode.color }}></div>
                  <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: activeNode.color }}>
                    {activeNode.details.status}
                  </span>
                </div>
                <h4 className="text-body font-bold text-white tracking-tight">
                  {activeNode.details.title}
                </h4>
                <p className="text-xs text-zinc-400 mt-space-sm leading-relaxed">
                  {activeNode.details.desc}
                </p>
                <div className="border-t border-zinc-800/85 pt-space-sm mt-space-md grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-zinc-550 uppercase font-semibold">Latência</span>
                    <p className="text-white font-mono font-medium mt-0.5">{activeNode.details.latency}</p>
                  </div>
                  <div>
                    <span className="text-zinc-550 uppercase font-semibold">Vazão</span>
                    <p className="text-white font-mono font-medium mt-0.5">{activeNode.details.throughput}</p>
                  </div>
                </div>
              </div>
            );
          })() : (
            <div className="bg-zinc-950/20 border border-zinc-900/45 rounded-md p-space-md text-center py-10 transition-all duration-300">
              <Activity size={24} className="text-zinc-700 mx-auto animate-pulse mb-space-sm" />
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Sistema Operando
              </span>
              <p className="text-[10px] text-zinc-550 mt-1 leading-relaxed">
                Passe o cursor sobre os nós da topologia e filtre as categorias acima para visualizar as métricas operacionais em tempo real.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
