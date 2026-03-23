import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { Activity, Users, Globe, AlertTriangle, Clock } from 'lucide-react';
import type { SyncResult, Client } from '../types';
import { getMetricsHistory, getClients } from '../api';
import StatCard from '../components/StatCard';
import { formatTime } from '../utils';

const DEVICE_COLORS: Record<string, string> = {
  device_pc: '#3b82f6',
  device_laptop: '#6366f1',
  device_phone: '#a855f7',
  device_tablet: '#8b5cf6',
  device_nas: '#06b6d4',
  device_tv: '#ec4899',
  device_camera: '#f97316',
  device_printer: '#14b8a6',
  device_gameconsole: '#f43f5e',
  device_audio: '#f59e0b',
  device_securityalarm: '#eab308',
  device_other: '#6b7280',
};

const OS_COLORS: Record<string, string> = {
  os_linux: '#f97316',
  os_windows: '#3b82f6',
  os_android: '#22c55e',
  os_ios: '#94a3b8',
  os_macos: '#64748b',
  os_other: '#6b7280',
};

function CardWrapper({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">{title}</h3>
      {children}
    </div>
  );
}

export default function Metrics() {
  const [history, setHistory] = useState<SyncResult[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [h, c] = await Promise.all([getMetricsHistory(), getClients()]);
      setHistory(h);
      setClients(c);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const recent = history.slice(-20);

  const durationData = recent.map((r) => ({
    time: formatTime(r.timestamp),
    ms: r.duration_ms,
  }));

  const activityData = recent.map((r) => ({
    time: formatTime(r.timestamp),
    Added: r.clients_added,
    Updated: r.clients_updated,
    Skipped: r.clients_skipped,
    Removed: r.clients_removed,
    Errors: r.errors,
  }));

  const deviceDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of clients) {
      const tag = c.tags.find((t) => t.startsWith('device_')) ?? 'device_other';
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [clients]);

  const osDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of clients) {
      const tag = c.tags.find((t) => t.startsWith('os_'));
      if (tag) counts[tag] = (counts[tag] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [clients]);

  const totalErrors = history.reduce((s, r) => s + r.errors, 0);
  const avgDuration =
    history.length > 0
      ? Math.round(history.reduce((s, r) => s + r.duration_ms, 0) / history.length)
      : 0;

  const tooltipStyle = {
    backgroundColor: 'var(--tooltip-bg, #1f2937)',
    border: '1px solid #374151',
    borderRadius: '8px',
    color: '#f9fafb',
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Metrics</h1>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          title="Total Syncs"
          value={history.length}
          icon={<Activity className="h-5 w-5" />}
          color="blue"
        />
        <StatCard
          title="Total Clients"
          value={clients.length}
          icon={<Users className="h-5 w-5" />}
          color="purple"
        />
        <StatCard
          title="Total Rewrites"
          value="—"
          icon={<Globe className="h-5 w-5" />}
          color="green"
        />
        <StatCard
          title="Total Errors"
          value={totalErrors}
          icon={<AlertTriangle className="h-5 w-5" />}
          color={totalErrors > 0 ? 'red' : 'green'}
        />
        <StatCard
          title="Avg Duration"
          value={`${avgDuration}ms`}
          icon={<Clock className="h-5 w-5" />}
          color="yellow"
        />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sync Duration */}
        <CardWrapper title="Sync Duration (ms)">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={durationData}>
              <defs>
                <linearGradient id="durationGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area
                type="monotone"
                dataKey="ms"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#durationGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardWrapper>

        {/* Sync Activity */}
        <CardWrapper title="Sync Activity">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={activityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(v) => <span style={{ color: '#9ca3af' }}>{v}</span>}
              />
              <Bar dataKey="Added" fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={20} />
              <Bar dataKey="Updated" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={20} />
              <Bar dataKey="Skipped" fill="#6b7280" radius={[2, 2, 0, 0]} maxBarSize={20} />
              <Bar dataKey="Removed" fill="#f97316" radius={[2, 2, 0, 0]} maxBarSize={20} />
              <Bar dataKey="Errors" fill="#ef4444" radius={[2, 2, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </CardWrapper>

        {/* Device Type Distribution */}
        <CardWrapper title="Device Type Distribution">
          {deviceDistribution.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={deviceDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {deviceDistribution.map((entry, index) => (
                      <Cell
                        key={index}
                        fill={DEVICE_COLORS[entry.name] ?? '#6b7280'}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, n) => [v, (n as string).replace('device_', '')]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-2">
                {deviceDistribution.map((entry) => (
                  <span key={entry.name} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: DEVICE_COLORS[entry.name] ?? '#6b7280' }}
                    />
                    {entry.name.replace('device_', '')} ({entry.value})
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400 dark:text-gray-500">
              No client data yet
            </div>
          )}
        </CardWrapper>

        {/* OS Distribution */}
        <CardWrapper title="OS Distribution">
          {osDistribution.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={osDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {osDistribution.map((entry, index) => (
                      <Cell key={index} fill={OS_COLORS[entry.name] ?? '#6b7280'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, n) => [v, (n as string).replace('os_', '')]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-2">
                {osDistribution.map((entry) => (
                  <span key={entry.name} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: OS_COLORS[entry.name] ?? '#6b7280' }}
                    />
                    {entry.name.replace('os_', '')} ({entry.value})
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400 dark:text-gray-500">
              No client data yet
            </div>
          )}
        </CardWrapper>
      </div>
    </div>
  );
}
