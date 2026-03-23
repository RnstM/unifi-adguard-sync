"""
UniFi API client functions.
"""

import logging

import requests
import urllib3

from sync.config import (
    EXCLUDE_VLANS,
    INCLUDE_VLANS,
    REQUEST_TIMEOUT,
    UNIFI_HOST,
    UNIFI_PASS,
    UNIFI_SITE,
    UNIFI_USER,
    UNIFI_VERIFY_SSL,
)
from sync.tags import get_tags

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

log = logging.getLogger(__name__)

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
                # Extended fields
                "uptime": c.get("uptime"),
                "last_seen": c.get("last_seen"),
                "is_wired": c.get("is_wired", False),
                "signal": c.get("signal"),
                "network": c.get("network", ""),
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
