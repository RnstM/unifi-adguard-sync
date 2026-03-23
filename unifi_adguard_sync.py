#!/usr/bin/env python3
"""
UniFi -> AdGuard Home client sync
Syncs clients from UniFi Controller to AdGuard Home with smart tag detection.

Configuration via environment variables (see .env.example).
"""

import json
import logging
import re

# Load .env file automatically when running locally (optional dev dependency)
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass
import os
import signal
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
UNIFI_HOST = os.environ.get("UNIFI_HOST", "https://192.168.1.1")
UNIFI_USER = os.environ["UNIFI_USER"]
UNIFI_PASS = os.environ["UNIFI_PASS"]
UNIFI_SITE = os.environ.get("UNIFI_SITE", "default")
UNIFI_VERIFY_SSL = os.environ.get("UNIFI_VERIFY_SSL", "false").lower() == "true"

ADGUARD_HOST = os.environ.get("ADGUARD_HOST", "http://localhost")
ADGUARD_USER = os.environ["ADGUARD_USER"]
ADGUARD_PASS = os.environ["ADGUARD_PASS"]

SYNC_INTERVAL = int(os.environ.get("SYNC_INTERVAL", "300"))
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"
HEALTH_PORT = int(os.environ.get("HEALTH_PORT", "8080"))
REQUEST_TIMEOUT = int(os.environ.get("REQUEST_TIMEOUT", "10"))

# VLAN filtering — mutually exclusive; INCLUDE_VLANS takes precedence if both set
INCLUDE_VLANS: frozenset[int] = frozenset(
    int(x) for x in os.environ.get("INCLUDE_VLANS", "").split(",") if x.strip()
)
EXCLUDE_VLANS: frozenset[int] = frozenset(
    int(x) for x in os.environ.get("EXCLUDE_VLANS", "").split(",") if x.strip()
)

# Stale client cleanup
STALE_AFTER_DAYS = int(os.environ.get("STALE_AFTER_DAYS", "0"))
STATE_FILE = Path(os.environ.get("STATE_FILE", "/data/state.json"))

# DNS rewrite sync
DNS_REWRITE_ENABLED = os.environ.get("DNS_REWRITE_ENABLED", "false").lower() == "true"
DNS_REWRITE_DOMAIN = os.environ.get("DNS_REWRITE_DOMAIN", "")
# Excludelist: tags that never get a DNS rewrite (phones, tablets, IoT, etc.)
# device_pc, device_laptop, device_nas, device_other all get rewrites by default.
_DNS_REWRITE_EXCLUDE_TAGS_DEFAULT = (
    "device_phone,device_tablet,device_tv,device_camera,"
    "device_audio,device_printer,device_gameconsole,device_securityalarm"
)
DNS_REWRITE_EXCLUDE_TAGS: frozenset[str] = frozenset(
    x.strip()
    for x in os.environ.get(
        "DNS_REWRITE_EXCLUDE_TAGS", _DNS_REWRITE_EXCLUDE_TAGS_DEFAULT
    ).split(",")
    if x.strip()
)
# Include-only VLAN filter (empty = all VLANs)
DNS_REWRITE_VLANS: frozenset[int] = frozenset(
    int(x) for x in os.environ.get("DNS_REWRITE_VLANS", "").split(",") if x.strip()
)
# VLAN excludelist — skip devices on these VLANs unless their tag is NOT in the exclude list
# e.g. a laptop on a WiFi VLAN still gets a rewrite, a phone does not
DNS_REWRITE_EXCLUDE_VLANS: frozenset[int] = frozenset(
    int(x)
    for x in os.environ.get("DNS_REWRITE_EXCLUDE_VLANS", "").split(",")
    if x.strip()
)

# Optional VLAN -> OS tag fallback
VLAN_OS_MAP: dict[int, str] = {}
for _entry in os.environ.get("VLAN_OS_MAP", "").split(","):
    _entry = _entry.strip()
    if ":" in _entry:
        _vid, _tag = _entry.split(":", 1)
        try:
            VLAN_OS_MAP[int(_vid)] = _tag.strip()
        except ValueError:
            pass

# ---------------------------------------------------------------------------
# Health state
# ---------------------------------------------------------------------------
_health_lock = threading.Lock()
_last_sync_ok: bool | None = None  # None = not yet synced
_last_sync_at: float = 0.0


def _set_health(ok: bool) -> None:
    global _last_sync_ok, _last_sync_at
    with _health_lock:
        _last_sync_ok = ok
        _last_sync_at = time.monotonic()


