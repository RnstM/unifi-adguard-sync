"""Tests for sync/core.py — sync logic, tag overrides, exclusions, stale cleanup."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from sync.core import SyncResult, sync


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _make_unifi_client(ip="192.168.1.10", name="TestClient", tags=None, vlan=10):
    return {"ip": ip, "name": name, "tags": tags or ["device_pc"], "vlan": vlan,
            "mac": "aa:bb:cc:dd:ee:ff", "hostname": name}


def _make_adguard_client(ip="192.168.1.10", name="TestClient", tags=None):
    return {"ip": ip, "name": name, "tags": tags or ["device_pc"]}


def _run_sync(unifi_clients, adguard_clients, state=None):
    """Run sync() with mocked UniFi and AdGuard calls."""
    with (
        patch("sync.core.unifi_get_clients", return_value=unifi_clients),
        patch("sync.core._print_vlan_table"),
        patch("sync.core.adguard_get_clients", return_value={
            c["ip"]: c for c in adguard_clients
        }),
        patch("sync.core.adguard_add_client", return_value=True) as mock_add,
        patch("sync.core.adguard_update_client", return_value=True) as mock_update,
        patch("sync.core.adguard_remove_client", return_value=True) as mock_remove,
        patch("sync.core.notify_sync"),
        patch("sync.core.sync_dns_rewrites", return_value=({}, 0, 0, 0, 0, [])),
        patch("sync.core.DNS_REWRITE_ENABLED", False),
    ):
        new_state, result = sync(state or {})
        return new_state, result, mock_add, mock_update, mock_remove


# ---------------------------------------------------------------------------
# Basic add / update / skip
# ---------------------------------------------------------------------------
def test_new_client_is_added():
    client = _make_unifi_client()
    _, result, mock_add, _, _ = _run_sync([client], [])
    mock_add.assert_called_once_with(client["name"], client["ip"], client["tags"])
    assert result.clients_added == 1
    assert result.clients_updated == 0


def test_unchanged_client_is_skipped():
    client = _make_unifi_client()
    adg = _make_adguard_client(tags=["device_pc"])
    _, result, mock_add, mock_update, _ = _run_sync([client], [adg])
    mock_add.assert_not_called()
    mock_update.assert_not_called()
    assert result.clients_skipped == 1


def test_changed_tags_triggers_update():
    client = _make_unifi_client(tags=["device_laptop"])
    adg = _make_adguard_client(tags=["device_pc"])  # different
    _, result, _, mock_update, _ = _run_sync([client], [adg])
    mock_update.assert_called_once()
    assert result.clients_updated == 1


def test_changed_name_triggers_update():
    client = _make_unifi_client(name="NewName")
    adg = _make_adguard_client(name="OldName", tags=["device_pc"])
    _, result, _, mock_update, _ = _run_sync([client], [adg])
    mock_update.assert_called_once()
    assert result.clients_updated == 1


# ---------------------------------------------------------------------------
# Sync exclusions
# ---------------------------------------------------------------------------
def test_excluded_ip_not_synced():
    client = _make_unifi_client(ip="192.168.1.99")
    state = {"sync_excludes": ["192.168.1.99"]}
    _, result, mock_add, mock_update, _ = _run_sync([client], [], state=state)
    mock_add.assert_not_called()
    mock_update.assert_not_called()
    assert result.clients_skipped == 0  # excluded, not counted as skipped


def test_non_excluded_ip_is_synced():
    client = _make_unifi_client(ip="192.168.1.10")
    state = {"sync_excludes": ["192.168.1.99"]}
    _, result, mock_add, _, _ = _run_sync([client], [], state=state)
    mock_add.assert_called_once()
    assert result.clients_added == 1


# ---------------------------------------------------------------------------
# Tag overrides
# ---------------------------------------------------------------------------
def test_tag_override_replaces_device_tag():
    client = _make_unifi_client(tags=["device_pc", "os_linux"])
    state = {
        "tag_overrides": {
            "192.168.1.10": {"device_tag": "device_laptop"}
        }
    }
    _, result, mock_add, _, _ = _run_sync([client], [], state=state)
    call_tags = mock_add.call_args[0][2]
    assert "device_laptop" in call_tags
    assert "device_pc" not in call_tags
    assert "os_linux" in call_tags  # OS tag preserved


def test_tag_override_replaces_os_tag():
    client = _make_unifi_client(tags=["device_phone", "os_android"])
    state = {
        "tag_overrides": {
            "192.168.1.10": {"os_tag": "os_ios"}
        }
    }
    _, result, mock_add, _, _ = _run_sync([client], [], state=state)
    call_tags = mock_add.call_args[0][2]
    assert "os_ios" in call_tags
    assert "os_android" not in call_tags
    assert "device_phone" in call_tags  # device tag preserved


def test_tag_override_for_other_ip_not_applied():
    client = _make_unifi_client(ip="192.168.1.10", tags=["device_pc"])
    state = {
        "tag_overrides": {
            "192.168.1.99": {"device_tag": "device_laptop"}  # different IP
        }
    }
    _, result, mock_add, _, _ = _run_sync([client], [], state=state)
    call_tags = mock_add.call_args[0][2]
    assert "device_pc" in call_tags
    assert "device_laptop" not in call_tags


# ---------------------------------------------------------------------------
# Stale client cleanup
# ---------------------------------------------------------------------------
def test_stale_client_removed_after_threshold():
    old_ts = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
    state = {"192.168.1.50": old_ts}
    adg = _make_adguard_client(ip="192.168.1.50", name="OldClient")

    with patch("sync.core.STALE_AFTER_DAYS", 7):
        _, result, _, _, mock_remove = _run_sync([], [adg], state=state)

    mock_remove.assert_called_once()
    assert result.clients_removed == 1


def test_stale_client_not_removed_before_threshold():
    recent_ts = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    state = {"192.168.1.50": recent_ts}
    adg = _make_adguard_client(ip="192.168.1.50")

    with patch("sync.core.STALE_AFTER_DAYS", 7):
        _, result, _, _, mock_remove = _run_sync([], [adg], state=state)

    mock_remove.assert_not_called()
    assert result.clients_removed == 0


def test_first_seen_orphan_starts_grace_period():
    """Client in AdGuard but not in UniFi, never seen before — starts tracking."""
    adg = _make_adguard_client(ip="192.168.1.50")

    with patch("sync.core.STALE_AFTER_DAYS", 7):
        new_state, result, _, _, mock_remove = _run_sync([], [adg], state={})

    mock_remove.assert_not_called()
    assert "192.168.1.50" in new_state  # grace period started


# ---------------------------------------------------------------------------
# SyncResult changes list
# ---------------------------------------------------------------------------
def test_changes_list_records_added():
    client = _make_unifi_client(ip="192.168.1.10", name="PC1")
    _, result, _, _, _ = _run_sync([client], [])
    assert any(c["action"] == "added" and c["ip"] == "192.168.1.10" for c in result.changes)


def test_changes_list_records_updated():
    client = _make_unifi_client(tags=["device_laptop"])
    adg = _make_adguard_client(tags=["device_pc"])
    _, result, _, _, _ = _run_sync([client], [adg])
    assert any(c["action"] == "updated" for c in result.changes)


def test_changes_list_empty_when_no_changes():
    client = _make_unifi_client(tags=["device_pc"])
    adg = _make_adguard_client(tags=["device_pc"])
    _, result, _, _, _ = _run_sync([client], [adg])
    assert result.changes == []


# ---------------------------------------------------------------------------
# Backoff calculation (constants mirrored from main.py)
# ---------------------------------------------------------------------------
_BACKOFF_BASE = 30
_BACKOFF_MAX = 300


def test_backoff_first_failure_equals_base():
    wait = min(_BACKOFF_BASE * (2 ** 0), _BACKOFF_MAX)
    assert wait == _BACKOFF_BASE


def test_backoff_grows_exponentially():
    waits = [min(_BACKOFF_BASE * (2 ** (f - 1)), _BACKOFF_MAX) for f in range(1, 5)]
    assert waits == [30, 60, 120, 240]


def test_backoff_caps_at_max():
    for failure in range(1, 20):
        wait = min(_BACKOFF_BASE * (2 ** (failure - 1)), _BACKOFF_MAX)
        assert wait <= _BACKOFF_MAX
