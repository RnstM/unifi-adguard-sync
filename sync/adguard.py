"""
AdGuard Home API client functions.
"""

import logging
import os
import re

import requests

from sync.config import (
    DNS_REWRITE_DOMAIN,
    DNS_REWRITE_ENABLED,
    DNS_REWRITE_EXCLUDE_TAGS,
    DNS_REWRITE_EXCLUDE_VLANS,
    DNS_REWRITE_VLANS,
    DRY_RUN,
    REQUEST_TIMEOUT,
)

log = logging.getLogger(__name__)


def _host() -> str:
    """Read AdGuard host from env at call time so config changes apply without restart."""
    return os.environ.get("ADGUARD_HOST", "http://localhost")


def _auth() -> tuple[str, str]:
    """Read AdGuard credentials from env at call time so config changes apply without restart."""
    return os.environ.get("ADGUARD_USER", ""), os.environ.get("ADGUARD_PASS", "")


# ---------------------------------------------------------------------------
# Client API
# ---------------------------------------------------------------------------
def adguard_get_clients() -> dict[str, dict]:
    r = requests.get(
        f"{_host()}/control/clients",
        auth=_auth(),
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    return {c["ids"][0]: c for c in (r.json().get("clients") or []) if c.get("ids")}


def _client_payload(name: str, ip: str, tags: list[str]) -> dict:
    return {
        "name": name,
        "ids": [ip],
        "tags": tags,
        "use_global_settings": True,
        "use_global_blocked_services": True,
        "filtering_enabled": False,
        "parental_enabled": False,
        "safebrowsing_enabled": False,
        "safesearch_enabled": False,
        "ignore_querylog": False,
        "ignore_statistics": False,
    }


def adguard_add_client(name: str, ip: str, tags: list[str]) -> bool:
    if DRY_RUN:
        log.info("[DRY RUN] Would add:    %s (%s) tags=%s", name, ip, tags)
        return True
    r = requests.post(
        f"{_host()}/control/clients/add",
        auth=_auth(),
        json=_client_payload(name, ip, tags),
        timeout=REQUEST_TIMEOUT,
    )
    return r.status_code == 200


def adguard_update_client(name: str, ip: str, tags: list[str]) -> bool:
    if DRY_RUN:
        log.info("[DRY RUN] Would update: %s (%s) tags=%s", name, ip, tags)
        return True
    r = requests.post(
        f"{_host()}/control/clients/update",
        auth=_auth(),
        json={"name": name, "data": _client_payload(name, ip, tags)},
        timeout=REQUEST_TIMEOUT,
    )
    return r.status_code == 200


def adguard_remove_client(name: str, ip: str) -> bool:
    if DRY_RUN:
        log.info("[DRY RUN] Would remove: %s (%s)", name, ip)
        return True
    r = requests.post(
        f"{_host()}/control/clients/delete",
        auth=_auth(),
        json={"name": name},
        timeout=REQUEST_TIMEOUT,
    )
    return r.status_code == 200


# ---------------------------------------------------------------------------
# DNS rewrite API
# ---------------------------------------------------------------------------
def adguard_get_rewrites() -> dict[str, str]:
    """Returns {domain: answer} for all current DNS rewrites."""
    r = requests.get(
        f"{_host()}/control/rewrite/list",
        auth=_auth(),
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    if not data:
        return {}
    return {item["domain"]: item["answer"] for item in data}


def adguard_add_rewrite(domain: str, ip: str, force: bool = False) -> bool:
    if DRY_RUN and not force:
        log.info("[DRY RUN] Would add rewrite:    %s → %s", domain, ip)
        return True
    log.debug("AdGuard POST /control/rewrite/add  domain=%s answer=%s", domain, ip)
    r = requests.post(
        f"{_host()}/control/rewrite/add",
        auth=_auth(),
        json={"domain": domain, "answer": ip},
        timeout=REQUEST_TIMEOUT,
    )
    log.debug("AdGuard rewrite/add response: HTTP %s", r.status_code)
    return r.status_code == 200


def adguard_delete_rewrite(domain: str, ip: str, force: bool = False) -> bool:
    if DRY_RUN and not force:
        log.info("[DRY RUN] Would remove rewrite: %s → %s", domain, ip)
        return True
    log.debug("AdGuard POST /control/rewrite/delete  domain=%s answer=%s", domain, ip)
    r = requests.post(
        f"{_host()}/control/rewrite/delete",
        auth=_auth(),
        json={"domain": domain, "answer": ip},
        timeout=REQUEST_TIMEOUT,
    )
    log.debug("AdGuard rewrite/delete response: HTTP %s", r.status_code)
    return r.status_code == 200


# ---------------------------------------------------------------------------
# Access list API
# ---------------------------------------------------------------------------
def adguard_get_access() -> dict:
    """Returns the AdGuard Home access list configuration."""
    log.debug("AdGuard GET /control/access/list")
    r = requests.get(
        f"{_host()}/control/access/list",
        auth=_auth(),
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def adguard_set_access(
    allowed: list[str],
    disallowed: list[str],
    blocked_services: list[str],
    force: bool = False,
) -> bool:
    """Replaces the AdGuard Home access list."""
    log.debug(
        "AdGuard POST /control/access/set  allowed=%d disallowed=%d",
        len(allowed),
        len(disallowed),
    )
    r = requests.post(
        f"{_host()}/control/access/set",
        auth=_auth(),
        json={
            "allowed_clients": allowed,
            "disallowed_clients": disallowed,
            "blocked_services": blocked_services,
        },
        timeout=REQUEST_TIMEOUT,
    )
    log.debug("AdGuard access/set response: HTTP %s", r.status_code)
    return r.status_code == 200


def _to_dns_label(name: str) -> str | None:
    """Sanitize a UniFi client name to a valid DNS label."""
    label = name.lower()
    label = re.sub(r"[^a-z0-9-]", "-", label)
    label = re.sub(r"-+", "-", label)
    label = label.strip("-")
    return label or None


def sync_dns_rewrites(
    clients: list[dict], state: dict, sync_excludes: set[str] | None = None
) -> tuple[dict, int, int, int, int]:
    """
    Sync DNS rewrites from UniFi clients to AdGuard Home.
    Returns (state, added, updated, removed, skipped).
    """
    if not DNS_REWRITE_ENABLED:
        return state, 0, 0, 0, 0

    if not DNS_REWRITE_DOMAIN:
        log.warning(
            "DNS_REWRITE_ENABLED=true but DNS_REWRITE_DOMAIN is not set — skipping"
        )
        return state, 0, 0, 0, 0

    _sync_excludes: set[str] = sync_excludes or set()
    current_rewrites = adguard_get_rewrites()
    managed_rewrites: dict[str, str] = state.get("dns_rewrites", {})

    # Build desired state: {fqdn: ip}
    desired: dict[str, str] = {}
    for client in clients:
        if client["ip"] in _sync_excludes:
            continue  # excluded from sync — leave existing rewrite untouched
        name = client["name"] or client["hostname"] or client["ip"]

        device_tag = next((t for t in client["tags"] if t.startswith("device_")), None)

        # Hard exclude by tag (phones, tablets, cameras, etc.)
        if device_tag in DNS_REWRITE_EXCLUDE_TAGS:
            log.debug("Rewrite skip [tag=%s]: %s (%s)", device_tag, name, client["ip"])
            continue

        # Include-only VLAN filter
        if DNS_REWRITE_VLANS and client["vlan"] not in DNS_REWRITE_VLANS:
            log.debug(
                "Rewrite skip [vlan=%s]: %s (%s)", client["vlan"], name, client["ip"]
            )
            continue

        # VLAN excludelist — on excluded VLANs only allow through devices with a
        # clearly identifiable "computer" tag. device_other (unrecognised) is excluded
        # because on IoT/WiFi VLANs that typically means a light bulb or sensor.
        _VLAN_OVERRIDE_TAGS = frozenset({"device_pc", "device_laptop", "device_nas"})
        if (
            client["vlan"] in DNS_REWRITE_EXCLUDE_VLANS
            and device_tag not in _VLAN_OVERRIDE_TAGS
        ):
            log.debug(
                "Rewrite skip [excl-vlan=%s, tag=%s]: %s (%s)",
                client["vlan"],
                device_tag,
                name,
                client["ip"],
            )
            continue

        # alias first, hostname as fallback
        raw_name = client["name"] or client["hostname"]
        label = _to_dns_label(raw_name)
        if not label:
            log.debug("Rewrite skip [no name]: %s", client["ip"])
            continue

        fqdn = f"{label}.{DNS_REWRITE_DOMAIN}"
        log.debug("Rewrite candidate: %s → %s (tag=%s)", fqdn, client["ip"], device_tag)
        desired[fqdn] = client["ip"]

    added = updated = removed = skipped = 0

    # Add / update
    for fqdn, ip in desired.items():
        if fqdn in current_rewrites:
            if current_rewrites[fqdn] != ip:
                adguard_delete_rewrite(fqdn, current_rewrites[fqdn])
                if adguard_add_rewrite(fqdn, ip):
                    if not DRY_RUN:
                        log.info("Rewrite updated: %s → %s", fqdn, ip)
                    updated += 1
            else:
                skipped += 1
        elif fqdn in managed_rewrites:
            # Previously managed but no longer in AdGuard — user deleted it manually.
            # Respect that decision: don't re-add.
            log.debug("Rewrite skip [manually removed]: %s", fqdn)
            skipped += 1
        else:
            if adguard_add_rewrite(fqdn, ip):
                if not DRY_RUN:
                    log.info("Rewrite added:   %s → %s", fqdn, ip)
                added += 1

    # Remove rewrites we manage that are no longer in UniFi
    for fqdn, ip in list(managed_rewrites.items()):
        if ip in _sync_excludes:
            continue  # don't remove rewrites for sync-excluded IPs
        if fqdn not in desired and fqdn in current_rewrites:
            if adguard_delete_rewrite(fqdn, ip):
                if not DRY_RUN:
                    log.info("Rewrite removed: %s (no longer in UniFi)", fqdn)
                removed += 1

    state["dns_rewrites"] = desired
    log.info(
        "DNS rewrites — added: %d, updated: %d, removed: %d, skipped: %d",
        added,
        updated,
        removed,
        skipped,
    )
    return state, added, updated, removed, skipped
