import { Activity, Settings, Video, Users, FileBarChart } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-900 text-slate-900 dark:text-slate-100 p-8">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-brand-500 to-indigo-500 bg-clip-text text-transparent">
            Capture OS
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Bem-vindo de volta ao seu Workspace</p>
        </div>
        <div className="flex gap-4">
          <Link to="/admin" className="flex items-center gap-2 px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition-colors shadow-sm">
            <Settings size={20} />
            <span>Painel do Gestor</span>
          </Link>
          <button className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition-colors shadow-sm">
            <Video size={20} />
            <span>Novo Roteiro</span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded-lg">
              <FileBarChart size={24} />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Total de Roteiros</p>
              <p className="text-2xl font-bold">12</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg">
              <Activity size={24} />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Taxa de Sucesso</p>
              <p className="text-2xl font-bold">98%</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-surface-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg">
              <Users size={24} />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Membros</p>
              <p className="text-2xl font-bold">4</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold">Roteiros Recentes</h2>
        </div>
        <div className="p-6 text-center text-slate-500 dark:text-slate-400 py-12">
          Nenhum roteiro encontrado neste workspace.
        </div>
      </div>
    </div>
  );
}
