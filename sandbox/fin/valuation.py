"""Multiples, cost of capital and discounted cash flow.

DCF timing: the first explicit cash flow lands at t=1 (end of year 1), unlike npv where t=0.
"""

from __future__ import annotations

from ._coerce import as_float, as_floats
from ._fmt import mult, num, pct
from ._solve import bisect
from .errors import FinError
from .registry import api
from .result import FinResult, FinStruct

# reverse_dcf searches growth rates between -50% and +100% a year.
REVERSE_DCF_LOW = -0.5
REVERSE_DCF_HIGH = 1.0


@api(group="Valuation", summary="price / eps as a multiple (x); raises when eps <= 0")
def pe(price: object, eps: object) -> FinResult:
    """Price-to-earnings as a multiple."""
    share_price = as_float(price)
    earnings = as_float(eps)
    if earnings <= 0:
        raise FinError(
            f"fin.pe: eps must be > 0 (got {num(earnings)}); P/E is not meaningful on a "
            "loss. Report 'not meaningful', or use fin.ratio(price, eps) for the raw quotient."
        )
    return FinResult(
        share_price / earnings,
        unit="x",
        formula=f"pe = {num(share_price)} / {num(earnings)}",
        inputs={"price": share_price, "eps": earnings},
    )


@api(group="Valuation", summary="enterprise value = market cap + debt - cash + minority + preferred")
def ev(
    market_cap: object,
    debt: object,
    cash: object,
    minority_interest: object = 0.0,
    preferred: object = 0.0,
) -> FinResult:
    """Enterprise value, in the currency of the inputs."""
    equity = as_float(market_cap)
    borrowings = as_float(debt)
    liquid = as_float(cash)
    minority = as_float(minority_interest)
    preferred_stock = as_float(preferred)
    value = equity + borrowings - liquid + minority + preferred_stock
    return FinResult(
        value,
        formula=(
            f"ev = {num(equity)} + {num(borrowings)} - {num(liquid)}"
            + (f" + {num(minority)}" if minority else "")
            + (f" + {num(preferred_stock)}" if preferred_stock else "")
        ),
        inputs={
            "market_cap": equity,
            "debt": borrowings,
            "cash": liquid,
            "minority_interest": minority,
            "preferred": preferred_stock,
        },
    )


@api(group="Valuation", summary="enterprise value / EBITDA as a multiple (x)")
def ev_to_ebitda(enterprise_value: object, ebitda: object) -> FinResult:
    """EV/EBITDA as a multiple."""
    value = as_float(enterprise_value)
    earnings = as_float(ebitda)
    if earnings <= 0:
        raise FinError(
            f"fin.ev_to_ebitda: ebitda must be > 0 (got {num(earnings)}); the multiple is "
            "not meaningful on negative EBITDA"
        )
    return FinResult(
        value / earnings,
        unit="x",
        formula=f"ev_to_ebitda = {num(value)} / {num(earnings)}",
        inputs={"enterprise_value": value, "ebitda": earnings},
    )


@api(group="Valuation", summary="free cash flow / market cap as a decimal (0.05 = 5%)")
def fcf_yield(free_cash_flow: object, market_cap: object) -> FinResult:
    """Free cash flow yield as a decimal."""
    cash_flow = as_float(free_cash_flow)
    equity = as_float(market_cap)
    if equity <= 0:
        raise FinError(f"fin.fcf_yield: market_cap must be > 0 (got {num(equity)})")
    return FinResult(
        cash_flow / equity,
        unit="%",
        formula=f"fcf_yield = {num(cash_flow)} / {num(equity)}",
        inputs={"free_cash_flow": cash_flow, "market_cap": equity},
    )


@api(group="Valuation", summary="cost of equity = risk_free + beta * equity_risk_premium, a decimal")
def capm(risk_free: object, beta: object, equity_risk_premium: object) -> FinResult:
    """Cost of equity as a decimal. All three inputs are decimals (0.045 = 4.5%)."""
    rate = as_float(risk_free)
    slope = as_float(beta)
    premium = as_float(equity_risk_premium)
    return FinResult(
        rate + slope * premium,
        unit="%",
        formula=f"capm = {pct(rate)} + {num(slope)} * {pct(premium)}",
        inputs={"risk_free": rate, "beta": slope, "equity_risk_premium": premium},
    )


