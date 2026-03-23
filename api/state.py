"""
Application state singleton and log capture handler.
"""

import logging
import threading
from collections import deque
from dataclasses import asdict
from typing import Optional

from sync.core import SyncResult


class LogCaptureHandler(logging.Handler):
    """Logging handler that also stores log lines in AppState."""

    def __init__(self, app_state: "AppState") -> None:
        super().__init__()
        self.app_state = app_state
        self.setFormatter(
            logging.Formatter(
                "%(asctime)s [%(levelname)s] %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S",
            )
        )

    def emit(self, record: logging.LogRecord) -> None:
        line = self.format(record)
        self.app_state.add_log(line)


class AppState:
    MAX_HISTORY = 100
    MAX_LOG_LINES = 500

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.sync_history: deque[SyncResult] = deque(maxlen=self.MAX_HISTORY)
        self._last_clients: list[dict] = []
        self._last_rewrites: list[dict] = []
        self._sync_enabled: bool = True
        self._log_lines: deque[str] = deque(maxlen=self.MAX_LOG_LINES)
        # Threading controls
        self._stop_event: Optional[threading.Event] = None
        self._trigger_event: Optional[threading.Event] = None

    def record_sync(self, result: SyncResult) -> None:
        with self._lock:
            self.sync_history.append(result)

    def set_clients(self, clients: list[dict]) -> None:
        with self._lock:
            self._last_clients = list(clients)

    def set_rewrites(self, rewrites: list[dict]) -> None:
        with self._lock:
            self._last_rewrites = list(rewrites)

    def add_log(self, line: str) -> None:
        with self._lock:
            self._log_lines.append(line)

    def get_status(self) -> dict:
        with self._lock:
            last = self.sync_history[-1] if self.sync_history else None
            return {
                "sync_enabled": self._sync_enabled,
                "last_sync": asdict(last) if last is not None else None,
                "total_syncs": len(self.sync_history),
                "total_clients": len(self._last_clients),
                "total_rewrites": len(self._last_rewrites),
            }

    def get_history(self) -> list[dict]:
        with self._lock:
            return [asdict(r) for r in self.sync_history]

    def get_clients(self) -> list[dict]:
        with self._lock:
            return list(self._last_clients)

    def get_rewrites(self) -> list[dict]:
        with self._lock:
            return list(self._last_rewrites)

    def get_logs(self) -> list[str]:
        with self._lock:
            return list(self._log_lines)

    def stop_sync(self) -> None:
        with self._lock:
            self._sync_enabled = False

    def start_sync(self) -> None:
        with self._lock:
            self._sync_enabled = True
        self.trigger_sync()

    def trigger_sync(self) -> None:
        if self._trigger_event is not None:
            self._trigger_event.set()


app_state = AppState()
