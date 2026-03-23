"""Tests for sync/tags.py — get_tags() device and OS tag detection."""

import pytest

from sync.tags import get_tags


# ---------------------------------------------------------------------------
# Device tag — dev_cat takes priority over dev_family
# ---------------------------------------------------------------------------
def test_dev_cat_phone():
    assert "device_phone" in get_tags({"dev_cat": 6})


def test_dev_cat_overrides_family():
    # dev_cat=1 → device_pc, dev_family=3 → device_phone — cat wins
    assert "device_pc" in get_tags({"dev_cat": 1, "dev_family": 3})


def test_dev_family_fallback():
    # no dev_cat, dev_family=24 → device_laptop
    assert "device_laptop" in get_tags({"dev_family": 24})


def test_dev_cat_gameconsole():
    assert "device_gameconsole" in get_tags({"dev_cat": 17})


def test_dev_cat_camera():
    assert "device_camera" in get_tags({"dev_cat": 9})


# ---------------------------------------------------------------------------
# Device tag — name-based fallback (when no dev_cat / dev_family matches)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("name,expected", [
    ("MyiPhone", "device_phone"),
    ("Office-Camera", "device_camera"),
    ("HP-Printer", "device_printer"),
    ("TrueNAS-Scale", "device_nas"),
    ("AppleTV-4K", "device_tv"),
    ("PS5-Console", "device_gameconsole"),
    ("Sonos-Arc", "device_audio"),
    ("Ring-Alarm", "device_securityalarm"),
    ("MacBook-Pro", "device_laptop"),
    ("proxmox-pve", "device_pc"),
])
def test_name_based_device_tag(name, expected):
    tags = get_tags({"name": name})
    assert expected in tags, f"Expected {expected} in tags for '{name}', got {tags}"


def test_unknown_device_defaults_to_other():
    tags = get_tags({"name": "some-random-device"})
    assert "device_other" in tags


# ---------------------------------------------------------------------------
# OS tag — os_name map
# ---------------------------------------------------------------------------
def test_os_name_ios():
    assert "os_ios" in get_tags({"os_name": 24})


def test_os_name_linux():
    assert "os_linux" in get_tags({"os_name": 3})


def test_os_name_android():
    assert "os_android" in get_tags({"os_name": 56})


def test_os_name_macos():
    assert "os_macos" in get_tags({"os_name": 25})


# ---------------------------------------------------------------------------
# OS tag — name-based fallback
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("name,expected_os", [
    ("MyiPhone", "os_ios"),
    ("MacBook-Air", "os_macos"),
    ("Samsung-Galaxy", "os_android"),
    ("ubuntu-server", "os_linux"),
])
def test_name_based_os_tag(name, expected_os):
    tags = get_tags({"name": name})
    assert expected_os in tags, f"Expected {expected_os} in tags for '{name}', got {tags}"


# ---------------------------------------------------------------------------
# Tags are valid AdGuard tags (no typos / unknown values)
# ---------------------------------------------------------------------------
from sync.tags import ADGUARD_DEVICE_TAGS, ADGUARD_OS_TAGS

VALID_TAGS = ADGUARD_DEVICE_TAGS | ADGUARD_OS_TAGS


def test_all_returned_tags_are_valid():
    clients = [
        {"dev_cat": cat} for cat in [1, 2, 6, 9, 17, 30, 44, 46, 49, 57]
    ] + [
        {"dev_family": fam} for fam in [2, 3, 4, 9, 10, 13, 24, 35, 38, 117]
    ] + [
        {"name": n} for n in [
            "iphone", "camera", "printer", "truenas", "appletv",
            "ps5", "sonos", "ring-alarm", "macbook", "proxmox",
        ]
    ]
    for client in clients:
        for tag in get_tags(client):
            assert tag in VALID_TAGS, f"Unknown tag '{tag}' produced for {client}"


# ---------------------------------------------------------------------------
# Always returns exactly one device tag and at most one OS tag
# ---------------------------------------------------------------------------
def test_exactly_one_device_tag():
    for dev_cat in [1, 6, 9, 17]:
        tags = get_tags({"dev_cat": dev_cat})
        device_tags = [t for t in tags if t.startswith("device_")]
        assert len(device_tags) == 1, f"Expected 1 device tag, got {device_tags}"


def test_at_most_one_os_tag():
    for os_name in [24, 25, 56, 3]:
        tags = get_tags({"os_name": os_name})
        os_tags = [t for t in tags if t.startswith("os_")]
        assert len(os_tags) <= 1, f"Expected at most 1 OS tag, got {os_tags}"
