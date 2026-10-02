---
name: valuation
description: >-
  Value one company with a discounted cash flow and a multiples cross-check, every assumption
  declared. Builds the free cash flow history from XBRL, takes the risk-free rate from Treasury
  yields and beta from the price series, derives WACC through CAPM, discounts an explicit forecast
  to a per-share value, runs a WACC by terminal-growth sensitivity grid, and reverses the model to
  show the growth the current price already implies. Delivers a valuation report: approach, inputs,
  valuation, sensitivity, stance. Use when the user asks what a company is worth, whether it is
  cheap or expensive, to run a DCF, or invokes /valuation. Not for a first introduction to the
  company — use stock-brief — and not for relative ranking against rivals, which is /peer-comps.
license: MIT
metadata:
  version: "1.0"
  category: valuation
  inputs: [ticker]
  requires: [fundamentals, prices, macro, filings]
  output: valuation
  profile: [experience.level, style.depth, objectives.horizon]
  holdings: false
---

# Valuation

## Purpose

What one share is worth under stated assumptions, how sensitive that is to the two inputs that
dominate it, and what growth the current price already demands. A model with its assumptions on the
surface, not a target price.

## Inputs

- **Required:** one company, by ticker or by name. A name is enough: resolve it in step 1 and
  carry on. Ask for the ticker and stop only when no company is named, or the name fits more than
  one listed company.
- **Ask only when the user has a view:** if they name a forecast, a discount rate or a terminal
  growth rate, use theirs and say so. Otherwise derive everything and declare it.
- **Infer rather than ask:** reporting currency, the forecast horizon (five years unless the
  business is cyclical or early, then ten), whether to value on free cash flow to the firm.

## Process

Steps 2 to 5 are independent, so issue them in one batch. Roughly ten calls: the Alpha Vantage free
tier allows 25 requests a day and 5 a minute, so never repeat a call and never poll.

1. **Identify the company.** `edgar_lookup_company`, and `alphavantage__COMPANY_OVERVIEW` for
   market cap, shares outstanding, beta and EBITDA in the same batch.

2. **Cash flow history.** `edgar_financials` with `statement: "cashflow"`, `period: "annual"`,
   `limit: 8`: operating cash flow and capital expenditure, so free cash flow is computed, not
   taken on trust.

3. **Capital structure.** `edgar_financials` with `statement: "balance"`, `period: "quarterly"`,
   `limit: 1`: cash and equivalents, short and long-term debt, shares outstanding.

4. **Risk-free rate.** `alphavantage__TREASURY_YIELD` with `maturity: "10year"`, monthly. Use the
   latest observation on or before the as-of date and cite it.

5. **Price and beta.** `alphavantage__GLOBAL_QUOTE` for the last price with its trading date. Take
   beta from the company overview, or compute it in the calculator from
   `alphavantage__TIME_SERIES_DAILY` against an index series when you already have both. Never mix
   a vendor beta with a computed one in the same model.

6. **Growth evidence.** Only if the forecast needs support: `edgar_filings` with
   `forms: ["10-K"]` then `edgar_read_filing` with `query: "outlook capital expenditure growth"`,
   or one `web_search` for the consensus growth rate, attributed to a named source.

7. **One calculator call** does the whole model. Pass the evidence ids for the cash flow table, the
   balance sheet, the yield and the quote:

   ```python
   rf = E12.iloc[0]["value"] / 100                                  # off the yield series
   beta = assume("beta", 1.15, "5y monthly beta from the company overview E3")
   erp  = assume("equity_risk_premium", 0.045, "Damodaran implied US ERP, long-run average")
   ke   = fin.capm(rf, beta, erp)
   w    = fin.wacc(equity_value, debt_value, ke.value, cost_of_debt, tax_rate)
   g    = assume("terminal_growth", 0.025, "long-run nominal GDP growth; must stay below WACC")
   growth = assume("fcf_growth", 0.08, "3pt below the trailing 5y FCF CAGR of C1, fading to g")
   flows  = [fcf0 * (1 + growth) ** t for t in range(1, 6)]
   base = fin.dcf(flows, w.value, terminal_growth=g, net_debt=net_debt, shares=shares)
   emit("DCF value per share", base.per_share, unit="USD/share")
   for wx in [w.value - 0.01, w.value, w.value + 0.01]:
       for gx in [g - 0.005, g, g + 0.005]:
           cell = fin.dcf(flows, wx, terminal_growth=gx, net_debt=net_debt, shares=shares)
           emit(f"DCF per share @ WACC {wx:.2%} / g {gx:.2%}", cell.per_share, unit="USD/share")
   emit("Implied FCF growth at the current price",
        fin.reverse_dcf(price, fcf0, w.value, g, years=10, net_debt=net_debt, shares=shares),
        unit="%")
   ```

   Every grid cell must come from this one call: nine `fin.dcf` results in a loop, not nine calls.
   Read each input off the preloaded frames; never retype a number.

