"""Returns, volatility and the risk ratios.

252 trading days a year everywhere; sample standard deviation (ddof=1) everywhere.
Annual rates passed in (`risk_free`, `target`) are de-annualized geometrically, so
compounding a period rate back over a year returns the annual rate exactly.
"""

from __future__ import annotations

import math

from ._coerce import as_float, as_floats, labels_of
from ._fmt import num, pct
from .errors import FinError
from .registry import api
from .result import FinResult, FinVector

TRADING_DAYS = 252
_KINDS = ("simple", "log")


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _sample_stdev(func: str, values: list[float]) -> float:
    """Sample standard deviation, ddof=1 (the convention across all of `fin`)."""
    if len(values) < 2:
        raise FinError(
            f"fin.{func}: needs at least 2 values for a sample standard deviation, "
            f"got {len(values)}"
        )
    average = _mean(values)
    variance = sum((value - average) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance)


def _simple_returns(func: str, prices: list[float]) -> list[float]:
    if len(prices) < 2:
        raise FinError(f"fin.{func}: needs at least 2 prices, got {len(prices)}")
    out: list[float] = []
    for previous, current in zip(prices[:-1], prices[1:], strict=True):
        if previous == 0.0:
            raise FinError(f"fin.{func}: a price of 0 makes the return undefined")
        out.append(current / previous - 1.0)
    return out


def _de_annualize(annual_rate: float, periods_per_year: float) -> float:
    """The per-period rate that compounds to `annual_rate` over a year."""
    return (1.0 + annual_rate) ** (1.0 / periods_per_year) - 1.0


def _periods_per_year(func: str, periods_per_year: object) -> float:
    value = as_float(periods_per_year)
    if value <= 0:
        raise FinError(
            f"fin.{func}: periods_per_year must be > 0 (got {num(value)}); use 252 for "
            "daily, 52 for weekly, 12 for monthly"
        )
    return value


@api(group="Returns and risk", summary='period returns as a vector of n-1 decimals; kind "simple" or "log"')
def returns(prices: object, kind: str = "simple") -> FinVector:
    """Period returns as decimals, one shorter than the price series.

    kind="simple" gives p_t/p_(t-1) - 1; kind="log" gives ln(p_t/p_(t-1)).
    """
    if kind not in _KINDS:
        raise FinError(f'fin.returns: kind must be "simple" or "log" (got {kind!r})')
    series = as_floats(prices)
    if kind == "simple":
        values = _simple_returns("returns", series)
    else:
        if len(series) < 2:
            raise FinError(f"fin.returns: needs at least 2 prices, got {len(series)}")
        if any(price <= 0 for price in series):
            raise FinError(
                'fin.returns: kind="log" needs strictly positive prices; use kind="simple" '
                "for a series that touches zero or goes negative"
            )
        values = [
            math.log(current / previous)
            for previous, current in zip(series[:-1], series[1:], strict=True)
        ]
    labels = labels_of(prices)
    return FinVector(
        values,
        labels=None if labels is None else labels[1:],
        unit="%",
        formula=f"returns ({kind}) over {len(values)} periods",
        inputs={"kind": kind, "n_prices": len(series)},
    )


@api(group="Returns and risk", summary="annualized return as a decimal, from prices or (total_return, periods)")
def annualized_return(
    prices: object = None,
    total_return: object = None,
    periods: object = None,
    periods_per_year: object = TRADING_DAYS,
) -> FinResult:
    """Annualized (geometric) return as a decimal.

    Pass either `prices` (the number of periods is then len(prices) - 1) or both
    `total_return` (a decimal over the whole span) and `periods`.
    """
    per_year = _periods_per_year("annualized_return", periods_per_year)
    if prices is not None:
        if total_return is not None:
            raise FinError(
                "fin.annualized_return: pass prices= or total_return=, not both"
            )
        series = as_floats(prices)
        if len(series) < 2:
            raise FinError(
                f"fin.annualized_return: needs at least 2 prices, got {len(series)}"
            )
        if series[0] <= 0:
            raise FinError("fin.annualized_return: the first price must be > 0")
        whole = series[-1] / series[0] - 1.0
        count = float(len(series) - 1) if periods is None else as_float(periods)
    else:
        if total_return is None or periods is None:
            raise FinError(
                "fin.annualized_return: pass prices=, or both total_return= (a decimal "
                "over the whole span) and periods= (how many periods that span covers)"
            )
        whole = as_float(total_return)
        count = as_float(periods)
    if count <= 0:
        raise FinError(f"fin.annualized_return: periods must be > 0 (got {num(count)})")
    if whole <= -1.0:
        raise FinError(
            f"fin.annualized_return: total_return must be > -1 (got {num(whole)}); a total "
            "loss has no annualized rate"
        )
    value = (1.0 + whole) ** (per_year / count) - 1.0
    return FinResult(
        value,
        unit="%",
        formula=f"annualized = (1+{pct(whole)})^({num(per_year)}/{num(count)}) - 1",
        inputs={"total_return": whole, "periods": count, "periods_per_year": per_year},
    )


