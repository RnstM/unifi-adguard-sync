import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Monitor,
  Globe,
  ScrollText,
  Settings,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

const navItems = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, exact: true },
  { to: '/clients', label: 'Clients', icon: Monitor },
  { to: '/logs', label: 'Logs', icon: ScrollText },
  { to: '/config', label: 'Configuration', icon: Settings },
];

export default function Sidebar() {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => setVersion(d.version ?? ''))
      .catch(() => {});
  }, []);

  return (
    <aside className="flex flex-col w-14 md:w-56 h-screen bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-3 md:px-4 h-16 border-b border-gray-200 dark:border-gray-700">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
          <Globe className="h-5 w-5 text-white" />
        </div>
        <span className="hidden md:block font-semibold text-sm text-gray-900 dark:text-gray-100 leading-tight">
          UniFi AdGuard<br />Sync
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
        {navItems.map(({ to, label, icon: Icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
              ].join(' ')
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="hidden md:block">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer: theme toggle + version/github */}
      <div className="px-2 pb-4 space-y-3">
        <div className="flex justify-center md:justify-start md:px-1">
          <ThemeToggle />
        </div>
        <div className="hidden md:flex items-center justify-between px-1 pt-3 border-t border-gray-100 dark:border-gray-800">
          <span className="text-xs text-gray-400 dark:text-gray-600">
            {version ? (version === 'dev' ? 'dev' : `v${version.replace(/^v/, '')}`) : '—'}
          </span>
          <a
            href="https://github.com/RnstM/unifi-adguard-sync"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="GitHub"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.185 6.839 9.504.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.021C22 6.484 17.522 2 12 2z" />
            </svg>
          </a>
        </div>
      </div>
    </aside>
  );
}
