import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, CheckCircle, ChevronRight, ChevronLeft, Wifi, Shield, Settings, Eye, EyeOff } from 'lucide-react';
import { saveConfig, startSync, testUnifi, testAdguard } from '../api';

type Step = 0 | 1 | 2 | 3 | 4;

interface WizardConfig {
  UNIFI_HOST: string;
  UNIFI_USER: string;
  UNIFI_PASS: string;
  UNIFI_SITE: string;
  UNIFI_VERIFY_SSL: boolean;
  ADGUARD_HOST: string;
  ADGUARD_USER: string;
  ADGUARD_PASS: string;
  SYNC_INTERVAL: number;
  DRY_RUN: boolean;
}

const DEFAULT: WizardConfig = {
  UNIFI_HOST: 'https://192.168.1.1',
  UNIFI_USER: '',
  UNIFI_PASS: '',
  UNIFI_SITE: 'default',
  UNIFI_VERIFY_SSL: false,
  ADGUARD_HOST: 'http://192.168.1.2:3000',
  ADGUARD_USER: '',
  ADGUARD_PASS: '',
  SYNC_INTERVAL: 300,
  DRY_RUN: false,
};

const STEPS = [
  { label: 'Welcome', icon: Globe },
  { label: 'UniFi', icon: Wifi },
  { label: 'AdGuard', icon: Shield },
  { label: 'Sync', icon: Settings },
  { label: 'Done', icon: CheckCircle },
];

const INTERVAL_PRESETS = [
  { label: '1 min', value: 60 },
  { label: '5 min', value: 300 },
  { label: '15 min', value: 900 },
  { label: '30 min', value: 1800 },
  { label: '1 hr', value: 3600 },
];

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

function StepWelcome() {
  return (
    <div className="text-center space-y-6 py-4">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center">
        <Globe className="h-9 w-9 text-white" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Welcome to UniFi AdGuard Sync</h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-sm mx-auto text-sm leading-relaxed">
          This wizard will help you connect your UniFi controller and AdGuard Home instance so your clients are
          automatically synced.
        </p>
      </div>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-left max-w-sm mx-auto">
        <p className="text-xs text-blue-700 dark:text-blue-300 font-medium mb-2">What you'll need:</p>
        <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-1">
          <li>• UniFi controller URL + credentials</li>
          <li>• AdGuard Home URL + credentials</li>
        </ul>
      </div>
    </div>
  );
}

function StepUnifi({ cfg, setCfg }: { cfg: WizardConfig; setCfg: React.Dispatch<React.SetStateAction<WizardConfig>> }) {
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');

  const runTest = async () => {
    setTestState('loading');
    try {
      const res = await testUnifi({
        UNIFI_HOST: cfg.UNIFI_HOST,
        UNIFI_USER: cfg.UNIFI_USER,
        UNIFI_PASS: cfg.UNIFI_PASS,
        UNIFI_SITE: cfg.UNIFI_SITE,
        UNIFI_VERIFY_SSL: cfg.UNIFI_VERIFY_SSL,
      });
      setTestState(res.ok ? 'ok' : 'error');
      setTestMsg(res.message);
    } catch {
      setTestState('error');
      setTestMsg('Connection failed');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">UniFi Controller</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Connect to your UniFi Network controller.</p>
      </div>
      <Field label="Controller URL" hint="e.g. https://192.168.1.1 or https://unifi.local">
        <TextInput
          value={cfg.UNIFI_HOST}
          onChange={(v) => setCfg((c) => ({ ...c, UNIFI_HOST: v }))}
          placeholder="https://192.168.1.1"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Username">
          <TextInput
            value={cfg.UNIFI_USER}
            onChange={(v) => setCfg((c) => ({ ...c, UNIFI_USER: v }))}
            placeholder="admin"
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            value={cfg.UNIFI_PASS}
            onChange={(v) => setCfg((c) => ({ ...c, UNIFI_PASS: v }))}
            placeholder="••••••••"
          />
        </Field>
      </div>
      <Field label="Site" hint="Usually 'default'">
        <TextInput
          value={cfg.UNIFI_SITE}
          onChange={(v) => setCfg((c) => ({ ...c, UNIFI_SITE: v }))}
          placeholder="default"
        />
      </Field>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <div
            onClick={() => setCfg((c) => ({ ...c, UNIFI_VERIFY_SSL: !c.UNIFI_VERIFY_SSL }))}
            className={`relative w-9 h-5 rounded-full transition-colors ${cfg.UNIFI_VERIFY_SSL ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${cfg.UNIFI_VERIFY_SSL ? 'translate-x-4' : ''}`}
            />
          </div>
          <span className="text-sm text-gray-700 dark:text-gray-300">Verify SSL certificate</span>
        </label>
        <button
          onClick={runTest}
          disabled={testState === 'loading' || !cfg.UNIFI_HOST || !cfg.UNIFI_USER}
          className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {testState === 'loading' ? 'Testing…' : 'Test connection'}
        </button>
      </div>
      {testState !== 'idle' && testState !== 'loading' && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${testState === 'ok' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}
        >
          {testState === 'ok' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <span className="text-base leading-none">✕</span>}
          {testMsg}
        </div>
      )}
    </div>
  );
}

