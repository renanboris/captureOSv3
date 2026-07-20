export default function SkeletonRow({ columns = 4 }) {
  return (
    <tr className="border-b border-slate-100 dark:border-white/[0.06]">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <div className="h-4 bg-slate-200 dark:bg-white/[0.06] rounded-md animate-pulse w-3/4"></div>
        </td>
      ))}
    </tr>
  );
}
