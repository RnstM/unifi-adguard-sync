"""
FastAPI dashboard application with REST API routes.
"""

import json
import logging
import os
from pathlib import Path

import requests as http_requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from api.config_store import (
    MASKED,
    SENSITIVE,
    apply_to_env,
    current_config,
    masked_config,
    save_config,
)
from api.state import app_state
from sync.config import SYNC_INTERVAL

log = logging.getLogger(__name__)

_version_file = Path(__file__).parent.parent / "VERSION"
APP_VERSION = os.environ.get("APP_VERSION") or (
    _version_file.read_text().strip() if _version_file.exists() else "dev"
)

app = FastAPI(title="UniFi AdGuard Sync Dashboard", version=APP_VERSION)

# CORS middleware for dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------
@app.get("/api/status")
async def get_status() -> JSONResponse:
    status = app_state.get_status()
    status["sync_interval"] = SYNC_INTERVAL
    status["version"] = APP_VERSION
    return JSONResponse(status)


@app.get("/api/clients")
async def get_clients() -> JSONResponse:
    from sync.core import load_state

    clients = [dict(c) for c in app_state.get_clients()]
    tag_overrides: dict = load_state().get("tag_overrides", {})
    for client in clients:
        override = tag_overrides.get(client.get("ip", ""))
        if not override:
            continue
        tags = [
            t
            for t in client.get("tags", [])
            if not (override.get("device_tag") and t.startswith("device_"))
            and not (override.get("os_tag") and t.startswith("os_"))
        ]
        if override.get("device_tag"):
            tags.append(override["device_tag"])
        if override.get("os_tag"):
            tags.append(override["os_tag"])
        client["tags"] = tags
    return JSONResponse(clients)


@app.get("/api/rewrites")
async def get_rewrites() -> JSONResponse:
    from sync.adguard import adguard_get_rewrites

    try:
        raw = adguard_get_rewrites()
        return JSONResponse([{"domain": d, "ip": ip} for d, ip in raw.items()])
    except Exception as exc:
        # Fall back to cached state if AdGuard is unreachable
        log.warning("Could not fetch rewrites from AdGuard: %s — using cache", exc)
        return JSONResponse(app_state.get_rewrites())


@app.get("/api/metrics/history")
async def get_metrics_history() -> JSONResponse:
    return JSONResponse(app_state.get_history())


@app.get("/api/logs")
async def get_logs() -> JSONResponse:
    return JSONResponse({"lines": app_state.get_logs()})


@app.post("/api/sync/trigger")
async def trigger_sync() -> JSONResponse:
    log.info("Sync triggered manually via dashboard")
    app_state.trigger_sync()
    return JSONResponse({"ok": True})


@app.post("/api/sync/stop")
async def stop_sync() -> JSONResponse:
    log.info("Sync paused via dashboard")
    app_state.stop_sync()
    return JSONResponse({"ok": True})


@app.post("/api/sync/start")
async def start_sync() -> JSONResponse:
    log.info("Sync resumed via dashboard")
    app_state.start_sync()
    return JSONResponse({"ok": True})