@api(group="Returns and risk", summary="annualized stdev of returns as a decimal (ddof=1, sqrt scaling)")
def volatility(
    returns_or_prices: object,
    periods_per_year: object = TRADING_DAYS,
    from_prices: bool = False,
) -> FinResult:
    """Annualized volatility as a decimal (0.28 = 28%).

    Expects period RETURNS; pass from_prices=True to hand it a price series instead.
    """
    per_year = _periods_per_year("volatility", periods_per_year)
    series = as_floats(returns_or_prices)
    period_returns = _simple_returns("volatility", series) if from_prices else series
    stdev = _sample_stdev("volatility", period_returns)
    value = stdev * math.sqrt(per_year)
    return FinResult(
        value,
        unit="%",
        formula=f"volatility = stdev({len(period_returns)} returns, ddof=1) * sqrt({num(per_year)})",
        inputs={
            "n": len(period_returns),
            "periods_per_year": per_year,
            "period_stdev": stdev,
            "from_prices": from_prices,
        },
    )


@api(group="Returns and risk", summary="largest peak-to-trough fall as a negative decimal (-0.23 = -23%)")
def max_drawdown(prices: object) -> FinResult:
    """The worst peak-to-trough fall over the series, as a negative decimal."""
    series = as_floats(prices)
    if len(series) < 2:
        raise FinError(f"fin.max_drawdown: needs at least 2 prices, got {len(series)}")
    if any(price <= 0 for price in series):
        raise FinError("fin.max_drawdown: prices must be > 0")
    peak = series[0]
    worst = 0.0
    trough = series[0]
    peak_at_worst = series[0]
    for price in series[1:]:
        peak = max(peak, price)
        fall = price / peak - 1.0
        if fall < worst:
            worst, trough, peak_at_worst = fall, price, peak
    return FinResult(
        worst,
        unit="%",
        formula=f"max_drawdown = {num(trough)} / {num(peak_at_worst)} - 1",
        inputs={"n": len(series), "peak": peak_at_worst, "trough": trough},
    )


def _paired(func: str, a: object, b: object) -> tuple[list[float], list[float]]:
    first = as_floats(a)
    second = as_floats(b)
    if len(first) != len(second):
        raise FinError(
            f"fin.{func}: the two series must be the same length (got {len(first)} and "
            f"{len(second)}); align them on their dates first"
        )
    if len(first) < 2:
        raise FinError(f"fin.{func}: needs at least 2 pairs, got {len(first)}")
    return first, second


@api(group="Returns and risk", summary="slope vs the market: cov(asset, market) / var(market), ddof=1")
def beta(asset_returns: object, market_returns: object) -> FinResult:
    """Beta as a plain multiple. Both series are period returns, aligned and equal length."""
    asset, market = _paired("beta", asset_returns, market_returns)
    asset_mean = _mean(asset)
    market_mean = _mean(market)
    degrees = len(asset) - 1
    covariance = (
        sum((a - asset_mean) * (m - market_mean) for a, m in zip(asset, market, strict=True))
        / degrees
    )
    variance = sum((m - market_mean) ** 2 for m in market) / degrees
    if variance == 0.0:
        raise FinError("fin.beta: the market series never moves, so beta is undefined")
    return FinResult(
        covariance / variance,
        formula=f"beta = cov(asset, market) / var(market), n={len(asset)}, ddof=1",
        inputs={"n": len(asset), "covariance": covariance, "market_variance": variance},
    )


