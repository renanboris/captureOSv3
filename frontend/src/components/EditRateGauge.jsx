export default function EditRateGauge({ rate }) {
  // Define the semantic message and color based on the rate (0 to 100)
  let statusColor = "text-status-ok";
  let strokeColor = "var(--color-status-ok)";
  let message = "A IA está acertando na primeira tentativa.";

  if (rate > 50) {
    statusColor = "text-status-error";
    strokeColor = "var(--color-status-error)";
    message = "Alto volume de reescrita — revisar prompts.";
  } else if (rate > 20) {
    statusColor = "text-status-warn";
    strokeColor = "var(--color-status-warn)";
    message = "Os instrutores fazem ajustes pontuais.";
  }

  // Calculate SVG arc for gauge
  const radius = 40;
  const circumference = Math.PI * radius; // Half circle
  const strokeDashoffset = circumference - (rate / 100) * circumference;

  return (
    <div className="flex flex-col h-full bg-surface-100 p-space-lg rounded-md shadow-sombra-200 border border-surface-150 hover:shadow-sombra-400 transition-base font-sans">
      <h3 className="text-caption uppercase tracking-widest text-surface-700 mb-space-md font-semibold">
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
              strokeWidth="5"
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
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute bottom-0 text-center w-full transform translate-y-2">
            <span className={`text-display-md font-bold tracking-tight ${statusColor}`}>
              {rate}%
            </span>
          </div>
        </div>
        
        <p className="text-center text-caption text-surface-700 mt-space-md leading-relaxed max-w-[160px]">
          {message}
        </p>
      </div>
    </div>
  );
}
