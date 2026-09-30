"""Present values, rates of return and loan arithmetic.

Timing: `npv` and `irr` put the FIRST cash flow at t=0, matching numpy-financial and
Excel's XNPV family (but not Excel's NPV, which starts at t=1). `xnpv` and `xirr`
use actual dates on ACT/365, discounted from the first date in the list.
"""

from __future__ import annotations

import datetime as _dt

from ._coerce import as_dates, as_float, as_floats
from ._fmt import num, pct
from ._solve import bisect, newton
from .errors import FinError
from .registry import api
from .result import FinResult

DAYS_PER_YEAR = 365.0
# A rate below -100% is meaningless; 1000% is well past any real IRR.
RATE_LOW = -0.9999
RATE_HIGH = 10.0
_WHEN = {"end": 0, "begin": 1}


def _require_sign_change(func: str, flows: list[float]) -> None:
    """An IRR exists only if the flows change sign at least once."""
    if not any(flow > 0 for flow in flows) or not any(flow < 0 for flow in flows):
        raise FinError(
            f"fin.{func} needs at least one negative and one positive cash flow "
            f"(got {len(flows)} values, all "
            + ("non-negative" if all(flow >= 0 for flow in flows) else "non-positive")
            + "); the investment outflow is usually negative"
        )


def _discount(flow: float, rate: float, periods: float) -> float:
    """flow / (1+rate)**periods, saturating instead of raising at extreme rates."""
    try:
        return flow / (1.0 + rate) ** periods
    except (OverflowError, ZeroDivisionError):
        return float("inf") if flow > 0 else float("-inf")


def _npv_at(rate: float, flows: list[float]) -> float:
    return sum(_discount(flow, rate, i) for i, flow in enumerate(flows))


def _npv_slope_at(rate: float, flows: list[float]) -> float:
    """d(npv)/d(rate), for Newton's method."""
    return sum(_discount(-i * flow, rate, i + 1) for i, flow in enumerate(flows) if i)


@api(group="Cash flows", summary="net present value; FIRST cash flow is at t=0 (numpy-financial)")
def npv(rate: object, cash_flows: object) -> FinResult:
    """Net present value in the currency of the cash flows.

    The first cash flow is at t=0 and is NOT discounted, like numpy-financial's
    `npv` and unlike Excel's `NPV`.
    """
    discount_rate = as_float(rate)
    flows = as_floats(cash_flows)
    if not flows:
        raise FinError("fin.npv: cash_flows is empty")
    if discount_rate <= -1.0:
        raise FinError(f"fin.npv: rate must be > -1 (got {num(discount_rate)}); it is a decimal")
    return FinResult(
        _npv_at(discount_rate, flows),
        formula=f"npv = sum(CF_t / (1+{pct(discount_rate)})^t), t=0..{len(flows) - 1}",
        inputs={"rate": discount_rate, "cash_flows": flows, "n": len(flows)},
    )


@api(group="Cash flows", summary="internal rate of return as a decimal; first cash flow at t=0")
def irr(cash_flows: object) -> FinResult:
    """Internal rate of return as a decimal, with the first cash flow at t=0."""
    flows = as_floats(cash_flows)
    if len(flows) < 2:
        raise FinError(f"fin.irr: needs at least 2 cash flows, got {len(flows)}")
    _require_sign_change("irr", flows)
    solved = newton(
        lambda r: _npv_at(r, flows), lambda r: _npv_slope_at(r, flows), 0.1
    )
    if solved is None or solved <= -1.0:
        solved = bisect(lambda r: _npv_at(r, flows), RATE_LOW, RATE_HIGH)
    if solved is None:
        raise FinError(
            f"fin.irr: no rate between {pct(RATE_LOW)} and {pct(RATE_HIGH)} zeroes these "
            "cash flows; the series may change sign more than once (multiple IRRs)"
        )
    return FinResult(
        solved,
        unit="%",
        formula=f"irr: npv(r, {len(flows)} flows from t=0) = 0",
        inputs={"cash_flows": flows, "n": len(flows)},
    )


def _year_fractions(func: str, dates: list[_dt.date], count: int) -> list[float]:
    """Years from the first date on ACT/365, checked against the flow count."""
    if len(dates) != count:
        raise FinError(
            f"fin.{func}: got {count} cash flows but {len(dates)} dates; they must line up "
            "one-to-one"
        )
    if count < 2:
        raise FinError(f"fin.{func}: needs at least 2 dated cash flows, got {count}")
    start = dates[0]
    return [(day - start).days / DAYS_PER_YEAR for day in dates]


