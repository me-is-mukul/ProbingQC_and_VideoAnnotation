"""Minimal parser for GoPro Metadata Format (GPMF) KLV streams.

Every GPMF entry is an 8-byte header followed by a payload padded to 4 bytes:

    key    4 bytes   ASCII FourCC, e.g. b"ACCL"
    type   1 byte    value type character, or 0 for a nested container
    size   1 byte    bytes per sample (structure size)
    repeat 2 bytes   big-endian sample count

All numeric values are big-endian. Reference: https://github.com/gopro/gpmf-parser
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Iterator

import numpy as np

HEADER_SIZE = 8

# GPMF type character -> big-endian numpy dtype
NUMERIC_TYPES = {
    "b": ">i1",
    "B": ">u1",
    "s": ">i2",
    "S": ">u2",
    "l": ">i4",
    "L": ">u4",
    "j": ">i8",
    "J": ">u8",
    "f": ">f4",
    "d": ">f8",
}


@dataclass(frozen=True)
class KLV:
    key: str
    type: str  # "\x00" for nested containers
    size: int
    repeat: int
    payload: bytes

    @property
    def is_nested(self) -> bool:
        return self.type == "\x00"

    def children(self) -> Iterator["KLV"]:
        return iter_klv(self.payload)

    def values(self) -> np.ndarray:
        """Decode a numeric payload into shape (repeat, size // itemsize)."""
        dtype = np.dtype(NUMERIC_TYPES[self.type])
        arr = np.frombuffer(self.payload, dtype=dtype)
        return arr.reshape(self.repeat, self.size // dtype.itemsize)

    def text(self) -> str:
        return self.payload.rstrip(b"\x00").decode("ascii", errors="replace")


def _padded(n: int) -> int:
    return (n + 3) & ~3


def iter_klv(buf: bytes) -> Iterator[KLV]:
    """Yield the KLV entries at one nesting level of ``buf``."""
    pos = 0
    end = len(buf)
    while pos + HEADER_SIZE <= end:
        key = buf[pos:pos + 4]
        type_, size = chr(buf[pos + 4]), buf[pos + 5]
        (repeat,) = struct.unpack_from(">H", buf, pos + 6)
        length = size * repeat
        start = pos + HEADER_SIZE
        if key == b"\x00\x00\x00\x00":  # zero padding between payloads
            pos = start
            continue
        if start + length > end:
            raise ValueError(f"Truncated GPMF entry {key!r} at offset {pos}")
        yield KLV(key.decode("ascii", errors="replace"), type_, size, repeat,
                  buf[start:start + length])
        pos = start + _padded(length)
