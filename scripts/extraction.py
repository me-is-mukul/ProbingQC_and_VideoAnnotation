"""Thin wrapper kept for `python scripts/extraction.py ...`; see probing_qc.cli.extract."""

import sys

from probing_qc.cli.extract import main

if __name__ == "__main__":
    sys.exit(main())
