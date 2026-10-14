#!/usr/bin/env python3
"""Run the project research CLI directly from a checkout without installation."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from islam_research.cli import main

if __name__ == "__main__":
    main()
