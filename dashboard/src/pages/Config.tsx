import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Save,
  RefreshCw,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle,
  RotateCcw,
  Server,
  Settings,
  Globe,
  Network,
  Bell,
  Download,
  Upload,
  FlaskConical,
  Loader2,
} from 'lucide-react';
import { getConfig, saveConfig, restartApp, getStatus, testUnifi, testAdguard, exportConfig, importConfig } from '../api';

type ConfigValues = Record<string, unknown>;

const INPUT =
  'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition-colors';
const LABEL = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
const HINT = 'mt-1 text-xs text-gray-400 dark:text-gray-500';
const FIELD_GRID = 'grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5';

// ---------------------------------------------------------------------------
// Field components
// ---------------------------------------------------------------------------
function TextInput({
  name,
  label,
  value,
  onChange,
  hint,
  password,
  placeholder,
}: {
  name: string;
  label?: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  password?: boolean;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className={LABEL}>{label ?? name}</label>
      <div className="relative">
        <input
          type={password && !show ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={INPUT + (password ? ' pr-10' : '')}
        />
        {password && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

function NumberInput({
  name,
  label,
  value,
  onChange,
  hint,
  min,
}: {
  name: string;
  label?: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  min?: number;
}) {
  const [raw, setRaw] = useState(String(value));
  const prevValue = useRef(value);

  useEffect(() => {
    if (value !== prevValue.current) {
      prevValue.current = value;
      setRaw(String(value));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const s = e.target.value;
    setRaw(s);
    const n = Number(s);
    if (s !== '' && !isNaN(n)) {
      prevValue.current = n;
      onChange(n);
    }
  };

  const handleBlur = () => {
    const n = Number(raw);
    const fallback = min ?? 0;
    const resolved = raw === '' || isNaN(n) ? fallback : n;
    setRaw(String(resolved));
    prevValue.current = resolved;
    onChange(resolved);
  };

  return (
    <div>
      <label className={LABEL}>{label ?? name}</label>
      <input
        type="number"
        value={raw}
        min={min}
        onChange={handleChange}
        onBlur={handleBlur}
        className={INPUT}
      />
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

function Toggle({
  name,
  label,
  value,
  onChange,
  hint,
}: {
  name: string;
  label?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className={LABEL}>{label ?? name}</label>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
          value ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

const INTERVAL_PRESETS: { label: string; value: number }[] = [
  { label: 'Manual only', value: 0 },
  { label: '1 minute', value: 60 },
  { label: '5 minutes', value: 300 },
  { label: '15 minutes', value: 900 },
  { label: '30 minutes', value: 1800 },
  { label: '1 hour', value: 3600 },
  { label: '6 hours', value: 21600 },
  { label: '24 hours', value: 86400 },
];

function SyncIntervalInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const isPreset = INTERVAL_PRESETS.some((p) => p.value === value);
  const [custom, setCustom] = useState(!isPreset);

  return (
    <div>
      <label className={LABEL}>Sync Interval</label>
      <select
        value={custom ? 'custom' : String(value)}
        onChange={(e) => {
          if (e.target.value === 'custom') {
            setCustom(true);
          } else {
            setCustom(false);
            onChange(Number(e.target.value));
          }
        }}
        className={INPUT}
      >
        {INTERVAL_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom (seconds)…</option>
      </select>
      {custom && (
        <input
          type="number"
          value={value}
          min={0}
          onChange={(e) => onChange(Number(e.target.value))}
          placeholder="Seconds"
          className={INPUT + ' mt-2'}
        />
      )}
      <p className={HINT}>
        How often to sync automatically. <em>Manual only</em> = use the Sync Now button.
      </p>
    </div>
  );
}

function SelectInput({
  name,
  label,
  value,
  options,
  onChange,
  hint,
}: {
  name: string;
  label?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className={LABEL}>{label ?? name}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section divider inside a tab
// ---------------------------------------------------------------------------
function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------
type TabId = 'connections' | 'sync' | 'dns' | 'vlans' | 'notifications';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'connections', label: 'Connections', icon: <Server className="h-4 w-4" /> },
  { id: 'sync', label: 'Sync', icon: <Settings className="h-4 w-4" /> },
  { id: 'dns', label: 'DNS Rewrites', icon: <Globe className="h-4 w-4" /> },
  { id: 'vlans', label: 'VLANs', icon: <Network className="h-4 w-4" /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
];

// ---------------------------------------------------------------------------
// Connection test button
// ---------------------------------------------------------------------------
function TestResult({ ok, message }: { ok: boolean; message: string }) {
  return (
    <div
      className={`flex items-start gap-2 p-2.5 rounded-lg text-sm border ${
        ok
          ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800/40 text-green-700 dark:text-green-400'
          : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400'
      }`}
    >
      {ok ? <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab panels
// ---------------------------------------------------------------------------
function ConnectionsTab({
  str,
  bool,
  set,
  cfg,
}: {
  str: (k: string, fb?: string) => string;
  bool: (k: string) => boolean;
  set: (k: string) => (v: unknown) => void;
  cfg: Record<string, unknown>;
}) {
  const [unifiTest, setUnifiTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [adguardTest, setAdguardTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingUnifi, setTestingUnifi] = useState(false);
  const [testingAdguard, setTestingAdguard] = useState(false);

  const handleTestUnifi = async () => {
    setTestingUnifi(true);
    setUnifiTest(null);
    try {
      const res = await testUnifi(cfg);
      setUnifiTest(res);
    } catch {
      setUnifiTest({ ok: false, message: 'Request failed' });
    } finally {
      setTestingUnifi(false);
    }
  };

  const handleTestAdguard = async () => {
    setTestingAdguard(true);
    setAdguardTest(null);
    try {
      const res = await testAdguard(cfg);
      setAdguardTest(res);
    } catch {
      setAdguardTest({ ok: false, message: 'Request failed' });
    } finally {
      setTestingAdguard(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <SectionTitle
          title="UniFi Controller"
          subtitle="Connection details for your UniFi controller"
        />
        <div className={FIELD_GRID}>
          <TextInput
            name="UNIFI_HOST"
            label="Host"
            value={str('UNIFI_HOST')}
            onChange={set('UNIFI_HOST')}
            placeholder="https://192.168.1.1"
            hint="Full URL including protocol and port"
          />
          <TextInput
            name="UNIFI_SITE"
            label="Site"
            value={str('UNIFI_SITE')}
            onChange={set('UNIFI_SITE')}
            placeholder="default"
            hint="UniFi site name (usually 'default')"
          />
          <TextInput
            name="UNIFI_USER"
            label="Username"
            value={str('UNIFI_USER')}
            onChange={set('UNIFI_USER')}
            placeholder="adguard"
            hint="Local admin account (not Ubiquiti SSO)"
          />
          <TextInput
            name="UNIFI_PASS"
            label="Password"
            value={str('UNIFI_PASS')}
            onChange={set('UNIFI_PASS')}
            password
            hint="Encrypted at rest in /data/config.json"
          />
          <Toggle
            name="UNIFI_VERIFY_SSL"
            label="Verify SSL"
            value={bool('UNIFI_VERIFY_SSL')}
            onChange={set('UNIFI_VERIFY_SSL')}
            hint="Disable for self-signed certificates"
          />
        </div>
        <div className="space-y-2">
          <button
            onClick={handleTestUnifi}
            disabled={testingUnifi}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {testingUnifi ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            Test Connection
          </button>
          {unifiTest && <TestResult {...unifiTest} />}
        </div>
      </div>

      <div className="space-y-5">
        <SectionTitle title="AdGuard Home" subtitle="Connection details for AdGuard Home" />
        <div className={FIELD_GRID}>
          <TextInput
            name="ADGUARD_HOST"
            label="Host"
            value={str('ADGUARD_HOST')}
            onChange={set('ADGUARD_HOST')}
            placeholder="http://192.168.1.2"
            hint="Full URL including protocol and port"
          />
          <div />
          <TextInput
            name="ADGUARD_USER"
            label="Username"
            value={str('ADGUARD_USER')}
            onChange={set('ADGUARD_USER')}
            placeholder="admin"
          />
          <TextInput
            name="ADGUARD_PASS"
            label="Password"
            value={str('ADGUARD_PASS')}
            onChange={set('ADGUARD_PASS')}
            password
            hint="Encrypted at rest in /data/config.json"
          />
        </div>
        <div className="space-y-2">
          <button
            onClick={handleTestAdguard}
            disabled={testingAdguard}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {testingAdguard ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            Test Connection
          </button>
          {adguardTest && <TestResult {...adguardTest} />}
        </div>
      </div>
    </div>
  );
}

function SyncTab({
  str,
  num,
  bool,
  set,
}: {
  str: (k: string, fb?: string) => string;
  num: (k: string, fb?: number) => number;
  bool: (k: string) => boolean;
  set: (k: string) => (v: unknown) => void;
}) {
  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <SectionTitle title="Sync Settings" subtitle="Control how and when syncing happens" />
        <div className={FIELD_GRID}>
          <SyncIntervalInput value={num('SYNC_INTERVAL', 300)} onChange={set('SYNC_INTERVAL')} />
          <SelectInput
            name="LOG_LEVEL"
            label="Log Level"
            value={str('LOG_LEVEL', 'INFO')}
            options={['DEBUG', 'INFO', 'WARNING', 'ERROR']}
            onChange={set('LOG_LEVEL')}
            hint="DEBUG shows per-client details"
          />
          <Toggle
            name="DRY_RUN"
            label="Dry Run"
            value={bool('DRY_RUN')}
            onChange={set('DRY_RUN')}
            hint="Log what would happen without writing to AdGuard"
          />
        </div>
      </div>

      <div className="space-y-5">
        <SectionTitle
          title="Stale Client Cleanup"
          subtitle="Automatically remove clients no longer seen in UniFi"
        />
        <div className={FIELD_GRID}>
          <NumberInput
            name="STALE_AFTER_DAYS"
            label="Stale After Days"
            value={num('STALE_AFTER_DAYS', 0)}
            onChange={set('STALE_AFTER_DAYS')}
            min={0}
            hint="Remove AdGuard clients not seen for this many days. 0 = disabled"
          />
        </div>
      </div>

      <div className="space-y-5">
        <SectionTitle title="Ports" subtitle="Network ports used by this service" />
        <div className={FIELD_GRID}>
          <NumberInput
            name="DASHBOARD_PORT"
            label="Dashboard Port"
            value={num('DASHBOARD_PORT', 8888)}
            onChange={set('DASHBOARD_PORT')}
            min={1}
            hint="Port for this dashboard (restart required)"
          />
          <NumberInput
            name="HEALTH_PORT"
            label="Health Port"
            value={num('HEALTH_PORT', 8080)}
            onChange={set('HEALTH_PORT')}
            min={0}
            hint="Legacy /healthz port. 0 = disabled"
          />
        </div>
      </div>
    </div>
  );
}

function DnsTab({
  str,
  bool,
  set,
}: {
  str: (k: string, fb?: string) => string;
  bool: (k: string) => boolean;
  set: (k: string) => (v: unknown) => void;
}) {
  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <SectionTitle
          title="DNS Rewrite Sync"
          subtitle="Sync hostnames → IPs so devices are reachable by name (e.g. ssh myserver.home.local)"
        />
        <div className={FIELD_GRID}>
          <Toggle
            name="DNS_REWRITE_ENABLED"
            label="Enabled"
            value={bool('DNS_REWRITE_ENABLED')}
            onChange={set('DNS_REWRITE_ENABLED')}
            hint="Enable automatic DNS rewrite sync"
          />
          <TextInput
            name="DNS_REWRITE_DOMAIN"
            label="Domain"
            value={str('DNS_REWRITE_DOMAIN')}
            onChange={set('DNS_REWRITE_DOMAIN')}
            placeholder="home.local"
            hint="Domain suffix appended to hostnames (e.g. myserver.home.local)"
          />
        </div>
      </div>

      <div className="space-y-5">
        <SectionTitle
          title="Rewrite Filters"
          subtitle="Control which devices get a DNS rewrite"
        />
        <div className={FIELD_GRID}>
          <TextInput
            name="DNS_REWRITE_VLANS"
            label="Include VLANs"
            value={str('DNS_REWRITE_VLANS')}
            onChange={set('DNS_REWRITE_VLANS')}
            placeholder="10,20"
            hint="Only create rewrites for these VLANs (empty = all)"
          />
          <TextInput
            name="DNS_REWRITE_EXCLUDE_VLANS"
            label="Exclude VLANs"
            value={str('DNS_REWRITE_EXCLUDE_VLANS')}
            onChange={set('DNS_REWRITE_EXCLUDE_VLANS')}
            placeholder="30,40"
            hint="Skip these VLANs unless device is a PC/laptop/NAS"
          />
          <div className="md:col-span-2">
            <TextInput
              name="DNS_REWRITE_EXCLUDE_TAGS"
              label="Exclude Tags"
              value={str('DNS_REWRITE_EXCLUDE_TAGS')}
              onChange={set('DNS_REWRITE_EXCLUDE_TAGS')}
              placeholder="device_phone,device_tablet,device_tv,…"
              hint="Comma-separated device tags to exclude from rewrites. Leave empty for defaults (phones, tablets, IoT)"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function VlansTab({
  str,
  set,
}: {
  str: (k: string, fb?: string) => string;
  set: (k: string) => (v: unknown) => void;
}) {
  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <SectionTitle
          title="VLAN Filtering"
          subtitle="Restrict which VLANs are synced to AdGuard. Use include OR exclude, not both."
        />
        <div className={FIELD_GRID}>
          <TextInput
            name="INCLUDE_VLANS"
            label="Include VLANs"
            value={str('INCLUDE_VLANS')}
            onChange={set('INCLUDE_VLANS')}
            placeholder="10,20,30"
            hint="Only sync clients on these VLANs (empty = all)"
          />
          <TextInput
            name="EXCLUDE_VLANS"
            label="Exclude VLANs"
            value={str('EXCLUDE_VLANS')}
            onChange={set('EXCLUDE_VLANS')}
            placeholder="99,100"
            hint="Skip clients on these VLANs entirely"
          />
        </div>
      </div>

      <div className="space-y-5">
        <SectionTitle
          title="VLAN → OS Mapping"
          subtitle="Assign a fallback OS tag to all clients in a VLAN when OS cannot be auto-detected"
        />
        <div className={FIELD_GRID}>
          <div className="md:col-span-2">
            <TextInput
              name="VLAN_OS_MAP"
              label="VLAN → OS Mapping"
              value={str('VLAN_OS_MAP')}
              onChange={set('VLAN_OS_MAP')}
              placeholder="200:os_windows,300:os_linux"
              hint="Format: VLAN_ID:os_tag,VLAN_ID:os_tag — overrides auto-detection for that VLAN"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function NotificationsTab({
  str,
  set,
  cfg,
}: {
  str: (k: string, fb?: string) => string;
  set: (k: string) => (v: unknown) => void;
  cfg: Record<string, unknown>;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTest = async () => {
    const isTelegram = str('NOTIFY_TYPE', 'discord') === 'telegram';
    if (isTelegram ? !str('NOTIFY_TOKEN') : !str('NOTIFY_URL')) {
      setTestResult({ ok: false, message: isTelegram ? 'Set Bot Token first' : 'Set Webhook URL first' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/test/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      }).then((r) => r.json());
      setTestResult(res);
    } catch {
      setTestResult({ ok: false, message: 'Request failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <SectionTitle
          title="Webhook Notifications"
          subtitle="Get notified after sync cycles via Discord, ntfy, Gotify, Telegram, or a generic webhook"
        />
        <div className={FIELD_GRID}>
          <SelectInput
            name="NOTIFY_TYPE"
            label="Type"
            value={str('NOTIFY_TYPE', 'discord')}
            options={['discord', 'ntfy', 'gotify', 'telegram', 'webhook']}
            onChange={set('NOTIFY_TYPE')}
            hint="Format of the webhook payload"
          />
          <SelectInput
            name="NOTIFY_ON"
            label="Notify On"
            value={str('NOTIFY_ON', 'errors')}
            options={['errors', 'changes', 'always']}
            onChange={set('NOTIFY_ON')}
            hint="errors = only on sync errors · changes = when something changed · always = every sync"
          />
          {str('NOTIFY_TYPE', 'discord') === 'telegram' ? (
            <>
              <div className="md:col-span-2">
                <TextInput
                  name="NOTIFY_TOKEN"
                  label="Bot Token"
                  value={str('NOTIFY_TOKEN')}
                  onChange={set('NOTIFY_TOKEN')}
                  placeholder="123456789:ABCDEFabcdef…"
                  hint="Token from @BotFather — looks like 123456789:ABCDEFabcdef…"
                />
              </div>
              <div className="md:col-span-2">
                <TextInput
                  name="NOTIFY_CHAT_ID"
                  label="Chat ID"
                  value={str('NOTIFY_CHAT_ID')}
                  onChange={set('NOTIFY_CHAT_ID')}
                  placeholder="123456789"
                  hint="Your chat or group ID — use @userinfobot to find it"
                />
              </div>
            </>
          ) : (
            <div className="md:col-span-2">
              <TextInput
                name="NOTIFY_URL"
                label="Webhook URL"
                value={str('NOTIFY_URL')}
                onChange={set('NOTIFY_URL')}
                placeholder="https://discord.com/api/webhooks/…"
                hint={
                  str('NOTIFY_TYPE', 'discord') === 'ntfy'
                    ? 'Format: https://ntfy.sh/your-topic'
                    : str('NOTIFY_TYPE', 'discord') === 'gotify'
                    ? 'Format: https://gotify.example.com/message?token=TOKEN'
                    : 'Webhook URL'
                }
              />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            Send Test Notification
          </button>
          {testResult && <TestResult {...testResult} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type RestartState = 'idle' | 'restarting' | 'done' | 'timeout';

export default function Config() {
  const [cfg, setCfg] = useState<ConfigValues>({});
  const [activeTab, setActiveTab] = useState<TabId>('connections');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [restartState, setRestartState] = useState<RestartState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await getConfig();
      setCfg(data);
    } catch {
      setErrorMsg('Failed to load config');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key: string) => (value: unknown) => setCfg((c) => ({ ...c, [key]: value }));
  const str = (key: string, fallback = '') => String(cfg[key] ?? fallback);
  const num = (key: string, fallback = 0) => Number(cfg[key] ?? fallback);
  const bool = (key: string) => Boolean(cfg[key]);

  const handleSave = async () => {
    setSaveState('saving');
    setErrorMsg('');
    setRestartState('idle');
    try {
      await saveConfig(cfg);
      setSaveState('saved');
    } catch {
      setSaveState('error');
      setErrorMsg('Failed to save config. Check that /data is writable.');
    }
  };

  const handleRestart = async () => {
    setRestartState('restarting');
    try {
      restartApp().catch(() => {});
    } catch {
      // expected: connection drops when process restarts
    }
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        await getStatus();
        clearInterval(poll);
        setRestartState('done');
        await load();
      } catch {
        if (attempts > 60) {
          clearInterval(poll);
          setRestartState('timeout');
        }
      }
    }, 1000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Configuration</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Saved to <code className="font-mono">data/config.json</code>. Passwords encrypted at
            rest. Restart to apply changes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportConfig()}
            title="Export config"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <label
            title="Import config"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">Import</span>
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const data = JSON.parse(text);
                  await importConfig(data);
                  await load();
                  setSaveState('saved');
                } catch {
                  setSaveState('error');
                  setErrorMsg('Failed to import: invalid JSON file');
                }
                e.target.value = '';
              }}
            />
          </label>
          <button
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {saveState === 'saving' ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Status banners */}
      {saveState === 'saved' && restartState === 'idle' && (
        <div className="flex items-center justify-between rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          <span className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 shrink-0" />
            Config saved. Restart to apply changes.
          </span>
          <button
            onClick={handleRestart}
            className="flex items-center gap-1.5 ml-4 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restart Now
          </button>
        </div>
      )}
      {restartState === 'restarting' && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
          <RotateCcw className="h-4 w-4 shrink-0 animate-spin" />
          Restarting — waiting for server to come back up…
        </div>
      )}
      {restartState === 'done' && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          <CheckCircle className="h-4 w-4 shrink-0" />
          Restarted successfully. New config is active.
        </div>
      )}
      {restartState === 'timeout' && (
        <div className="flex items-center gap-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Server didn't respond within 60s. Check container logs, then reload this page.
        </div>
      )}
      {saveState === 'error' && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Tab card */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors relative ${
                activeTab === tab.id
                  ? 'text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-800 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-blue-500'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-6">
          {activeTab === 'connections' && (
            <ConnectionsTab str={str} bool={bool} set={set} cfg={cfg} />
          )}
          {activeTab === 'sync' && (
            <SyncTab str={str} num={num} bool={bool} set={set} />
          )}
          {activeTab === 'dns' && (
            <DnsTab str={str} bool={bool} set={set} />
          )}
          {activeTab === 'vlans' && (
            <VlansTab str={str} set={set} />
          )}
          {activeTab === 'notifications' && (
            <NotificationsTab str={str} set={set} cfg={cfg} />
          )}
        </div>
      </div>

    </div>
  );
}
