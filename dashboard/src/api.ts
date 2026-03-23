import type { AppStatus, Client, HealthStatus, Rewrite, SyncResult } from './types';

const BASE = '/api';

export const getStatus = (): Promise<AppStatus> =>
  fetch(`${BASE}/status`).then((r) => r.json());

export const getHealth = (): Promise<HealthStatus> =>
  fetch(`${BASE}/health`).then((r) => r.json());

export const getClients = (): Promise<Client[]> =>
  fetch(`${BASE}/clients`).then((r) => r.json());

export const getRewrites = (): Promise<Rewrite[]> =>
  fetch(`${BASE}/rewrites`).then((r) => r.json());

export const getMetricsHistory = (): Promise<SyncResult[]> =>
  fetch(`${BASE}/metrics/history`).then((r) => r.json());

export const getLogs = (): Promise<{ lines: string[] }> =>
  fetch(`${BASE}/logs`).then((r) => r.json());

export const triggerSync = (): Promise<void> =>
  fetch(`${BASE}/sync/trigger`, { method: 'POST' }).then(() => {});

export const stopSync = (): Promise<void> =>
  fetch(`${BASE}/sync/stop`, { method: 'POST' }).then(() => {});

export const startSync = (): Promise<void> =>
  fetch(`${BASE}/sync/start`, { method: 'POST' }).then(() => {});

export const getConfig = (): Promise<Record<string, unknown>> =>
  fetch(`${BASE}/config`).then((r) => r.json());

export const saveConfig = (config: Record<string, unknown>): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }).then((r) => r.json());

export const restartApp = (): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/restart`, { method: 'POST' }).then((r) => r.json());

export const getAccess = (): Promise<{ disallowed: string[] }> =>
  fetch(`${BASE}/access`).then((r) => r.json());

export const blockClient = (ip: string): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/access/block`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: ip }),
  }).then((r) => r.json());

export const unblockClient = (ip: string): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/access/unblock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: ip }),
  }).then((r) => r.json());

export const addRewrite = (domain: string, ip: string): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/rewrites/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, ip }),
  }).then((r) => r.json());

export const updateRewrite = (
  old_domain: string,
  old_ip: string,
  new_domain: string,
  new_ip: string,
): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/rewrites/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_domain, old_ip, new_domain, new_ip }),
  }).then((r) => r.json());

export const deleteRewrite = (domain: string, ip: string): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/rewrites/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, ip }),
  }).then((r) => r.json());

export const testUnifi = (cfg: Record<string, unknown>): Promise<{ ok: boolean; message: string }> =>
  fetch(`${BASE}/test/unifi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  }).then((r) => r.json());

export const testAdguard = (cfg: Record<string, unknown>): Promise<{ ok: boolean; message: string }> =>
  fetch(`${BASE}/test/adguard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  }).then((r) => r.json());

export const exportConfig = (): Promise<void> =>
  fetch(`${BASE}/config/export`)
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'unifi-adguard-sync-config.json';
      a.click();
      URL.revokeObjectURL(url);
    });

export const importConfig = (data: Record<string, unknown>): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/config/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => r.json());

export const getTagOverrides = (): Promise<Record<string, { device_tag?: string; os_tag?: string }>> =>
  fetch(`${BASE}/tag-overrides`).then((r) => r.json());

export const setTagOverride = (
  ip: string,
  device_tag: string | null,
  os_tag: string | null,
): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/tag-overrides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip, device_tag, os_tag }),
  }).then((r) => r.json());

export const clearTagOverride = (ip: string): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/tag-overrides/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip }),
  }).then((r) => r.json());

export const getSyncExcludes = (): Promise<string[]> =>
  fetch(`${BASE}/sync/excludes`).then((r) => r.json());

export const excludeFromSync = (ip: string): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/sync/exclude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip }),
  }).then((r) => r.json());

export const includeInSync = (ip: string): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/sync/include`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip }),
  }).then((r) => r.json());
