# unifi-adguard-sync

[![Build & Publish](https://github.com/RnstM/unifi-adguard-sync/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/RnstM/unifi-adguard-sync/actions/workflows/docker-publish.yml)
[![Image](https://ghcr.io/RnstM/unifi-adguard-sync)](https://ghcr.io/RnstM/unifi-adguard-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Automatically syncs clients from a **UniFi Controller** to **AdGuard Home**, complete with smart device/OS tag detection based on UniFi device metadata.

## Features

- Syncs active UniFi clients (IP + hostname) to AdGuard Home
- Auto-detects device type tags (`device_phone`, `device_laptop`, `device_camera`, …)
- Auto-detects OS tags (`os_ios`, `os_android`, `os_linux`, `os_windows`, …)
- Falls back to hostname-based heuristics when UniFi metadata is missing
- **Dry-run mode** — preview all changes without touching AdGuard
- **VLAN filtering** — include or exclude specific VLANs from the sync
- **Stale client cleanup** — automatically remove clients not seen in UniFi for X days
- **Health endpoint** (`/healthz`) for Kubernetes liveness/readiness probes
- Graceful shutdown on `SIGTERM` — safe for rolling deploys
- **DNS rewrite sync** — syncs hostname→IP to AdGuard so devices are reachable by name (e.g. `ssh server.rnst.nl`)
- Persistent UniFi session — re-authenticates only when the session expires
- Configurable request timeouts — prevents hanging on unreachable hosts
- Runs as a daemon with a configurable sync interval, or once and exits
- Designed for Docker / Kubernetes (k3s) deployment
- Multi-arch image: `linux/amd64` + `linux/arm64`

## Quick start

### Docker

```bash
docker run -d \
  -e UNIFI_HOST=https://192.168.1.1 \
  -e UNIFI_USER=adguard \
  -e UNIFI_PASS=yourpassword \
  -e ADGUARD_HOST=http://192.168.1.2 \
  -e ADGUARD_USER=admin \
  -e ADGUARD_PASS=yourpassword \
  ghcr.io/RnstM/unifi-adguard-sync:latest
```

### Docker Compose

```yaml
services:
  unifi-adguard-sync:
    image: ghcr.io/RnstM/unifi-adguard-sync:latest
    restart: unless-stopped
    env_file: .env
```

Copy `.env.example` to `.env` and fill in your values.

### Kubernetes / k3s

```bash
# 1. Create secret (fill in base64-encoded values first)
cp k8s/secret.example.yaml k8s/secret.yaml
kubectl apply -f k8s/secret.yaml

# 2. Update image and host values in k8s/deployment.yaml, then:
kubectl apply -f k8s/deployment.yaml
```

## Configuration

All configuration is done via environment variables.

| Variable | Required | Default | Description |
|---|---|---|---|
| `UNIFI_HOST` | | `https://192.168.1.1` | UniFi Controller URL |
| `UNIFI_USER` | **yes** | — | UniFi username |
| `UNIFI_PASS` | **yes** | — | UniFi password |
| `UNIFI_SITE` | | `default` | UniFi site name |
| `UNIFI_VERIFY_SSL` | | `false` | Verify UniFi TLS certificate |
| `ADGUARD_HOST` | | `http://localhost` | AdGuard Home URL |
| `ADGUARD_USER` | **yes** | — | AdGuard username |
| `ADGUARD_PASS` | **yes** | — | AdGuard password |
| `SYNC_INTERVAL` | | `300` | Seconds between syncs (`0` = run once) |
| `LOG_LEVEL` | | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `DRY_RUN` | | `false` | Log what would change without writing to AdGuard |
| `HEALTH_PORT` | | `8080` | Port for `/healthz` endpoint (`0` = disabled) |
| `INCLUDE_VLANS` | | — | Only sync clients on these VLANs, e.g. `10,20,30` |
| `EXCLUDE_VLANS` | | — | Skip clients on these VLANs, e.g. `99,100` |
| `STALE_AFTER_DAYS` | | `0` | Remove AdGuard clients unseen in UniFi for this many days (`0` = disabled) |
| `STATE_FILE` | | `/data/state.json` | Path to last-seen state file (used by stale cleanup) |
| `REQUEST_TIMEOUT` | | `10` | HTTP request timeout in seconds for all API calls |
| `DNS_REWRITE_ENABLED` | | `false` | Enable DNS rewrite sync |
| `DNS_REWRITE_DOMAIN` | if enabled | — | Domain suffix, e.g. `rnst.nl` → `server.rnst.nl` |
| `DNS_REWRITE_DEVICE_TAGS` | | `device_pc,device_laptop,device_nas` | Device tags eligible for DNS rewrites |
| `DNS_REWRITE_VLANS` | | — | Limit DNS rewrites to these VLANs (empty = all) |
| `VLAN_OS_MAP` | | — | VLAN→OS tag fallback, e.g. `200:os_windows,300:os_linux` |

## Tag detection

Tags are applied to clients in AdGuard Home based on UniFi device metadata.

### Device type tags

Detection priority: **`dev_cat`** (most specific) → **`dev_family`** → **hostname heuristics**

| Tag | Devices |
|---|---|
| `device_audio` | Smart speakers (Sonos, Echo, HomePod, Google Home) |
| `device_camera` | IP camera |
| `device_gameconsole` | PS4, PS5, Xbox, Nintendo Switch |
| `device_laptop` | Laptop, MacBook, iMac |
| `device_nas` | NAS, TrueNAS |
| `device_other` | Anything else |
| `device_pc` | Desktop, server, VM |
| `device_phone` | Smartphone, iPhone |
| `device_printer` | Printer |
| `device_securityalarm` | Ring, alarm systems, Nest Protect |
| `device_tablet` | Tablet, iPad |
| `device_tv` | Smart TV, Apple TV, Fire TV, Roku |

### OS tags

Detection priority: **`os_name`** → **VLAN fallback** → **hostname heuristics**

| Tag | OS |
|---|---|
| `os_android` | Android |
| `os_ios` | iOS |
| `os_linux` | Linux |
| `os_macos` | macOS |
| `os_other` | Other |
| `os_windows` | Windows |

> **Note:** AdGuard Home has no `os_chrome` tag — Chromebooks fall back to `os_other`.
> The `user_admin`, `user_child` and `user_regular` tags exist in AdGuard but are intentionally
> not set automatically — assign these manually per client in AdGuard.

## Dry-run mode

Before your first real sync, run once with `DRY_RUN=true` to preview what would be added, updated, or removed:

```bash
docker run --rm \
  -e UNIFI_USER=adguard -e UNIFI_PASS=secret \
  -e ADGUARD_USER=admin -e ADGUARD_PASS=secret \
  -e DRY_RUN=true -e SYNC_INTERVAL=0 \
  ghcr.io/RnstM/unifi-adguard-sync:latest
```

## VLAN filtering

Sync only specific VLANs (whitelist):
```
INCLUDE_VLANS=10,20,30
```

Or exclude specific VLANs (blacklist):
```
EXCLUDE_VLANS=99,100
```

`INCLUDE_VLANS` takes precedence if both are set.

## Stale client cleanup

Enable to automatically remove AdGuard clients that haven't appeared in UniFi for a given number of days:

```
STALE_AFTER_DAYS=30
STATE_FILE=/data/state.json
```

The state file tracks when each client was last seen. In Kubernetes, uncomment the `PersistentVolumeClaim` in `k8s/deployment.yaml` to persist state across pod restarts.

## DNS rewrite sync

When enabled, devices with matching tags get a DNS rewrite in AdGuard so you can reach them by hostname:

```
DNS_REWRITE_ENABLED=true
DNS_REWRITE_DOMAIN=rnst.nl
DNS_REWRITE_DEVICE_TAGS=device_pc,device_laptop,device_nas
```

The hostname is taken from the **UniFi alias** first, falling back to the DHCP hostname. The name is sanitized to a valid DNS label (lowercase, hyphens). A device named `prd-k3s-01` becomes `prd-k3s-01.rnst.nl`.

Only rewrites created by this tool are ever removed — manually added AdGuard rewrites are never touched. When a device disappears from UniFi, its rewrite is removed on the next sync.

## UniFi account setup

Create a read-only local user in UniFi:

1. Go to **Settings → Admins & Users → Add Admin**
2. Role: **Read Only**
3. Use those credentials in `UNIFI_USER` / `UNIFI_PASS`

## License

MIT
