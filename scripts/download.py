"""Thin wrapper kept for `python scripts/download.py ...`; see probing_qc.cli.download."""

import sys

from probing_qc.cli.download import main

if __name__ == "__main__":
    sys.exit(main())
