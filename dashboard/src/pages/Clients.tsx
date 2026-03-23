import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Monitor,
  Smartphone,
  Server,
  Tv,
  Camera,
  Printer,
  Gamepad2,
  ShieldAlert,
  HelpCircle,
  Headphones,
  MonitorSmartphone,
  X,
  CheckCircle,
  XCircle,
  Ban,
  Wifi,
  WifiOff,
  Trash2,
  Plus,
  Loader2,
  Clock,
  Signal,
  ShieldOff,
  ShieldCheck,
  EyeOff,
  Eye,
  Pencil,
  Save,
} from 'lucide-react';
import type { Client, Rewrite } from '../types';
import { getClients, getRewrites, getAccess, blockClient, unblockClient, addRewrite, deleteRewrite, updateRewrite, getTagOverrides, setTagOverride, clearTagOverride, getSyncExcludes, excludeFromSync, includeInSync } from '../api';

// ── Helpers ────────────────────────────────────────────────────────────────
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function formatLastSeen(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Device icon mapping ────────────────────────────────────────────────────
const DeviceIcon = ({ tag, className }: { tag: string; className?: string }) => {
  const cls = className ?? 'h-5 w-5';
  switch (tag) {
    case 'device_pc':        return <Monitor className={cls} />;
    case 'device_laptop':    return <MonitorSmartphone className={cls} />;
    case 'device_phone':     return <Smartphone className={cls} />;
    case 'device_tablet':    return <MonitorSmartphone className={cls} />;
    case 'device_nas':       return <Server className={cls} />;
    case 'device_tv':        return <Tv className={cls} />;
    case 'device_camera':    return <Camera className={cls} />;
    case 'device_printer':   return <Printer className={cls} />;
    case 'device_gameconsole': return <Gamepad2 className={cls} />;
    case 'device_audio':     return <Headphones className={cls} />;
    case 'device_securityalarm': return <ShieldAlert className={cls} />;
    default:                 return <HelpCircle className={cls} />;
  }
};

// ── Tag badge colors ───────────────────────────────────────────────────────
const tagColors: Record<string, string> = {
  device_pc: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  device_laptop: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400',
  device_phone: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  device_tablet: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400',
  device_nas: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400',
  device_tv: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400',
  device_camera: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  device_printer: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400',
  device_gameconsole: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',
  device_audio: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  device_securityalarm: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  device_other: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  os_linux: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  os_windows: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  os_android: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  os_ios: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
  os_macos: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  os_other: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
};

function TagBadge({ tag }: { tag: string }) {
  const color = tagColors[tag] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300';
  const label = tag.replace(/^(device_|os_)/, '');
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

// ── VLAN badge color hashing ───────────────────────────────────────────────
const VLAN_PALETTES = [
  'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400',
  'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',
  'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400',
];

function VlanBadge({ vlan }: { vlan: number }) {
  if (!vlan) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
        No VLAN
      </span>
    );
  }
  const color = VLAN_PALETTES[vlan % VLAN_PALETTES.length];
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {vlan}
    </span>
  );
}

// ── Side drawer ────────────────────────────────────────────────────────────
const DEVICE_TAGS = [
  'device_pc', 'device_laptop', 'device_phone', 'device_tablet', 'device_nas',
  'device_tv', 'device_camera', 'device_printer', 'device_gameconsole',
  'device_audio', 'device_securityalarm', 'device_other',
];
const OS_TAGS = ['os_linux', 'os_windows', 'os_android', 'os_ios', 'os_macos', 'os_other'];

interface ModalProps {
  client: Client | null;
  rewrites: string[];
  isBlocked: boolean;
  isExcluded: boolean;
  tagOverride: { device_tag?: string; os_tag?: string } | null;
  onClose: () => void;
  onRefresh: () => void;
}

