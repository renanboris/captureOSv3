import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Maximize2, Minimize2, X, GraduationCap } from 'lucide-react';
import Draggable from 'react-draggable';

const FloatingVideoTutorial = ({ title = "Tutorial", isActive = true, videoUrl, onClose }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState('0:00');
  const [duration, setDuration] = useState('0:00');
  const videoRef = useRef(null);
  const dragRef = useRef(null); // Ref for react-draggable

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds)) return "0:00";
    const m = Math.floor(timeInSeconds / 60);
    const s = Math.floor(timeInSeconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const current = videoRef.current.currentTime;
      const dur = videoRef.current.duration;
      setCurrentTime(formatTime(current));
      setProgress((current / dur) * 100);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(formatTime(videoRef.current.duration));
    }
  };

  // Using a highly reliable sample video URL
  const finalVideoUrl = videoUrl || "https://www.w3schools.com/html/mov_bbb.mp4";

  if (!isActive) return null;

  if (isMinimized) {
    return (
      <Draggable nodeRef={dragRef}>
        <div 
          ref={dragRef}
          className="fixed bottom-6 right-6 bg-[#1C2025] border border-gray-700/50 rounded-full p-3 shadow-2xl cursor-move hover:bg-gray-800 transition-colors z-50"
          onDoubleClick={() => setIsMinimized(false)}
          title="Arrastar ou clique duplo para expandir"
        >
          <GraduationCap className="w-6 h-6 text-emerald-500 pointer-events-none" />
        </div>
      </Draggable>
    );
  }

  return (
    <Draggable handle=".drag-handle" nodeRef={dragRef}>
      <div ref={dragRef} className="fixed bottom-6 right-6 w-80 bg-[#1C2025] rounded-xl shadow-2xl overflow-hidden border border-gray-700/50 font-sans z-50">
        {/* Header */}
        <div className="drag-handle flex justify-between items-center px-4 py-3 border-b border-gray-700/50 bg-gray-900/50 cursor-move">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-emerald-500" />
          <span className="text-white text-sm font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsMinimized(true)} className="text-gray-400 hover:text-white transition-colors">
            <Minimize2 className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Video Area */}
      <div className="relative aspect-video bg-gray-950 flex items-center justify-center group overflow-hidden">
        
        <video 
          ref={videoRef}
          src={finalVideoUrl}
          className="w-full h-full object-cover"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onClick={togglePlay}
          onEnded={() => setIsPlaying(false)}
        />

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
        
        {/* Play Controls overlay */}
        <button 
          onClick={togglePlay}
          className="absolute inset-0 w-full h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/10"
        >
          <div className="w-12 h-12 rounded-full bg-emerald-500/90 flex items-center justify-center text-white shadow-lg backdrop-blur-sm hover:scale-110 transition-transform">
            {isPlaying ? <Pause className="w-5 h-5" fill="currentColor" /> : <Play className="w-5 h-5 ml-1" fill="currentColor" />}
          </div>
        </button>

        {/* Timeline */}
        <div className="absolute bottom-3 left-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="text-[10px] font-medium text-white/90">{currentTime}</div>
          <div className="flex-1 h-1.5 bg-gray-700/80 rounded-full overflow-hidden cursor-pointer" onClick={(e) => {
            // Simple seek logic for demo
            if(videoRef.current && isFinite(videoRef.current.duration) && videoRef.current.duration > 0) {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickPos = (e.clientX - rect.left) / rect.width;
              videoRef.current.currentTime = clickPos * videoRef.current.duration;
            }
          }}>
            <div className="h-full bg-emerald-500 transition-all duration-75" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-[10px] font-medium text-white/90">{duration}</div>
        </div>
      </div>
      
      {/* Captions/Subtitle */}
      <div className="p-3 bg-[#181a1f] text-center text-sm text-gray-300 min-h-[60px] flex items-center justify-center border-t border-gray-800">
        "Para começar, clique no botão azul 'Criar Fatura' no topo da tela."
      </div>
    </div>
    </Draggable>
  );
};

export default FloatingVideoTutorial;