def _is_healthy() -> bool:
    with _health_lock:
        if _last_sync_ok is None:
            return True  # still starting up
        if not _last_sync_ok:
            return False
        if SYNC_INTERVAL > 0:
            # Unhealthy if we haven't synced within 3× the interval
            return (time.monotonic() - _last_sync_at) < SYNC_INTERVAL * 3
        return True


# ---------------------------------------------------------------------------
# Health HTTP server
# ---------------------------------------------------------------------------
class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            ok = _is_healthy()
            status = 200 if ok else 503
            body = b"ok\n" if ok else b"unhealthy\n"
        else:
            status, body = 404, b"not found\n"

        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_) -> None:  # suppress access logs
        pass


def _start_health_server() -> None:
    if HEALTH_PORT == 0:
        return
    server = HTTPServer(("", HEALTH_PORT), _HealthHandler)
    threading.Thread(target=server.serve_forever, daemon=True, name="health").start()
    log.info("Health endpoint listening on :%d/healthz", HEALTH_PORT)


# ---------------------------------------------------------------------------
# State (for stale client tracking)
# ---------------------------------------------------------------------------
def load_state() -> dict[str, str]:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception as exc:
        log.warning("Could not load state file %s: %s", STATE_FILE, exc)
        return {}


def save_state(state: dict[str, str]) -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=2))
    except Exception as exc:
        log.warning("Could not save state file %s: %s", STATE_FILE, exc)


# ---------------------------------------------------------------------------
# Device / OS tag maps
# ---------------------------------------------------------------------------
DEV_FAMILY_MAP: dict[int, str] = {
    2: "device_pc",
    3: "device_phone",
    4: "device_phone",
    7: "device_other",
    9: "device_phone",
    10: "device_tablet",
    13: "device_pc",
    24: "device_laptop",
    35: "device_camera",
    38: "device_camera",
    117: "device_pc",
}

DEV_CAT_MAP: dict[int, str] = {
    1: "device_pc",
    2: "device_other",
    6: "device_phone",
    9: "device_camera",
    17: "device_gameconsole",
    30: "device_tablet",
    44: "device_tablet",
    46: "device_pc",
    49: "device_printer",
    57: "device_camera",
    182: "device_pc",
}

OS_NAME_MAP: dict[int, str] = {
    1: "os_other",
    3: "os_linux",
    18: "os_linux",
    24: "os_ios",
    25: "os_macos",
    56: "os_android",
    60: "os_linux",
    75: "os_linux",
}

# All valid AdGuard Home tags (from AdGuardHome/internal/client/storage.go).
# user_* tags (user_admin, user_child, user_regular) are intentionally excluded
# — these are user-specific labels that should be set manually in AdGuard.
ADGUARD_DEVICE_TAGS = frozenset(
    {
        "device_audio",
        "device_camera",
        "device_gameconsole",
        "device_laptop",
        "device_nas",
        "device_other",
        "device_pc",
        "device_phone",
        "device_printer",
        "device_securityalarm",
        "device_tablet",
        "device_tv",
    }
)
ADGUARD_OS_TAGS = frozenset(
    {
        "os_android",
        "os_ios",
        "os_linux",
        "os_macos",
        "os_other",
        "os_windows",
    }
)