function ClientModal({ client, rewrites, isBlocked, isExcluded, tagOverride, onClose, onRefresh }: ModalProps) {
  const [blocking, setBlocking] = useState(false);
  const [excluding, setExcluding] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [addingRewrite, setAddingRewrite] = useState(false);
  const [deletingDomain, setDeletingDomain] = useState<string | null>(null);
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [editDomainValue, setEditDomainValue] = useState('');
  const [savingDomain, setSavingDomain] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [overrideDevice, setOverrideDevice] = useState('');
  const [overrideOs, setOverrideOs] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  const handleExclude = async () => {
    setExcluding(true);
    setActionError(null);
    try {
      const res = await excludeFromSync(client!.ip);
      if (!res.ok) setActionError('Failed to exclude from sync');
      else await onRefresh();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setExcluding(false);
    }
  };

  const handleInclude = async () => {
    setExcluding(true);
    setActionError(null);
    try {
      const res = await includeInSync(client!.ip);
      if (!res.ok) setActionError('Failed to re-include in sync');
      else await onRefresh();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setExcluding(false);
    }
  };

  // Reset local state when client changes
  useEffect(() => {
    setBlocking(false);
    setExcluding(false);
    setNewDomain('');
    setAddingRewrite(false);
    setDeletingDomain(null);
    setShowAddForm(false);
    setActionError(null);
    setOverrideDevice(tagOverride?.device_tag ?? '');
    setOverrideOs(tagOverride?.os_tag ?? '');
    // Note: tagOverride intentionally omitted — background refreshes must not reset user edits.
    // Values are reset only when switching to a different client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.ip]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Lock page scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (!client) return null;

  const devTag = client.tags.find((t) => t.startsWith('device_')) ?? 'device_other';
  const osTag = client.tags.find((t) => t.startsWith('os_'));
  const devLabel = devTag.replace('device_', '').replace(/\b\w/g, (c) => c.toUpperCase());

  const handleBlock = async () => {
    setBlocking(true);
    setActionError(null);
    try {
      const res = await blockClient(client.ip);
      if (!res.ok) setActionError((res as any).error ?? 'AdGuard rejected the request');
      else await onRefresh();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBlocking(false);
    }
  };

  const handleUnblock = async () => {
    setBlocking(true);
    setActionError(null);
    try {
      const res = await unblockClient(client.ip);
      if (!res.ok) setActionError((res as any).error ?? 'AdGuard rejected the request');
      else await onRefresh();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBlocking(false);
    }
  };

  const handleDeleteRewrite = async (domain: string) => {
    setDeletingDomain(domain);
    setActionError(null);
    try {
      const res = await deleteRewrite(domain, client.ip);
      if (!res.ok) setActionError((res as any).error ?? 'AdGuard rejected the request');
      else await onRefresh();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setDeletingDomain(null);
    }
  };

  const handleSaveOverride = async () => {
    setSavingOverride(true);
    setActionError(null);
    try {
      const res = await setTagOverride(client!.ip, overrideDevice || null, overrideOs || null);
      if (!res.ok) setActionError('Failed to save override');
      else await onRefresh();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setSavingOverride(false);
    }
  };

  const handleClearOverride = async () => {
    setSavingOverride(true);
    setActionError(null);
    try {
      const res = await clearTagOverride(client!.ip);
      if (!res.ok) setActionError('Failed to clear override');
      else {
        setOverrideDevice('');
        setOverrideOs('');
        await onRefresh();
      }
    } catch (e) {
      setActionError(String(e));
    } finally {
      setSavingOverride(false);
    }
  };

  const handleEditRewrite = async (oldDomain: string) => {
    const newDomainVal = editDomainValue.trim();
    if (!newDomainVal || newDomainVal === oldDomain) { setEditingDomain(null); return; }
    setSavingDomain(true);
    setActionError(null);
    try {
      const res = await updateRewrite(oldDomain, client!.ip, newDomainVal, client!.ip);
      if (!res.ok) setActionError((res as any).error ?? 'Failed to update rewrite');
      else { setEditingDomain(null); await onRefresh(); }
    } catch (e) {
      setActionError(String(e));
    } finally {
      setSavingDomain(false);
    }
  };

  const handleAddRewrite = async () => {
    const domain = newDomain.trim();
    if (!domain) return;
    setAddingRewrite(true);
    setActionError(null);
    try {
      const res = await addRewrite(domain, client.ip);
      if (!res.ok) {
        setActionError((res as any).error ?? 'AdGuard rejected the request');
      } else {
        setNewDomain('');
        setShowAddForm(false);
        await onRefresh();
      }
    } catch (e) {
      setActionError(String(e));
    } finally {
      setAddingRewrite(false);
    }
  };

  return createPortal(
    <>
      {/* Pure backdrop — covers full viewport independently of dialog size */}
      <div
        className="bg-black/40 dark:bg-black/60"
        style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
        onClick={onClose}
      />
      {/* Dialog container — separate layer for centering/scrolling */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 10000, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        onClick={onClose}
      >
      <div
        className="w-full max-w-xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 shrink-0 mt-0.5">
              <DeviceIcon tag={devTag} className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">{client.name}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span className="font-mono">{client.ip}</span>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <VlanBadge vlan={client.vlan} />
                <span className="text-gray-300 dark:text-gray-600">·</span>
                {client.is_wired
                  ? <span className="flex items-center gap-1"><WifiOff className="h-3 w-3" /> Wired</span>
                  : <span className="flex items-center gap-1"><Wifi className="h-3 w-3 text-blue-400" /> Wireless{client.signal != null ? ` (${client.signal} dBm)` : ''}</span>
                }
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={isExcluded ? handleInclude : handleExclude}
                disabled={excluding}
                title={isExcluded ? 'Include in sync' : 'Exclude from sync'}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${isExcluded ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              >
                {excluding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{isExcluded ? 'Excluded' : 'Exclude'}</span>
              </button>
              <button
                onClick={isBlocked ? handleUnblock : handleBlock}
                disabled={blocking}
                title={isBlocked ? 'Unblock DNS' : 'Block DNS'}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${isBlocked ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              >
                {blocking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{isBlocked ? 'Blocked' : 'Block DNS'}</span>
              </button>
              <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {client.tags.map((tag) => <TagBadge key={tag} tag={tag} />)}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="overflow-y-auto">
          {actionError && (
            <div className="mx-5 mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="break-all flex-1">{actionError}</span>
              <button onClick={() => setActionError(null)}><X className="h-4 w-4" /></button>
            </div>
          )}

          <div className="p-5 space-y-5">
            {/* Details grid */}
            <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Type</dt>
                <dd className="text-gray-900 dark:text-gray-100">{devLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">MAC</dt>
                <dd className="font-mono text-gray-700 dark:text-gray-300 text-xs">{client.mac}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Hostname</dt>
                <dd className="text-gray-900 dark:text-gray-100 truncate">{client.hostname || '—'}</dd>
              </div>
              {client.network && (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Network</dt>
                  <dd className="text-gray-900 dark:text-gray-100 truncate">{client.network}</dd>
                </div>
              )}
              {client.uptime != null && (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Uptime</dt>
                  <dd className="flex items-center gap-1 text-gray-900 dark:text-gray-100">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />{formatUptime(client.uptime)}
                  </dd>
                </div>
              )}
              {client.last_seen != null && (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Last Seen</dt>
                  <dd className="text-gray-900 dark:text-gray-100">{formatLastSeen(client.last_seen)}</dd>
                </div>
              )}
            </dl>

            {/* DNS Rewrites */}
            <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">DNS Rewrites</p>
                {!showAddForm && (
                  <button onClick={() => { setShowAddForm(true); setNewDomain(''); }} className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {rewrites.map((fqdn) => (
                  <div key={fqdn} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/40">
                    {editingDomain === fqdn ? (
                      <>
                        <input
                          autoFocus
                          value={editDomainValue}
                          onChange={(e) => setEditDomainValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleEditRewrite(fqdn); if (e.key === 'Escape') setEditingDomain(null); }}
                          className="flex-1 px-2 py-0.5 text-sm font-mono border border-blue-400 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button onClick={() => handleEditRewrite(fqdn)} disabled={savingDomain} className="p-1 rounded text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 shrink-0 disabled:opacity-50">
                          {savingDomain ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => setEditingDomain(null)} className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          <span className="text-sm font-mono text-green-700 dark:text-green-400 truncate">{fqdn}</span>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => { setEditingDomain(fqdn); setEditDomainValue(fqdn); }} className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDeleteRewrite(fqdn)} disabled={deletingDomain === fqdn} className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50">
                            {deletingDomain === fqdn ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {rewrites.length === 0 && !showAddForm && (
                  <p className="text-sm text-gray-400 dark:text-gray-500">No DNS rewrites</p>
                )}
                {showAddForm && (
                  <div className="space-y-1">
                    <div className="flex gap-2">
                      <input autoFocus type="text" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddRewrite()}
                        placeholder={`e.g. ${(client.name || client.hostname).toLowerCase().replace(/[^a-z0-9-]/g, '-')}.lan`}
                        className="flex-1 px-3 py-1.5 text-sm font-mono border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button onClick={handleAddRewrite} disabled={addingRewrite || !newDomain.trim()} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                        {addingRewrite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                      </button>
                      <button onClick={() => { setShowAddForm(false); setNewDomain(''); }} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">FQDN → {client.ip}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Tag Override */}
            <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                Tag Override
                {tagOverride && <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 normal-case font-medium">active</span>}
              </p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Device type</label>
                  <select value={overrideDevice} onChange={(e) => setOverrideDevice(e.target.value)} className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— auto —</option>
                    {DEVICE_TAGS.map((t) => <option key={t} value={t}>{t.replace('device_', '')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">OS</label>
                  <select value={overrideOs} onChange={(e) => setOverrideOs(e.target.value)} className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— auto —</option>
                    {OS_TAGS.map((t) => <option key={t} value={t}>{t.replace('os_', '')}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveOverride} disabled={savingOverride} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {savingOverride ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />} Apply
                </button>
                {tagOverride && (
                  <button onClick={handleClearOverride} disabled={savingOverride} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors">
                    <X className="h-3.5 w-3.5" /> Clear override
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Takes effect on the next sync cycle.</p>
            </div>
          </div>
        </div>
      </div>
      </div>
    </>,
    document.body
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [rewrites, setRewrites] = useState<Rewrite[]>([]);
  const [disallowed, setDisallowed] = useState<Set<string>>(new Set());
  const [syncExcludes, setSyncExcludes] = useState<Set<string>>(new Set());
  const [tagOverrides, setTagOverrides] = useState<Record<string, { device_tag?: string; os_tag?: string }>>({});
  const [search, setSearch] = useState('');
  const [vlanFilter, setVlanFilter] = useState<string>('');
  const [deviceFilter, setDeviceFilter] = useState<string>('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [checkedIps, setCheckedIps] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [c, r, a, ov, ex] = await Promise.all([
        getClients(), getRewrites(), getAccess(), getTagOverrides(), getSyncExcludes(),
      ]);
      setClients(c);
      setRewrites(r);
      setDisallowed(new Set(a.disallowed ?? []));
      setTagOverrides(ov);
      setSyncExcludes(new Set(ex));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const runBulk = async (fn: (ip: string) => Promise<unknown>) => {
    setBulkLoading(true);
    try {
      await Promise.all([...checkedIps].map(fn));
      await refresh();
      setCheckedIps(new Set());
    } finally {
      setBulkLoading(false);
    }
  };

  // Keep selectedClient in sync when clients list refreshes
  useEffect(() => {
    if (selectedClient) {
      const updated = clients.find((c) => c.ip === selectedClient.ip);
      if (updated) setSelectedClient(updated);
    }
  }, [clients]);

  // Build IP → [FQDN, ...] map (one IP can have multiple rewrites)
  const rewriteMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of rewrites) {
      if (r.ip) {
        const existing = map.get(r.ip) ?? [];
        map.set(r.ip, [...existing, r.domain]);
      }
    }
    return map;
  }, [rewrites]);

  const vlans = useMemo(() => {
    const set = new Set(clients.map((c) => c.vlan));
    return Array.from(set).sort((a, b) => a - b);
  }, [clients]);

  const deviceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const c of clients) {
      const tag = c.tags.find((t) => t.startsWith('device_'));
      if (tag) set.add(tag);
    }
    return Array.from(set).sort();
  }, [clients]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return clients.filter((c) => {
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.ip.includes(q) ||
        c.mac.toLowerCase().includes(q) ||
        c.hostname.toLowerCase().includes(q);
      const matchVlan = !vlanFilter || String(c.vlan) === vlanFilter;
      const matchDevice =
        !deviceFilter || c.tags.some((t) => t === deviceFilter);
      return matchSearch && matchVlan && matchDevice;
    });
  }, [clients, search, vlanFilter, deviceFilter]);

  const selectedRewrites = selectedClient ? (rewriteMap.get(selectedClient.ip) ?? []) : [];
  const selectedIsBlocked = selectedClient ? disallowed.has(selectedClient.ip) : false;
  const selectedIsExcluded = selectedClient ? syncExcludes.has(selectedClient.ip) : false;
  const selectedTagOverride = selectedClient ? (tagOverrides[selectedClient.ip] ?? null) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Clients</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {filtered.length} / {clients.length}
        </span>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, IP, MAC, hostname..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={vlanFilter}
          onChange={(e) => setVlanFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All VLANs</option>
          {vlans.map((v) => (
            <option key={v} value={String(v)}>
              VLAN {v || 'none'}
            </option>
          ))}
        </select>
        <select
          value={deviceFilter}
          onChange={(e) => setDeviceFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Devices</option>
          {deviceTypes.map((d) => (
            <option key={d} value={d}>
              {d.replace('device_', '').replace(/\b\w/g, (c) => c.toUpperCase())}
            </option>
          ))}
        </select>
      </div>

      {/* Bulk action bar */}
      {checkedIps.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            {checkedIps.size} selected
          </span>
          <div className="flex items-center gap-2 ml-2 flex-wrap">
            <button
              onClick={() => runBulk((ip) => excludeFromSync(ip))}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 disabled:opacity-50 transition-colors"
            >
              <EyeOff className="h-3.5 w-3.5" /> Exclude from sync
            </button>
            <button
              onClick={() => runBulk((ip) => includeInSync(ip))}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50 transition-colors"
            >
              <Eye className="h-3.5 w-3.5" /> Include in sync
            </button>
            <button
              onClick={() => runBulk((ip) => blockClient(ip))}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
            >
              <Ban className="h-3.5 w-3.5" /> Block DNS
            </button>
            <button
              onClick={() => runBulk((ip) => unblockClient(ip))}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Unblock DNS
            </button>
          </div>
          <button
            onClick={() => setCheckedIps(new Set())}
            className="ml-auto p-1 rounded text-blue-400 hover:text-blue-600 dark:hover:text-blue-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50">
                {/* Select all checkbox */}
                <th className="pl-4 pr-2 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((c) => checkedIps.has(c.ip))}
                    ref={(el) => {
                      if (el) el.indeterminate = checkedIps.size > 0 && !filtered.every((c) => checkedIps.has(c.ip));
                    }}
                    onChange={(e) => {
                      if (e.target.checked) setCheckedIps(new Set(filtered.map((c) => c.ip)));
                      else setCheckedIps(new Set());
                    }}
                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-10" />
                {['Name', 'IP', 'VLAN', 'Tags', 'DNS Rewrite'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider" title="DNS blocked in AdGuard">
                  <Ban className="h-3.5 w-3.5 mx-auto" />
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider" title="Excluded from sync">
                  <EyeOff className="h-3.5 w-3.5 mx-auto" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((c, i) => {
                const devTag = c.tags.find((t) => t.startsWith('device_')) ?? 'device_other';
                const osTag = c.tags.find((t) => t.startsWith('os_'));
                const fqdns = rewriteMap.get(c.ip) ?? [];
                const blocked = disallowed.has(c.ip);
                const excluded = syncExcludes.has(c.ip);
                const checked = checkedIps.has(c.ip);

                return (
                  <tr
                    key={i}
                    className={`cursor-pointer transition-colors ${
                      blocked
                        ? 'bg-red-50/50 dark:bg-red-900/5 hover:bg-red-50 dark:hover:bg-red-900/10'
                        : excluded
                        ? 'bg-amber-50/50 dark:bg-amber-900/5 hover:bg-amber-50 dark:hover:bg-amber-900/10'
                        : checked
                        ? 'bg-blue-50/50 dark:bg-blue-900/5'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                    }`}
                    onClick={() => setSelectedClient(c)}
                  >
                    {/* Checkbox */}
                    <td className="pl-4 pr-2 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(checkedIps);
                          if (e.target.checked) next.add(c.ip);
                          else next.delete(c.ip);
                          setCheckedIps(next);
                        }}
                        className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                    </td>

                    {/* Device icon */}
                    <td className="px-4 py-3 w-10">
                      <div className={
                        blocked ? 'text-red-400 dark:text-red-500'
                        : excluded ? 'text-amber-400 dark:text-amber-500'
                        : 'text-gray-400 dark:text-gray-500'
                      }>
                        <DeviceIcon tag={devTag} className="h-4 w-4" />
                      </div>
                    </td>

                    {/* Name + hostname */}
                    <td className="px-4 py-3">
                      <div className={`font-medium ${
                        blocked ? 'text-red-700 dark:text-red-400'
                        : excluded ? 'text-amber-700 dark:text-amber-400'
                        : 'text-gray-900 dark:text-gray-100'
                      }`}>
                        {c.name}
                      </div>
                      {c.hostname && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{c.hostname}</div>
                      )}
                    </td>

                    {/* IP */}
                    <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {c.ip}
                    </td>

                    {/* VLAN */}
                    <td className="px-4 py-3">
                      <VlanBadge vlan={c.vlan} />
                    </td>

                    {/* Tags */}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <TagBadge tag={devTag} />
                        {osTag && <TagBadge tag={osTag} />}
                      </div>
                    </td>

                    {/* DNS Rewrite */}
                    <td className="px-4 py-3">
                      {fqdns.length > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                          <span className="text-xs font-mono text-green-700 dark:text-green-400 truncate max-w-[160px]">
                            {fqdns[0]}
                          </span>
                          {fqdns.length > 1 && (
                            <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                              +{fqdns.length - 1}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </td>

                    {/* Blocked toggle */}
                    <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => blocked ? unblockClient(c.ip).then(refresh) : blockClient(c.ip).then(refresh)}
                        title={blocked ? 'Unblock DNS' : 'Block DNS'}
                        className={`p-1.5 rounded-lg transition-colors ${
                          blocked
                            ? 'text-red-500 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50'
                            : 'text-gray-300 dark:text-gray-600 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                        }`}
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                    </td>

                    {/* Excluded toggle */}
                    <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => excluded ? includeInSync(c.ip).then(refresh) : excludeFromSync(c.ip).then(refresh)}
                        title={excluded ? 'Include in sync' : 'Exclude from sync'}
                        className={`p-1.5 rounded-lg transition-colors ${
                          excluded
                            ? 'text-amber-500 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50'
                            : 'text-gray-300 dark:text-gray-600 hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                        }`}
                      >
                        <EyeOff className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-gray-400 dark:text-gray-500"
                  >
                    {clients.length === 0 ? 'No clients synced yet' : 'No clients match filter'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Side drawer */}
      {selectedClient && (
        <ClientModal
          client={selectedClient}
          rewrites={selectedRewrites}
          isBlocked={selectedIsBlocked}
          isExcluded={selectedIsExcluded}
          tagOverride={selectedTagOverride}
          onClose={() => setSelectedClient(null)}
          onRefresh={refresh}
        />
      )}

    </div>
  );
}
