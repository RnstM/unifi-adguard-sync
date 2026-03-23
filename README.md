# unifi-adguard-sync

[![Build & Publish](https://github.com/RnstM/unifi-adguard-sync/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/RnstM/unifi-adguard-sync/actions/workflows/docker-publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Automatically syncs clients from a **UniFi Controller** to **AdGuard Home** — with smart device/OS tag detection, DNS rewrite sync, and a built-in web dashboard to manage everything.

![Dashboard screenshot placeholder](https://github.com/user-attachments/assets/placeholder)

---

## Features

**Sync**
- Syncs active UniFi clients (name + IP) to AdGuard Home as named clients
- Auto-detects device type tags (`device_phone`, `device_laptop`, `device_nas`, …)
- Auto-detects OS tags (`os_ios`, `os_android`, `os_windows`, `os_linux`, …)
- Falls back to hostname heuristics when UniFi metadata is missing
- VLAN include/exclude filter
- Stale client cleanup — removes AdGuard clients not seen in UniFi for X days
- Dry-run mode — preview changes without touching AdGuard
- Per-device sync exclusion — skip specific clients from AdGuard sync while preserving their DNS rewrites

**DNS Rewrites**
- Syncs `hostname.yourdomain.com → IP` so devices are reachable by name
- Per-VLAN and per-tag include/exclude filters
- Only manages rewrites it created — manually added rewrites are never removed

**Dashboard** (built-in web UI)
- Overview with sync metrics, client coverage chart, VLAN distribution, and recent sync history
- Clients page — search, filter by VLAN/device type/sync status, bulk actions
- Per-client modal: block/unblock in AdGuard, DNS rewrite management, tag override, sync exclusion toggle
- Tag overrides — manually override auto-detected device/OS tags per client
- Rewrites page listing all active DNS rewrites
- Live logs page
- Configuration page — all settings editable in the UI, no restart needed
- Connection test buttons for UniFi and AdGuard
- Config export/import as JSON
- Sync can be paused, resumed, and manually triggered at any time
- Dark/light theme

**Notifications**
- Sync result notifications via Telegram, Discord, Slack, ntfy, Gotify, or any webhook
- Configurable to notify on errors, changes, or every sync

**Infrastructure**
- Single Docker image — FastAPI backend + React frontend, no separate containers needed
- All persistent data in `/data` (easy volume mount)
- Config and credentials stored encrypted in `/data/config.json`
- Multi-arch: `linux/amd64` + `linux/arm64`

---

## Quick start

### Docker Compose (recommended)

```yaml
services:
  unifi-adguard-sync:
    image: ghcr.io/rnstm/unifi-adguard-sync:latest
    restart: unless-stopped
    ports:
      - "8888:8888"
    env_file: .env
    volumes:
      - unifi-adguard-sync-data:/data

volumes:
  unifi-adguard-sync-data:
```

Copy `.env.example` to `.env`, fill in your credentials, then:

```bash
docker compose up -d
```

The dashboard is available at `http://localhost:8888`.

### Docker run

```bash
docker run -d \
  -e UNIFI_HOST=https://192.168.1.1 \
  -e UNIFI_USER=adguard \
  -e UNIFI_PASS=yourpassword \
  -e ADGUARD_HOST=http://192.168.1.2 \
  -e ADGUARD_USER=admin \
  -e ADGUARD_PASS=yourpassword \
  -p 8888:8888 \
  -v unifi-adguard-sync-data:/data \
  ghcr.io/rnstm/unifi-adguard-sync:latest
```

---

## Configuration

All settings can be configured via environment variables **or** through the dashboard UI. Changes made in the UI are saved to `/data/config.json` and take effect on the next sync without a restart.

### Connections

| Variable | Default | Description |
|---|---|---|
| `UNIFI_HOST` | `https://192.168.1.1` | UniFi Controller URL |
| `UNIFI_USER` | — | UniFi username |
| `UNIFI_PASS` | — | UniFi password |
| `UNIFI_SITE` | `default` | UniFi site name |
| `UNIFI_VERIFY_SSL` | `false` | Verify UniFi TLS certificate |
| `ADGUARD_HOST` | `http://localhost` | AdGuard Home URL |
| `ADGUARD_USER` | — | AdGuard username |
| `ADGUARD_PASS` | — | AdGuard password |

### Sync

| Variable | Default | Description |
|---|---|---|
| `SYNC_INTERVAL` | `300` | Seconds between syncs (`0` = run once and exit) |
| `DRY_RUN` | `false` | Log changes without writing to AdGuard |
| `STALE_AFTER_DAYS` | `0` | Remove AdGuard clients unseen in UniFi for this many days (`0` = disabled) |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |

### VLAN filtering

| Variable | Default | Description |
|---|---|---|
| `INCLUDE_VLANS` | — | Only sync clients on these VLANs, e.g. `10,20,30` |
| `EXCLUDE_VLANS` | — | Skip clients on these VLANs, e.g. `99,100` |
| `VLAN_OS_MAP` | — | VLAN → OS tag fallback, e.g. `200:os_windows,300:os_linux` |

`INCLUDE_VLANS` takes precedence if both are set.

### DNS rewrites

| Variable | Default | Description |
|---|---|---|
| `DNS_REWRITE_ENABLED` | `false` | Enable DNS rewrite sync |
| `DNS_REWRITE_DOMAIN` | — | Domain suffix, e.g. `home.local` → `server.home.local` |
| `DNS_REWRITE_EXCLUDE_TAGS` | phones, tablets, IoT | Comma-separated tags that never get a rewrite |
| `DNS_REWRITE_VLANS` | — | Limit rewrites to these VLANs (empty = all) |
| `DNS_REWRITE_EXCLUDE_VLANS` | — | Skip rewrites for devices on these VLANs |

### Notifications

| Variable | Default | Description |
|---|---|---|
| `NOTIFY_URL` | — | Webhook URL (Discord, Slack, ntfy, Gotify, Telegram, or custom) |
| `NOTIFY_TYPE` | `discord` | `discord`, `slack`, `ntfy`, `gotify`, `telegram`, `webhook` |
| `NOTIFY_ON` | `errors` | `errors`, `changes`, `always` |
| `NOTIFY_TOKEN` | — | Telegram bot token |
| `NOTIFY_CHAT_ID` | — | Telegram chat ID |

### Dashboard

| Variable | Default | Description |
|---|---|---|
| `DASHBOARD_PORT` | `8888` | Dashboard port (`0` = disabled) |

---

## Tag detection

Tags are applied to AdGuard Home clients based on UniFi device metadata.

### Device type tags

Detection order: `dev_cat` (most specific) → `dev_family` → hostname heuristics

| Tag | Devices |
|---|---|
| `device_audio` | Smart speakers (Sonos, Echo, HomePod, Google Home) |
| `device_camera` | IP cameras |
| `device_gameconsole` | PS4/PS5, Xbox, Nintendo Switch |
| `device_laptop` | Laptop, MacBook, iMac |
| `device_nas` | NAS, TrueNAS |
| `device_pc` | Desktop, server, VM |
| `device_phone` | Smartphone, iPhone |
| `device_printer` | Printers |
| `device_securityalarm` | Ring, Nest Protect, alarm systems |
| `device_tablet` | Tablet, iPad |
| `device_tv` | Smart TV, Apple TV, Fire TV, Roku |
| `device_other` | Anything else |

### OS tags

Detection order: `os_name` → VLAN fallback (`VLAN_OS_MAP`) → hostname heuristics

| Tag | OS |
|---|---|
| `os_android` | Android |
| `os_ios` | iOS / iPadOS |
| `os_linux` | Linux |
| `os_macos` | macOS |
| `os_windows` | Windows |
| `os_other` | Other / unknown |

> **Note:** AdGuard Home has no `os_chrome` tag — Chromebooks fall back to `os_other`.

You can override auto-detected tags per device from the dashboard without touching AdGuard directly.

---

## DNS rewrite sync

When enabled, eligible devices get a DNS rewrite so you can reach them by hostname:

```env
DNS_REWRITE_ENABLED=true
DNS_REWRITE_DOMAIN=home.local
```

The hostname comes from the UniFi alias first, falling back to the DHCP hostname. Names are sanitized to valid DNS labels (lowercase, hyphens only). A device named `My NAS` becomes `my-nas.home.local`.

By default, only PCs, laptops, NAS devices, and unrecognised devices get a rewrite. Phones, tablets, and IoT devices are skipped. Override this with `DNS_REWRITE_EXCLUDE_TAGS`.

Only rewrites created by this tool are ever removed — manually added AdGuard rewrites are never touched.

---

## Stale client cleanup

Automatically remove AdGuard clients that haven't appeared in UniFi for a given number of days:

```env
STALE_AFTER_DAYS=30
```

State is persisted in `/data/state.json`. Mount `/data` as a volume to keep state across container restarts.

---

## UniFi account setup

Create a dedicated read-only local account in UniFi:

1. Go to **Settings → Admins & Users → Invite Admin**
2. Set role to **Read Only**
3. Use those credentials as `UNIFI_USER` / `UNIFI_PASS`

---

## License

MIT
