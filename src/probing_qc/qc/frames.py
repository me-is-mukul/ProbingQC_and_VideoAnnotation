"""Decode a video once with FFmpeg and yield every Nth frame as RGB.

FFmpeg still decodes every frame (HEVC frames depend on each other), so decode
errors are detected for the whole range; only the selected frames are piped out.

``expected_frame_count`` and ``decode_command`` are pure helpers; ``FrameSampler``
runs the process.
"""

from __future__ import annotations

import math
import queue
import subprocess
import threading
from dataclasses import dataclass, field
from typing import Iterator

import numpy as np

from ..ffmpeg import require_tool
from .metadata import VideoInfo

PREFETCH_FRAMES = 8  # decoded frames buffered ahead of analysis (~16 MB each at 2.7K)


@dataclass(frozen=True)
class Frame:
    index: int          # frame number in the source video
    timestamp_s: float  # index / fps (GoPro footage is constant frame rate)
    rgb: np.ndarray     # (height, width, 3) uint8


def start_frame(start_s: float, fps: float) -> int:
    return round(start_s * fps)


def expected_frame_count(frame_count: int, fps: float, stride: int,
                         start_s: float = 0.0, max_seconds: float | None = None) -> int:
    """Frames a sampler should yield for this window and stride."""
    available = max(frame_count - start_frame(start_s, fps), 0)
    if max_seconds is not None:
        available = min(available, round(max_seconds * fps))
    return math.ceil(available / stride)


def decode_command(ffmpeg: str, path: str, stride: int, start_s: float = 0.0,
                   max_seconds: float | None = None, hwaccel: str | None = None) -> list[str]:
    """ffmpeg arguments that write every ``stride``-th frame of the window as raw RGB24 to stdout."""
    cmd = [ffmpeg, "-v", "error", "-nostdin"]
    if hwaccel:
        cmd += ["-hwaccel", hwaccel]
    if start_s:
        cmd += ["-ss", str(start_s)]
    cmd += ["-i", path]
    if max_seconds is not None:
        cmd += ["-t", str(max_seconds)]
    return cmd + [
        "-map", "0:v:0",
        "-vf", f"select=not(mod(n\\,{stride}))",
        "-fps_mode", "passthrough",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]


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
        return start_frame(self.start_s, self.info.fps)

    @property
    def expected_frames(self) -> int:
        """Number of frames this sampler should yield."""
        return expected_frame_count(self.info.frame_count, self.info.fps, self.stride,
                                    self.start_s, self.max_seconds)

    def command(self) -> list[str]:
        return decode_command(require_tool("ffmpeg"), self.info.path, self.stride,
                              self.start_s, self.max_seconds, self.hwaccel)

    def __iter__(self) -> Iterator[Frame]:
        width, height = self.info.display_size
        frame_bytes = width * height * 3
        proc = subprocess.Popen(self.command(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        # Drain stderr concurrently so a chatty decoder cannot block the pipe.
        err_reader = threading.Thread(target=self._collect_errors, args=(proc.stderr,), daemon=True)
        err_reader.start()
        # Read frames ahead in a thread so decoding overlaps with analysis.
        frames: queue.Queue[bytes | None] = queue.Queue(maxsize=PREFETCH_FRAMES)
        stop = threading.Event()
        reader = threading.Thread(target=read_frames,
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

    def _collect_errors(self, stream) -> None:
        for line in stream:
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                self.errors.append(text)


def read_frames(stdout, frame_bytes: int, frames: "queue.Queue[bytes | None]",
                stop: threading.Event) -> None:
    """Push fixed-size frame buffers from ``stdout`` onto ``frames``, then a ``None`` end marker.

    A trailing partial frame is discarded. Stops early when ``stop`` is set.
    """
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
        # Deliver the end marker. A full queue usually just means analysis is slower than
        # decoding, so wait; only when the consumer has stopped (``stop`` set) is a buffered
        # frame discarded to make room. Dropping unconditionally lost the last frame(s).
        while True:
            try:
                frames.put(None, timeout=0.5)
                break
            except queue.Full:
                if stop.is_set():
                    try:
                        frames.get_nowait()
                    except queue.Empty:
                        pass
