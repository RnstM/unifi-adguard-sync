export interface SyncChange {
  action: 'added' | 'updated' | 'removed';
  name: string;
  ip: string;
}

export interface SyncResult {
  timestamp: string;
  success: boolean;
  duration_ms: number;
  clients_added: number;
  clients_updated: number;
  clients_skipped: number;
  clients_removed: number;
  errors: number;
  rewrites_added: number;
  rewrites_updated: number;
  rewrites_removed: number;
  rewrites_skipped: number;
  unifi_clients: number;
  adguard_clients: number;
  changes?: SyncChange[];
}

export interface AppStatus {
  sync_enabled: boolean;
  last_sync: SyncResult | null;
  total_syncs: number;
  total_clients: number;
  total_rewrites: number;
  sync_interval: number;
  version?: string;
}

export interface TagOverride {
  device_tag?: string;
  os_tag?: string;
}

export interface Client {
  name: string;
  ip: string;
  mac: string;
  hostname: string;
  vlan: number;
  tags: string[];
  // Extended UniFi fields
  uptime?: number;
  last_seen?: number;
  is_wired?: boolean;
  signal?: number;
  network?: string;
}

export interface Rewrite {
  domain: string;
  ip: string;
}