def get_tags(client: dict) -> list[str]:
    tags: list[str] = []

    dev_cat = client.get("dev_cat", 0)
    dev_family = client.get("dev_family", 0)

    if dev_cat and dev_cat in DEV_CAT_MAP:
        tags.append(DEV_CAT_MAP[dev_cat])
    elif dev_family and dev_family in DEV_FAMILY_MAP:
        tags.append(DEV_FAMILY_MAP[dev_family])
    else:
        name = (client.get("name") or client.get("hostname") or "").lower()
        if any(x in name for x in ["iphone", "ipad"]):
            tags.append("device_phone")
        elif any(x in name for x in ["camera", "cam", "ipc"]):
            tags.append("device_camera")
        elif any(x in name for x in ["printer", "print"]):
            tags.append("device_printer")
        elif any(x in name for x in ["nas", "truenas"]):
            tags.append("device_nas")
        elif any(x in name for x in ["appletv", "smarttv", "firetv", "rokutv"]):
            tags.append("device_tv")
        elif any(x in name for x in ["ps4", "ps5", "xbox", "nintendo", "switch"]):
            tags.append("device_gameconsole")
        elif any(
            x in name
            for x in ["sonos", "echo", "homepod", "alexa", "google-home", "nest-audio"]
        ):
            tags.append("device_audio")
        elif any(
            x in name for x in ["ring", "alarm", "nest-protect", "simplisafe", "eufy"]
        ):
            tags.append("device_securityalarm")
        elif any(
            x in name for x in ["macbook", "imac", "mac-mini", "macmini", "mac-pro"]
        ):
            tags.append("device_laptop")
        elif any(
            x in name
            for x in ["pve", "proxmox", "docker", "server", "srv", "k3s", "k8s", "pbs"]
        ):
            tags.append("device_pc")
        else:
            tags.append("device_other")

    os_name = client.get("os_name", 0)
    vlan = client.get("vlan") or client.get("gw_vlan") or 0

    if os_name and os_name in OS_NAME_MAP:
        tags.append(OS_NAME_MAP[os_name])
    elif vlan in VLAN_OS_MAP:
        tags.append(VLAN_OS_MAP[vlan])
    else:
        name = (client.get("name") or client.get("hostname") or "").lower()
        if any(x in name for x in ["iphone", "ipad"]):
            tags.append("os_ios")
        elif any(
            x in name for x in ["macbook", "imac", "macmini", "mac-mini", "mac-pro"]
        ):
            tags.append("os_macos")
        elif any(x in name for x in ["android", "galaxy", "samsung"]):
            tags.append("os_android")
        elif any(x in name for x in ["chromebook", "chrome-"]):
            tags.append("os_other")  # AdGuard has no os_chrome tag
        elif any(x in name for x in ["win", "windows"]):
            tags.append("os_windows")
        elif any(x in name for x in ["pve", "proxmox", "docker", "linux", "ubuntu"]):
            tags.append("os_linux")

    return tags


# ---------------------------------------------------------------------------
# UniFi API
# ---------------------------------------------------------------------------
_unifi_session: requests.Session | None = None


