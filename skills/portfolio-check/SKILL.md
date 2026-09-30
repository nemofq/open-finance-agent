---
name: portfolio-check
description: >-
  Examine the holdings the user entered themselves: what they own, how concentrated it is, which
  sectors and instrument types it leans on, how the largest positions have moved lately, and where
  it sits against the risk tolerance, horizon and instrument constraints in their investor profile.
  Delivers a portfolio check directly in chat: holdings summary, concentration, and fit with profile. Observations and
  questions only, never rebalancing instructions. Use when the user asks how their portfolio looks,
  whether they are too concentrated, how exposed they are to a sector or theme, or invokes
  /portfolio-check. Not for researching one name, which is /stock-brief.
license: MIT
metadata:
  version: "1.0"
  category: portfolio
  inputs: []
  requires: [prices, fundamentals]
  profile: [risk.tolerance, constraints.allowedInstruments, objectives.horizon]
  holdings: true
---

# Portfolio Check

## Purpose

A clear picture of what the user actually holds and where it is unbalanced, read against the
profile they declared. Every finding is an observation or a question for them, never an instruction.

## Inputs

- **Required:** nothing. The holdings come from the user's own ledger.
- **Reads from the profile:** risk tolerance, allowed instruments, horizon. When a field is unset,
  say the check could not be made rather than assuming a default.
- **Scope:** every account unless the user named one.

## Process

Step 1 gates everything: with no holdings there is nothing to check.

1. **Read the holdings.** `portfolio_get`. If it reports no accounts, stop and tell the user where
   to add them on the Portfolio page; do not guess a portfolio from the conversation.

2. **Fetch market quotes and sector classifications in one batch.** Call `market_quotes` passing all
   held ticker symbols in one batch. This returns live prices, changes, and sector/industry
   classifications for all positions at once, with evidence entries for the calculator, without
   consuming API quotas. If a custom or private asset is not quoted, show it at cost basis.

3. **One calculator call** does the arithmetic:

   ```python
   # Declare holdings (U tags) and quotes (E tags) using assume() since they are scalar figures:
   # qty = {"AAPL": assume("AAPL qty", 1, "U1"), ...}
   # price = {"AAPL": assume("AAPL price", 150.0, "E1"), ...}
   value = {sym: qty[sym] * price[sym] for sym in qty}
   w = fin.weights(value)
   conc = fin.concentration(value)
   emit("Concentration (HHI)", conc)
   emit("Effective number of holdings", conc.effective_holdings)
   emit("Sector exposure", fin.exposure(value, sector_by_symbol), unit="%")
   emit("Instrument exposure", fin.exposure(value, kind_by_symbol), unit="%")
   for sym in value:
       emit(f"{sym} weight", w[sym], unit="%")
       emit(f"{sym} unrealized", fin.ratio(value[sym] - cost[sym], cost[sym], unit="%"))
   ```

   Note: holdings entries (U tags) and live quotes (E tags) are scalar numbers rather than tabular DataFrames; declare them with `assume(..., why="U1")` or similar inside the script rather than passing them in the `evidence` parameter.

4. **Context for the biggest moves:**
   The portfolio check focuses strictly on asset allocation, concentration, and risk profile fit. Highlight the positions with the largest unrealized gains or losses directly from your calculator arithmetic and mark-to-market observations. Do not make external news or sentiment API calls during this check, to keep the analysis fast, concise, and focused on structural portfolio health.

Holdings never leave the machine: a web search carries a ticker, never a quantity, a cost basis, a
position value or an account name. The harness enforces this; do not test it.

On an error, rate limit or empty payload, retry once and never substitute a guess. A position you
could not price is shown at cost with the gap named.

Evidence ids, the `$TICKER` style and the citation rules are the harness's job — every figure must cite its evidence id (e.g. `[U1]`, `[E1]`, `[C1]`).

## Analysis rules

- **This is not advice.** No rebalancing instruction, no target weight, no "you should trim". State
  what is true, what it would mean under their stated profile, and what you would need to know. End
  findings as observations or as questions the user can answer.
- **Concentration is described, not judged in the abstract.** Report the largest weight, the top-three
  weight, the Herfindahl index and the effective number of holdings, and compare them with what the
  user's stated risk tolerance implies. A high concentration under a high tolerance is a fact, not a
  problem.
- **Correlation is the hidden concentration.** Five positions in one end market are one bet; say so
  when the sector table shows it, even though the count of holdings looks diversified.
- **Look-through where you can, and say so where you cannot.** An index ETF's sector mix changes the
  picture; without the data, report the exposure as unmeasured rather than as zero.
- **Cost basis is not performance.** Unrealized gain against cost is not a return: there is no time
  weighting and no cash flow history. Label it as such.
- **A constraint breach is stated plainly:** a holding in an instrument class the profile does not
  allow, or a position whose horizon is shorter than the objective, is named with the profile field
  it conflicts with.
- **Tone.** Professional, calm and direct. No alarm, no reassurance the evidence does not support.

## Output

Deliver the portfolio check directly in chat, not as a separate report document. Structure your chat reply with these sections:

- **Holdings Summary**: High-level position count, total cost basis, total current value, and cash. Follow with a table of positions (Symbol, Kind, Quantity, Cost basis, Current value, Weight, Change since purchase).
- **Concentration & Exposure**: Largest weight, top-three weight, Herfindahl index / effective number of holdings, followed by sector exposure and instrument-class exposure.
- **Fit with Profile**: Comparison against declared risk tolerance, allowed instruments, and time horizon. Note any constraint breaches, unset fields, or look-through gaps.
- **Key Observation**: 1-2 focused observations or questions for the user (never advice or rebalancing instructions).

Every figure in the response must cite its evidence id (e.g. `[U1]`, `[E1]`, `[C1]`).

## Do not

- Do not recommend buying, selling, trimming or rebalancing anything, and do not name a target weight.
- Do not put a quantity, a value, a cost basis or an account name into a web search or fetch.
- Do not infer a profile field the user has not set; report it as unset.
- Do not present the change since purchase as a return.
- Do not make external news or sentiment calls during a portfolio check; focus entirely on holdings, allocation, concentration, and risk profile alignment.
- Do not burn Alpha Vantage calls on positions you are not going to report on.
