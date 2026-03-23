"""
Notification support — send webhook notifications after sync cycles.
Supports Discord, ntfy, Gotify, Telegram, and generic webhooks.
"""

import logging
import os
from typing import TYPE_CHECKING

import requests

if TYPE_CHECKING:
    from sync.core import SyncResult

log = logging.getLogger(__name__)


def _cfg() -> tuple[str, str, str, str]:
    """Read notification config from env at call time so changes apply without restart."""
    notify_type = os.environ.get("NOTIFY_TYPE", "discord")
    if notify_type == "telegram":
        token = os.environ.get("NOTIFY_TOKEN", "")
        url = f"https://api.telegram.org/bot{token}/sendMessage" if token else ""
    else:
        url = os.environ.get("NOTIFY_URL", "")
    return (
        url,
        notify_type,
        os.environ.get("NOTIFY_ON", "errors"),
        os.environ.get("NOTIFY_CHAT_ID", ""),
    )


def notify_sync(result: "SyncResult") -> None:
    """Send a notification based on NOTIFY_ON setting. Silently skips if NOTIFY_URL is unset."""
    url, notify_type, notify_on, chat_id = _cfg()
    if not url:
        return

    should_notify = False
    if notify_on == "always":
        should_notify = True
    elif notify_on == "changes":
        total_changes = (
            result.clients_added
            + result.clients_updated
            + result.clients_removed
            + result.rewrites_added
            + result.rewrites_updated
            + result.rewrites_removed
        )
        should_notify = total_changes > 0 or result.errors > 0
    elif notify_on == "errors":
        should_notify = result.errors > 0 or not result.success

    if not should_notify:
        return

    has_errors = result.errors > 0 or not result.success
    title = "⚠️ UniFi AdGuard Sync — Error" if has_errors else "✅ UniFi AdGuard Sync"
    color = 0xFF4444 if has_errors else 0x44AA88
    priority = 7 if has_errors else 3

    lines = []
    if result.clients_added:
        lines.append(f"+{result.clients_added} clients added")
    if result.clients_updated:
        lines.append(f"~{result.clients_updated} clients updated")
    if result.clients_removed:
        lines.append(f"-{result.clients_removed} clients removed")
    if result.rewrites_added:
        lines.append(f"+{result.rewrites_added} rewrites added")
    if result.rewrites_removed:
        lines.append(f"-{result.rewrites_removed} rewrites removed")
    if result.errors:
        lines.append(f"⚠ {result.errors} errors")
    if not lines:
        lines.append("No changes")
    message = "\n".join(lines)

    try:
        if notify_type == "discord":
            _send_discord(url, title, message, color)
        elif notify_type == "ntfy":
            _send_ntfy(url, title, message)
        elif notify_type == "gotify":
            _send_gotify(url, title, message, priority)
        elif notify_type == "telegram":
            _send_telegram(url, chat_id, title, message)
        else:
            _send_webhook(url, title, message)
        log.info("Notification sent via %s", notify_type)
    except Exception as exc:
        log.warning("Notification failed (%s): %s", notify_type, exc)


def _check(r: requests.Response, service: str) -> None:
    if not r.ok:
        log.warning(
            "Notification HTTP %s from %s: %s", r.status_code, service, r.text[:200]
        )


def _send_discord(url: str, title: str, message: str, color: int) -> None:
    r = requests.post(
        url,
        json={"embeds": [{"title": title, "description": message, "color": color}]},
        timeout=10,
    )
    _check(r, "Discord")


def _send_ntfy(url: str, title: str, message: str) -> None:
    r = requests.post(
        url,
        data=message.encode(),
        headers={"Title": title},
        timeout=10,
    )
    _check(r, "ntfy")


def _send_gotify(url: str, title: str, message: str, priority: int) -> None:
    r = requests.post(
        url,
        json={"title": title, "message": message, "priority": priority},
        timeout=10,
    )
    _check(r, "Gotify")


def _send_telegram(url: str, chat_id: str, title: str, message: str) -> None:
    if not chat_id:
        log.warning("Telegram notification skipped: NOTIFY_CHAT_ID is not set")
        return
    text = f"<b>{title}</b>\n{message}"
    r = requests.post(
        url,
        json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
        timeout=10,
    )
    # Telegram always returns HTTP 200 — check the JSON body for API-level errors
    try:
        body = r.json()
        if not body.get("ok"):
            log.warning("Telegram API error: %s", body.get("description", r.text[:200]))
            return
    except Exception:
        _check(r, "Telegram")


def _send_webhook(url: str, title: str, message: str) -> None:
    r = requests.post(
        url,
        json={"title": title, "message": message},
        timeout=10,
    )
    _check(r, "webhook")
