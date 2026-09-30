"""European options: Black-Scholes-Merton with a continuous dividend yield.

The normal CDF is `math.erf`, so there is no scipy dependency and the numbers are
identical in CPython and Pyodide. Assumptions: European exercise, lognormal spot,
constant volatility and rates, continuous dividend yield `q`, no transaction costs.
"""

from __future__ import annotations

import math
from typing import Any

from ._coerce import as_float
from ._fmt import num, pct
from ._solve import bisect
from .errors import FinError
from .registry import api
from .result import FinResult, FinStruct

CALENDAR_DAYS = 365.0
# implied_vol searches annualized volatility between 0.0001% and 500%.
VOL_LOW = 1e-6
VOL_HIGH = 5.0
_KINDS = ("call", "put")


def _norm_cdf(x: float) -> float:
    """Standard normal CDF."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    """Standard normal density."""
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _kind(func: str, kind: str) -> str:
    if kind not in _KINDS:
        raise FinError(f'fin.{func}: kind must be "call" or "put" (got {kind!r})')
    return kind


def _check_contract(func: str, spot: float, strike: float, time_to_expiry: float) -> None:
    if spot <= 0 or strike <= 0:
        raise FinError(
            f"fin.{func}: spot and strike must both be > 0 (got spot={num(spot)}, "
            f"strike={num(strike)})"
        )
    if time_to_expiry <= 0:
        raise FinError(
            f"fin.{func}: time_to_expiry must be > 0 (got {num(time_to_expiry)}); it is in "
            "YEARS, so 30 days is 30/365"
        )


def _contract(func: str, kind: str, **terms: object) -> dict[str, Any]:
    """The terms as floats, coerced in the order given, then `kind`, checked: a pricer's `inputs`."""
    values = {name: as_float(value) for name, value in terms.items()}
    inputs: dict[str, Any] = {**values, "kind": _kind(func, kind)}
    _check_contract(func, values["spot"], values["strike"], values["time_to_expiry"])
    return inputs


def _d1_d2(
    spot: float, strike: float, years: float, vol: float, rate: float, yield_: float
) -> tuple[float, float]:
    spread = vol * math.sqrt(years)
    d1 = (math.log(spot / strike) + (rate - yield_ + 0.5 * vol * vol) * years) / spread
    return d1, d1 - spread


def _price(
    spot: float, strike: float, years: float, vol: float, rate: float, yield_: float, kind: str
) -> float:
    d1, d2 = _d1_d2(spot, strike, years, vol, rate, yield_)
    carry = math.exp(-yield_ * years)
    discount = math.exp(-rate * years)
    if kind == "call":
        return spot * carry * _norm_cdf(d1) - strike * discount * _norm_cdf(d2)
    return strike * discount * _norm_cdf(-d2) - spot * carry * _norm_cdf(-d1)


@api(group="Options", summary="European option price in the currency of spot (Black-Scholes-Merton)")
def black_scholes(
    spot: object,
    strike: object,
    time_to_expiry: object,
    volatility: object,
    risk_free: object = 0.0,
    dividend_yield: object = 0.0,
    kind: str = "call",
) -> FinResult:
    """The European option price, in the currency of `spot`.

    `time_to_expiry` is in YEARS; `volatility`, `risk_free` and `dividend_yield` are
    annualized decimals (0.25 = 25%).
    """
    inputs = _contract(
        "black_scholes",
        kind,
        spot=spot,
        strike=strike,
        time_to_expiry=time_to_expiry,
        volatility=volatility,
        risk_free=risk_free,
        dividend_yield=dividend_yield,
    )
    price_of_underlying, strike_price, years, vol, rate, carry_yield, option_kind = inputs.values()
    if vol <= 0:
        raise FinError(
            f"fin.black_scholes: volatility must be > 0 (got {num(vol)}); it is an "
            "annualized decimal, so 25% is 0.25"
        )
    value = _price(price_of_underlying, strike_price, years, vol, rate, carry_yield, option_kind)
    return FinResult(
        value,
        formula=(
            f"black_scholes {option_kind}: S={num(price_of_underlying)} K={num(strike_price)} "
            f"T={num(years)}y v={pct(vol)} r={pct(rate)} q={pct(carry_yield)}"
        ),
        inputs=inputs,
    )


