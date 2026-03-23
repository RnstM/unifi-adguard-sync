#!/usr/bin/env python3
# ruff: noqa: E402
"""
UniFi -> AdGuard Home sync -- main entrypoint.
Starts the FastAPI dashboard and the sync daemon in parallel.

E402 (module-level import not at top) is suppressed because the config file
must be loaded and applied to os.environ *before* sync modules are imported —
those modules read env vars at import time.
"""

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

# Load config from /data/config.json (if it exists) and apply to env vars
# BEFORE importing sync modules, which read env vars at import time.
from api.config_store import load_config, apply_to_env as _apply_to_env

_stored = load_config()
if _stored:
    _apply_to_env(_stored)

import logging
import signal
import threading

import uvicorn

from sync.config import (
    DASHBOARD_PORT,
    DNS_REWRITE_ENABLED,
    DNS_REWRITE_DOMAIN,
    DNS_REWRITE_EXCLUDE_TAGS,
    DNS_REWRITE_EXCLUDE_VLANS,
    DNS_REWRITE_VLANS,
    DRY_RUN,
    EXCLUDE_VLANS,
    INCLUDE_VLANS,
    LOG_LEVEL,
    METRICS_FILE,
    STALE_AFTER_DAYS,
    SYNC_INTERVAL,
)
from sync.core import SyncResult, load_state, save_state, sync
from api.state import LogCaptureHandler, app_state
from api.main import app

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

# Attach log capture handler to root logger so all log lines go to dashboard
log_handler = LogCaptureHandler(app_state)
log_handler.setLevel(logging.DEBUG)
logging.getLogger().addHandler(log_handler)

# Load persisted sync history
app_state.load_history(METRICS_FILE)


# ---------------------------------------------------------------------------
# Sync daemon
# ---------------------------------------------------------------------------
_BACKOFF_BASE = 30  # seconds for first retry
_BACKOFF_MAX = 300  # cap at 5 minutes


def sync_daemon(stop: threading.Event) -> None:
    app_state._stop_event = stop
    failure_count = 0

    while not stop.is_set():
        # Exponential backoff on consecutive failures, capped at _BACKOFF_MAX
        if failure_count > 0:
            wait = min(_BACKOFF_BASE * (2 ** (failure_count - 1)), _BACKOFF_MAX)
            log.info(
                "Backing off %ds before next sync attempt (failure #%d)",
                wait,
                failure_count,
            )
        else:
            wait = SYNC_INTERVAL if SYNC_INTERVAL > 0 else None

        if app_state._trigger_event is not None:
            app_state._trigger_event.wait(timeout=wait)
        else:
            stop.wait(wait)

        if stop.is_set():
            break

        if app_state._trigger_event is not None and app_state._trigger_event.is_set():
            app_state._trigger_event.clear()

        if not app_state._sync_enabled:
            continue  # sync paused — keep daemon alive, wait for next trigger/interval

        try:
            # Always reload from disk so API writes (tag overrides etc.) are picked up
            state = load_state()
            state, result = sync(state, app_state=app_state)
            # Re-read from disk to pick up any API writes (tag_overrides,
            # sync_excludes) that happened while sync was running, then merge:
            # API-managed keys come from disk, sync-managed keys (IP timestamps)
            # come from the sync result.
            if not DRY_RUN:
                disk_state = load_state()
                for api_key in ("tag_overrides", "sync_excludes"):
                    if api_key in disk_state:
                        state[api_key] = disk_state[api_key]
                    else:
                        state.pop(api_key, None)
                save_state(state)
            app_state.record_sync(result)
            app_state.save_history(METRICS_FILE)
            failure_count = 0  # reset backoff on success
        except Exception as exc:
            failure_count += 1
            log.error("Sync failed (attempt %d): %s", failure_count, exc)
            from datetime import datetime, timezone

            from sync.notify import notify_sync

            result = SyncResult(
                timestamp=datetime.now(timezone.utc).isoformat(),
                success=False,
                duration_ms=0,
                errors=1,
            )
            app_state.record_sync(result)
            app_state.save_history(METRICS_FILE)
            notify_sync(result)

        if SYNC_INTERVAL == 0:
            break


# ---------------------------------------------------------------------------
# Startup logging
# ---------------------------------------------------------------------------
if DRY_RUN:
    log.warning("DRY RUN mode enabled — AdGuard will not be modified")

if INCLUDE_VLANS:
    log.info("VLAN filter: including only VLANs %s", sorted(INCLUDE_VLANS))
elif EXCLUDE_VLANS:
    log.info("VLAN filter: excluding VLANs %s", sorted(EXCLUDE_VLANS))

if STALE_AFTER_DAYS > 0:
    from sync.config import STATE_FILE

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
            sorted(DNS_REWRITE_EXCLUDE_VLANS) if DNS_REWRITE_EXCLUDE_VLANS else "none",
        )
    else:
        log.warning("DNS_REWRITE_ENABLED=true but DNS_REWRITE_DOMAIN is not set")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
stop = threading.Event()
app_state._trigger_event = threading.Event()
app_state._trigger_event.set()  # trigger immediately on startup


def handle_signal(signum: int, _frame) -> None:
    log.info("Signal %d received — shutting down", signum)
    stop.set()


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

# Start sync daemon
sync_thread = threading.Thread(
    target=sync_daemon, args=(stop,), daemon=True, name="sync"
)
sync_thread.start()

# Start uvicorn (non-blocking)
uvicorn_config = uvicorn.Config(
    app, host="0.0.0.0", port=DASHBOARD_PORT, log_level="warning"
)
server = uvicorn.Server(uvicorn_config)

uvicorn_thread = threading.Thread(target=server.run, daemon=True, name="uvicorn")
uvicorn_thread.start()

log.info("Dashboard listening on :%d", DASHBOARD_PORT)
log.info("Starting sync (interval=%ds)", SYNC_INTERVAL)

stop.wait()
server.should_exit = True
log.info("Shutdown complete")
