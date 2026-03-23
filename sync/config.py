"""
Configuration — all env var constants for unifi-adguard-sync.
"""

import os
from pathlib import Path

UNIFI_HOST = os.environ.get("UNIFI_HOST", "https://192.168.1.1")
UNIFI_USER = os.environ.get("UNIFI_USER", "")
UNIFI_PASS = os.environ.get("UNIFI_PASS", "")
UNIFI_SITE = os.environ.get("UNIFI_SITE", "default")
UNIFI_VERIFY_SSL = os.environ.get("UNIFI_VERIFY_SSL", "false").lower() == "true"

ADGUARD_HOST = os.environ.get("ADGUARD_HOST", "http://localhost")
ADGUARD_USER = os.environ.get("ADGUARD_USER", "")
ADGUARD_PASS = os.environ.get("ADGUARD_PASS", "")

SYNC_INTERVAL = int(os.environ.get("SYNC_INTERVAL", "300"))
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"
HEALTH_PORT = int(os.environ.get("HEALTH_PORT", "8080"))
DASHBOARD_PORT = int(os.environ.get("DASHBOARD_PORT", "8888"))
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

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()

# Notifications
NOTIFY_URL = os.environ.get("NOTIFY_URL", "")
NOTIFY_TYPE = os.environ.get(
    "NOTIFY_TYPE", "discord"
)  # discord/ntfy/gotify/telegram/webhook
NOTIFY_ON = os.environ.get("NOTIFY_ON", "errors")  # errors/changes/always
NOTIFY_CHAT_ID = os.environ.get("NOTIFY_CHAT_ID", "")  # Telegram chat ID
NOTIFY_TOKEN = os.environ.get("NOTIFY_TOKEN", "")  # Telegram bot token
