"""Number formatting for the short `formula` strings carried on every result."""

from __future__ import annotations


def num(x: float) -> str:
    """A compact decimal for formula strings: 6 significant digits, no trailing zeros."""
    return f"{float(x):.6g}"


def pct(x: float) -> str:
    """A decimal rendered as a percentage, e.g. 0.1235 -> '12.35%'."""
    return f"{float(x) * 100:.4g}%"


def mult(x: float) -> str:
    """A ratio rendered as a multiple, e.g. 12.4 -> '12.4x'."""
    return f"{float(x):.4g}x"
