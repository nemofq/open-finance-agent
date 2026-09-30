"""Growth rates. Every rate is a decimal: 0.124 is +12.4%."""

from __future__ import annotations

from ._coerce import as_float, as_floats
from ._fmt import num
from .errors import FinError
from .registry import api
from .result import FinResult

TTM_QUARTERS = 4


def _period_change(func: str, current: object, prior: object, label: str) -> FinResult:
    """Shared body of yoy and qoq: (current - prior) / abs(prior)."""
    now = as_float(current)
    before = as_float(prior)
    if before == 0.0:
        raise FinError(
            f"fin.{func}: prior must be non-zero; growth from a base of zero is undefined. "
            "Report the absolute change instead."
        )
    # abs() in the denominator keeps the sign honest when the base is a loss:
    # -2.0 -> -1.0 is a +50% improvement, not -50%.
    value = (now - before) / abs(before)
    return FinResult(
        value,
        unit="%",
        formula=f"{func} = ({num(now)} - {num(before)}) / |{num(before)}|",
        inputs={"current": now, "prior": before, "period": label},
    )


@api(group="Growth", summary="year-over-year change as a decimal (0.12 = +12%); divides by abs(prior)")
def yoy(current: object, prior: object) -> FinResult:
    """Year-over-year change as a decimal. 0.12 means +12%."""
    return _period_change("yoy", current, prior, "year")


@api(group="Growth", summary="quarter-over-quarter change as a decimal; divides by abs(prior)")
def qoq(current: object, prior: object) -> FinResult:
    """Quarter-over-quarter change as a decimal. 0.03 means +3%."""
    return _period_change("qoq", current, prior, "quarter")


@api(group="Growth", summary="compound annual growth rate as a decimal; periods = number of intervals")
def cagr(begin: object, end: object, periods: object) -> FinResult:
    """Compound annual growth rate as a decimal.

    `periods` is the number of intervals between the two figures, not the number of
    years listed: FY2021 -> FY2025 is 4.
    """
    start = as_float(begin)
    finish = as_float(end)
    count = as_float(periods)
    if count <= 0:
        raise FinError(
            f"fin.cagr: periods must be > 0 (got {num(count)}); for FY2021->FY2025 use "
            "periods=4 (the number of intervals, not the number of years listed)"
        )
    if start <= 0 or finish <= 0:
        raise FinError(
            f"fin.cagr: begin and end must both be > 0 (got begin={num(start)}, "
            f"end={num(finish)}); a compound rate is undefined across zero or a loss. "
            "Use fin.yoy on each period instead."
        )
    value = (finish / start) ** (1.0 / count) - 1.0
    return FinResult(
        value,
        unit="%",
        formula=f"cagr = ({num(finish)}/{num(start)})^(1/{num(count)}) - 1",
        inputs={"begin": start, "end": finish, "periods": count},
    )


@api(group="Growth", summary="trailing twelve months: sum of the last 4 quarterly values")
def ttm(values: object) -> FinResult:
    """Sum of the trailing four quarters, in the unit of the input.

    Takes the last four entries of the series, so a longer history can be passed
    straight in.
    """
    series = as_floats(values)
    if len(series) < TTM_QUARTERS:
        raise FinError(
            f"fin.ttm: needs at least {TTM_QUARTERS} quarterly values, got {len(series)}; "
            "pass the quarterly series, oldest first"
        )
    last_four = series[-TTM_QUARTERS:]
    total = sum(last_four)
    return FinResult(
        total,
        formula="ttm = " + " + ".join(num(v) for v in last_four),
        inputs={"quarters": last_four, "n": len(series)},
    )
