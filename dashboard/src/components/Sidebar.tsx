import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Monitor,
  Globe,
  ScrollText,
  Settings,
  Github,
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
            {version ? (version === 'dev' ? 'dev' : `v${version}`) : '—'}
          </span>
          <a
            href="https://github.com/RnstM/unifi-adguard-sync"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </div>
    </aside>
  );
}
