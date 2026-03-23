"""
Device and OS tag detection for UniFi clients.
"""

from sync.config import VLAN_OS_MAP

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
