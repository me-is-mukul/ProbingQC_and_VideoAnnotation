"""Synthetic-data builders shared by the tests (and handy for manual testing in a REPL).

    from helpers import gpmf_stream, make_hand    # run from the tests/ folder
"""

from __future__ import annotations

import struct

import numpy as np

from probing_qc.qc.hands.landmarks import Hand

# --- GPMF ---------------------------------------------------------------------


def klv(key: bytes, type_: str, size: int, repeat: int, payload: bytes) -> bytes:
    """One KLV entry: 8-byte header + payload zero-padded to 4 bytes."""
    header = key + type_.encode("latin-1") + bytes([size]) + struct.pack(">H", repeat)
    return header + payload + b"\x00" * (-len(payload) % 4)


def nest(key: bytes, *children: bytes) -> bytes:
    """A container entry (type 0) holding ``children``."""
    body = b"".join(children)
    return klv(key, "\x00", 4, len(body) // 4, body)


def sensor_strm(key: bytes, stmp_us: int | None, scale: int, raw: np.ndarray,
                orin: bytes | None = b"ZXY") -> bytes:
    """A STRM with optional STMP/ORIN, a SCAL and ``raw`` int16 (n, 3) samples."""
    parts = []
    if stmp_us is not None:
        parts.append(klv(b"STMP", "J", 8, 1, struct.pack(">Q", stmp_us)))
    if orin is not None:
        parts.append(klv(b"ORIN", "c", 1, len(orin), orin))
    parts.append(klv(b"SCAL", "s", 2, 1, struct.pack(">h", scale)))
    parts.append(klv(key, "s", 6, len(raw), raw.astype(">i2").tobytes()))
    return nest(b"STRM", *parts)


def devc(stmp_us: int | None, acc_raw: np.ndarray, gyro_raw: np.ndarray,
         acc_scale: int = 100, gyro_scale: int = 10) -> bytes:
    """One ~1 s payload: a DEVC holding an ACCL and a GYRO stream."""
    return nest(
        b"DEVC",
        klv(b"DVID", "L", 4, 1, struct.pack(">L", 1)),
        sensor_strm(b"ACCL", stmp_us, acc_scale, acc_raw),
        sensor_strm(b"GYRO", stmp_us, gyro_scale, gyro_raw),
    )


def gpmf_stream(payloads: int = 2, samples: int = 4, period_us: int = 1_000_000) -> bytes:
    """``payloads`` DEVCs of ``samples`` samples each, ``period_us`` apart.

    Raw rows are 0, 1, 2, ... so scaled values are predictable.
    """
    raw = np.arange(samples * 3).reshape(samples, 3)
    return b"".join(devc(i * period_us, raw + 100 * i, raw + 100 * i) for i in range(payloads))


# --- hands --------------------------------------------------------------------


def make_hand(side: str, wrist_x: float, curl: float = 2.0, pinch: float = 1.0,
              score: float = 0.9) -> Hand:
    """Synthetic hand with palm length 1 and chosen curl/pinch ratios."""
    world = np.zeros((21, 3), np.float32)
    world[9] = (0, 1, 0)                     # middle MCP: palm length 1
    for tip in (8, 12, 16, 20):
        world[tip] = (0, curl, 0)
    world[4] = (pinch, curl, 0)              # thumb tip offset from index tip
    lms = np.zeros((21, 3), np.float32)
    lms[0, 0] = wrist_x
    return Hand(side, score, lms, world)


# --- ffprobe ------------------------------------------------------------------


def probe_json(**video_overrides) -> dict:
    """Minimal ffprobe JSON for a 1080p30 HEVC GoPro file with a GPMF track."""
    video = {"index": 0, "codec_type": "video", "codec_name": "hevc", "profile": "Main",
             "pix_fmt": "yuvj420p", "width": 1920, "height": 1080,
             "avg_frame_rate": "30000/1001", "r_frame_rate": "30000/1001",
             "duration": "10.010000", "nb_frames": "300", "bit_rate": "60000000"}
    video.update(video_overrides)
    return {
        "streams": [video,
                    {"index": 1, "codec_type": "audio", "codec_name": "aac"},
                    {"index": 3, "codec_type": "data", "codec_tag_string": "gpmd"}],
        "format": {"duration": "10.010000", "bit_rate": "61000000"},
    }
