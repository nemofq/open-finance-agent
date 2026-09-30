---
name: peer-comps
description: >-
  Compare one company against its closest listed rivals on the numbers each of them filed. Resolves
  the peer set from the user or from the 10-K's own competition language, pulls revenue growth,
  gross and operating margin, diluted EPS and free cash flow for every name from XBRL, adds the
  valuation multiples, and ranks the set on the measures that matter for this industry. Delivers a
  peer-comps report: peer set, comparison, read-through. Use when the user asks how a company
  stacks up against competitors, who is winning a market, which of several names is the better
  business, or invokes /peer-comps. Not for valuing one company on its own cash flows, which is
  /valuation.
license: MIT
metadata:
  version: "1.0"
  category: valuation
  inputs: [ticker, peers]
  requires: [filings, fundamentals, prices]
  output: peer-comps
  profile: [experience.level, style.depth, style.preferredMetrics]
  holdings: false
---

# Peer Comps

## Purpose

A like-for-like table across a handful of companies, built from what each of them reported, and the
read-through: who is growing, who is earning it, and what the market pays for each.

## Inputs

- **Required:** one subject ticker. If the user did not give one, ask for it and stop.
- **Peers:** use the ones the user named. If they named none, infer three to five and say in the
  chat summary which set you used and why, so they can correct it. Do not stop to ask.
- **Infer rather than ask:** reporting currency, the fiscal alignment problem, which metrics lead
  for this industry.

## Process

Keep the set to four peers at most. Every extra name costs a call on each of two tools, and the
Alpha Vantage free tier allows 25 requests a day and 5 a minute, so never repeat a call and never
poll. Steps 3 and 4 run as one batch per tool across all names.

1. **Identify the subject.** `edgar_lookup_company`, and `edgar_filings` with `forms: ["10-K"]`,
   `limit: 1` in the same batch.

2. **Resolve the peer set,** when the user named none. `edgar_read_filing` on the 10-K with
   `query: "competition we compete principal competitors"` and take the companies the filing names
   itself — a competitor the company admits to is better evidence than an index membership. Where
   the language is generic, `edgar_search_filings` with the product or market phrase and
   `forms: ["10-K"]` finds the filers that describe the same market. Resolve each name to a ticker
   with `edgar_lookup_company`. Drop anything private, foreign-unlisted or more than roughly ten
   times the subject's revenue, and say which you dropped.

3. **Fundamentals per name,** including the subject, in one batch: `edgar_financials` with
   `statement: "key_metrics"`, `period: "annual"`, `limit: 3`.

4. **Market data per name,** in one batch: `alphavantage__COMPANY_OVERVIEW` for market cap, shares,
   EBITDA and the trailing multiples. Without Alpha Vantage, build the table from the filings alone
   and say the valuation columns are missing.

5. **One calculator call** builds every derived column and the ranking. Pass the evidence ids of all
   the metric tables:

   ```python
   for name, frame in {"NKE": E7, "DECK": E9, "ONON": E11}.items():
       emit(f"{name} revenue growth", fin.yoy(frame.loc["Revenues"][0], frame.loc["Revenues"][1]), unit="%")
       emit(f"{name} operating margin", fin.margin(frame.loc["OperatingIncome"][0], frame.loc["Revenues"][0]), unit="%")
       emit(f"{name} EV/EBITDA", fin.ev_to_ebitda(ev_by_name[name], ebitda_by_name[name]), unit="x")
   ```

   Read every input off the preloaded frames; never retype a number. Declare any adjustment you
   make with `assume()`.

On an error, rate limit or empty payload, retry once and never substitute a guess. A peer whose
data will not load is dropped from the table with a one-line reason, not filled in from memory.

Evidence ids, the `$TICKER` style and the citation rules are the harness's job — follow the tool
errors when `create_report` pushes back.

## Analysis rules

- **Like for like or not at all.** Fiscal years differ; say which period each column covers and never
  compare a company's FY25 to another's FY24 without labelling both. Where a peer's mix makes a line
  incomparable, mark the cell and say why rather than printing a misleading number.
- **The peer set is an argument, not a list.** State the basis: the same end market, the same
  customer, or the same unit economics. A peer chosen only for the sector is a weak peer.
- **Growth and margin before multiples.** A multiple is only interpretable once the reader knows what
  the business earns. Rank on the operating measures first, then show what each costs.
- **Segment share matters.** When the subject competes with only one segment of a larger peer, use
  the segment's revenue where it is disclosed and say so.
- **Accounting differences are named,** not averaged away: stock-based compensation, capitalized
  software, lease treatment, adjusted versus GAAP.
- **No composite score.** Rank each measure and let the reader see where the ranks disagree; a single
  blended score hides exactly the disagreement that is interesting.
- **Tone.** Professional and direct. No hype, no superlatives, no price prediction.

## Output

Call `create_report` once with `template: "peer-comps"` and these sections, in this order:

| Section | Blocks |
|---|---|
| Peer set | `list`: each name with its ticker and the one sentence that justifies including it, plus any name considered and dropped with the reason. A `text` block naming the fiscal periods the table uses |
| Comparison | `table` with `key: true`: Company, Revenue, Revenue growth, Gross margin, Operating margin, Diluted EPS, Free cash flow, Market cap, P/E, EV/EBITDA — one row per company, the subject first. Then a `table` of ranks: Measure, 1st, 2nd, 3rd, 4th, 5th |
| Read-through | `list`: what the table says about the subject's position, one item per finding, each naming the cells that support it. A `callout` for the one comparison that decides the argument |

Then reply in chat with two or three lines: the peer set you used, and where the subject sits.
Never paste the report, a table or a section list into the chat. If `create_report` returns issues,
fix exactly those cells and call it again.

## Do not

- Do not include a peer you could not pull data for; drop it and say so.
- Do not compare across fiscal periods without labelling both sides.
- Do not blend measures into one score, or call a ranking a recommendation.
- Do not exceed scope: no price target, no position sizing, no buy or sell call.
- Do not burn Alpha Vantage calls on repeats, retries or tools outside this process.