8. **Multiples cross-check.** In the same call, `fin.pe`, `fin.ev_to_ebitda` and `fin.fcf_yield` on
   the current price, so the DCF is not the only opinion in the report.

On an error, rate limit or empty payload, retry once and never substitute a guess. Record the gap
in the cell and explain it in one clause.

Evidence ids, the `$TICKER` style and the citation rules are the harness's job — follow the tool
errors when `create_report` pushes back.

## Analysis rules

- **Every assumption is declared.** Growth, fade, margin, tax rate, cost of debt, beta, the equity
  risk premium and terminal growth each go through `assume()` with the reason. An input that is not
  declared is not an input, it is a guess.
- **Terminal growth stays below the discount rate** and below long-run nominal GDP. A terminal value
  above about three quarters of the enterprise value means the model is a terminal-value bet: say so.
- **Free cash flow is computed, not lifted.** Operating cash flow minus capital expenditure, from the
  filing's own lines, with stock-based compensation treated consistently and the treatment stated.
- **One convention, stated once:** flows are year-end unless you set `mid_year=True`, the first
  explicit flow is next year, and the terminal value is discounted over the full horizon.
- **The reverse DCF is the honest half.** The growth the price implies is often the most useful
  number in the report, because it needs no forecast of yours.
- **A range, never a point.** The headline is the grid's span. A single value per share stated
  without its sensitivity is false precision.
- **Profile shapes the framing.** A short horizon leads with the multiples and the implied growth; a
  long horizon leads with the DCF. A beginner gets the intuition before the arithmetic.
- **Tone.** Professional and direct. This is a model under assumptions, not a price target.

## Output

Call `create_report` once with `template: "valuation"` and these sections, in this order:

| Section | Blocks |
|---|---|
| Approach | `text`: which model, on what cash flow, over what horizon, and why that fits this business |
| Inputs | `table` with `key: true`: Input, Value, Source, Why — one row per assumption and per fetched input, risk-free rate, beta, ERP, cost of equity, cost of debt, tax rate, WACC, forecast growth, terminal growth, net debt, shares |
| Valuation | `kpis`: value per share, current price, premium or discount, enterprise value, implied FCF growth at the current price. Then a `table` of the model: Year, Free cash flow, Discount factor, Present value, plus terminal value and its share of enterprise value |
| Sensitivity | `table`: rows are WACC, columns are terminal growth, cells are value per share, with the base case marked. A `text` block naming the range across the grid |
| Stance | `callout`: what the price implies, where your value lands against it, and your confidence with its reason |

Then reply in chat with two or three lines: the value range, the current price and the single
assumption that moves the answer most. Never paste the report, a table or a section list into the
chat. If `create_report` returns issues, fix exactly those cells and call it again.

## Do not

- Do not run a DCF on a company with no positive free cash flow and no credible path to it. The
  report is still the deliverable: `create_report` with `template: "valuation"`, Approach saying in
  plain terms why discounted cash flow does not apply here, Inputs and Valuation carrying the
  multiples instead, Sensitivity dropped or replaced by the implied-growth reading, Stance as usual.
- Do not pick a discount rate to reach a conclusion, and never set terminal growth at or above WACC.
- Do not present the base case as the answer without the grid.
- Do not exceed scope: no price target, no position sizing, no buy or sell call.
- Do not burn Alpha Vantage calls on repeats, retries or tools outside this process.
