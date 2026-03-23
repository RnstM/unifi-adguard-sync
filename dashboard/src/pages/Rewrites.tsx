import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Copy, Check, Pencil, X, Save } from 'lucide-react';
import type { Rewrite } from '../types';
import { getRewrites, updateRewrite } from '../api';

export default function Rewrites() {
  const [rewrites, setRewrites] = useState<Rewrite[]>([]);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ domain: string; ip: string } | null>(null);
  const [editDomain, setEditDomain] = useState('');
  const [editIp, setEditIp] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getRewrites();
      setRewrites(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rewrites;
    return rewrites.filter(
      (r) => r.domain.toLowerCase().includes(q) || r.ip.includes(q),
    );
  }, [rewrites, search]);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // ignore
    }
  }, []);

  const startEdit = (r: Rewrite) => {
    setEditing({ domain: r.domain, ip: r.ip });
    setEditDomain(r.domain);
    setEditIp(r.ip);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditError(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await updateRewrite(editing.domain, editing.ip, editDomain.trim(), editIp.trim());
      if (!res.ok) {
        setEditError((res as any).error ?? 'Failed to update rewrite');
      } else {
        setEditing(null);
        await refresh();
      }
    } catch (e) {
      setEditError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">DNS Rewrites</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {filtered.length} / {rewrites.length}
        </span>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search domain or IP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Domain
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  IP
                </th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((r, i) => {
                const isEditing = editing?.domain === r.domain && editing?.ip === r.ip;
                return (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 group">
                    <td className="px-4 py-3 font-mono text-gray-900 dark:text-gray-100">
                      {isEditing ? (
                        <input
                          value={editDomain}
                          onChange={(e) => setEditDomain(e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-blue-400 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          {r.domain}
                          <button
                            onClick={() => handleCopy(r.domain)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                            title="Copy domain"
                          >
                            {copied === r.domain ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3 text-gray-400" />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">
                      {isEditing ? (
                        <input
                          value={editIp}
                          onChange={(e) => setEditIp(e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-blue-400 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          {r.ip}
                          <button
                            onClick={() => handleCopy(r.ip)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                            title="Copy IP"
                          >
                            {copied === r.ip ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3 text-gray-400" />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="p-1.5 rounded hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 dark:text-green-400 disabled:opacity-50"
                            title="Save"
                          >
                            <Save className="h-4 w-4" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={saving}
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
                            title="Cancel"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(r)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {editError && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-xs text-red-500">{editError}</td>
                </tr>
              )}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-8 text-center text-gray-400 dark:text-gray-500"
                  >
                    {rewrites.length === 0
                      ? 'No DNS rewrites (enable DNS_REWRITE_ENABLED)'
                      : 'No rewrites match filter'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
