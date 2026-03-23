# Changelog

## v1.0.0 — 2026-03-23

Initial public release.

### Features

**Sync**
- Automatic UniFi → AdGuard Home client sync (name, IP, tags)
- Configurable sync interval or one-shot mode
- VLAN include/exclude filter
- Stale client cleanup after configurable number of days
- Per-device sync exclusion — exclude specific clients from AdGuard sync while keeping DNS rewrites
- Dry-run mode — preview changes without writing to AdGuard
- Sync can be paused, resumed, and manually triggered from the dashboard

**DNS Rewrites**
- Automatic DNS rewrite sync (`<hostname>.<domain>` → IP)
- Per-VLAN rewrite include/exclude filter
- Tag-based rewrite exclusion
- Sync exclusion preserves existing DNS rewrites (no accidental removal)
- Manual rewrite deletions are respected across sync cycles

**Tag Overrides**
- Override auto-detected device type and OS tags per client from the dashboard
- Overrides are persisted and applied immediately to AdGuard on the next sync
- Clearing an override restores the auto-detected tags

**Dashboard**
- Overview page with sync metrics, client coverage area chart, VLAN distribution, and recent sync history
- Clients page with search, VLAN/device/sync-status filter, bulk sync exclusion, and per-client modal
- Client modal: block/unblock in AdGuard, DNS rewrite management, tag override, sync exclusion toggle
- Rewrites page listing all active DNS rewrites
- Logs page with live log tail
- Configuration page with tabbed layout (Connections / Sync / DNS Rewrites / VLANs)
- Connection test buttons for UniFi and AdGuard
- Config export/import as JSON
- Dark / light theme toggle

**Notifications**
- Sync result notifications via Telegram, Slack, or generic webhook
- Configurable to notify on success, failure, or both
- Test notification button in the dashboard

**Infrastructure**
- Single Docker image — FastAPI backend + React frontend bundled together
- Persistent state and config in `/data` (volume-friendly)
- Encrypted credential storage in config
- CI/CD: Docker image built and pushed to GHCR on version tags
