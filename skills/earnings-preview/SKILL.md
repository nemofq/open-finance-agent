---
name: earnings-preview
description: >-
  Build a pre-earnings preview for a single stock before it reports. Confirms the scheduled report
  date, pulls the last eight quarters of EPS actual vs estimate and surprise, reconstructs revenue
  and margin trend from XBRL, extracts prior-quarter guidance from the last 8-K press release,
  gathers catalysts and sell-side expectations from news, and reads the price setup. Delivers an
  earnings-preview report: setup, expectations, what matters this quarter, beat/inline/miss
  scenarios, risks, and an explicit stance with confidence. Use when the user asks what to expect
  from an upcoming report, how a company is set up into earnings, what to watch or what is priced
  in, or invokes /earnings-preview. Do not use after results are out; use earnings-review instead.
license: MIT
metadata:
  version: "2.0"
  category: earnings
  inputs: [ticker]
  requires: [filings, fundamentals, earnings, estimates, prices, news]
  output: earnings-preview
  profile: [experience.level, style.depth]
  holdings: false
---

# Earnings Preview

## Purpose

Preview a company's upcoming quarterly report: what is expected, what would change the story, and
how the stock is set up going in. Analysis of expectations and scenarios, not a recommendation.

## Inputs

- **Required:** one company, by ticker or by name. A name is enough: resolve it in step 1 and
  carry on. Ask for the ticker and stop only when no company is named, or the name fits more than
  one listed company. Ask nothing else.
- **Infer rather than ask:** the quarter (the next scheduled report), the user's stated view or
  position, focus areas (the KPIs that drive this company's revenue), reporting currency.
- If the ticker resolves to several listings, take the primary US listing and name the entity.

## Process

Work in this order. Steps 1 and 2 gate the rest. Steps 3 through 7 are independent, so issue their
tool calls in parallel batches. Keep the run to roughly a dozen calls: the Alpha Vantage free tier
allows 25 requests per day and 5 per minute, so never repeat a call with the same arguments and
never poll.

1. **Identify the company.** `edgar_lookup_company` for the registrant name, CIK and exchange; in
   the same batch `alphavantage__COMPANY_OVERVIEW` for sector, market cap, shares outstanding and
   fiscal year end. If Alpha Vantage is off, continue with EDGAR alone and note the gap. If neither
   resolves the ticker, stop and say so.

2. **Confirm the report date.** `alphavantage__EARNINGS_CALENDAR` with a three-month horizon; take
   the next `reportDate` and the session (before open or after close). Fall back to `web_search`
   with `topic: "news"`, accepting a date only from the company's investor relations page or a wire
   story that cites the company. If no confirmed date exists, write "report date not confirmed" and
   say what you checked. Never infer the date from last year's calendar.

3. **Earnings history.** `alphavantage__EARNINGS`; take the last eight quarters of quarter end,
   reported EPS, estimated EPS and surprise, labelled GAAP or adjusted. Fallback: `edgar_financials`
   income quarterly gives as-reported diluted EPS but no estimates.

4. **Revenue and margin trend.** `edgar_financials` with `statement: "income"`,
   `period: "quarterly"`, `limit: 8`. Compute growth and margins in the calculator, not by hand.
   Flag any quarter whose value is derived rather than directly reported.

5. **Prior guidance.** `edgar_filings` with `forms: ["8-K"]`, find the most recent earnings release,
   then `edgar_read_filing` on the Exhibit 99.1 URL with `query: "outlook guidance full year"`.
   Extract the guided ranges for the quarter now being previewed and for the full year, with the
   exact wording of any qualifier. If the company does not guide, say so explicitly.

6. **Catalysts and sell-side expectations.** `web_search` with `topic: "news"`,
   `time_range: "month"`, favouring reuters.com, bloomberg.com, wsj.com, barrons.com, cnbc.com, for
   consensus EPS and revenue, revisions, preannouncements, target changes and any options-implied
   move. `web_fetch` at most two URLs that carry numbers. Consensus is only consensus when a named
   source states it; otherwise "not available".

7. **Price setup.** `alphavantage__GLOBAL_QUOTE` and `alphavantage__TIME_SERIES_DAILY` in one batch:
   last price with its trading date, change on the day, 52-week range, and the one-day move after
   each of the last four reports. If Alpha Vantage is unavailable, omit the setup rather than
   approximating from news.

8. **Memory.** `memory_update` only if the user explicitly asks you to remember something.

On an error, rate limit or empty payload, retry once and never substitute a guess. Record the gap in
the cell and explain it in one clause.

## Tools carry the rules

- Every tool result is evidence with an id (`E7`); cite figures by id and use `evidence_get` to read
  an exact slice back rather than trusting your memory of it.
- Every derived figure — growth, margin, surprise, implied move — comes from `financial_calculator`
  via `emit()`, which gives it a `C` id. Declare each choice you make with `assume()`.
- `create_report` rejects a figure that does not match its entry and names the cell to fix.
  Formatting, source tags, Sources and the disclaimer are the harness's job, not yours.

## Analysis rules

- **Beat is judged separately for EPS and revenue.** Never call a quarter a beat on one line alone.
- **Label every EPS figure** GAAP or adjusted and never compare across bases. Alpha Vantage
  estimates are typically adjusted; EDGAR EPS is GAAP.
- **Guidance versus consensus.** Compare the guided midpoint to consensus and give the range width.
  A midpoint below consensus is a cut even if the top of the range clears it. Flag a guide that
  changes basis, segment definition or currency assumption.
- **One-offs** are non-recurring only when the filing says so. Quantify them.
- **Quality of expectations.** Note wide dispersion, a long run of beats, habitually conservative
  guides. Sandbagging is a pattern to describe, not a prediction to assert.
- **Confidence.** Every judgment carries an explicit level — high, moderate or low — and its reason.
- **Tone.** Professional and direct. No hype, no superlatives, no price prediction stated as fact.

## Output

Call `create_report` once with `template: "earnings-preview"` and these sections, in this order:

| Section | Blocks |
|---|---|
| Setup | `kpis`: last price, change on day, 52-week range, report date. Then a `table` of the one-day move after each of the last four reports |
| Expectations | `table` with `key: true`: Line, Consensus, Prior-year actual, Company guidance. Then a `table` of eight quarters: Quarter, EPS actual, EPS estimate, Surprise %, Revenue, YoY revenue |
| What matters this quarter | `list`: one KPI per item, with the threshold that counts as good or bad, and why |
| Scenarios | `table`: Scenario, Trigger, Read-through, Confidence — a beat, in-line and miss row |
| Risks | `list`: each risk and what would reveal it early |
| Stance | `callout`: what is already expected, and your confidence with its reason |

Then reply in chat with two or three lines: the headline of the setup and your stance with its
confidence. Never paste the report, a table or a section list into the chat. Omit a table only when
every row would be "not available"; keep the section and give the reason in one line. If
`create_report` returns issues, fix exactly those cells and call it again.

## Do not

- Do not guess the report date from a prior-year pattern; an unconfirmed date is stated as such.
- Do not invent consensus. If no named source publishes it, the cell reads "not available".
- Do not mix GAAP and non-GAAP in one row or one comparison without labelling both sides.
- Do not quote a price without its trading date, or present a stale quote as current.
- Do not exceed scope: no valuation model, no price target, no position sizing, no buy or sell call.
- Do not burn Alpha Vantage calls on repeats, retries or tools outside this process.
