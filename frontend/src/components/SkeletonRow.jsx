export default function SkeletonRow({ columns = 4 }) {
  return (
    <tr className="border-b border-surface-200 dark:border-surface-700">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-space-md py-space-sm">
          <div className="h-4 bg-surface-200 dark:bg-surface-700 rounded animate-pulse w-3/4"></div>
        </td>
      ))}
    </tr>
  );
}
