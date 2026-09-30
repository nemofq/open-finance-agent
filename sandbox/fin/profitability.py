"""Margins and per-share figures."""

from __future__ import annotations

from ._coerce import as_float
from ._fmt import num
from .errors import FinError
from .registry import api
from .result import FinResult


@api(group="Profitability and ratios", summary="numerator / revenue as a decimal (0.42 = 42% margin)")
def margin(numerator: object, revenue: object) -> FinResult:
    """A margin as a decimal: gross profit / revenue, net income / revenue, and so on."""
    top = as_float(numerator)
    sales = as_float(revenue)
    if sales == 0.0:
        raise FinError("fin.margin: revenue must be non-zero; a margin on zero revenue is undefined")
    return FinResult(
        top / sales,
        unit="%",
        formula=f"margin = {num(top)} / {num(sales)}",
        inputs={"numerator": top, "revenue": sales},
    )


@api(group="Profitability and ratios", summary='numerator / denominator; pass unit= to label it (e.g. "x")')
def ratio(numerator: object, denominator: object, unit: str | None = None) -> FinResult:
    """Any quotient, in whatever unit the caller names ("x", "%", or None)."""
    top = as_float(numerator)
    bottom = as_float(denominator)
    if bottom == 0.0:
        raise FinError("fin.ratio: denominator must be non-zero")
    return FinResult(
        top / bottom,
        unit=unit,
        formula=f"ratio = {num(top)} / {num(bottom)}",
        inputs={"numerator": top, "denominator": bottom},
    )


@api(group="Profitability and ratios", summary="total / shares, in the total's unit per share")
def per_share(total: object, shares: object) -> FinResult:
    """A total divided by the share count, in the total's unit per share."""
    amount = as_float(total)
    count = as_float(shares)
    if count <= 0:
        raise FinError(
            f"fin.per_share: shares must be > 0 (got {num(count)}); use the diluted share "
            "count from the filing"
        )
    return FinResult(
        amount / count,
        formula=f"per_share = {num(amount)} / {num(count)} shares",
        inputs={"total": amount, "shares": count},
    )
