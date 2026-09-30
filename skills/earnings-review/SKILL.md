---
name: earnings-review
description: >-
  Analyze a quarterly report that has already been released for a single stock. Locates the 8-K
  earnings press release and reads Exhibit 99.1, compares reported EPS and revenue against
  estimates, extracts segment and KPI detail, compares new guidance to prior guidance and
  consensus, pulls call takeaways from the transcript, checks cash flow and the balance sheet,
  measures the market reaction and sell-side response, and tests the result against any pre-
  earnings thesis. Delivers an earnings-review report: results vs expectations, guidance, drivers,
  reaction and a stance. Use when the user asks how a company did, what the print means, or
  invokes /earnings-review. Do not use before results are out; use earnings-preview instead.
license: MIT
metadata:
  version: "2.0"
  category: earnings
  inputs: [ticker]
  requires: [filings, fundamentals, earnings, estimates, prices, transcripts, news]
  output: earnings-review
  profile: [experience.level, style.depth]
  holdings: false
---

# Earnings Review

## Purpose

A post-mortem of a quarterly report: what the company delivered against expectations, how the guide
changed, what the call revealed, how durable the result is, and how the market responded. Analysis
of the print, not a recommendation.


## Inputs

- **Required:** one ticker. If the user did not give one, ask for it and stop. Ask nothing else.
- **Infer rather than ask:** the quarter (default to the most recently reported), the pre-earnings
  thesis (from an `earnings-preview` earlier in this chat or from memory; skip the comparison if
  none exists), focus areas, reporting currency.
- If the ticker resolves to several listings, take the primary US listing and name the entity.

## Process

Step 1 gates the rest: the press release supplies the numbers every later step reasons about. Steps
3 through 6 are independent, so issue their calls in parallel batches. Keep the run to roughly a
dozen calls: the Alpha Vantage free tier allows 25 requests per day and 5 per minute, so never
repeat a call and never poll.

1. **Locate the release.** `edgar_lookup_company` for the CIK, then `edgar_filings` with
   `forms: ["8-K"]`. Take the most recent Item 2.02 results filing and `edgar_read_filing` on its
   Exhibit 99.1 URL with `query: "revenue earnings per share guidance outlook segment"`. Record the
   filing date and accession. With no 8-K yet — normal in the first hours, and for foreign private
   issuers filing 6-K — `web_search` with `topic: "news"`, `time_range: "week"`, then `web_fetch` the
   company's own release, said plainly to come from coverage.

2. **Actuals versus estimates.** `alphavantage__EARNINGS` for reported EPS, estimated EPS and
   surprise. Take revenue, margins and segment lines from the press release; Alpha Vantage carries
   no revenue estimate, so source any revenue consensus from step 6 and attribute it.

3. **Detail and guidance change.** Re-read the release with `edgar_read_filing`, querying the
   company's own segment names plus "guidance" and "outlook". Extract segment revenue and operating
   income, the KPIs management leads with, the new guide for next quarter and the full year, and the
   exact qualifier wording. Read the previous 8-K exhibit for the prior guide if it is not already
   in context.

4. **Call takeaways.** `alphavantage__EARNINGS_CALL_TRANSCRIPT` for the symbol and fiscal quarter.
   Extract five substantive points with speaker name and role, favouring management's explanation of
   drivers and the sharpest analyst questions. Fallback: `web_search` for transcript coverage, marked
   secondary. With no transcript, say so and omit quotes rather than paraphrasing.

5. **Balance sheet and cash flow.** `edgar_financials` with `statement: "cashflow"` and again with
   `statement: "balance"`, `period: "quarterly"`, once the 10-Q or 10-K is filed: operating cash
   flow against net income, capital expenditure, buybacks, cash and debt. If only the 8-K exists,
   use its condensed statements, labelled press-release figures subject to revision.

6. **Market reaction and sell-side.** `alphavantage__GLOBAL_QUOTE` and
   `alphavantage__TIME_SERIES_DAILY` in one batch for the first full session move after the release
   and the move since. `web_search` with `topic: "news"`, `time_range: "week"`, favouring
   reuters.com, bloomberg.com, wsj.com, barrons.com, for rating and target changes.

7. **Thesis check.** If a preview thesis exists in this chat or memory, state item by item what it
   got right, what it missed and why. Skip it entirely when no prior thesis exists.

8. **Memory.** `memory_update` only if the user explicitly asks you to remember something.

On an error, rate limit or empty payload, retry once and never substitute a guess. Record the gap in
the cell and explain it in one clause.

## Tools carry the rules

- Every tool result is evidence with an id (`E7`); cite figures by id and use `evidence_get` to read
  an exact slice back rather than trusting your memory of it.
- Every derived figure — surprise, margin, growth, per-share effect, the move — comes from
  `financial_calculator` via `emit()`, which gives it a `C` id. Declare each choice with `assume()`.
- `create_report` rejects a figure that does not match its entry and names the cell to fix.
  Formatting, source tags, Sources and the disclaimer are the harness's job, not yours.

## Analysis rules

- **Beat is judged separately for EPS and revenue**, each against its own stated consensus. Never
  collapse the two into one verdict.
- **Label every EPS figure** GAAP or adjusted and never compare across bases. Reconcile the two if
  both appear.
- **Quality of earnings.** Check operating cash flow against net income, receivables and inventory
  against revenue, an unusually low tax rate, buybacks flattering per-share figures, currency, and
  one-off gains sitting in operating income. Quantify every effect you cite, and say plainly when a
  beat rests on tax or share count.
- **One-offs** are non-recurring only when the filing says so. State the amount, the line item and
  the per-share effect where disclosed.
- **Guidance versus consensus.** Compare the guided midpoint to consensus and give the range width.
  A midpoint below consensus is a cut even if the top of the range clears it. Flag any change in
  basis, segment definition or currency assumption; withdrawal is material.
- **Confidence.** Every judgment carries an explicit level — high, moderate or low — and its reason.
- **Tone.** Professional and direct. No hype, no superlatives, no claim about where the stock goes.

## Output

Call `create_report` once with `template: "earnings-review"` and these sections, in this order:

| Section | Blocks |
|---|---|
| Results vs expectations | `kpis`: EPS, revenue, the headline margin. Then a `table` with `key: true`: Line, Reported, Consensus, Surprise, Prior-year |
| Guidance | `table`: Period, New guide, Prior guide, Consensus, Change. A `text` block for the exact qualifier wording |
| Drivers | `list` of segment and KPI moves, plus a `chart` of the metric that carries the quarter, and the five call takeaways with speaker and role |
| Reaction | `kpis`: move on the first full session, move since, 52-week range. A `text` block for rating and target changes |
| Stance | `callout`: what the print changes, the quality of the result, and your confidence with its reason. Add the thesis check here when one exists |

Then reply in chat with two or three lines: the headline of the print and your verdict with its
confidence. Never paste the report, a table or a section list into the chat. Omit a table only when
every row would be "not available"; keep the section and give the reason in one line. If
`create_report` returns issues, fix exactly those cells and call it again.

## Do not

- Do not call a quarter a beat when only one line cleared, and do not blend EPS and revenue.
- Do not paraphrase the call as a quote, and do not present a stale quote as current.
- Do not exceed scope: no price target, no position sizing, no buy or sell call.
- Do not burn Alpha Vantage calls on repeats, retries or tools outside this process.
