"""
Core sync logic — SyncResult dataclass, sync(), load_state(), save_state().
"""

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Optional

import requests

from sync.adguard import (
    adguard_add_client,
    adguard_get_clients,
    adguard_remove_client,
    adguard_update_client,
    sync_dns_rewrites,
)
from sync.config import (
    DNS_REWRITE_ENABLED,
    DRY_RUN,
    STALE_AFTER_DAYS,
    STATE_FILE,
)
from sync.notify import notify_sync
from sync.unifi import _print_vlan_table, unifi_get_clients

if TYPE_CHECKING:
    from api.state import AppState

log = logging.getLogger(__name__)


@dataclass
class SyncResult:
    timestamp: str  # ISO format
    success: bool
    duration_ms: int
    clients_added: int = 0
    clients_updated: int = 0
    clients_skipped: int = 0
    clients_removed: int = 0
    errors: int = 0
    rewrites_added: int = 0
    rewrites_updated: int = 0
    rewrites_removed: int = 0
    rewrites_skipped: int = 0
    unifi_clients: int = 0
    adguard_clients: int = 0


# ---------------------------------------------------------------------------
# State persistence
# ---------------------------------------------------------------------------
def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception as exc:
        log.warning("Could not load state file %s: %s", STATE_FILE, exc)
        return {}


def save_state(state: dict[str, Any]) -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=2))
    except Exception as exc:
        log.warning("Could not save state file %s: %s", STATE_FILE, exc)


