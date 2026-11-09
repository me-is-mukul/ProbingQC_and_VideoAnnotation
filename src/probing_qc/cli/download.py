"""Interactive downloader: fetch videos from a URL into input/ with a progress bar.

Usage:
    python scripts/download.py                  # menu
    python scripts/download.py --url <URL>      # non-interactive
"""

from __future__ import annotations

import sys
from pathlib import Path

import requests

from ..download import download, filename_from_url, is_valid_url
from ..paths import INPUT_DIR, list_videos
from .common import CANCELLED, OK, USAGE, make_parser

MENU = """
==============================
  Video downloader
==============================
  1) Download a video from URL
  2) List videos in {input_dir}
  3) Quit
"""


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


def print_videos(input_dir: Path) -> None:
    videos = list_videos(input_dir)
    if not videos:
        print(f"No videos in {input_dir}")
    for p in videos:
        print(f"  {p.name:30} {p.stat().st_size / 1024**3:6.2f} GiB")


def menu(input_dir: Path) -> None:
    actions = {"1": download_flow, "2": print_videos}
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
    parser = make_parser(__doc__)
    parser.add_argument("--url", help="download this URL and exit (skips the menu)")
    parser.add_argument("--name", help="output file name for --url (default: from URL)")
    parser.add_argument("--input-dir", type=Path, default=INPUT_DIR)
    args = parser.parse_args(argv)

    try:
        if args.url:
            if not is_valid_url(args.url):
                print("Invalid URL: must start with http:// or https://")
                return USAGE
            name = args.name or filename_from_url(args.url)
            if not name:
                print("The URL has no file name; pass --name.")
                return USAGE
            print(f"Saved {download(args.url, args.input_dir / name)}")
        else:
            menu(args.input_dir)
    except KeyboardInterrupt:
        print("\nCancelled.")
        return CANCELLED
    return OK


if __name__ == "__main__":
    sys.exit(main())
