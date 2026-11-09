"""The ``FrameAnalyzer`` interface: the extension point for new per-frame QC metrics.

Each analyzer sees every sampled frame once (``process``) and returns a flat
dict of scalars; those rows form the per-frame table. After decoding,
``summarize`` turns the analyzer's columns into its part of the report.

To add a metric family: subclass ``FrameAnalyzer`` in a new module of this
package, set ``name`` and ``section`` ("technical" or "hands", or a new
section), and register it in ``build_analyzers`` (``analyzers/__init__.py``).
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import pandas as pd

from ..frames import Frame


class FrameAnalyzer(ABC):
    name: str
    section: str

    @abstractmethod
    def process(self, frame: Frame) -> dict:
        """Per-frame scalar measurements."""

    @abstractmethod
    def summarize(self, frames: pd.DataFrame, dt: float) -> dict:
        """Report entries from this analyzer's per-frame columns.

        ``dt`` is the time between analysed frames in seconds.
        """

    def info(self) -> dict:
        """Extra provenance for the report (model versions etc.)."""
        return {}

    def close(self) -> None:
        pass
