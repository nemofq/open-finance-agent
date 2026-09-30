"""Earnings surprises and guidance."""

from __future__ import annotations

from ._coerce import as_float
from ._fmt import num, pct
from .errors import FinError
from .registry import api
from .result import FinResult, FinStruct

# Anything smaller than half a percent is reported as in line.
IN_LINE = 0.005


def _surprise(actual: float, estimate: float) -> float:
    """(actual - estimate) / abs(estimate) - abs() so a beat on a loss reads positive."""
    return (actual - estimate) / abs(estimate)


@api(group="Earnings", summary="(actual - estimate) / abs(estimate) as a decimal (0.05 = 5% beat)")
def surprise(actual: object, estimate: object) -> FinResult:
    """Earnings surprise as a decimal.

    Divided by abs(estimate) so the sign always reads the same way: beating a loss
    estimate of -0.40 with -0.30 is a +25% surprise, not -25%.
    """
    reported = as_float(actual)
    expected = as_float(estimate)
    if expected == 0.0:
        raise FinError(
            "fin.surprise: estimate must be non-zero; report the absolute difference "
            "when the consensus is break-even"
        )
    return FinResult(
        _surprise(reported, expected),
        unit="%",
        formula=f"surprise = ({num(reported)} - {num(expected)}) / |{num(expected)}|",
        inputs={"actual": reported, "estimate": expected},
    )


@api(group="Earnings", summary='struct: surprise (decimal), difference, verdict "beat"/"miss"/"in line"')
def beat_or_miss(actual: object, estimate: object) -> FinStruct:
    """Surprise, absolute difference and a verdict.

    `verdict` is "in line" when the surprise is smaller than 0.5% either way.
    """
    reported = as_float(actual)
    expected = as_float(estimate)
    if expected == 0.0:
        raise FinError(
            "fin.beat_or_miss: estimate must be non-zero; report the absolute difference "
            "when the consensus is break-even"
        )
    value = _surprise(reported, expected)
    if abs(value) < IN_LINE:
        verdict = "in line"
    else:
        verdict = "beat" if value > 0 else "miss"
    return FinStruct(
        {"surprise": value, "difference": reported - expected, "verdict": verdict},
        formula=(
            f"surprise = ({num(reported)} - {num(expected)}) / |{num(expected)}| = "
            f"{pct(value)}"
        ),
        inputs={"actual": reported, "estimate": expected, "in_line_threshold": IN_LINE},
    )


@api(group="Earnings", summary="(low + high) / 2, in the unit of the guidance range")
def guidance_midpoint(low: object, high: object) -> FinResult:
    """The midpoint of a guidance range, in the unit of the range."""
    bottom = as_float(low)
    top = as_float(high)
    if top < bottom:
        raise FinError(
            f"fin.guidance_midpoint: high ({num(top)}) is below low ({num(bottom)}); "
            "the arguments may be swapped"
        )
    return FinResult(
        (bottom + top) / 2.0,
        formula=f"guidance_midpoint = ({num(bottom)} + {num(top)}) / 2",
        inputs={"low": bottom, "high": top},
    )