@api(group="Options", summary="struct: delta, gamma, vega per 0.01 vol, theta per day, rho per 1% rate")
def greeks(
    spot: object,
    strike: object,
    time_to_expiry: object,
    volatility: object,
    risk_free: object = 0.0,
    dividend_yield: object = 0.0,
    kind: str = "call",
) -> FinStruct:
    """The five first-order Greeks, scaled the way a trader quotes them.

    delta: change in option value per 1.0 of spot.
    gamma: change in delta per 1.0 of spot.
    vega:  change in option value per 0.01 (one point) of volatility.
    theta: change in option value per CALENDAR day (annual theta / 365).
    rho:   change in option value per 0.01 (100bp) of the risk-free rate.
    """
    inputs = _contract(
        "greeks",
        kind,
        spot=spot,
        strike=strike,
        time_to_expiry=time_to_expiry,
        volatility=volatility,
        risk_free=risk_free,
        dividend_yield=dividend_yield,
    )
    price_of_underlying, strike_price, years, vol, rate, carry_yield, option_kind = inputs.values()
    if vol <= 0:
        raise FinError(f"fin.greeks: volatility must be > 0 (got {num(vol)})")

    d1, d2 = _d1_d2(price_of_underlying, strike_price, years, vol, rate, carry_yield)
    carry = math.exp(-carry_yield * years)
    discount = math.exp(-rate * years)
    root_t = math.sqrt(years)
    density = _norm_pdf(d1)

    gamma = carry * density / (price_of_underlying * vol * root_t)
    vega = price_of_underlying * carry * density * root_t
    decay = -price_of_underlying * carry * density * vol / (2.0 * root_t)
    if option_kind == "call":
        delta = carry * _norm_cdf(d1)
        theta = (
            decay
            + carry_yield * price_of_underlying * carry * _norm_cdf(d1)
            - rate * strike_price * discount * _norm_cdf(d2)
        )
        rho = strike_price * years * discount * _norm_cdf(d2)
    else:
        delta = carry * (_norm_cdf(d1) - 1.0)
        theta = (
            decay
            - carry_yield * price_of_underlying * carry * _norm_cdf(-d1)
            + rate * strike_price * discount * _norm_cdf(-d2)
        )
        rho = -strike_price * years * discount * _norm_cdf(-d2)

    return FinStruct(
        {
            "delta": delta,
            "gamma": gamma,
            "vega": vega / 100.0,
            "theta": theta / CALENDAR_DAYS,
            "rho": rho / 100.0,
        },
        formula=(
            f"greeks {option_kind}: S={num(price_of_underlying)} K={num(strike_price)} "
            f"T={num(years)}y v={pct(vol)}; vega/pt, theta/day, rho/1%"
        ),
        inputs=inputs,
    )


