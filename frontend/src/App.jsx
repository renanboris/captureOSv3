import { HashRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import AdminPanel from './pages/AdminPanel';
import Layout from './components/Layout';
import { ThemeVariantProvider } from './context/ThemeVariantContext';

function App() {
  return (
    <ThemeVariantProvider>
      <HashRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/admin" element={<AdminPanel />} />
          </Routes>
        </Layout>
      </HashRouter>
    </ThemeVariantProvider>
  );
}

export default App;
