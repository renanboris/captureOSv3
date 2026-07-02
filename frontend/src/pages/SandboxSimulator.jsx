import React, { useState } from 'react';
import CertificationChecklist from '../components/CertificationChecklist';
import FloatingVideoTutorial from '../components/FloatingVideoTutorial';
import { Plus, Save, FileText, Check } from 'lucide-react';

const INITIAL_TASKS = [
  { id: 't1', label: 'Start Invoice Creation', completed: false },
  { id: 't2', label: 'Fill Client Details', completed: false },
  { id: 't3', label: 'Add 1 Item to Invoice', completed: false },
  { id: 't4', label: 'Save Invoice', completed: false },
];

const SandboxSimulator = () => {
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [showChecklist, setShowChecklist] = useState(true);
  const [showVideo, setShowVideo] = useState(true);

  // Mock Sandbox State
  const [isCreating, setIsCreating] = useState(false);
  const [clientName, setClientName] = useState('');
  const [itemsCount, setItemsCount] = useState(0);
  const [isSaved, setIsSaved] = useState(false);

  // Event Handlers for Sandbox (The "Game Engine")
  const completeTask = (taskId) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed: true } : t));
  };

  const handleStartCreation = () => {
    setIsCreating(true);
    completeTask('t1');
  };

  const handleClientChange = (e) => {
    const val = e.target.value;
    setClientName(val);
    if (val.length > 3) {
      completeTask('t2');
    }
  };

  const handleAddItem = () => {
    setItemsCount(prev => prev + 1);
    completeTask('t3');
  };

  const handleSave = () => {
    if (isCreating && clientName && itemsCount > 0) {
      setIsSaved(true);
      completeTask('t4');
    }
  };

  return (
    <div className="relative min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Fake App Navbar */}
      <header className="bg-white border-b h-16 flex items-center px-6 justify-between shadow-sm">
        <div className="font-bold text-xl text-gray-800 flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white">C</span>
          </div>
          CorpERP
        </div>
        <div className="text-sm font-medium text-amber-600 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
          Sandbox Training Mode Active
        </div>
      </header>

      {/* Main Sandbox Area */}
      <main className="flex-1 p-8 max-w-5xl mx-auto w-full">
        {!isCreating ? (
          <div className="bg-white p-12 text-center rounded-xl border border-dashed border-gray-300">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Invoices</h2>
            <p className="text-gray-500 mb-6">You have no pending invoices.</p>
            <button 
              onClick={handleStartCreation}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2 mx-auto"
            >
              <Plus className="w-5 h-5" />
              Create Invoice
            </button>
          </div>
        ) : (
          <div className="bg-white p-8 rounded-xl border shadow-sm">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">New Invoice</h2>
            
            <div className="space-y-6 max-w-2xl">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client Name</label>
                <input 
                  type="text" 
                  value={clientName}
                  onChange={handleClientChange}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Type client name..."
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">Items</label>
                  <button 
                    onClick={handleAddItem}
                    className="text-sm text-blue-600 font-medium hover:text-blue-700 flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> Add Item
                  </button>
                </div>
                
                {itemsCount === 0 ? (
                  <div className="p-4 border border-dashed rounded-lg text-center text-gray-400 text-sm">
                    No items added yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {Array.from({ length: itemsCount }).map((_, i) => (
                      <div key={i} className="p-3 border rounded-lg flex justify-between bg-gray-50">
                        <span>Consulting Services</span>
                        <span className="font-medium">$500.00</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-4 border-t flex justify-end">
                <button 
                  onClick={handleSave}
                  disabled={isSaved}
                  className={`px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 transition-colors ${
                    isSaved ? 'bg-green-500 text-white cursor-default' : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {isSaved ? <Check className="w-5 h-5" /> : <Save className="w-5 h-5" />}
                  {isSaved ? 'Saved successfully' : 'Save Invoice'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Floating UI Elements */}
      {showChecklist && (
        <div className="fixed top-20 right-6 z-40">
          <CertificationChecklist tasks={tasks} onClose={() => setShowChecklist(false)} />
        </div>
      )}

      {showVideo && (
        <FloatingVideoTutorial 
          title="Module 1: Invoicing" 
          onClose={() => setShowVideo(false)} 
        />
      )}
    </div>
  );
};

export default SandboxSimulator;