@app.get("/api/access")
async def get_access() -> JSONResponse:
    from sync.adguard import adguard_get_access

    try:
        data = adguard_get_access()
        return JSONResponse({"disallowed": data.get("disallowed_clients", [])})
    except Exception as exc:
        log.error("Failed to fetch AdGuard access list: %s", exc)
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/api/access/block")
async def block_client(payload: dict) -> JSONResponse:
    from sync.adguard import adguard_get_access, adguard_set_access

    ip: str = payload.get("id", "")
    log.debug("Block request received for: %s", ip)
    try:
        current = adguard_get_access()
        disallowed = current.get("disallowed_clients", [])
        if ip not in disallowed:
            disallowed = [*disallowed, ip]
        ok = adguard_set_access(
            current.get("allowed_clients", []),
            disallowed,
            current.get("blocked_services", []),
            force=True,
        )
        if ok:
            log.info("Client blocked via dashboard: %s", ip)
        else:
            log.warning("AdGuard rejected block request for: %s", ip)
        return JSONResponse({"ok": ok})
    except Exception as exc:
        log.error("Failed to block client %s: %s", ip, exc)
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/api/access/unblock")
async def unblock_client(payload: dict) -> JSONResponse:
    from sync.adguard import adguard_get_access, adguard_set_access

    ip: str = payload.get("id", "")
    log.debug("Unblock request received for: %s", ip)
    try:
        current = adguard_get_access()
        disallowed = [x for x in current.get("disallowed_clients", []) if x != ip]
        ok = adguard_set_access(
            current.get("allowed_clients", []),
            disallowed,
            current.get("blocked_services", []),
            force=True,
        )
        if ok:
            log.info("Client unblocked via dashboard: %s", ip)
        else:
            log.warning("AdGuard rejected unblock request for: %s", ip)
        return JSONResponse({"ok": ok})
    except Exception as exc:
        log.error("Failed to unblock client %s: %s", ip, exc)
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/api/rewrites/add")
async def api_add_rewrite(payload: dict) -> JSONResponse:
    from sync.adguard import adguard_add_rewrite

    domain = payload.get("domain", "")
    ip = payload.get("ip", "")
    log.debug("Rewrite add request received: %s → %s", domain, ip)
    try:
        ok = adguard_add_rewrite(domain, ip, force=True)
        if ok:
            log.info("Rewrite added via dashboard: %s → %s", domain, ip)
        else:
            log.warning("AdGuard rejected rewrite add: %s → %s", domain, ip)
        return JSONResponse({"ok": ok})
    except Exception as exc:
        log.error("Failed to add rewrite %s → %s: %s", domain, ip, exc)
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/api/rewrites/delete")
async def api_delete_rewrite(payload: dict) -> JSONResponse:
    from sync.adguard import adguard_delete_rewrite

    domain = payload.get("domain", "")
    ip = payload.get("ip", "")
    log.debug("Rewrite delete request received: %s → %s", domain, ip)
    try:
        ok = adguard_delete_rewrite(domain, ip, force=True)
        if ok:
            log.info("Rewrite removed via dashboard: %s → %s", domain, ip)
        else:
            log.warning("AdGuard rejected rewrite delete: %s → %s", domain, ip)
        return JSONResponse({"ok": ok})
    except Exception as exc:
        log.error("Failed to delete rewrite %s → %s: %s", domain, ip, exc)
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.get("/api/config")
async def get_config() -> JSONResponse:
    return JSONResponse(masked_config())


@app.post("/api/config")
async def post_config(payload: dict) -> JSONResponse:
    # Merge incoming payload onto current config.
    # Skip MASKED placeholder values so existing passwords are preserved.
    current = current_config()
    for k, v in payload.items():
        if k in SENSITIVE and v == MASKED:
            continue  # keep existing password
        current[k] = v
    save_config(current)
    apply_to_env(current)
    return JSONResponse({"ok": True})


@app.post("/api/restart")
async def restart_app() -> JSONResponse:
    """Replace the running process with a fresh copy to apply new config."""
    import os
    import sys
    import threading

    def _do_restart() -> None:
        import time

        time.sleep(0.8)  # let the HTTP response go out first
        os.execv(sys.executable, [sys.executable, "-u"] + sys.argv)

    threading.Thread(target=_do_restart, daemon=True).start()
    return JSONResponse({"ok": True})


