import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  Monitor,
  Globe,
  Ban,
  Network,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Play,
  Square,
  Clock,
} from 'lucide-react';
import type { AppStatus, SyncResult, Client } from '../types';
import {
  getStatus,
  getMetricsHistory,
  getClients,
  getAccess,
  triggerSync,
  stopSync,
  startSync,
} from '../api';
import { formatRelative, formatDateTime } from '../utils';

// ── Constants ──────────────────────────────────────────────────────────────
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

const VLAN_PALETTE = [
  '#3b82f6', '#a855f7', '#22c55e', '#f59e0b',
  '#14b8a6', '#f43f5e', '#6366f1', '#06b6d4', '#f97316', '#94a3b8',
];

const CARD = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm';

const tooltipStyle = { backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' };
const tooltipItemStyle = { color: '#f9fafb' };
const tooltipLabelStyle = { color: '#9ca3af' };

// ── Horizontal mini-bar list ───────────────────────────────────────────────
function DistributionList({
  entries,
  colorMap,
  format,
  sort = true,
}: {
  entries: { name: string; value: number }[];
  colorMap: Record<string, string>;
  format?: (name: string) => string;
  sort?: boolean;
}) {
  const max = Math.max(...entries.map((e) => e.value), 1);
  const rows = sort ? [...entries].sort((a, b) => b.value - a.value) : entries;
  return (
    <div className="space-y-2.5">
      {rows.map(({ name, value }) => (
        <div key={name} className="flex items-center gap-2.5">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: colorMap[name] ?? '#6b7280' }}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 w-20 truncate">
            {format ? format(name) : name}
          </span>
          <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${(value / max) * 100}%`, backgroundColor: colorMap[name] ?? '#6b7280' }}
            />
          </div>
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-5 text-right tabular-nums">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Overview() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [history, setHistory] = useState<SyncResult[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [blockedCount, setBlockedCount] = useState(0);
  const [syncLoading, setSyncLoading] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, h, c, a] = await Promise.all([
        getStatus(), getMetricsHistory(), getClients(), getAccess(),
      ]);
      setStatus(s);
      setHistory(h);
      setClients(c);
      setBlockedCount(a.disallowed?.length ?? 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Sync controls state
  const syncEnabled = status?.sync_enabled ?? true;
  const syncInterval = status?.sync_interval ?? 0;
  const lastSync = status?.last_sync ?? null;

  useEffect(() => {
    if (!syncEnabled || syncInterval === 0 || !lastSync) { setCountdown(null); return; }
    const calc = () => {
      const next = new Date(lastSync.timestamp).getTime() + syncInterval * 1000;
      setCountdown(Math.max(0, Math.round((next - Date.now()) / 1000)));
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [lastSync?.timestamp, syncInterval, syncEnabled]);

  const handleSync = async (action: () => Promise<void>) => {
    setSyncLoading(true);
    try {
      await action();
      setTimeout(() => { refresh(); setSyncLoading(false); }, 500);
    } catch { setSyncLoading(false); }
  };

  // Derived data
  const vlansCount = useMemo(() => new Set(clients.map((c) => c.vlan)).size, [clients]);
  const totalErrors = history.reduce((s, r) => s + r.errors, 0);

  // Client coverage chart: UniFi vs AdGuard over time
  const coverageData = history.slice(-20).map((r) => ({
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    'UniFi': r.unifi_clients,
    'AdGuard': r.adguard_clients,
  }));

  // Device type distribution
  const deviceDist = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of clients) {
      const tag = c.tags.find((t) => t.startsWith('device_')) ?? 'device_other';
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [clients]);

  // Clients per VLAN (sorted by VLAN number)
  const vlanDist = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of clients) {
      const key = c.vlan ? `VLAN ${c.vlan}` : 'No VLAN';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort(([a], [b]) => {
        const na = parseInt(a.replace('VLAN ', '')) || 9999;
        const nb = parseInt(b.replace('VLAN ', '')) || 9999;
        return na - nb;
      })
      .map(([name, value]) => ({ name, value }));
  }, [clients]);

  const vlanColorMap = useMemo(() => {
    const result: Record<string, string> = {};
    vlanDist.forEach(({ name }, i) => { result[name] = VLAN_PALETTE[i % VLAN_PALETTE.length]; });
    return result;
  }, [vlanDist]);

  // Stats bar
  const stats = [
    {
      label: 'Synced Clients',
      value: status?.total_clients ?? '—',
      sub: 'in AdGuard Home',
      icon: <Monitor className="h-4 w-4 text-blue-500" />,
      valueClass: 'text-blue-600 dark:text-blue-400',
    },
    {
      label: 'DNS Rewrites',
      value: status?.total_rewrites ?? '—',
      sub: 'active records',
      icon: <Globe className="h-4 w-4 text-purple-500" />,
      valueClass: 'text-purple-600 dark:text-purple-400',
    },
    {
      label: 'Blocked Devices',
      value: blockedCount,
      sub: blockedCount > 0 ? 'access denied' : 'all allowed',
      icon: <Ban className="h-4 w-4 text-red-500" />,
      valueClass: blockedCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300',
    },
    {
      label: 'Active VLANs',
      value: vlansCount || '—',
      sub: `${clients.length} client${clients.length !== 1 ? 's' : ''} across VLANs`,
      icon: <Network className="h-4 w-4 text-teal-500" />,
      valueClass: 'text-teal-600 dark:text-teal-400',
    },
    {
      label: 'Last Sync',
      value: lastSync ? (lastSync.success ? 'OK' : 'FAILED') : '—',
      sub: lastSync
        ? `${formatRelative(lastSync.timestamp)}${totalErrors > 0 ? ` · ${totalErrors} errors` : ''}`
        : 'No sync yet',
      icon: lastSync?.success === false
        ? <AlertTriangle className="h-4 w-4 text-red-500" />
        : <CheckCircle className="h-4 w-4 text-green-500" />,
      valueClass: lastSync?.success === false
        ? 'text-red-600 dark:text-red-400'
        : 'text-green-600 dark:text-green-400',
    },
  ];

  return (
    <div className="space-y-5">

      {/* Header + inline sync controls */}
      <div className="flex flex-wrap items-center gap-2.5 justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Overview</h1>
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
            syncEnabled
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${syncEnabled ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {syncEnabled ? 'Running' : 'Paused'}
          </span>
          {syncInterval === 0 ? (
            <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1"><Clock className="h-3 w-3" /> Manual only</span>
          ) : !syncEnabled ? (
            <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1"><Clock className="h-3 w-3" /> Paused</span>
          ) : countdown !== null ? (
            <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1 tabular-nums"><Clock className="h-3 w-3" /> Next in {countdown}s</span>
          ) : null}
          <button
            onClick={() => handleSync(triggerSync)}
            disabled={syncLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncLoading ? 'animate-spin' : ''}`} />
            Sync Now
          </button>
          {syncEnabled ? (
            <button onClick={() => handleSync(stopSync)} disabled={syncLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium transition-colors disabled:opacity-50">
              <Square className="h-3.5 w-3.5" /> Stop
            </button>
          ) : (
            <button onClick={() => handleSync(startSync)} disabled={syncLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors disabled:opacity-50">
              <Play className="h-3.5 w-3.5" /> Start
            </button>
          )}
        </div>
      </div>

      {/* Full-width stats bar */}
      <div className={CARD}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y lg:divide-y-0 divide-gray-100 dark:divide-gray-700">
          {stats.map(({ label, value, sub, icon, valueClass }) => (
            <div key={label} className="px-5 py-4">
              <div className="flex items-center gap-1.5 mb-1.5">
                {icon}
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
              </div>
              <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Client coverage chart + device types */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className={`${CARD} p-5 lg:col-span-3`}>
          <div className="mb-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Client Coverage</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              UniFi clients (after VLAN filter) vs AdGuard tracked — gap indicates drift
            </p>
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <AreaChart data={coverageData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="unifiGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="adguardGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a855f7" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} width={24} />
              <Tooltip
                contentStyle={tooltipStyle}
                itemStyle={tooltipItemStyle}
                labelStyle={tooltipLabelStyle}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(v) => <span style={{ color: '#9ca3af' }}>{v}</span>}
              />
              <Area type="monotone" dataKey="UniFi" stroke="#3b82f6" strokeWidth={2} fill="url(#unifiGrad)" dot={false} />
              <Area type="monotone" dataKey="AdGuard" stroke="#a855f7" strokeWidth={2} fill="url(#adguardGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className={`${CARD} p-5 lg:col-span-2`}>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Device Types</h3>
          {deviceDist.length > 0 ? (
            <DistributionList
              entries={deviceDist}
              colorMap={DEVICE_COLORS}
              format={(n) => n.replace('device_', '').replace(/_/g, ' ')}
            />
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500">No data yet</p>
          )}
        </div>
      </div>

      {/* VLAN distribution + recent syncs */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className={`${CARD} p-5 lg:col-span-2`}>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Clients per VLAN</h3>
          {vlanDist.length > 0 ? (
            <DistributionList
              entries={vlanDist}
              colorMap={vlanColorMap}
              sort={false}
            />
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500">No data yet</p>
          )}
        </div>

        <div className={`${CARD} lg:col-span-3 overflow-hidden`}>
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recent Syncs</h3>
            <span className="text-xs text-gray-400 dark:text-gray-500">last {Math.min(history.length, 5)}</span>
          </div>
          {history.length === 0 ? (
            <p className="px-5 py-6 text-xs text-center text-gray-400 dark:text-gray-500">No sync history yet</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {history.slice().reverse().slice(0, 5).map((r, i) => {
                const hasChanges = r.clients_added + r.clients_updated + r.clients_removed > 0;
                const hasRwChanges = r.rewrites_added + r.rewrites_removed > 0;
                return (
                  <div key={i} className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    {/* Status dot */}
                    <span className={`w-2 h-2 rounded-full shrink-0 ${r.success ? 'bg-green-500' : 'bg-red-500'}`} />

                    {/* Time */}
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap w-32 shrink-0">
                      {formatDateTime(r.timestamp)}
                    </span>

                    {/* Client changes */}
                    <span className="text-xs tabular-nums space-x-1 flex-1">
                      {hasChanges ? (
                        <>
                          {r.clients_added > 0 && <span className="text-green-600 dark:text-green-400">+{r.clients_added}</span>}
                          {r.clients_updated > 0 && <span className="text-blue-600 dark:text-blue-400"> ~{r.clients_updated}</span>}
                          {r.clients_removed > 0 && <span className="text-orange-500 dark:text-orange-400"> -{r.clients_removed}</span>}
                          {' '}
                          <span className="text-gray-400 dark:text-gray-500">clients</span>
                        </>
                      ) : hasRwChanges ? (
                        <>
                          {r.rewrites_added > 0 && <span className="text-green-600 dark:text-green-400">+{r.rewrites_added} rewrites</span>}
                          {r.rewrites_removed > 0 && <span className="text-orange-500 dark:text-orange-400"> -{r.rewrites_removed} rewrites</span>}
                        </>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">no changes</span>
                      )}
                    </span>

                    {/* Errors */}
                    {r.errors > 0 && (
                      <span className="text-xs text-red-500 dark:text-red-400 shrink-0">
                        {r.errors} err
                      </span>
                    )}

                    {/* Status badge */}
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                      r.success
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    }`}>
                      {r.success ? 'OK' : 'FAIL'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
