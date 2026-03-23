"""
Config file storage with Fernet encryption for sensitive fields.

Config is stored in /data/config.json alongside the state file.
Sensitive fields (passwords) are encrypted with a key stored in /data/.secret_key.
On startup, main.py loads this file and applies values to os.environ before
importing any sync modules.
"""

import json
import os
from pathlib import Path
from typing import Any

_PROJECT_ROOT = Path(__file__).parent.parent
_default_state = (
    "/data/state.json"
    if Path("/data").exists()
    else str(_PROJECT_ROOT / "data" / "state.json")
)
_state_file = os.environ.get("STATE_FILE", _default_state)
DATA_DIR = Path(_state_file).parent
CONFIG_FILE = DATA_DIR / "config.json"
KEY_FILE = DATA_DIR / ".secret_key"

SENSITIVE = {"UNIFI_PASS", "ADGUARD_PASS"}

# Placeholder shown in the API / UI for existing passwords
MASKED = "••••••••"


def _fernet():
    from cryptography.fernet import Fernet

    if not KEY_FILE.exists():
        key = Fernet.generate_key()
        KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        KEY_FILE.write_bytes(key)
        KEY_FILE.chmod(0o600)
    return Fernet(KEY_FILE.read_bytes())


def load_config() -> dict[str, Any] | None:
    """Load config from file, decrypting sensitive fields. Returns None if no file."""
    if not CONFIG_FILE.exists():
        return None
    try:
        data = json.loads(CONFIG_FILE.read_text())
        f = _fernet()
        for field in SENSITIVE:
            if data.get(field):
                try:
                    data[field] = f.decrypt(data[field].encode()).decode()
                except Exception:
                    pass  # not encrypted or wrong key, leave as-is
        return data
    except Exception:
        return None


def save_config(config: dict[str, Any]) -> None:
    """Save config to file, encrypting sensitive fields."""
    f = _fernet()
    data = dict(config)
    for field in SENSITIVE:
        if data.get(field) and data[field] != MASKED:
            data[field] = f.encrypt(data[field].encode()).decode()
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, indent=2))


def apply_to_env(config: dict[str, Any]) -> None:
    """Apply config dict values to os.environ."""
    for k, v in config.items():
        if v is None:
            continue
        if isinstance(v, bool):
            os.environ[k] = "true" if v else "false"
        else:
            os.environ[k] = str(v)


def current_config() -> dict[str, Any]:
    """Return current effective config built from os.environ."""
    return {
        "UNIFI_HOST": os.environ.get("UNIFI_HOST", "https://192.168.1.1"),
        "UNIFI_USER": os.environ.get("UNIFI_USER", ""),
        "UNIFI_PASS": os.environ.get("UNIFI_PASS", ""),
        "UNIFI_SITE": os.environ.get("UNIFI_SITE", "default"),
        "UNIFI_VERIFY_SSL": os.environ.get("UNIFI_VERIFY_SSL", "false").lower()
        == "true",
        "ADGUARD_HOST": os.environ.get("ADGUARD_HOST", "http://192.168.1.2"),
        "ADGUARD_USER": os.environ.get("ADGUARD_USER", ""),
        "ADGUARD_PASS": os.environ.get("ADGUARD_PASS", ""),
        "SYNC_INTERVAL": int(os.environ.get("SYNC_INTERVAL", "300")),
        "LOG_LEVEL": os.environ.get("LOG_LEVEL", "INFO"),
        "DRY_RUN": os.environ.get("DRY_RUN", "false").lower() == "true",
        "HEALTH_PORT": int(os.environ.get("HEALTH_PORT", "8080")),
        "DASHBOARD_PORT": int(os.environ.get("DASHBOARD_PORT", "8888")),
        "STALE_AFTER_DAYS": int(os.environ.get("STALE_AFTER_DAYS", "0")),
        "INCLUDE_VLANS": os.environ.get("INCLUDE_VLANS", ""),
        "EXCLUDE_VLANS": os.environ.get("EXCLUDE_VLANS", ""),
        "VLAN_OS_MAP": os.environ.get("VLAN_OS_MAP", ""),
        "DNS_REWRITE_ENABLED": os.environ.get("DNS_REWRITE_ENABLED", "false").lower()
        == "true",
        "DNS_REWRITE_DOMAIN": os.environ.get("DNS_REWRITE_DOMAIN", ""),
        "DNS_REWRITE_VLANS": os.environ.get("DNS_REWRITE_VLANS", ""),
        "DNS_REWRITE_EXCLUDE_VLANS": os.environ.get("DNS_REWRITE_EXCLUDE_VLANS", ""),
        "DNS_REWRITE_EXCLUDE_TAGS": os.environ.get("DNS_REWRITE_EXCLUDE_TAGS", ""),
        "NOTIFY_URL": os.environ.get("NOTIFY_URL", ""),
        "NOTIFY_TYPE": os.environ.get("NOTIFY_TYPE", "discord"),
        "NOTIFY_ON": os.environ.get("NOTIFY_ON", "errors"),
        "NOTIFY_CHAT_ID": os.environ.get("NOTIFY_CHAT_ID", ""),
        "NOTIFY_TOKEN": os.environ.get("NOTIFY_TOKEN", ""),
    }


def masked_config() -> dict[str, Any]:
    """Return current config with passwords replaced by MASKED."""
    cfg = current_config()
    for field in SENSITIVE:
        if cfg.get(field):
            cfg[field] = MASKED
    return cfg
