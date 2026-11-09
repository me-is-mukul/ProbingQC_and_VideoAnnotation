"""Download a video over HTTP(S) into the input folder."""

from __future__ import annotations

from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlparse

import requests
from tqdm.auto import tqdm

CHUNK_BYTES = 1024 * 1024
TIMEOUT_S = 60


def is_valid_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def filename_from_url(url: str) -> str:
    """Last path segment of ``url``, percent-decoded; "" if the URL ends in "/".

    Decoding happens before the segment is taken, so an encoded "../" or "\\"
    cannot escape the destination folder.
    """
    path = unquote(urlparse(url).path).replace("\\", "/")
    if path.endswith("/"):
        return ""
    name = PurePosixPath(path).name
    return "" if name in ("", ".", "..") else name


def download(url: str, dest: Path, progress: bool = True, timeout: float = TIMEOUT_S) -> Path:
    """Stream ``url`` to ``dest`` via a ``.part`` file so interrupted runs leave no corrupt video."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_suffix(dest.suffix + ".part")
    try:
        with requests.get(url, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0)) or None
            with open(partial, "wb") as f, tqdm(total=total, unit="B", unit_scale=True,
                                                unit_divisor=1024, desc=dest.name,
                                                disable=not progress) as bar:
                for chunk in r.iter_content(chunk_size=CHUNK_BYTES):
                    f.write(chunk)
                    bar.update(len(chunk))
        partial.replace(dest)
    finally:
        partial.unlink(missing_ok=True)
    return dest