@api(group="Valuation", summary="weighted average cost of capital as a decimal; tax shield on debt")
def wacc(
    equity_value: object,
    debt_value: object,
    cost_of_equity: object,
    cost_of_debt: object,
    tax_rate: object,
) -> FinResult:
    """WACC as a decimal. Rates are decimals; the tax shield applies to debt only."""
    equity = as_float(equity_value)
    debt = as_float(debt_value)
    ke = as_float(cost_of_equity)
    kd = as_float(cost_of_debt)
    tax = as_float(tax_rate)
    total = equity + debt
    if total <= 0:
        raise FinError(
            f"fin.wacc: equity_value + debt_value must be > 0 (got {num(total)}); pass "
            "market values, not book values"
        )
    value = (equity / total) * ke + (debt / total) * kd * (1.0 - tax)
    return FinResult(
        value,
        unit="%",
        formula=(
            f"wacc = {pct(equity / total)}*{pct(ke)} + {pct(debt / total)}*{pct(kd)}"
            f"*(1-{pct(tax)})"
        ),
        inputs={
            "equity_value": equity,
            "debt_value": debt,
            "cost_of_equity": ke,
            "cost_of_debt": kd,
            "tax_rate": tax,
        },
    )


def _discount_periods(count: int, mid_year: bool) -> list[float]:
    """t for each explicit cash flow: 1, 2, 3... or 0.5, 1.5, 2.5... under mid-year."""
    offset = 0.5 if mid_year else 0.0
    return [float(i + 1) - offset for i in range(count)]


def _terminal_value(
    last_flow: float,
    discount_rate: float,
    terminal_growth: float | None,
    exit_multiple: float | None,
    terminal_metric: float | None,
) -> tuple[float, str]:
    """The terminal value as of the end of the last explicit year, and its formula text."""
    if (terminal_growth is None) == (exit_multiple is None):
        raise FinError(
            "fin.dcf: pass exactly one of terminal_growth= (Gordon growth) or "
            "exit_multiple= (a multiple of the final year); got "
            + ("both" if terminal_growth is not None else "neither")
        )
    if terminal_growth is not None:
        if discount_rate <= terminal_growth:
            raise FinError(
                f"fin.dcf: discount_rate ({pct(discount_rate)}) must exceed terminal_growth "
                f"({pct(terminal_growth)}); the Gordon formula diverges otherwise. Long-run "
                "growth should not exceed nominal GDP growth (~2.5%)."
            )
        value = last_flow * (1.0 + terminal_growth) / (discount_rate - terminal_growth)
        text = f"TV = CF_n*(1+{pct(terminal_growth)})/({pct(discount_rate)}-{pct(terminal_growth)})"
        return value, text
    base = last_flow if terminal_metric is None else terminal_metric
    return exit_multiple * base, f"TV = {mult(exit_multiple)} * {num(base)}"


@api(
    group="Valuation",
    summary="DCF: pv_explicit, terminal_value, pv_terminal, enterprise_value, equity_value, per_share",
)
def dcf(
    cash_flows: object,
    discount_rate: object,
    terminal_growth: object = None,
    exit_multiple: object = None,
    terminal_metric: object = None,
    net_debt: object = 0.0,
    shares: object = None,
    mid_year: bool = False,
) -> FinStruct:
    """Discounted cash flow.

    The first explicit cash flow is at t=1; `mid_year=True` moves the explicit flows
    to t-0.5. The terminal value is a value as of the end of the last explicit year
    and is always discounted over the full n years. Exactly one of `terminal_growth`
    and `exit_multiple` must be given; `exit_multiple` applies to `terminal_metric`
    when that is given, otherwise to the last explicit cash flow.

    Returns pv_explicit, terminal_value, pv_terminal, enterprise_value, equity_value
    and - only when `shares` is given - per_share, all in the currency of the inputs.
    """
    flows = as_floats(cash_flows)
    if not flows:
        raise FinError("fin.dcf: cash_flows is empty; pass the explicit forecast, first year first")
    rate = as_float(discount_rate)
    if rate <= -1.0:
        raise FinError(f"fin.dcf: discount_rate must be > -1 (got {num(rate)}); it is a decimal")
    growth = None if terminal_growth is None else as_float(terminal_growth)
    multiple = None if exit_multiple is None else as_float(exit_multiple)
    metric = None if terminal_metric is None else as_float(terminal_metric)
    debt = as_float(net_debt)

    periods = _discount_periods(len(flows), mid_year)
    pv_explicit = sum(flow / (1.0 + rate) ** t for flow, t in zip(flows, periods, strict=True))
    terminal, terminal_text = _terminal_value(flows[-1], rate, growth, multiple, metric)
    pv_terminal = terminal / (1.0 + rate) ** len(flows)
    enterprise_value = pv_explicit + pv_terminal
    equity_value = enterprise_value - debt

    fields: dict[str, object] = {
        "pv_explicit": pv_explicit,
        "terminal_value": terminal,
        "pv_terminal": pv_terminal,
        "enterprise_value": enterprise_value,
        "equity_value": equity_value,
    }
    inputs: dict[str, object] = {
        "n_flows": len(flows),
        "discount_rate": rate,
        "net_debt": debt,
        "mid_year": mid_year,
    }
    if growth is not None:
        inputs["terminal_growth"] = growth
    if multiple is not None:
        inputs["exit_multiple"] = multiple
    if metric is not None:
        inputs["terminal_metric"] = metric
    if shares is not None:
        count = as_float(shares)
        if count <= 0:
            raise FinError(f"fin.dcf: shares must be > 0 (got {num(count)})")
        fields["per_share"] = equity_value / count
        inputs["shares"] = count

    mid = ", mid-year" if mid_year else ""
    return FinStruct(
        fields,
        formula=f"dcf = PV({len(flows)} flows @ {pct(rate)}{mid}) + PV({terminal_text})",
        inputs=inputs,
    )


