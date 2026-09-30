"""Root finders shared by irr, xirr, reverse_dcf and implied_vol.

Pure Python on purpose: scipy is not available in CPython for the golden tests, and
a hand-written bisection gives byte-identical results in CPython and Pyodide.
"""

from __future__ import annotations

import math
from collections.abc import Callable


def bisect(
    f: Callable[[float], float],
    lo: float,
    hi: float,
    *,
    tol: float = 1e-12,
    max_iter: int = 200,
) -> float | None:
    """The root of `f` in [lo, hi], or None when `f` does not change sign over it."""
    f_lo = f(lo)
    f_hi = f(hi)
    if f_lo == 0.0:
        return lo
    if f_hi == 0.0:
        return hi
    if not (math.isfinite(f_lo) and math.isfinite(f_hi)):
        return None
    if (f_lo > 0.0) == (f_hi > 0.0):
        return None
    for _ in range(max_iter):
        mid = (lo + hi) / 2.0
        f_mid = f(mid)
        if f_mid == 0.0 or (hi - lo) / 2.0 < tol:
            return mid
        if (f_mid > 0.0) == (f_lo > 0.0):
            lo, f_lo = mid, f_mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def newton(
    f: Callable[[float], float],
    df: Callable[[float], float],
    x0: float,
    *,
    tol: float = 1e-12,
    max_iter: int = 100,
) -> float | None:
    """The root of `f` near `x0`, or None when the iteration does not settle on one."""
    x = x0
    for _ in range(max_iter):
        value = f(x)
        if not math.isfinite(value):
            return None
        if abs(value) < tol:
            return x
        slope = df(x)
        if slope == 0.0 or not math.isfinite(slope):
            return None
        step = value / slope
        x -= step
        if not math.isfinite(x):
            return None
        if abs(step) < tol:
            return x if abs(f(x)) < 1e-7 else None
    return None
