# `fin` conventions

Every convention `fin` pins, in one place. The model never has to guess which
variant a function uses, and a reviewer can check a footnote against this page.

## Why stdlib-only

`fin` is pure Python with no third-party imports. The golden tests run in CPython on
Linux, macOS and Windows, where numpy, pandas and scipy are **not** installed; the
calculator sandbox runs Pyodide 3.14, where they are. Implementing the numerics here
(normal CDF on `math.erf`, IRR by Newton with a bisection fallback, regression by
hand) is what makes the same call return the same bits in both places, so a figure the
sandbox computed can be checked against the golden tests.

`fin` still **accepts** pandas Series/DataFrame columns and numpy arrays: they are
duck-typed in `_coerce.py` (`.tolist()`, `.values`, `.index`), never imported.

## Units

| Convention | Value |
|---|---|
| Percentages | Always decimals: `0.124` is 12.4%. Results that are rates carry `unit="%"`. |
| Multiples | Plain numbers with `unit="x"`: `pe` of 20 means 20x. |
| Currency | Whatever the inputs were; `fin` never converts and never labels a currency. |
| Rates in, rates out | Every rate argument (`discount_rate`, `risk_free`, `tax_rate`, `volatility`, `terminal_growth`) is a decimal, never a percent. |

## Timing and day count

| Convention | Value |
|---|---|
| `npv`, `irr` | The **first cash flow is at t=0** and is not discounted. This matches numpy-financial and Excel's `XNPV`, and differs from Excel's `NPV` (which starts at t=1). |
| `dcf` | The **first explicit cash flow is at t=1** (end of year 1). |
| `dcf(mid_year=True)` | Explicit flows move to t-0.5 (0.5, 1.5, 2.5 ...). The terminal value is a value *as of the end of year n* and is always discounted over the full n years, with or without mid-year. |
| `dcf` terminal value | Exactly one of `terminal_growth` (Gordon: `CF_n * (1+g) / (r - g)`, requires `r > g`) or `exit_multiple` (applied to `terminal_metric` when given, otherwise to the last explicit cash flow). |
| `reverse_dcf` | `cash_flow` grows at the solved rate for `years` years (first flow at t=1), then Gordon at `terminal_growth`. Solved by bisection over -50% to +100%. |
| `xnpv`, `xirr` | **ACT/365**: the year fraction is `(date - first_date).days / 365`, discounting from the **first date in the list**, not from today. |
| Trading year | **252** periods (`periods_per_year=252`), the default for `volatility`, `sharpe`, `sortino` and `annualized_return`. Use 52 for weekly and 12 for monthly data. |
| Calendar year | **365** days, used only for option time-to-expiry and `theta`. |
| `cagr` periods | The number of **intervals**, not the number of figures: FY2021 -> FY2025 is `periods=4`. |
| Option `time_to_expiry` | In **years**: 30 days is `30/365`. |

## Statistics

| Convention | Value |
|---|---|
| Standard deviation | **Sample, ddof=1**, everywhere (`volatility`, `sharpe`, `sortino`, `beta`, downside deviation). |
| Annualising volatility | `stdev(period returns) * sqrt(periods_per_year)`. |
| Annualising a return | Geometric: `(1 + total_return)^(periods_per_year / periods) - 1`. |
| De-annualising a rate | Geometric: the per-period rate is `(1 + annual)^(1/periods_per_year) - 1`, so `sharpe(returns, risk_free=0.04)` takes an **annual** 4%. `sortino`'s `target` is annual too. |
| `beta` | `cov(asset, market) / var(market)`, both ddof=1 (the sample-size term cancels). |
| `correlation` | Pearson. |
| `returns` | `kind="simple"` gives `p_t/p_(t-1) - 1`; `kind="log"` gives `ln(p_t/p_(t-1))`. Either way the result has n-1 values. |
| `max_drawdown` | The worst peak-to-trough fall, as a **negative** decimal. |

## Signs

| Convention | Value |
|---|---|
| `pmt`, `fv` | numpy-financial signs: money **paid out is negative**. A positive `pv` (a loan received) gives a negative `pmt`. `rate` is the rate **per period**, so a 7.5% annual mortgage paid monthly is `rate=0.075/12, nper=180`. `when="end"` (default) or `"begin"`. |
| `irr`, `xirr` | Need at least one negative and one positive cash flow, or they raise. |
| `yoy`, `qoq` | `(current - prior) / abs(prior)`. The `abs()` keeps the sign honest off a negative base: -2.0 -> -1.0 is +50%, not -50%. |
| `surprise`, `beat_or_miss` | `(actual - estimate) / abs(estimate)`. Beating a -0.40 consensus with -0.30 is **+25%**. `beat_or_miss` reports "in line" when the surprise is under 0.5% either way. |
| `premium_to_nav` | Positive is a premium, negative is a discount. |
| `max_drawdown` | Negative. |

## Options

Black-Scholes-**Merton**, European exercise, with a continuous dividend yield `q`.
Assumes a lognormal spot, constant volatility and interest rates over the life of
the option, no transaction costs and no early exercise. The normal CDF is
`0.5 * (1 + erf(x / sqrt(2)))`.

| Greek | Scaling |
|---|---|
| `delta` | Per 1.0 of spot. |
| `gamma` | Change in delta per 1.0 of spot. |
| `vega` | Per **0.01** of volatility (one vol point), i.e. annual vega / 100. |
| `theta` | Per **calendar day**, i.e. annual theta / 365. Negative for a long option. |
| `rho` | Per **0.01** of the risk-free rate (100bp), i.e. annual rho / 100. |

`implied_vol` bisects volatility over 0 to 500% and raises when the price is outside
the no-arbitrage bounds (a call must sit between `S*e^(-qT) - K*e^(-rT)` and
`S*e^(-qT)`; a put between `K*e^(-rT) - S*e^(-qT)` and `K*e^(-rT)`).

`expected_move` takes either the at-the-money straddle price (the market's own
one-standard-deviation estimate, used as-is) or `volatility * sqrt(T) * spot`.

## Portfolio

`weights` normalises position values to sum to 1 and keeps the labels of a pandas
Series or dict. `concentration` normalises first, so it accepts values or weights and
returns the Herfindahl-Hirschman index between 0 and 1 (its formula string also
reports `1/HHI`, the effective number of holdings). `exposure` sums weights by group,
with groups in first-seen order.

## Return shape

Every public function returns `FinResult` (a float), `FinVector` (a sequence) or
`FinStruct` (a mapping). All three expose:

- `.value` - `float`, `list[float]` or `dict[str, float]` (numeric fields only)
- `.unit` - `"%"`, `"x"`, or `None` when the unit follows the inputs
- `.formula` - a short string with the numbers substituted, for report footnotes
- `.inputs` - the named scalar arguments used, JSON-serialisable, series truncated

`FinResult` **is** a float, so it drops straight into further arithmetic - but the
result of that arithmetic is a plain float, because the unit and formula no longer
describe it.

Errors are always `FinError` (a `ValueError`), with a message that says how to fix
the call.
