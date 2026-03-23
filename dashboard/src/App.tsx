import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Clients from './pages/Clients';
import Logs from './pages/Logs';
import Config from './pages/Config';
import Setup from './pages/Setup';
import { getSetupStatus } from './api';

function AppRoutes() {
  const navigate = useNavigate();
  const location = useLocation();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Only check once; skip if already on /setup
    if (location.pathname === '/setup') {
      setChecked(true);
      return;
    }
    getSetupStatus()
      .then(({ needs_setup }) => {
        if (needs_setup) navigate('/setup', { replace: true });
      })
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!checked && location.pathname !== '/setup') return null;

  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route
        path="/*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/config" element={<Config />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
