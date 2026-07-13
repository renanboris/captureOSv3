import Sidebar from './Sidebar';
import { useThemeVariant } from '../context/ThemeVariantContext';

export default function Layout({ children }) {
  const { variant } = useThemeVariant();

  return (
    <div className={`flex min-h-screen bg-surface-50 dark:bg-surface-900 transition-colors duration-300 ${variant === 'purist' ? 'theme-purist dark' : ''}`}>
      <Sidebar />
      <main className="flex-1 ml-60 bg-surface-50 dark:bg-surface-900 min-h-screen">
        {children}
      </main>
    </div>
  );
}