def _unifi_login() -> requests.Session:
    session = requests.Session()
    session.verify = UNIFI_VERIFY_SSL
    r = session.post(
        f"{UNIFI_HOST}/api/auth/login",
        json={"username": UNIFI_USER, "password": UNIFI_PASS},
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    log.debug("UniFi session established")
    return session


def unifi_get_clients() -> list[dict]:
    global _unifi_session

    if _unifi_session is None:
        _unifi_session = _unifi_login()

    r = _unifi_session.get(
        f"{UNIFI_HOST}/proxy/network/api/s/{UNIFI_SITE}/stat/sta",
        timeout=REQUEST_TIMEOUT,
    )

    if r.status_code == 401:
        log.debug("UniFi session expired — re-logging in")
        _unifi_session = _unifi_login()
        r = _unifi_session.get(
            f"{UNIFI_HOST}/proxy/network/api/s/{UNIFI_SITE}/stat/sta",
            timeout=REQUEST_TIMEOUT,
        )

    r.raise_for_status()

    clients = []
    skipped_vlan = 0

    for c in r.json().get("data", []):
        ip = c.get("ip") or c.get("last_ip")
        name = c.get("name") or c.get("hostname") or ""

        if not ip or not name:
            continue

        # VLAN filtering
        vlan = c.get("vlan") or c.get("gw_vlan") or 0
        if INCLUDE_VLANS and vlan not in INCLUDE_VLANS:
            skipped_vlan += 1
            continue
        if vlan in EXCLUDE_VLANS:
            skipped_vlan += 1
            continue

        clients.append(
            {
                "ip": ip,
                "name": name,
                "mac": c.get("mac", ""),
                "hostname": c.get("hostname", ""),
                "vlan": vlan,
                "dev_cat": c.get("dev_cat", 0),
                "dev_family": c.get("dev_family", 0),
                "os_name": c.get("os_name", 0),
                "tags": get_tags(c),
            }
        )

    if skipped_vlan:
        log.debug("Skipped %d clients due to VLAN filter", skipped_vlan)

    return clients


def _print_vlan_table(clients: list[dict]) -> None:
    """Log a per-VLAN summary table of fetched UniFi clients."""
    by_vlan: dict[int, list[dict]] = {}
    for c in clients:
        by_vlan.setdefault(c["vlan"], []).append(c)

    headers = ["HOSTNAME", "IP", "MAC", "DEVICE TAG", "OS TAG"]

    for vlan in sorted(by_vlan):
        group = sorted(by_vlan[vlan], key=lambda x: x["name"].lower())
        vlan_label = f"VLAN {vlan}" if vlan else "no VLAN"
        log.debug(
            "  ┌─ %s — %d client%s",
            vlan_label,
            len(group),
            "s" if len(group) != 1 else "",
        )

        rows = []
        for c in group:
            dev_tag = next((t for t in c["tags"] if t.startswith("device_")), "—")
            os_tag = next((t for t in c["tags"] if t.startswith("os_")), "—")
            rows.append(
                [c["hostname"] or c["name"], c["ip"], c["mac"], dev_tag, os_tag]
            )

        # Dynamic column widths
        widths = [
            max(len(headers[i]), max(len(r[i]) for r in rows))
            for i in range(len(headers))
        ]
        sep = "─┼─".join("─" * w for w in widths)
        header_str = " │ ".join(h.ljust(w) for h, w in zip(headers, widths))

        log.debug("  │  %s", header_str)
        log.debug("  │  %s", sep)
        for row in rows:
            log.debug("  │  %s", " │ ".join(v.ljust(w) for v, w in zip(row, widths)))

    log.debug(
        "  └─ total: %d clients across %d VLAN%s",
        len(clients),
        len(by_vlan),
        "s" if len(by_vlan) != 1 else "",
    )


# ---------------------------------------------------------------------------
# AdGuard API
# ---------------------------------------------------------------------------
def adguard_get_clients() -> dict[str, dict]:
    r = requests.get(
        f"{ADGUARD_HOST}/control/clients",
        auth=(ADGUARD_USER, ADGUARD_PASS),
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    return {c["ids"][0]: c for c in r.json().get("clients", []) if c.get("ids")}


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
        f"{ADGUARD_HOST}/control/clients/add",
        auth=(ADGUARD_USER, ADGUARD_PASS),
        json=_client_payload(name, ip, tags),
        timeout=REQUEST_TIMEOUT,
    )
    return r.status_code == 200


def adguard_update_client(name: str, ip: str, tags: list[str]) -> bool:
    if DRY_RUN:
        log.info("[DRY RUN] Would update: %s (%s) tags=%s", name, ip, tags)
        return True
    r = requests.post(
        f"{ADGUARD_HOST}/control/clients/update",
        auth=(ADGUARD_USER, ADGUARD_PASS),
        json={"name": name, "data": _client_payload(name, ip, tags)},
        timeout=REQUEST_TIMEOUT,
    )
    return r.status_code == 200


def adguard_remove_client(name: str, ip: str) -> bool:
    if DRY_RUN:
        log.info("[DRY RUN] Would remove: %s (%s)", name, ip)
        return True
    r = requests.post(
        f"{ADGUARD_HOST}/control/clients/delete",
        auth=(ADGUARD_USER, ADGUARD_PASS),
        json={"name": name},
        timeout=REQUEST_TIMEOUT,
    )
    return r.status_code == 200


# ---------------------------------------------------------------------------
# AdGuard DNS rewrite API
# ---------------------------------------------------------------------------
def adguard_get_rewrites() -> dict[str, str]:
    """Returns {domain: answer} for all current DNS rewrites."""
    r = requests.get(
        f"{ADGUARD_HOST}/control/rewrite/list",
        auth=(ADGUARD_USER, ADGUARD_PASS),
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    return {item["domain"]: item["answer"] for item in r.json()}


def adguard_add_rewrite(domain: str, ip: str) -> bool:
    if DRY_RUN:
        log.info("[DRY RUN] Would add rewrite:    %s → %s", domain, ip)
        return True
    r = requests.post(
        f"{ADGUARD_HOST}/control/rewrite/add",
        auth=(ADGUARD_USER, ADGUARD_PASS),
        json={"domain": domain, "answer": ip},
        timeout=REQUEST_TIMEOUT,
    )
    return r.status_code == 200


def adguard_delete_rewrite(domain: str, ip: str) -> bool:
    if DRY_RUN:
        log.info("[DRY RUN] Would remove rewrite: %s → %s", domain, ip)
        return True
    r = requests.post(
        f"{ADGUARD_HOST}/control/rewrite/delete",
        auth=(ADGUARD_USER, ADGUARD_PASS),
        json={"domain": domain, "answer": ip},
        timeout=REQUEST_TIMEOUT,
    )
    return r.status_code == 200


def _to_dns_label(name: str) -> str | None:
    """Sanitize a UniFi client name to a valid DNS label."""
    label = name.lower()
    label = re.sub(r"[^a-z0-9-]", "-", label)
    label = re.sub(r"-+", "-", label)
    label = label.strip("-")
    return label or None


def sync_dns_rewrites(clients: list[dict], state: dict) -> dict:
    """Sync DNS rewrites from UniFi clients to AdGuard Home."""
    if not DNS_REWRITE_ENABLED:
        return state

    if not DNS_REWRITE_DOMAIN:
        log.warning(
            "DNS_REWRITE_ENABLED=true but DNS_REWRITE_DOMAIN is not set — skipping"
        )
        return state

    current_rewrites = adguard_get_rewrites()
    managed_rewrites: dict[str, str] = state.get("dns_rewrites", {})

    # Build desired state: {fqdn: ip}
    desired: dict[str, str] = {}
    for client in clients:
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
        else:
            if adguard_add_rewrite(fqdn, ip):
                if not DRY_RUN:
                    log.info("Rewrite added:   %s → %s", fqdn, ip)
                added += 1

    # Remove rewrites we manage that are no longer in UniFi
    for fqdn, ip in list(managed_rewrites.items()):
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
    return state


# ---------------------------------------------------------------------------
# Main sync
# ---------------------------------------------------------------------------
def sync(state: dict[str, str]) -> dict[str, str]:
    if DRY_RUN:
        log.info("--- DRY RUN MODE — no changes will be written ---")

    log.info("Fetching UniFi clients...")
    unifi_clients = unifi_get_clients()
    log.info("Found %d clients in UniFi (after VLAN filter)", len(unifi_clients))
    _print_vlan_table(unifi_clients)

    log.info("Fetching AdGuard clients...")
    adguard_clients = adguard_get_clients()
    log.info("Found %d clients in AdGuard", len(adguard_clients))

    added = updated = skipped = removed = errors = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    unifi_ips = {c["ip"] for c in unifi_clients}

    # Update last_seen for all current UniFi clients
    for ip in unifi_ips:
        state[ip] = now_iso

    # Add / update
    for client in unifi_clients:
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

    state = sync_dns_rewrites(unifi_clients, state)
    return state


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    if DRY_RUN:
        log.warning("DRY RUN mode enabled — AdGuard will not be modified")

    if INCLUDE_VLANS:
        log.info("VLAN filter: including only VLANs %s", sorted(INCLUDE_VLANS))
    elif EXCLUDE_VLANS:
        log.info("VLAN filter: excluding VLANs %s", sorted(EXCLUDE_VLANS))

    if STALE_AFTER_DAYS > 0:
        log.info(
            "Stale cleanup enabled: removing clients unseen for >%d days (state: %s)",
            STALE_AFTER_DAYS,
            STATE_FILE,
        )

    if DNS_REWRITE_ENABLED:
        if DNS_REWRITE_DOMAIN:
            log.info(
                "DNS rewrite sync enabled: domain=%s exclude_tags=%s vlans=%s excl_vlans=%s",
                DNS_REWRITE_DOMAIN,
                sorted(DNS_REWRITE_EXCLUDE_TAGS),
                sorted(DNS_REWRITE_VLANS) if DNS_REWRITE_VLANS else "all",
                sorted(DNS_REWRITE_EXCLUDE_VLANS)
                if DNS_REWRITE_EXCLUDE_VLANS
                else "none",
            )
        else:
            log.warning("DNS_REWRITE_ENABLED=true but DNS_REWRITE_DOMAIN is not set")

    _start_health_server()

    stop = threading.Event()

    def _handle_signal(signum: int, _frame) -> None:
        log.info("Received signal %d — shutting down gracefully", signum)
        stop.set()

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    state = load_state() if (STALE_AFTER_DAYS > 0 or DNS_REWRITE_ENABLED) else {}

    log.info("Starting sync (interval=%ds)", SYNC_INTERVAL)

    if SYNC_INTERVAL == 0:
        try:
            sync(state)
            _set_health(True)
        except Exception as exc:
            log.error("Sync failed: %s", exc)
            _set_health(False)
    else:
        while not stop.is_set():
            try:
                state = sync(state)
                if STALE_AFTER_DAYS > 0 or DNS_REWRITE_ENABLED:
                    save_state(state)
                _set_health(True)
            except Exception as exc:
                log.error("Sync failed: %s", exc)
                _set_health(False)

            log.info(
                "Next sync in %d seconds (Ctrl+C or SIGTERM to stop)", SYNC_INTERVAL
            )
            stop.wait(SYNC_INTERVAL)

    log.info("Shutdown complete")
