export default function EditRateGauge({ rate }) {
  // Define the semantic message and color based on the rate (0 to 100)
  let statusColor = "text-status-ok";
  let strokeColor = "#22c55e"; // brand-500
  let message = "A IA está acertando na primeira tentativa.";

  if (rate > 50) {
    statusColor = "text-status-error";
    strokeColor = "#ef4444";
    message = "Alto volume de reescrita — revisar prompts.";
  } else if (rate > 20) {
    statusColor = "text-status-warn";
    strokeColor = "#f59e0b";
    message = "Os instrutores fazem ajustes pontuais.";
  }

  // Calculate SVG arc for gauge
  const radius = 40;
  const circumference = Math.PI * radius; // Half circle
  const strokeDashoffset = circumference - (rate / 100) * circumference;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700">
      <h3 className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-4">
        Qualidade da IA
      </h3>
      
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="relative flex justify-center items-end" style={{ width: 100, height: 50 }}>
          {/* Background Arc */}
          <svg className="absolute top-0 left-0" width="100" height="50" viewBox="0 0 100 50">
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke="currentColor"
              strokeWidth="10"
              className="text-surface-200 dark:text-surface-700"
              strokeLinecap="round"
            />
          </svg>
          {/* Foreground Arc */}
          <svg className="absolute top-0 left-0" width="100" height="50" viewBox="0 0 100 50">
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke={strokeColor}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute bottom-0 text-center w-full transform translate-y-2">
            <span className={`font-mono text-xl font-bold ${statusColor}`}>
              {rate}%
            </span>
          </div>
        </div>
        
        <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-6 leading-relaxed max-w-[150px]">
          {message}
        </p>
      </div>
    </div>
  );
}
