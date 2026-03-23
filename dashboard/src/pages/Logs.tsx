import { useState, useEffect, useCallback, useRef } from 'react';
import { getLogs } from '../api';

type LogLevel = 'ALL' | 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

const LEVELS: LogLevel[] = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR'];

function getLineLevel(line: string): LogLevel {
  if (line.includes('[ERROR]')) return 'ERROR';
  if (line.includes('[WARNING]')) return 'WARNING';
  if (line.includes('[INFO]')) return 'INFO';
  if (line.includes('[DEBUG]')) return 'DEBUG';
  return 'INFO';
}

const levelOrder: Record<LogLevel, number> = {
  ALL: 0,
  DEBUG: 1,
  INFO: 2,
  WARNING: 3,
  ERROR: 4,
};

const lineColors: Record<LogLevel, string> = {
  ALL: 'text-gray-300',
  DEBUG: 'text-gray-500',
  INFO: 'text-green-400',
  WARNING: 'text-yellow-400',
  ERROR: 'text-red-400',
};

export default function Logs() {
  const [lines, setLines] = useState<string[]>([]);
  const [level, setLevel] = useState<LogLevel>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getLogs();
      setLines(data.lines);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, autoScroll]);

  const filtered = lines.filter((line) => {
    if (level === 'ALL') return true;
    const lineLevel = getLineLevel(line);
    return levelOrder[lineLevel] >= levelOrder[level];
  });

  return (
    <div className="space-y-4 h-full flex flex-col">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Logs</h1>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {LEVELS.map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                level === l
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded"
          />
          Auto-scroll
        </label>

        <span className="text-xs text-gray-400 dark:text-gray-500">
          {filtered.length} lines
        </span>
      </div>

      {/* Log viewer — fixed height so page doesn't scroll */}
      <div className="rounded-xl bg-gray-950 border border-gray-700 overflow-auto font-mono text-xs leading-relaxed p-4 h-[calc(100vh-200px)]">
        {filtered.map((line, i) => {
          const lineLevel = getLineLevel(line);
          const color = lineColors[lineLevel];
          return (
            <div key={i} className={`${color} whitespace-pre-wrap break-all`}>
              {line}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-gray-600">No log lines yet...</div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