@api(group="Options", summary="annualized implied volatility as a decimal (0.32 = 32%) from a price")
def implied_vol(
    price: object,
    spot: object,
    strike: object,
    time_to_expiry: object,
    risk_free: object = 0.0,
    dividend_yield: object = 0.0,
    kind: str = "call",
) -> FinResult:
    """The Black-Scholes volatility that reproduces `price`, as an annualized decimal.

    Searches 0 to 500% by bisection. Raises when the price is outside the
    no-arbitrage bounds, since no volatility can produce it.
    """
    inputs = _contract(
        "implied_vol",
        kind,
        price=price,
        spot=spot,
        strike=strike,
        time_to_expiry=time_to_expiry,
        risk_free=risk_free,
        dividend_yield=dividend_yield,
    )
    market_price, price_of_underlying, strike_price, years, rate, carry_yield, option_kind = inputs.values()

    forward = price_of_underlying * math.exp(-carry_yield * years)
    discounted_strike = strike_price * math.exp(-rate * years)
    if option_kind == "call":
        lower, upper = max(0.0, forward - discounted_strike), forward
    else:
        lower, upper = max(0.0, discounted_strike - forward), discounted_strike
    if not lower <= market_price <= upper:
        raise FinError(
            f"fin.implied_vol: a {option_kind} at S={num(price_of_underlying)}, "
            f"K={num(strike_price)}, T={num(years)}y must be priced between {num(lower)} "
            f"and {num(upper)} to be arbitrage-free; got {num(market_price)}. Check the "
            "price, the strike and that time_to_expiry is in years."
        )

    solved = bisect(
        lambda vol: _price(
            price_of_underlying, strike_price, years, vol, rate, carry_yield, option_kind
        )
        - market_price,
        VOL_LOW,
        VOL_HIGH,
    )
    if solved is None:
        raise FinError(
            f"fin.implied_vol: no volatility between {pct(VOL_LOW)} and {pct(VOL_HIGH)} "
            f"reproduces {num(market_price)}; the price sits on a no-arbitrage bound"
        )
    return FinResult(
        solved,
        unit="%",
        formula=(
            f"implied_vol: black_scholes({option_kind}, S={num(price_of_underlying)}, "
            f"K={num(strike_price)}, T={num(years)}y) = {num(market_price)}"
        ),
        inputs=inputs,
    )


@api(group="Options", summary="struct: absolute, percent, low, high; from an ATM straddle or vol*sqrt(T)")
def expected_move(
    spot: object,
    straddle_price: object = None,
    volatility: object = None,
    time_to_expiry: object = None,
) -> FinStruct:
    """The one-standard-deviation move implied by the options market.

    Pass either `straddle_price` (the at-the-money call plus put, whose price is the
    market's expected move) or both `volatility` (annualized decimal) and
    `time_to_expiry` (years). Returns `absolute`, `percent` (of spot), `low` and `high`.
    """
    price_of_underlying = as_float(spot)
    if price_of_underlying <= 0:
        raise FinError(f"fin.expected_move: spot must be > 0 (got {num(price_of_underlying)})")
    from_vol = volatility is not None or time_to_expiry is not None
    if (straddle_price is not None) and from_vol:
        raise FinError(
            "fin.expected_move: pass straddle_price=, or volatility= with "
            "time_to_expiry=, but not both"
        )
    if straddle_price is not None:
        move = as_float(straddle_price)
        if move < 0:
            raise FinError(f"fin.expected_move: straddle_price must be >= 0 (got {num(move)})")
        source = f"ATM straddle {num(move)}"
        inputs: dict[str, object] = {"spot": price_of_underlying, "straddle_price": move}
    elif volatility is not None and time_to_expiry is not None:
        vol = as_float(volatility)
        years = as_float(time_to_expiry)
        if vol <= 0 or years <= 0:
            raise FinError(
                f"fin.expected_move: volatility and time_to_expiry must both be > 0 (got "
                f"{num(vol)} and {num(years)}); time_to_expiry is in years"
            )
        move = price_of_underlying * vol * math.sqrt(years)
        source = f"{pct(vol)} * sqrt({num(years)}) * {num(price_of_underlying)}"
        inputs = {
            "spot": price_of_underlying,
            "volatility": vol,
            "time_to_expiry": years,
        }
    else:
        raise FinError(
            "fin.expected_move: pass straddle_price=, or both volatility= and "
            "time_to_expiry= (in years)"
        )
    return FinStruct(
        {
            "absolute": move,
            "percent": move / price_of_underlying,
            "low": price_of_underlying - move,
            "high": price_of_underlying + move,
        },
        formula=f"expected_move = {source}",
        inputs=inputs,
    )
