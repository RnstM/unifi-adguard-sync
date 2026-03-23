"""
FastAPI dashboard application with REST API routes.
"""

import json
import logging
import os
from pathlib import Path
from urllib.parse import urlparse

import requests as http_requests
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

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

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — self-hosted tool, frontend is served from the same origin in production.
# Wildcard is intentional to support local dev (Vite on a different port).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
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


@app.get("/api/health")
async def get_health() -> JSONResponse:
    """Check connectivity to UniFi and AdGuard. Used by the dashboard header."""
    import os

    adguard_ok = False
    unifi_ok = False

    try:
        r = http_requests.get(
            f"{os.environ.get('ADGUARD_HOST', '')}/control/status",
            auth=(
                os.environ.get("ADGUARD_USER", ""),
                os.environ.get("ADGUARD_PASS", ""),
            ),
            timeout=5,
        )
        adguard_ok = r.status_code == 200
    except Exception:
        pass

    try:
        host = os.environ.get("UNIFI_HOST", "")
        verify_ssl = os.environ.get("UNIFI_VERIFY_SSL", "false").lower() == "true"
        r = http_requests.get(
            f"{host}/api/auth/login",
            verify=verify_ssl,
            timeout=5,
        )
        # login page reachable = controller is up (any HTTP response counts)
        unifi_ok = r.status_code in (200, 400, 401, 404)
    except Exception:
        pass

    return JSONResponse({"adguard": adguard_ok, "unifi": unifi_ok})


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
@limiter.limit("10/minute")
async def trigger_sync(request: Request) -> JSONResponse:
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
        return JSONResponse({"error": "Failed to fetch access list"}, status_code=500)


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
        return JSONResponse({"error": "Failed to block client"}, status_code=500)


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
        return JSONResponse({"error": "Failed to unblock client"}, status_code=500)


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
        return JSONResponse({"error": "Failed to add rewrite"}, status_code=500)


@app.post("/api/rewrites/update")
async def api_update_rewrite(payload: dict) -> JSONResponse:
    from sync.adguard import adguard_add_rewrite, adguard_delete_rewrite

    old_domain = payload.get("old_domain", "")
    old_ip = payload.get("old_ip", "")
    new_domain = payload.get("new_domain", "").strip()
    new_ip = payload.get("new_ip", "").strip()
    if not all([old_domain, old_ip, new_domain, new_ip]):
        return JSONResponse({"ok": False, "error": "Missing fields"}, status_code=400)
    try:
        adguard_delete_rewrite(old_domain, old_ip, force=True)
        ok = adguard_add_rewrite(new_domain, new_ip, force=True)
        if ok:
            log.info(
                "Rewrite updated via dashboard: %s → %s (was %s → %s)",
                new_domain,
                new_ip,
                old_domain,
                old_ip,
            )
        return JSONResponse({"ok": ok})
    except Exception as exc:
        log.error("Failed to update rewrite: %s", exc)
        return JSONResponse({"error": "Failed to update rewrite"}, status_code=500)


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
        return JSONResponse({"error": "Failed to delete rewrite"}, status_code=500)


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
@limiter.limit("5/minute")
async def restart_app(request: Request) -> JSONResponse:
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
@limiter.limit("10/minute")
async def test_unifi(request: Request, payload: dict) -> JSONResponse:
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
        log.error("UniFi connection test failed: %s", exc)
        return JSONResponse(
            {
                "ok": False,
                "message": f"{type(exc).__name__}: {exc.args[0] if exc.args else 'Connection failed'}",
            }
        )


@app.post("/api/test/adguard")
@limiter.limit("10/minute")
async def test_adguard(request: Request, payload: dict) -> JSONResponse:
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
        log.error("AdGuard connection test failed: %s", exc)
        return JSONResponse(
            {
                "ok": False,
                "message": f"{type(exc).__name__}: {exc.args[0] if exc.args else 'Connection failed'}",
            }
        )


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
    new_override = {
        k: v for k, v in {"device_tag": device_tag, "os_tag": os_tag}.items() if v
    }
    if new_override:
        overrides[ip] = new_override
    else:
        overrides.pop(ip, None)  # Both fields empty → treat as clear
    state["tag_overrides"] = overrides
    save_state(state)
    log.info("Tag override set for %s: device=%s os=%s", ip, device_tag, os_tag)
    app_state.trigger_sync()
    return JSONResponse({"ok": True})


def _validate_notify_url(url: str) -> str | None:
    """Return an error message if the URL is not a safe http/https URL, else None."""
    try:
        parsed = urlparse(url)
    except Exception:
        return "Invalid URL"
    if parsed.scheme not in ("http", "https"):
        return "URL must use http or https"
    return None


@app.post("/api/test/notify")
@limiter.limit("10/minute")
async def test_notify(request: Request, payload: dict) -> JSONResponse:
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
        if err := _validate_notify_url(url):
            return JSONResponse({"ok": False, "message": err})

    title = "✅ UniFi AdGuard Sync — Test"
    message = "This is a test notification from your dashboard."
    try:
        # URL is user-configured webhook, scheme validated above  # lgtm[py/full-ssrf]
        if notify_type == "discord":
            http_requests.post(  # lgtm[py/full-ssrf]
                url,
                json={
                    "embeds": [
                        {"title": title, "description": message, "color": 0x44AA88}
                    ]
                },
                timeout=10,
            )
        elif notify_type == "ntfy":
            http_requests.post(  # lgtm[py/full-ssrf]
                url, data=message.encode(), headers={"Title": title}, timeout=10
            )
        elif notify_type == "gotify":
            http_requests.post(  # lgtm[py/full-ssrf]
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
            r = http_requests.post(  # lgtm[py/full-ssrf]
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
            http_requests.post(  # lgtm[py/full-ssrf]
                url, json={"title": title, "message": message}, timeout=10
            )
        return JSONResponse(
            {"ok": True, "message": f"Test notification sent via {notify_type}"}
        )
    except Exception as exc:
        log.error("Notification test failed: %s", exc)
        return JSONResponse(
            {
                "ok": False,
                "message": f"{type(exc).__name__}: {exc.args[0] if exc.args else 'Request failed'}",
            }
        )


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
    # Catch-all: serve static file if it exists, otherwise return index.html for SPA routing
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # Strip traversal components before constructing the path
        safe_parts = [p for p in full_path.split("/") if p and p != ".."]
        file_path = static_dir.joinpath(*safe_parts) if safe_parts else static_dir
        if file_path.is_file():
            return FileResponse(file_path)
        return Response(
            content=(static_dir / "index.html").read_bytes(), media_type="text/html"
        )

    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
