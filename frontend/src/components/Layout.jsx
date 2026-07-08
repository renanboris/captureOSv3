import Sidebar from './Sidebar';

export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen bg-surface-50 dark:bg-surface-900">
      <Sidebar />
      <main className="flex-1 ml-60 bg-surface-50 dark:bg-surface-900">
        {children}
      </main>
    </div>
  );
}