@api(group="Valuation", summary="growth the price implies, as a decimal; solves dcf per_share = price")
def reverse_dcf(
    price_per_share: object,
    cash_flow: object,
    discount_rate: object,
    terminal_growth: object,
    years: int = 10,
    net_debt: object = 0.0,
    shares: object = None,
) -> FinResult:
    """The annual growth rate of `cash_flow` the current price implies, as a decimal.

    `cash_flow` grows at the solved rate for `years`, then at `terminal_growth`
    forever (Gordon). Searches growth between -50% and +100% a year.
    """
    price = as_float(price_per_share)
    base_flow = as_float(cash_flow)
    rate = as_float(discount_rate)
    terminal = as_float(terminal_growth)
    horizon = int(as_float(years))
    debt = as_float(net_debt)
    if shares is None:
        raise FinError(
            "fin.reverse_dcf: shares= is required; the implied growth depends on the "
            "equity value per share"
        )
    count = as_float(shares)
    if count <= 0:
        raise FinError(f"fin.reverse_dcf: shares must be > 0 (got {num(count)})")
    if horizon <= 0:
        raise FinError(f"fin.reverse_dcf: years must be > 0 (got {horizon})")
    if rate <= terminal:
        raise FinError(
            f"fin.reverse_dcf: discount_rate ({pct(rate)}) must exceed terminal_growth "
            f"({pct(terminal)}); the Gordon terminal value diverges otherwise"
        )

    def value_per_share(growth: float) -> float:
        flows = [base_flow * (1.0 + growth) ** (t + 1) for t in range(horizon)]
        pv = sum(flow / (1.0 + rate) ** (t + 1) for t, flow in enumerate(flows))
        tv = flows[-1] * (1.0 + terminal) / (rate - terminal)
        return (pv + tv / (1.0 + rate) ** horizon - debt) / count

    solved = bisect(lambda g: value_per_share(g) - price, REVERSE_DCF_LOW, REVERSE_DCF_HIGH)
    if solved is None:
        low_value = value_per_share(REVERSE_DCF_LOW)
        high_value = value_per_share(REVERSE_DCF_HIGH)
        raise FinError(
            f"fin.reverse_dcf: no growth rate between {pct(REVERSE_DCF_LOW)} and "
            f"{pct(REVERSE_DCF_HIGH)} gives {num(price)} per share (that range spans "
            f"{num(low_value)} to {num(high_value)}). Check discount_rate, net_debt and "
            "shares, or start from a different cash_flow."
        )
    return FinResult(
        solved,
        unit="%",
        formula=(
            f"reverse_dcf: growth for {num(horizon)}y that prices {num(base_flow)} at "
            f"{num(price)}/sh @ {pct(rate)}"
        ),
        inputs={
            "price_per_share": price,
            "cash_flow": base_flow,
            "discount_rate": rate,
            "terminal_growth": terminal,
            "years": horizon,
            "net_debt": debt,
            "shares": count,
        },
    )


@api(group="Valuation", summary="price / nav - 1 as a decimal (0.6 = 60% premium, negative = discount)")
def premium_to_nav(price: object, nav: object) -> FinResult:
    """Premium (positive) or discount (negative) to net asset value, as a decimal."""
    market = as_float(price)
    asset_value = as_float(nav)
    if asset_value <= 0:
        raise FinError(
            f"fin.premium_to_nav: nav must be > 0 (got {num(asset_value)}); pass the net "
            "asset value per share on the same basis as price"
        )
    return FinResult(
        market / asset_value - 1.0,
        unit="%",
        formula=f"premium_to_nav = {num(market)} / {num(asset_value)} - 1",
        inputs={"price": market, "nav": asset_value},
    )
