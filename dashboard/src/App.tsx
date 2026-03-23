import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Clients from './pages/Clients';
import Logs from './pages/Logs';
import Config from './pages/Config';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/config" element={<Config />} />
      </Routes>
    </Layout>
  );
}