function StepAdguard({ cfg, setCfg }: { cfg: WizardConfig; setCfg: React.Dispatch<React.SetStateAction<WizardConfig>> }) {
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');

  const runTest = async () => {
    setTestState('loading');
    try {
      const res = await testAdguard({
        ADGUARD_HOST: cfg.ADGUARD_HOST,
        ADGUARD_USER: cfg.ADGUARD_USER,
        ADGUARD_PASS: cfg.ADGUARD_PASS,
      });
      setTestState(res.ok ? 'ok' : 'error');
      setTestMsg(res.message);
    } catch {
      setTestState('error');
      setTestMsg('Connection failed');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">AdGuard Home</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Connect to your AdGuard Home instance.</p>
      </div>
      <Field label="AdGuard Home URL" hint="e.g. http://192.168.1.2:3000">
        <TextInput
          value={cfg.ADGUARD_HOST}
          onChange={(v) => setCfg((c) => ({ ...c, ADGUARD_HOST: v }))}
          placeholder="http://192.168.1.2:3000"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Username">
          <TextInput
            value={cfg.ADGUARD_USER}
            onChange={(v) => setCfg((c) => ({ ...c, ADGUARD_USER: v }))}
            placeholder="admin"
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            value={cfg.ADGUARD_PASS}
            onChange={(v) => setCfg((c) => ({ ...c, ADGUARD_PASS: v }))}
            placeholder="••••••••"
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <button
          onClick={runTest}
          disabled={testState === 'loading' || !cfg.ADGUARD_HOST}
          className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {testState === 'loading' ? 'Testing…' : 'Test connection'}
        </button>
      </div>
      {testState !== 'idle' && testState !== 'loading' && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${testState === 'ok' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}
        >
          {testState === 'ok' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <span className="text-base leading-none">✕</span>}
          {testMsg}
        </div>
      )}
    </div>
  );
}

function StepSync({ cfg, setCfg }: { cfg: WizardConfig; setCfg: React.Dispatch<React.SetStateAction<WizardConfig>> }) {
  const isCustom = !INTERVAL_PRESETS.some((p) => p.value === cfg.SYNC_INTERVAL);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Sync Settings</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure how often clients are synced.</p>
      </div>
      <Field label="Sync interval">
        <div className="flex flex-wrap gap-2">
          {INTERVAL_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setCfg((c) => ({ ...c, SYNC_INTERVAL: p.value }))}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${cfg.SYNC_INTERVAL === p.value ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setCfg((c) => ({ ...c, SYNC_INTERVAL: 0 }))}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${isCustom ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            Custom
          </button>
        </div>
        {isCustom && (
          <div className="flex items-center gap-2 mt-2">
            <input
              type="number"
              min={10}
              value={cfg.SYNC_INTERVAL}
              onChange={(e) => setCfg((c) => ({ ...c, SYNC_INTERVAL: parseInt(e.target.value) || 300 }))}
              className="w-28 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-500">seconds</span>
          </div>
        )}
      </Field>
      <Field label="Dry run mode" hint="Simulates syncs without making changes — useful for testing.">
        <label className="flex items-center gap-3 cursor-pointer">
          <div
            onClick={() => setCfg((c) => ({ ...c, DRY_RUN: !c.DRY_RUN }))}
            className={`relative w-9 h-5 rounded-full transition-colors ${cfg.DRY_RUN ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${cfg.DRY_RUN ? 'translate-x-4' : ''}`}
            />
          </div>
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {cfg.DRY_RUN ? 'Enabled (no changes will be made)' : 'Disabled'}
          </span>
        </label>
      </Field>
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
        <p className="text-xs text-amber-700 dark:text-amber-400">
          You can change all settings later from the Configuration page.
        </p>
      </div>
    </div>
  );
}

function StepDone() {
  return (
    <div className="text-center space-y-6 py-4">
      <div className="mx-auto w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
        <CheckCircle className="h-9 w-9 text-green-600 dark:text-green-400" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">All set!</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm max-w-sm mx-auto leading-relaxed">
          Your configuration has been saved. The first sync will run shortly.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(0);
  const [cfg, setCfg] = useState<WizardConfig>(DEFAULT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const isLast = step === 4;

  const canAdvance = () => {
    if (step === 1) return !!cfg.UNIFI_HOST && !!cfg.UNIFI_USER;
    if (step === 2) return !!cfg.ADGUARD_HOST;
    return true;
  };

  const handleNext = async () => {
    if (step === 3) {
      // Save config and start sync
      setSaving(true);
      setSaveError('');
      try {
        await saveConfig(cfg as unknown as Record<string, unknown>);
        await startSync();
        setStep(4);
      } catch {
        setSaveError('Failed to save configuration. Please try again.');
      } finally {
        setSaving(false);
      }
      return;
    }
    if (step < 4) setStep((s) => (s + 1) as Step);
  };

  const handleBack = () => {
    if (step > 0) setStep((s) => (s - 1) as Step);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={s.label} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                    done
                      ? 'bg-blue-600 text-white'
                      : active
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 ring-2 ring-blue-600'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {done ? <CheckCircle className="h-4 w-4" /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-6 h-0.5 ${done ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          {step === 0 && <StepWelcome />}
          {step === 1 && <StepUnifi cfg={cfg} setCfg={setCfg} />}
          {step === 2 && <StepAdguard cfg={cfg} setCfg={setCfg} />}
          {step === 3 && <StepSync cfg={cfg} setCfg={setCfg} />}
          {step === 4 && <StepDone />}

          {saveError && (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400 text-center">{saveError}</p>
          )}

          {/* Navigation */}
          <div className={`flex mt-8 ${step === 0 || isLast ? 'justify-end' : 'justify-between'}`}>
            {step > 0 && !isLast && (
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
            )}
            {isLast ? (
              <button
                onClick={() => navigate('/')}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Go to dashboard
              </button>
            ) : (
              <button
                onClick={handleNext}
                disabled={!canAdvance() || saving}
                className="flex items-center gap-1.5 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : step === 3 ? 'Save & start' : 'Next'}
                {!saving && <ChevronRight className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
