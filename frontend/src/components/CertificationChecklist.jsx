import React, { useState } from 'react';
import { CheckCircle2, Circle, X, Minimize2, ListTodo } from 'lucide-react';

const CertificationChecklist = ({ tasks = [], onClose }) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const completedTasks = tasks.filter(t => t.completed).length;
  const totalTasks = tasks.length;
  const progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  if (isMinimized) {
    return (
      <div 
        className="bg-[#181A1F] text-white rounded-full shadow-2xl border border-[#2D323B] flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-[#20242B] transition-colors"
        onClick={() => setIsMinimized(false)}
        title="Expandir Checklist"
      >
        <ListTodo className="w-4 h-4 text-emerald-500" />
        <div className="flex flex-col gap-1 w-24">
          <div className="flex justify-between items-center text-[10px] font-medium text-[#A9B1BD]">
            <span>Progresso</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-1 bg-[#122A22] rounded-full overflow-hidden">
            <div className="h-full bg-[#1FBB75] rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#181A1F] text-white w-[280px] rounded-[10px] shadow-2xl overflow-hidden font-sans border border-[#2D323B]">
      {/* Header & Progress Bar */}
      <div className="p-4 pb-3 border-b border-[#2D323B] bg-[#1C1F25]/50">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-[13px] tracking-wide text-[#E2E4E9]">Profile Completion</h3>
          <div className="flex items-center gap-3">
            <span className="font-bold text-[13px] text-[#E2E4E9]">{progress}%</span>
            <button onClick={() => setIsMinimized(true)} className="text-gray-500 hover:text-gray-300 transition-colors">
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="w-full h-1.5 bg-[#122A22] rounded-full overflow-hidden">
          <div 
            className="h-full bg-[#1FBB75] rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Task List */}
      <div className="p-4 flex flex-col gap-3">
        {tasks.map((task, index) => (
          <div 
            key={index} 
            className={`flex items-center gap-3 transition-colors duration-300 ${task.completed ? 'text-[#646B75]' : 'text-[#A9B1BD]'}`}
          >
            {task.completed ? (
              <CheckCircle2 className="w-[18px] h-[18px] text-[#1FBB75] shrink-0" fill="currentColor" stroke="#181A1F" strokeWidth={1.5} />
            ) : (
              <Circle className="w-[18px] h-[18px] text-[#555C67] shrink-0" strokeWidth={1.5} />
            )}
            <span className="text-[13px] font-medium tracking-wide">
              {task.label}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 pb-4 pt-2">
        <button 
          onClick={onClose}
          className="w-full py-1.5 border border-[#3A414B] hover:bg-[#252A32] text-[#A9B1BD] hover:text-[#E2E4E9] text-[12px] font-semibold rounded-[6px] transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default CertificationChecklist;
