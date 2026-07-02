import { HashRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import AdminPanel from './pages/AdminPanel';
import SandboxSimulator from './pages/SandboxSimulator';
import Layout from './components/Layout';

function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/sandbox-demo" element={<SandboxSimulator />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}

export default App;
