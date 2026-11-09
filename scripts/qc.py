"""Thin wrapper kept for `python scripts/qc.py ...`; see probing_qc.cli.qc."""

import sys

from probing_qc.cli.qc import main

if __name__ == "__main__":
    sys.exit(main())
