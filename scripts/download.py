"""Interactive downloader: fetch videos from a URL into input/ with a progress bar.

Usage:
    python scripts/download.py                  # menu
    python scripts/download.py --url <URL>      # non-interactive
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import requests
from tqdm.auto import tqdm

ROOT = Path(__file__).resolve().parents[1]
CHUNK = 1024 * 1024
VIDEO_SUFFIXES = {".mp4", ".mov"}

MENU = """
==============================
  Video downloader
==============================
  1) Download a video from URL
  2) List videos in {input_dir}
  3) Quit
"""


def filename_from_url(url: str) -> str:
    return unquote(Path(urlparse(url).path).name)


def is_valid_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def download(url: str, dest: Path) -> Path:
    """Stream ``url`` to ``dest`` via a ``.part`` file so interrupted runs leave no corrupt video."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_suffix(dest.suffix + ".part")
    try:
        with requests.get(url, stream=True, timeout=60) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0)) or None
            with open(partial, "wb") as f, tqdm(total=total, unit="B", unit_scale=True,
                                                unit_divisor=1024, desc=dest.name) as bar:
                for chunk in r.iter_content(chunk_size=CHUNK):
                    f.write(chunk)
                    bar.update(len(chunk))
        partial.replace(dest)
    finally:
        partial.unlink(missing_ok=True)
    return dest


def ask(prompt: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default else ""
    answer = input(f"{prompt}{suffix}: ").strip()
    return answer or (default or "")


def confirm(prompt: str) -> bool:
    return ask(f"{prompt} (y/n)", "n").lower() in ("y", "yes")


def download_flow(input_dir: Path) -> None:
    url = ask("Enter video URL")
    if not is_valid_url(url):
        print("Invalid URL: must start with http:// or https://")
        return

    name = ask("Save as", filename_from_url(url) or None)
    if not name:
        print("A file name is required.")
        return
    dest = input_dir / name
    if dest.exists() and not confirm(f"{dest.name} already exists. Overwrite?"):
        print("Skipped.")
        return

    try:
        download(url, dest)
    except requests.RequestException as e:
        print(f"Download failed: {e}")
        return
    print(f"Saved {dest} ({dest.stat().st_size / 1024**2:.1f} MiB)")
    print(f"Next: python scripts/extraction.py \"{dest.name}\"")


def list_videos(input_dir: Path) -> None:
    videos = sorted(p for p in input_dir.glob("*") if p.suffix.lower() in VIDEO_SUFFIXES)
    if not videos:
        print(f"No videos in {input_dir}")
    for p in videos:
        print(f"  {p.name:30} {p.stat().st_size / 1024**3:6.2f} GiB")


def menu(input_dir: Path) -> None:
    actions = {"1": download_flow, "2": list_videos}
    while True:
        print(MENU.format(input_dir=input_dir))
        choice = ask("Choose an option")
        if choice == "3":
            return
        if choice in actions:
            actions[choice](input_dir)
        else:
            print("Please enter 1, 2 or 3.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", help="download this URL and exit (skips the menu)")
    parser.add_argument("--name", help="output file name for --url (default: from URL)")
    parser.add_argument("--input-dir", type=Path, default=ROOT / "input")
    args = parser.parse_args(argv)

    try:
        if args.url:
            dest = download(args.url, args.input_dir / (args.name or filename_from_url(args.url)))
            print(f"Saved {dest}")
        else:
            menu(args.input_dir)
    except KeyboardInterrupt:
        print("\nCancelled.")
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