# ---------------------------------------------------------------------------
# Main sync function
# ---------------------------------------------------------------------------
def sync(
    state: dict[str, Any],
    app_state: Optional["AppState"] = None,
) -> tuple[dict[str, Any], SyncResult]:
    """
    Run a full sync cycle. Returns (updated_state, SyncResult).
    Optionally updates app_state with live client/rewrite data.
    """
    t_start = time.monotonic()
    timestamp = datetime.now(timezone.utc).isoformat()

    if DRY_RUN:
        log.info("--- DRY RUN MODE — no changes will be written ---")

    log.info("Fetching UniFi clients...")
    unifi_clients = unifi_get_clients()
    log.info("Found %d clients in UniFi (after VLAN filter)", len(unifi_clients))
    _print_vlan_table(unifi_clients)

    # Filter out sync-excluded IPs for AdGuard client sync
    # (DNS rewrites handle exclusions separately to avoid removing existing entries)
    sync_excludes: set[str] = set(state.get("sync_excludes", []))
    unifi_clients_for_sync = unifi_clients
    if sync_excludes:
        unifi_clients_for_sync = [
            c for c in unifi_clients if c["ip"] not in sync_excludes
        ]
        skipped_exc = len(unifi_clients) - len(unifi_clients_for_sync)
        if skipped_exc:
            log.debug("Skipped %d sync-excluded client(s)", skipped_exc)

    # Store original (pre-override) clients so the API can apply current overrides
    # in real-time without waiting for the next sync cycle.
    if app_state is not None:
        app_state.set_clients(unifi_clients)

    # Apply tag overrides from state (set manually via dashboard)
    tag_overrides: dict[str, dict] = state.get("tag_overrides", {})
    if tag_overrides:
        for client in unifi_clients:
            override = tag_overrides.get(client["ip"])
            if not override:
                continue
            tags = [
                t
                for t in client["tags"]
                if not (override.get("device_tag") and t.startswith("device_"))
                and not (override.get("os_tag") and t.startswith("os_"))
            ]
            if override.get("device_tag"):
                tags.append(override["device_tag"])
            if override.get("os_tag"):
                tags.append(override["os_tag"])
            client["tags"] = tags
            log.debug(
                "Tag override applied for %s (%s): %s",
                client["name"],
                client["ip"],
                tags,
            )

    log.info("Fetching AdGuard clients...")
    adguard_clients = adguard_get_clients()
    log.info("Found %d clients in AdGuard", len(adguard_clients))

    added = updated = skipped = removed = errors = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    unifi_ips = {c["ip"] for c in unifi_clients_for_sync}

    # Update last_seen for all current UniFi clients
    for ip in unifi_ips:
        state[ip] = now_iso

    # Add / update
    for client in unifi_clients_for_sync:
        ip, name, tags = client["ip"], client["name"], client["tags"]
        try:
            if ip in adguard_clients:
                existing = adguard_clients[ip]
                if existing["name"] != name or sorted(
                    existing.get("tags", [])
                ) != sorted(tags):
                    if adguard_update_client(name, ip, tags):
                        if not DRY_RUN:
                            log.info("Updated:  %s (%s) tags=%s", name, ip, tags)
                        updated += 1
                    else:
                        log.warning("Failed to update: %s (%s)", name, ip)
                        errors += 1
                else:
                    skipped += 1
            else:
                if adguard_add_client(name, ip, tags):
                    if not DRY_RUN:
                        log.info("Added:    %s (%s) tags=%s", name, ip, tags)
                    added += 1
                else:
                    log.warning("Failed to add: %s (%s)", name, ip)
                    errors += 1
        except requests.RequestException as exc:
            log.error("Request error for %s (%s): %s", name, ip, exc)
            errors += 1

    # Stale client cleanup
    if STALE_AFTER_DAYS > 0:
        for ip, adg_client in adguard_clients.items():
            if ip in unifi_ips:
                continue  # still active in UniFi

            adg_name = adg_client.get("name", ip)
            last_seen_iso = state.get(ip)

            if last_seen_iso is None:
                # First time we see this orphan — start the grace period clock
                state[ip] = now_iso
                log.debug("Stale tracking started for %s (%s)", adg_name, ip)
                continue

            last_seen = datetime.fromisoformat(last_seen_iso)
            age_days = (datetime.now(timezone.utc) - last_seen).days

            if age_days >= STALE_AFTER_DAYS:
                try:
                    if adguard_remove_client(adg_name, ip):
                        log.info(
                            "Removed stale: %s (%s) — last seen %d days ago",
                            adg_name,
                            ip,
                            age_days,
                        )
                        state.pop(ip, None)
                        removed += 1
                    else:
                        log.warning("Failed to remove stale: %s (%s)", adg_name, ip)
                        errors += 1
                except requests.RequestException as exc:
                    log.error("Request error removing %s (%s): %s", adg_name, ip, exc)
                    errors += 1
            else:
                log.debug(
                    "Stale candidate: %s (%s) — %d/%d days",
                    adg_name,
                    ip,
                    age_days,
                    STALE_AFTER_DAYS,
                )

    log.info(
        "Done — added: %d, updated: %d, skipped: %d, removed: %d, errors: %d",
        added,
        updated,
        skipped,
        removed,
        errors,
    )

    # DNS rewrites
    rw_added = rw_updated = rw_removed = rw_skipped = 0
    if DNS_REWRITE_ENABLED:
        state, rw_added, rw_updated, rw_removed, rw_skipped = sync_dns_rewrites(
            unifi_clients, state, sync_excludes=sync_excludes
        )
        # Build rewrite list for dashboard
        desired_rewrites = state.get("dns_rewrites", {})
        rewrite_list = [
            {"domain": domain, "ip": ip} for domain, ip in desired_rewrites.items()
        ]
        if app_state is not None:
            app_state.set_rewrites(rewrite_list)
    else:
        if app_state is not None:
            app_state.set_rewrites([])

    duration_ms = int((time.monotonic() - t_start) * 1000)

    result = SyncResult(
        timestamp=timestamp,
        success=True,
        duration_ms=duration_ms,
        clients_added=added,
        clients_updated=updated,
        clients_skipped=skipped,
        clients_removed=removed,
        errors=errors,
        rewrites_added=rw_added,
        rewrites_updated=rw_updated,
        rewrites_removed=rw_removed,
        rewrites_skipped=rw_skipped,
        unifi_clients=len(unifi_clients),
        adguard_clients=len(adguard_clients),
    )

    notify_sync(result)

    return state, result