@app.post("/api/test/unifi")
async def test_unifi(payload: dict) -> JSONResponse:
    from api.config_store import MASKED, current_config

    host = payload.get("UNIFI_HOST", "")
    user = payload.get("UNIFI_USER", "")
    password = str(payload.get("UNIFI_PASS", ""))
    site = payload.get("UNIFI_SITE", "default")
    verify_ssl = bool(payload.get("UNIFI_VERIFY_SSL", False))

    if password == MASKED:
        password = current_config().get("UNIFI_PASS", "")

    log.debug("Testing UniFi connection to %s (site=%s)", host, site)
    try:
        session = http_requests.Session()
        r = session.post(
            f"{host}/api/auth/login",
            json={"username": user, "password": password},
            verify=verify_ssl,
            timeout=10,
        )
        if r.status_code == 200:
            return JSONResponse(
                {"ok": True, "message": "Connected to UniFi successfully"}
            )
        return JSONResponse(
            {"ok": False, "message": f"HTTP {r.status_code}: {r.text[:120]}"}
        )
    except Exception as exc:
        return JSONResponse({"ok": False, "message": str(exc)})


@app.post("/api/test/adguard")
async def test_adguard(payload: dict) -> JSONResponse:
    from api.config_store import MASKED, current_config

    host = payload.get("ADGUARD_HOST", "")
    user = payload.get("ADGUARD_USER", "")
    password = str(payload.get("ADGUARD_PASS", ""))

    if password == MASKED:
        password = current_config().get("ADGUARD_PASS", "")

    log.debug("Testing AdGuard connection to %s", host)
    try:
        r = http_requests.get(
            f"{host}/control/status",
            auth=(user, password),
            timeout=10,
        )
        if r.status_code == 200:
            version = r.json().get("version", "unknown")
            return JSONResponse(
                {"ok": True, "message": f"Connected — AdGuard Home {version}"}
            )
        return JSONResponse({"ok": False, "message": f"HTTP {r.status_code}"})
    except Exception as exc:
        return JSONResponse({"ok": False, "message": str(exc)})


@app.get("/api/config/export")
async def export_config() -> Response:
    from api.config_store import current_config

    data = current_config()
    return Response(
        content=json.dumps(data, indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": "attachment; filename=unifi-adguard-sync-config.json"
        },
    )


@app.post("/api/config/import")
async def import_config(payload: dict) -> JSONResponse:
    save_config(payload)
    return JSONResponse({"ok": True})


@app.get("/api/tag-overrides")
async def get_tag_overrides() -> JSONResponse:
    from sync.core import load_state

    state = load_state()
    return JSONResponse(state.get("tag_overrides", {}))


@app.post("/api/tag-overrides")
async def set_tag_override(payload: dict) -> JSONResponse:
    from sync.core import load_state, save_state

    ip = payload.get("ip", "")
    device_tag = payload.get("device_tag") or None
    os_tag = payload.get("os_tag") or None
    if not ip:
        return JSONResponse({"ok": False, "message": "ip required"}, status_code=400)
    state = load_state()
    overrides = state.get("tag_overrides", {})
    new_override = {k: v for k, v in {"device_tag": device_tag, "os_tag": os_tag}.items() if v}
    if new_override:
        overrides[ip] = new_override
    else:
        overrides.pop(ip, None)  # Both fields empty → treat as clear
    state["tag_overrides"] = overrides
    save_state(state)
    log.info("Tag override set for %s: device=%s os=%s", ip, device_tag, os_tag)
    app_state.trigger_sync()
    return JSONResponse({"ok": True})


