"""Fund and income figures: total return, distribution yield, NAV change."""

from __future__ import annotations

from collections.abc import Iterable

from ._coerce import as_float, as_floats
from ._fmt import num
from .errors import FinError
from .registry import api
from .result import FinResult

MONTHS_PER_YEAR = 12


def _scalar_or_sum(func: str, x: object) -> tuple[float, int]:
    """(total, how many periods it covers). A scalar counts as one period."""
    if isinstance(x, Iterable) and not isinstance(x, (str, bytes)):
        values = as_floats(x)
        if not values:
            raise FinError(f"fin.{func}: the distribution series is empty")
        return sum(values), len(values)
    if hasattr(x, "tolist") or hasattr(x, "values"):
        values = as_floats(x)
        if not values:
            raise FinError(f"fin.{func}: the distribution series is empty")
        return sum(values), len(values)
    return as_float(x), 1


@api(group="Funds and income", summary="(end - begin + distributions) / begin as a decimal (0.08 = 8%)")
def total_return(begin_price: object, end_price: object, distributions: object = 0.0) -> FinResult:
    """Total return as a decimal: price change plus distributions, over the starting price.

    `distributions` is either the total paid over the period or the series of payments.
    """
    begin = as_float(begin_price)
    end = as_float(end_price)
    paid, count = _scalar_or_sum("total_return", distributions)
    if begin <= 0:
        raise FinError(f"fin.total_return: begin_price must be > 0 (got {num(begin)})")
    return FinResult(
        (end - begin + paid) / begin,
        unit="%",
        formula=f"total_return = ({num(end)} - {num(begin)} + {num(paid)}) / {num(begin)}",
        inputs={
            "begin_price": begin,
            "end_price": end,
            "distributions": paid,
            "n_distributions": count,
        },
    )


@api(group="Funds and income", summary="annualized distributions / price as a decimal (0.11 = 11%)")
def distribution_yield(
    distributions: object, price: object, periods_per_year: object = MONTHS_PER_YEAR
) -> FinResult:
    """Annualized distribution yield as a decimal.

    A scalar is one period's payment and is annualized by `periods_per_year`. A series
    is summed and annualized by periods_per_year / len(series), so twelve monthly
    payments with periods_per_year=12 give the trailing-twelve-month yield unchanged.
    """
    paid, count = _scalar_or_sum("distribution_yield", distributions)
    share_price = as_float(price)
    per_year = as_float(periods_per_year)
    if share_price <= 0:
        raise FinError(f"fin.distribution_yield: price must be > 0 (got {num(share_price)})")
    if per_year <= 0:
        raise FinError(
            f"fin.distribution_yield: periods_per_year must be > 0 (got {num(per_year)}); "
            "use 12 for monthly payers, 4 for quarterly"
        )
    annualized = paid * per_year / count
    return FinResult(
        annualized / share_price,
        unit="%",
        formula=(
            f"distribution_yield = {num(paid)} * {num(per_year)}/{count} / {num(share_price)}"
        ),
        inputs={
            "distributions": paid,
            "n_distributions": count,
            "price": share_price,
            "periods_per_year": per_year,
        },
    )


@api(group="Funds and income", summary="end_nav / begin_nav - 1 as a decimal, before distributions")
def nav_change(begin_nav: object, end_nav: object) -> FinResult:
    """Change in net asset value as a decimal, ignoring distributions."""
    begin = as_float(begin_nav)
    end = as_float(end_nav)
    if begin <= 0:
        raise FinError(f"fin.nav_change: begin_nav must be > 0 (got {num(begin)})")
    return FinResult(
        end / begin - 1.0,
        unit="%",
        formula=f"nav_change = {num(end)} / {num(begin)} - 1",
        inputs={"begin_nav": begin, "end_nav": end},
    )
