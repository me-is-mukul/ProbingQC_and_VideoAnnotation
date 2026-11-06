"""Decode a video once with FFmpeg and yield every Nth frame as RGB.

FFmpeg still decodes every frame (HEVC frames depend on each other), so decode
errors are detected for the whole range; only the selected frames are piped out.
"""

from __future__ import annotations

import math
import queue
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import numpy as np

from ..telemetry import require_tool
from .metadata import VideoInfo

PREFETCH_FRAMES = 8  # decoded frames buffered ahead of analysis (~16 MB each at 2.7K)


@dataclass(frozen=True)
class Frame:
    index: int          # frame number in the source video
    timestamp_s: float  # index / fps (GoPro footage is constant frame rate)
    rgb: np.ndarray     # (height, width, 3) uint8


@dataclass
class FrameSampler:
    info: VideoInfo
    stride: int = 4
    start_s: float = 0.0
    max_seconds: float | None = None
    hwaccel: str | None = None
    errors: list[str] = field(default_factory=list, init=False)
    returncode: int | None = field(default=None, init=False)

    @property
    def start_frame(self) -> int:
        return round(self.start_s * self.info.fps)

    @property
    def expected_frames(self) -> int:
        """Number of frames this sampler should yield."""
        available = max(self.info.frame_count - self.start_frame, 0)
        if self.max_seconds is not None:
            available = min(available, round(self.max_seconds * self.info.fps))
        return math.ceil(available / self.stride)

    def _command(self) -> list[str]:
        cmd = [require_tool("ffmpeg"), "-v", "error", "-nostdin"]
        if self.hwaccel:
            cmd += ["-hwaccel", self.hwaccel]
        if self.start_s:
            cmd += ["-ss", str(self.start_s)]
        cmd += ["-i", self.info.path]
        if self.max_seconds is not None:
            cmd += ["-t", str(self.max_seconds)]
        return cmd + [
            "-map", "0:v:0",
            "-vf", f"select=not(mod(n\\,{self.stride}))",
            "-fps_mode", "passthrough",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ]

    def __iter__(self) -> Iterator[Frame]:
        width, height = self.info.display_size
        frame_bytes = width * height * 3
        proc = subprocess.Popen(self._command(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        # Drain stderr concurrently so a chatty decoder cannot block the pipe.
        err_reader = threading.Thread(target=self._collect_errors, args=(proc.stderr,), daemon=True)
        err_reader.start()
        # Read frames ahead in a thread so decoding overlaps with analysis.
        frames: queue.Queue[bytes | None] = queue.Queue(maxsize=PREFETCH_FRAMES)
        stop = threading.Event()
        reader = threading.Thread(target=self._read_frames,
                                  args=(proc.stdout, frame_bytes, frames, stop), daemon=True)
        reader.start()
        finished = False
        try:
            k = 0
            while (buf := frames.get()) is not None:
                index = self.start_frame + k * self.stride
                rgb = np.frombuffer(buf, dtype=np.uint8).reshape(height, width, 3)
                yield Frame(index, index / self.info.fps, rgb)
                k += 1
            finished = True
        finally:
            stop.set()
            if not finished and proc.poll() is None:
                proc.terminate()  # consumer stopped early (error or break)
            reader.join()
            proc.stdout.close()
            self.returncode = proc.wait()
            err_reader.join()

    @staticmethod
    def _read_frames(stdout, frame_bytes: int, frames: "queue.Queue[bytes | None]",
                     stop: threading.Event) -> None:
        try:
            while not stop.is_set():
                buf = stdout.read(frame_bytes)
                if len(buf) < frame_bytes:
                    break
                while not stop.is_set():
                    try:
                        frames.put(buf, timeout=0.5)
                        break
                    except queue.Full:
                        continue
        finally:
            while True:  # make room for the end marker if the consumer has gone
                try:
                    frames.put_nowait(None)
                    break
                except queue.Full:
                    frames.get_nowait()

    def _collect_errors(self, stream) -> None:
        for line in stream:
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                self.errors.append(text)
