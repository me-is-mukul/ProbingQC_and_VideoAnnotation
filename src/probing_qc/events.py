"""Machine-readable progress events: one JSON object per line (JSON Lines).

This is the contract between the Python pipeline and any caller that wants live
progress (the web frontend spawns ``python -m probing_qc.cli.job`` and reads
stdout). Every event has:

    v        schema version of the event format (``EVENT_VERSION``)
    t        Unix time in seconds (float)
    type     "stage" | "progress" | "log" | "result" | "error"

and type-specific fields:

    stage     stage, status ("start" | "done" | "skip"), message, [data]
    progress  stage, done, total (int or null), message, [unit]
    log       level ("debug" | "info" | "warning" | "error"), logger, message
    result    path (results file), message
    error     stage (or null), message, [error_type]

Bump ``EVENT_VERSION`` when a field is renamed or removed; adding fields is
backwards compatible. The TypeScript mirror lives in
``frontend/src/lib/shared/events.ts``.
"""

from __future__ import annotations

import json
import logging
import math
import sys
import time
from typing import Any, Callable, TextIO

EVENT_VERSION = 1
EVENT_TYPES = ("stage", "progress", "log", "result", "error")
STAGE_STATUSES = ("start", "done", "skip")


def json_safe(value: Any) -> Any:
    """Replace NaN/inf (not valid JSON) with ``None``, recursively."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    return value


def make_event(type_: str, now: float | None = None, **fields: Any) -> dict:
    if type_ not in EVENT_TYPES:
        raise ValueError(f"Unknown event type {type_!r}")
    return {"v": EVENT_VERSION, "t": round(time.time() if now is None else now, 3),
            "type": type_, **json_safe(fields)}


class EventEmitter:
    """Writes events to ``stream`` (one JSON line each, flushed). ``stream=None`` discards them."""

    def __init__(self, stream: TextIO | None = sys.stdout, clock: Callable[[], float] = time.time):
        self.stream = stream
        self.clock = clock

    def emit(self, type_: str, **fields: Any) -> dict:
        event = make_event(type_, now=self.clock(), **fields)
        if self.stream is not None:
            self.stream.write(json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n")
            self.stream.flush()
        return event

    def stage(self, stage: str, status: str, message: str, data: dict | None = None) -> dict:
        if status not in STAGE_STATUSES:
            raise ValueError(f"Unknown stage status {status!r}")
        fields: dict[str, Any] = {"stage": stage, "status": status, "message": message}
        if data is not None:
            fields["data"] = data
        return self.emit("stage", **fields)

    def progress(self, stage: str, done: int, total: int | None, message: str,
                 unit: str | None = None) -> dict:
        fields: dict[str, Any] = {"stage": stage, "done": int(done),
                                  "total": None if total is None else int(total), "message": message}
        if unit:
            fields["unit"] = unit
        return self.emit("progress", **fields)

    def log(self, level: str, message: str, logger: str = "") -> dict:
        return self.emit("log", level=level, logger=logger, message=message)

    def result(self, path: str, message: str) -> dict:
        return self.emit("result", path=path, message=message)

    def error(self, message: str, stage: str | None = None, error_type: str | None = None) -> dict:
        fields: dict[str, Any] = {"stage": stage, "message": message}
        if error_type:
            fields["error_type"] = error_type
        return self.emit("error", **fields)


class Throttle:
    """Lets a call through at most every ``interval_s`` seconds, plus always the final one.

    Used to keep per-frame progress from flooding the event stream.
    """

    def __init__(self, interval_s: float = 0.5, clock: Callable[[], float] = time.monotonic):
        self.interval_s = interval_s
        self.clock = clock
        self._last: float | None = None

    def ready(self, final: bool = False) -> bool:
        now = self.clock()
        if final or self._last is None or now - self._last >= self.interval_s:
            self._last = now
            return True
        return False


_LEVELS = {logging.DEBUG: "debug", logging.INFO: "info", logging.WARNING: "warning",
           logging.ERROR: "error", logging.CRITICAL: "error"}


class EventLogHandler(logging.Handler):
    """Forwards Python log records as ``log`` events so callers see them with their level."""

    def __init__(self, emitter: EventEmitter, level: int = logging.INFO):
        super().__init__(level)
        self.emitter = emitter

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = _LEVELS.get(record.levelno, "info")
            self.emitter.log(level, record.getMessage(), logger=record.name)
        except Exception:  # never let logging break the pipeline
            self.handleError(record)
