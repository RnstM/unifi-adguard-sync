import { useState, useEffect, useCallback } from 'react';
import { Play, Square, RefreshCw, Clock } from 'lucide-react';
import type { AppStatus } from '../types';
import { triggerSync, stopSync, startSync } from '../api';
import { formatRelative } from '../utils';

interface SyncControlsProps {
  status: AppStatus | null;
  onRefresh: () => void;
}

export default function SyncControls({ status, onRefresh }: SyncControlsProps) {
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const syncEnabled = status?.sync_enabled ?? true;
  const lastSync = status?.last_sync ?? null;
  const syncInterval = status?.sync_interval ?? 0;

  // Recalculate countdown whenever lastSync timestamp or syncInterval changes
  useEffect(() => {
    if (!syncEnabled || syncInterval === 0 || !lastSync) {
      setCountdown(null);
      return;
    }

    const calcCountdown = () => {
      const next = new Date(lastSync.timestamp).getTime() + syncInterval * 1000;
      const remaining = Math.max(0, next - Date.now()) / 1000;
      setCountdown(Math.round(remaining));
    };

    calcCountdown();
    const id = setInterval(calcCountdown, 1000);
    return () => clearInterval(id);
  }, [lastSync?.timestamp, syncInterval, syncEnabled]);

  const handleAction = useCallback(async (action: () => Promise<void>) => {
    setLoading(true);
    try {
      await action();
      setTimeout(() => {
        onRefresh();
        setLoading(false);
      }, 500);
    } catch {
      setLoading(false);
    }
  }, [onRefresh]);

  const renderCountdown = () => {
    if (syncInterval === 0) {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
          <Clock className="h-3.5 w-3.5" />
          Manual only
        </span>
      );
    }
    if (!syncEnabled) {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
          <Clock className="h-3.5 w-3.5" />
          Paused
        </span>
      );
    }
    if (countdown !== null) {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
          <Clock className="h-3.5 w-3.5" />
          Next sync in{' '}
          <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
            {countdown}s
          </span>
        </span>
      );
    }
    return null;
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-4">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${
              syncEnabled
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                syncEnabled ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            {syncEnabled ? 'Running' : 'Stopped'}
          </span>
        </div>

        {/* Last sync info + countdown */}
        <div className="flex flex-col gap-1">
          {lastSync && (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Last sync:{' '}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {formatRelative(lastSync.timestamp)}
              </span>
              {' '}
              <span
                className={
                  lastSync.success
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }
              >
                ({lastSync.success ? 'OK' : 'FAILED'}, {lastSync.duration_ms}ms)
              </span>
            </div>
          )}
          {renderCountdown()}
        </div>

        {/* Buttons */}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => handleAction(triggerSync)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Sync Now
          </button>

          {syncEnabled ? (
            <button
              onClick={() => handleAction(stopSync)}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <Square className="h-4 w-4" />
              Stop
            </button>
          ) : (
            <button
              onClick={() => handleAction(startSync)}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