@api(group="Returns and risk", summary="annualized Sharpe ratio; risk_free is an ANNUAL decimal rate")
def sharpe(
    returns: object, risk_free: object = 0.0, periods_per_year: object = TRADING_DAYS
) -> FinResult:
    """Annualized Sharpe ratio (a plain number, not a percentage).

    `returns` are period returns; `risk_free` is an ANNUAL decimal rate, de-annualized
    geometrically to match them.
    """
    per_year = _periods_per_year("sharpe", periods_per_year)
    series = as_floats(returns)
    annual_rf = as_float(risk_free)
    period_rf = _de_annualize(annual_rf, per_year)
    excess = [value - period_rf for value in series]
    stdev = _sample_stdev("sharpe", excess)
    if stdev == 0.0:
        raise FinError("fin.sharpe: the excess returns never vary, so the ratio is undefined")
    value = _mean(excess) / stdev * math.sqrt(per_year)
    return FinResult(
        value,
        formula=(
            f"sharpe = mean(r - {pct(period_rf)}) / stdev(ddof=1) * sqrt({num(per_year)}), "
            f"n={len(series)}"
        ),
        inputs={
            "n": len(series),
            "risk_free": annual_rf,
            "periods_per_year": per_year,
            "period_risk_free": period_rf,
        },
    )


@api(group="Returns and risk", summary="annualized Sortino ratio; risk_free and target are ANNUAL rates")
def sortino(
    returns: object,
    risk_free: object = 0.0,
    target: object = 0.0,
    periods_per_year: object = TRADING_DAYS,
) -> FinResult:
    """Annualized Sortino ratio: excess return over downside deviation.

    `risk_free` sets the excess return, `target` the minimum acceptable return below
    which a period counts as downside. Both are ANNUAL decimal rates.
    """
    per_year = _periods_per_year("sortino", periods_per_year)
    series = as_floats(returns)
    if len(series) < 2:
        raise FinError(f"fin.sortino: needs at least 2 returns, got {len(series)}")
    annual_rf = as_float(risk_free)
    annual_target = as_float(target)
    period_rf = _de_annualize(annual_rf, per_year)
    period_target = _de_annualize(annual_target, per_year)
    shortfalls = [min(0.0, value - period_target) for value in series]
    downside = math.sqrt(sum(shortfall**2 for shortfall in shortfalls) / (len(series) - 1))
    if downside == 0.0:
        raise FinError(
            f"fin.sortino: no return fell below the target ({pct(period_target)} per "
            "period), so downside deviation is 0 and the ratio is undefined"
        )
    value = _mean([r - period_rf for r in series]) / downside * math.sqrt(per_year)
    return FinResult(
        value,
        formula=(
            f"sortino = mean(r - {pct(period_rf)}) / downside_dev(ddof=1) * "
            f"sqrt({num(per_year)}), n={len(series)}"
        ),
        inputs={
            "n": len(series),
            "risk_free": annual_rf,
            "target": annual_target,
            "periods_per_year": per_year,
            "downside_deviation": downside,
        },
    )


@api(group="Returns and risk", summary="Pearson correlation of two equal-length series, -1 to 1")
def correlation(a: object, b: object) -> FinResult:
    """Pearson correlation coefficient, between -1 and 1."""
    first, second = _paired("correlation", a, b)
    first_mean = _mean(first)
    second_mean = _mean(second)
    covariance = sum(
        (x - first_mean) * (y - second_mean) for x, y in zip(first, second, strict=True)
    )
    first_ss = sum((x - first_mean) ** 2 for x in first)
    second_ss = sum((y - second_mean) ** 2 for y in second)
    if first_ss == 0.0 or second_ss == 0.0:
        raise FinError(
            "fin.correlation: one of the series never varies, so the correlation is undefined"
        )
    return FinResult(
        covariance / math.sqrt(first_ss * second_ss),
        formula=f"correlation = Pearson r over {len(first)} pairs",
        inputs={"n": len(first)},
    )
