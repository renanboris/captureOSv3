export default function FilterPills({ options, selected, onChange }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {options.map((opt) => {
        const isSelected = selected === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              isSelected
                ? 'bg-brand-500 text-white shadow-sm'
                : 'bg-surface-100 dark:bg-surface-800 text-slate-600 dark:text-slate-300 hover:bg-surface-200 dark:hover:bg-surface-700'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
