"""Keyframe positions of a video's first video stream, as frame numbers.

The web UI's fast (stream-copy) probing command can only start a kept part on a
keyframe, so it needs to know where they are. ``parse_packets`` is pure (ffprobe
CSV in, frame numbers out); ``read_keyframes`` adds the ffprobe call.

Frame numbers count frames in presentation order from the start of the file, the
same numbering the QC frame table uses (``frame`` column).
"""

from __future__ import annotations

from pathlib import Path

from .ffmpeg import ffprobe_video_packets

#: Returned instead of a list when every frame is a keyframe (all-intra video).
ALL_KEYFRAMES = "all"

Keyframes = list[int] | str | None


def parse_packets(text: str) -> Keyframes:
    """Keyframe frame numbers from ``pts,flags`` CSV lines (ffprobe ``packet=pts,flags``).

    Packets are ordered by ``pts`` (presentation order), so B-frame reordering does not
    shift the numbering. Packets without a ``pts`` or flagged ``D`` (discard) are not
    frames and are skipped. Returns ``ALL_KEYFRAMES`` when every frame is a keyframe and
    ``None`` when there are no packets at all.
    """
    packets: list[tuple[int, bool]] = []
    for line in text.splitlines():
        pts, _, flags = line.strip().partition(",")
        if not pts or pts == "N/A" or "D" in flags:
            continue
        packets.append((int(pts), "K" in flags))
    if not packets:
        return None
    packets.sort(key=lambda p: p[0])  # stable: equal pts keep demux order
    frames = [i for i, (_, key) in enumerate(packets) if key]
    return ALL_KEYFRAMES if len(frames) == len(packets) else frames


def read_keyframes(video: str | Path) -> Keyframes:
    """Keyframe frame numbers of ``video`` (see ``parse_packets``)."""
    return parse_packets(ffprobe_video_packets(Path(video)))


def describe(keyframes: Keyframes, fps: float) -> str:
    """One-line summary for logs, e.g. ``2,292 keyframes, every 30 frames (1.00 s)``."""
    if keyframes is None:
        return "No keyframes found"
    if keyframes == ALL_KEYFRAMES:
        return "Every frame is a keyframe (all-intra)"
    if len(keyframes) < 2:
        return f"{len(keyframes)} keyframe"
    gaps = sorted(b - a for a, b in zip(keyframes, keyframes[1:]))
    gap = gaps[len(gaps) // 2]
    return f"{len(keyframes):,} keyframes, every {gap} frames ({gap / fps:.2f} s)"
