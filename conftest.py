"""Root-level conftest.py — ensures the repository root is on sys.path."""
import sys
from pathlib import Path

# Repository root (the directory that contains this file).
_ROOT = str(Path(__file__).resolve().parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
