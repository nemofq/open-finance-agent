---
name: stock-brief
description: >-
  Introduce one company to someone who does not know it. Resolves the filer, reads the business
  description and risk factors from the latest 10-K, pulls five years of revenue, margins, EPS and
  free cash flow from XBRL, computes a valuation snapshot (P/E, EV/EBITDA, free cash flow yield)
  against the current quote, and gathers what has happened lately from news. Delivers a stock-brief
  report: business, key metrics, valuation, recent developments, risks. Use when the user asks
  "tell me about $X", "what does this company actually do", "is this a real business", or invokes
  /stock-brief. Not for an upcoming or just-released quarter — use earnings-preview or
  earnings-review — and not for a full valuation model, which is /valuation.
license: MIT
metadata:
  version: "1.0"
  category: research
  inputs: [ticker]
  requires: [filings, fundamentals, prices, news]
  output: stock-brief
  profile: [experience.level, style.depth]
  holdings: false
---

# Stock Brief

## Purpose

The first honest look at a company: what it sells, how the economics have trended, what the market
pays for that today, what just happened and what could break. A description, not a call.

## Inputs

- **Required:** one ticker. If the user did not give one, ask for it and stop. Ask nothing else.
- **Infer rather than ask:** reporting currency, fiscal calendar, which segments matter.
- If the ticker resolves to several listings, take the primary US listing and name the entity.

## Process

Step 1 gates everything; the 10-K URL from step 2 feeds steps 3 and 7. Steps 3 to 6 are
independent, so issue them in one batch. Roughly ten calls is the budget: the Alpha Vantage free
tier allows 25 requests a day and 5 a minute, so never repeat a call with the same arguments and
never poll.

1. **Identify the company.** `edgar_lookup_company` for the registrant name, CIK and exchange, and
   in the same batch `alphavantage__COMPANY_OVERVIEW` for sector, industry, market cap, shares
   outstanding, EBITDA and fiscal year end. Without Alpha Vantage, continue on EDGAR alone and note
   the gap. If neither resolves the ticker, stop and say so.

2. **Find the latest annual report.** `edgar_filings` with `forms: ["10-K"]`, `limit: 2`; take the
   most recent and keep its document URL. A foreign private issuer files 20-F instead — use it and
   say which form you read.

3. **Business.** `edgar_read_filing` on that URL with
   `query: "our business segments products customers revenue"`. Take the segments, what each sells,
   who buys it and how the company makes money. Prefer the company's own words over a sector label.

4. **Key metrics.** `edgar_financials` with `statement: "key_metrics"`, `period: "annual"`,
   `limit: 5`, and again with `period: "quarterly"`, `limit: 4` for the current run rate.

5. **Price.** `alphavantage__GLOBAL_QUOTE` for the last price with its trading date and the change
   on the day. Without it, omit the valuation figures rather than approximating from news.

6. **Recent developments.** `alphavantage__NEWS_SENTIMENT` for the ticker, then `web_search` with
   `topic: "news"`, `time_range: "month"`, favouring reuters.com, bloomberg.com, wsj.com,
   cnbc.com. `web_fetch` at most two URLs that carry numbers.

7. **Risks.** `edgar_read_filing` on the same 10-K with `query: "risk factors"`. Take the risks
   specific to this company and skip the boilerplate every filer prints.

8. **Valuation snapshot.** One `financial_calculator` call, passing the evidence ids for the quote,
   the overview and the metrics table:

   ```python
   emit("P/E (trailing)", fin.pe(price, eps_ttm), unit="x")
   emit("EV", fin.ev(market_cap, total_debt, cash), unit="USD")
   emit("EV/EBITDA", fin.ev_to_ebitda(enterprise_value, ebitda), unit="x")
   emit("FCF yield", fin.fcf_yield(free_cash_flow, market_cap), unit="%")
   emit("Revenue CAGR 5y", fin.cagr(rev_first, rev_last, periods=4), unit="%")
   ```

   Read every input off the preloaded frames; never retype a number. Declare anything you choose
   with `assume()`.

On an error, rate limit or empty payload, retry once and never substitute a guess. Record the gap
in the cell and explain it in one clause.

Evidence ids, the `$TICKER` style and the citation rules are the harness's job — follow the tool
errors when `create_report` pushes back, and read exact slices back with `evidence_get` rather than
trusting your memory of a number.

## Analysis rules

- **Describe the business before judging it.** A reader who has never heard of the company should be
  able to explain it in a sentence after the first section.
- **Trend beats level.** Five years of revenue growth, gross and operating margin and free cash flow
  direction say more than any single year. Name the inflection and its year.
- **Label the multiple's basis.** Trailing or forward, GAAP or adjusted, and against what. A P/E
  without its earnings basis is noise.
- **Cheap is not a conclusion.** Say what the multiple implies and what would have to be true, not
  whether it is a bargain.
- **Risks are specific or omitted.** "Competition" is boilerplate; a named customer at 40% of
  revenue is a risk. Quantify it from the filing where the filing does.
- **Profile shapes the telling, never the evidence.** A beginner gets plain language and every term
  defined on first use; a professional gets the terse version. A brief depth is roughly half the
  length of a deep one, with the same sections.
- **Tone.** Professional and direct. No hype, no superlatives, no price prediction.

## Output

Call `create_report` once with `template: "stock-brief"` and these sections, in this order:

| Section | Blocks |
|---|---|
| Business | `text`: what the company sells and to whom, in two short paragraphs. Then a `table` of segments: Segment, What it sells, Revenue, Share of total |
| Key metrics | `kpis`: revenue, gross margin, operating margin, free cash flow, diluted EPS, latest fiscal year. Then a `table` of five years: Year, Revenue, YoY growth, Gross margin, Operating margin, Diluted EPS, Free cash flow |
| Valuation | `kpis` with `key`-style headline figures: last price with its date, market cap, P/E, EV/EBITDA, free cash flow yield. A `text` block naming the basis of each multiple and what the market is paying for |
| Recent developments | `list`: the three to five things that have happened in the last quarter, each with its date and source |
| Risks | `list`: the company-specific risks, each with what would reveal it early |

Then reply in chat with two or three lines: what the company does and the one thing that decides
whether it works. Never paste the report, a table or a section list into the chat. Omit a table
only when every row would be "not available"; keep the section and give the reason in one line. If
`create_report` returns issues, fix exactly those cells and call it again.

## Do not

- Do not present a sector label as a business description.
- Do not quote a price without its trading date, or present a stale quote as current.
- Do not copy the 10-K risk factor list wholesale; select and explain.
- Do not exceed scope: no DCF, no price target, no position sizing, no buy or sell call.
- Do not burn Alpha Vantage calls on repeats, retries or tools outside this process.