@app.post("/api/test/notify")
async def test_notify(payload: dict) -> JSONResponse:
    notify_type = payload.get("NOTIFY_TYPE", "discord")
    if notify_type == "telegram":
        token = payload.get("NOTIFY_TOKEN", "")
        if not token:
            return JSONResponse({"ok": False, "message": "NOTIFY_TOKEN is not set"})
        url = f"https://api.telegram.org/bot{token}/sendMessage"
    else:
        url = payload.get("NOTIFY_URL", "")
        if not url:
            return JSONResponse({"ok": False, "message": "NOTIFY_URL is not set"})

    title = "✅ UniFi AdGuard Sync — Test"
    message = "This is a test notification from your dashboard."
    try:
        if notify_type == "discord":
            http_requests.post(
                url,
                json={
                    "embeds": [
                        {"title": title, "description": message, "color": 0x44AA88}
                    ]
                },
                timeout=10,
            )
        elif notify_type == "ntfy":
            http_requests.post(
                url, data=message.encode(), headers={"Title": title}, timeout=10
            )
        elif notify_type == "gotify":
            http_requests.post(
                url,
                json={"title": title, "message": message, "priority": 3},
                timeout=10,
            )
        elif notify_type == "telegram":
            chat_id = payload.get("NOTIFY_CHAT_ID", "")
            if not chat_id:
                return JSONResponse(
                    {"ok": False, "message": "NOTIFY_CHAT_ID is not set"}
                )
            r = http_requests.post(
                url,
                json={
                    "chat_id": chat_id,
                    "text": f"<b>{title}</b>\n{message}",
                    "parse_mode": "HTML",
                },
                timeout=10,
            )
            # Telegram always returns HTTP 200 — check JSON body for API errors
            try:
                body = r.json()
                if not body.get("ok"):
                    return JSONResponse(
                        {
                            "ok": False,
                            "message": body.get(
                                "description", "Unknown Telegram error"
                            ),
                        }
                    )
            except Exception:
                pass
        else:
            http_requests.post(
                url, json={"title": title, "message": message}, timeout=10
            )
        return JSONResponse(
            {"ok": True, "message": f"Test notification sent via {notify_type}"}
        )
    except Exception as exc:
        return JSONResponse({"ok": False, "message": str(exc)})


@app.get("/api/sync/excludes")
async def get_sync_excludes() -> JSONResponse:
    from sync.core import load_state

    state = load_state()
    return JSONResponse(list(state.get("sync_excludes", [])))


@app.post("/api/sync/exclude")
async def exclude_from_sync(payload: dict) -> JSONResponse:
    from sync.core import load_state, save_state

    ip = payload.get("ip", "")
    if not ip:
        return JSONResponse({"ok": False, "message": "ip required"}, status_code=400)
    state = load_state()
    excludes = set(state.get("sync_excludes", []))
    excludes.add(ip)
    state["sync_excludes"] = sorted(excludes)
    save_state(state)
    log.info("Sync exclude added: %s", ip)
    return JSONResponse({"ok": True})


@app.post("/api/sync/include")
async def include_in_sync(payload: dict) -> JSONResponse:
    from sync.core import load_state, save_state

    ip = payload.get("ip", "")
    state = load_state()
    excludes = set(state.get("sync_excludes", []))
    excludes.discard(ip)
    state["sync_excludes"] = sorted(excludes)
    save_state(state)
    log.info("Sync exclude cleared: %s", ip)
    return JSONResponse({"ok": True})


@app.post("/api/tag-overrides/clear")
async def clear_tag_override(payload: dict) -> JSONResponse:
    from sync.core import load_state, save_state

    ip = payload.get("ip", "")
    state = load_state()
    overrides = state.get("tag_overrides", {})
    overrides.pop(ip, None)
    state["tag_overrides"] = overrides
    save_state(state)
    log.info("Tag override cleared for %s", ip)
    app_state.trigger_sync()
    return JSONResponse({"ok": True})


@app.get("/healthz")
async def healthz() -> JSONResponse:
    status = app_state.get_status()
    last_sync = status.get("last_sync")
    if last_sync is not None and not last_sync.get("success", True):
        return JSONResponse({"status": "unhealthy"}, status_code=503)
    return JSONResponse({"status": "ok"})


# ---------------------------------------------------------------------------
# Static frontend (built React app)
# ---------------------------------------------------------------------------
static_dir = Path(__file__).parent.parent / "dashboard" / "dist"
if static_dir.exists():
    # Catch-all: serve index.html for any non-API path so SPA routing works on refresh
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        index = static_dir / "index.html"
        return Response(content=index.read_bytes(), media_type="text/html")

    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
