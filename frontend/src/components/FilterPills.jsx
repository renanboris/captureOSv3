export default function FilterPills({ options, selected, onChange }) {
  return (
    <div className="flex items-center gap-space-sm flex-wrap font-sans">
      {options.map((opt) => {
        const isSelected = selected === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-space-md py-space-xs rounded-full text-caption font-semibold tracking-wide transition-base cursor-pointer ${
              isSelected
                ? 'bg-azul-escuro text-white shadow-sombra-100'
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
