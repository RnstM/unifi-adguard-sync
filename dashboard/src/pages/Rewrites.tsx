import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Copy, Check } from 'lucide-react';
import type { Rewrite } from '../types';
import { getRewrites } from '../api';

export default function Rewrites() {
  const [rewrites, setRewrites] = useState<Rewrite[]>([]);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

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
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 group">
                  <td className="px-4 py-3 font-mono text-gray-900 dark:text-gray-100">
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
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">
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
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              ))}
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
