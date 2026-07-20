import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import CommandPaletteModal from './CommandPaletteModal';
import UserProfileModal from './UserProfileModal';
import Toast from './Toast';

export default function Layout({ children }) {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isUserProfileOpen, setIsUserProfileOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [userEmail, setUserEmail] = useState('boris.renan@gmail.com');

  useEffect(() => {
    const email = localStorage.getItem('user_email') || 'boris.renan@gmail.com';
    setUserEmail(email);

    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(open => !open);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const showToast = (toastObj) => {
    setToast(toastObj);
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-surface-900 dark:text-slate-100 font-sans transition-colors duration-200 selection:bg-slate-200 selection:text-slate-900 dark:selection:bg-white/20 dark:selection:text-white">
      <Sidebar 
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenUserProfile={() => setIsUserProfileOpen(true)}
      />
      
      <main className="flex-1 ml-64 bg-slate-50 dark:bg-surface-900 min-h-screen transition-colors duration-200">
        {children}
      </main>

      <CommandPaletteModal 
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenNewScript={() => {
          window.dispatchEvent(new CustomEvent('open-new-script-modal'));
        }}
        onRefresh={() => {
          window.dispatchEvent(new CustomEvent('trigger-workspace-refresh'));
        }}
        runs={window.cachedDashboardData?.runs || []}
      />

      <UserProfileModal 
        isOpen={isUserProfileOpen}
        onClose={() => setIsUserProfileOpen(false)}
        userEmail={userEmail}
        onToast={showToast}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
