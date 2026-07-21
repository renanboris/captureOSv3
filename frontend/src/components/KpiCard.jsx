import { TrendingUp, Sparkles } from 'lucide-react';

export default function KpiCard({ title, value, status = 'neutral', subtitle, trend }) {
  return (
    <div className="p-5 rounded-2xl bg-white border border-slate-200 dark:bg-surface-850 dark:border-white/[0.08] shadow-sm dark:shadow-xl flex flex-col justify-between relative overflow-hidden card-linear-hover transition-colors duration-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
          {title}
        </span>
        {trend && (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/10 dark:text-slate-300 dark:border-white/15">
            <TrendingUp size={11} />
            {trend}
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between mt-1">
        <p className="font-mono text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          {value}
        </p>
        <Sparkles size={14} className="text-slate-400 dark:text-slate-600 opacity-60" />
      </div>

      {subtitle && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 font-mono border-t border-slate-100 dark:border-white/[0.05] pt-2">
          {subtitle}
        </p>
      )}
    </div>
  );
}
