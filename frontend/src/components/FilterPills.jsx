export default function FilterPills({ options, selected, onChange }) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] transition-colors duration-200">
      {options.map((opt) => {
        const isSelected = selected === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
              isSelected
                ? 'bg-slate-900 text-white font-semibold shadow-xs dark:bg-white/15 dark:text-white dark:border dark:border-white/20'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-white/[0.04]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