@api(group="Cash flows", summary="present value on actual dates, ACT/365, from the first date")
def xnpv(rate: object, cash_flows: object, dates: object) -> FinResult:
    """Net present value of dated cash flows, discounted from the first date on ACT/365."""
    discount_rate = as_float(rate)
    flows = as_floats(cash_flows)
    when = as_dates(dates)
    if discount_rate <= -1.0:
        raise FinError(f"fin.xnpv: rate must be > -1 (got {num(discount_rate)}); it is a decimal")
    years = _year_fractions("xnpv", when, len(flows))
    value = sum(_discount(flow, discount_rate, t) for flow, t in zip(flows, years, strict=True))
    return FinResult(
        value,
        formula=f"xnpv = sum(CF / (1+{pct(discount_rate)})^(days/365)) from {when[0].isoformat()}",
        inputs={
            "rate": discount_rate,
            "cash_flows": flows,
            "n": len(flows),
            "start": when[0].isoformat(),
            "end": when[-1].isoformat(),
        },
    )


@api(group="Cash flows", summary="IRR on actual dates as a decimal, ACT/365, from the first date")
def xirr(cash_flows: object, dates: object) -> FinResult:
    """Internal rate of return on dated cash flows, as an annual decimal (ACT/365)."""
    flows = as_floats(cash_flows)
    when = as_dates(dates)
    years = _year_fractions("xirr", when, len(flows))
    _require_sign_change("xirr", flows)

    def value(rate: float) -> float:
        return sum(_discount(flow, rate, t) for flow, t in zip(flows, years, strict=True))

    def slope(rate: float) -> float:
        return sum(
            _discount(-t * flow, rate, t + 1.0)
            for flow, t in zip(flows, years, strict=True)
            if t
        )

    solved = newton(value, slope, 0.1)
    if solved is None or solved <= -1.0:
        solved = bisect(value, RATE_LOW, RATE_HIGH)
    if solved is None:
        raise FinError(
            f"fin.xirr: no rate between {pct(RATE_LOW)} and {pct(RATE_HIGH)} zeroes these "
            "cash flows; the series may change sign more than once (multiple IRRs)"
        )
    return FinResult(
        solved,
        unit="%",
        formula=(
            f"xirr: xnpv(r, {len(flows)} flows, ACT/365) = 0 from {when[0].isoformat()} "
            f"to {when[-1].isoformat()}"
        ),
        inputs={
            "cash_flows": flows,
            "n": len(flows),
            "start": when[0].isoformat(),
            "end": when[-1].isoformat(),
        },
    )


def _when_flag(func: str, when: str) -> int:
    if when not in _WHEN:
        raise FinError(f'fin.{func}: when must be "end" or "begin" (got {when!r})')
    return _WHEN[when]


@api(group="Cash flows", summary="payment per period; numpy-financial signs (outflows negative)")
def pmt(
    rate: object, nper: object, pv: object, fv: object = 0.0, when: str = "end"
) -> FinResult:
    """The level payment per period, in the currency of `pv`.

    numpy-financial sign convention: a positive `pv` (money received now) gives a
    negative payment (money paid out). `rate` is the rate PER PERIOD, so a 6% annual
    mortgage paid monthly is rate=0.06/12, nper=360.
    """
    period_rate = as_float(rate)
    periods = as_float(nper)
    present = as_float(pv)
    future = as_float(fv)
    flag = _when_flag("pmt", when)
    if periods <= 0:
        raise FinError(f"fin.pmt: nper must be > 0 (got {num(periods)})")
    if period_rate == 0.0:
        value = -(future + present) / periods
    else:
        factor = (1.0 + period_rate) ** periods
        value = -(future + present * factor) / (
            (1.0 + period_rate * flag) * (factor - 1.0) / period_rate
        )
    return FinResult(
        value,
        formula=f"pmt = -(fv + pv*(1+r)^n) / ((1+r*{flag})*((1+r)^n - 1)/r), r={pct(period_rate)}",
        inputs={"rate": period_rate, "nper": periods, "pv": present, "fv": future, "when": when},
    )


@api(group="Cash flows", summary="future value; numpy-financial signs (outflows negative)")
def fv(
    rate: object, nper: object, pmt: object, pv: object = 0.0, when: str = "end"
) -> FinResult:
    """The value after `nper` periods, in the currency of `pv`.

    numpy-financial sign convention: deposits are negative payments, so
    fv(0.05, 10, -100, 0) is a positive balance. `rate` is the rate PER PERIOD.
    """
    period_rate = as_float(rate)
    periods = as_float(nper)
    payment = as_float(pmt)
    present = as_float(pv)
    flag = _when_flag("fv", when)
    if periods < 0:
        raise FinError(f"fin.fv: nper must be >= 0 (got {num(periods)})")
    if period_rate == 0.0:
        value = -(present + payment * periods)
    else:
        factor = (1.0 + period_rate) ** periods
        value = -(
            present * factor
            + payment * (1.0 + period_rate * flag) * (factor - 1.0) / period_rate
        )
    return FinResult(
        value,
        formula=f"fv = -(pv*(1+r)^n + pmt*(1+r*{flag})*((1+r)^n - 1)/r), r={pct(period_rate)}",
        inputs={"rate": period_rate, "nper": periods, "pmt": payment, "pv": present, "when": when},
    )
