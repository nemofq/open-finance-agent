---
name: thesis-check
description: >-
  Re-test an investment thesis the user wrote earlier against what the data says now. Extracts the
  thesis's measurable claims, picks the right tool for each one, pulls the current figure, and
  marks every claim confirmed, broken, unproven or no longer measurable, with what would settle it.
  Delivers a thesis-check report: thesis, evidence since, verdict. Use when the user pastes a thesis
  or asks whether their reasons for owning something still hold, whether their thesis is intact or
  broken, or invokes /thesis-check. Not for forming a new view on a company, which is /stock-brief
  or /valuation.
license: MIT
metadata:
  version: "1.0"
  category: research
  inputs: [ticker, thesis]
  requires: [filings, fundamentals, earnings, prices, news]
  output: thesis-check
  profile: [experience.level, style.depth, objectives.horizon]
  holdings: false
---

# Thesis Check

## Purpose

Hold an old argument against new evidence, claim by claim. The point is to find out which parts
broke, not to defend or reject the thesis as a whole.

## Inputs

- **Required:** the thesis and the ticker it is about. Take the thesis from the user's message if
  they pasted one, from the `## Notes` section of the memory block already in your system prompt if
  they named a saved one, or from an earlier report in this chat.
- **If no thesis exists anywhere,** say so and ask them to paste it. Do not reconstruct a thesis from
  the price chart or from what is currently popular.
- **Infer rather than ask:** when the thesis was written, from its own dates or the memory entry.

## Process

Step 1 decides everything after it: the claims determine which tools you call. Group the claims by
the tool that tests them and issue one batch per tool, roughly a dozen calls in total. The Alpha
Vantage free tier allows 25 requests a day and 5 a minute, so never repeat a call and never poll.

1. **Extract the claims.** Turn the thesis into a numbered list of statements that can be checked
   against evidence. Keep the user's wording. For each claim record what would confirm it, what would
   break it, and the figure as it stood when the thesis was written, if the thesis states one. A
   sentence with no testable content is listed separately as an untestable premise, not silently
   dropped.

2. **Pick one tool per claim,** then batch by tool:

   | Claim is about | Test it with |
   |---|---|
   | Revenue, margin, cash flow, EPS trend | `edgar_financials` — `key_metrics` or the statement the claim names |
   | Beating or missing expectations | `alphavantage__EARNINGS` |
   | Guidance, segment detail, a management commitment | `edgar_filings` with `forms: ["8-K"]` or `["10-K","10-Q"]`, then `edgar_read_filing` with the claim's own words as the query |
   | A risk appearing or receding | `edgar_read_filing` with `query: "risk factors"` on the latest annual report |
   | Valuation being cheap or expensive | `alphavantage__COMPANY_OVERVIEW` and `alphavantage__GLOBAL_QUOTE`, then the calculator |
   | Market share, a competitor, a product launch | `web_search` with `topic: "news"`, then `web_fetch` on at most two sources that carry numbers |
   | A macro condition | `alphavantage__TREASURY_YIELD`, `alphavantage__CPI` or `alphavantage__FEDERAL_FUNDS_RATE` |

3. **Establish the "then" figures.** Where the thesis states a number, use it and mark it as the
   user's. Where it does not, take the period that was current when the thesis was written from the
   same tool that gives you the "now" figure, so both sides come from one series.

4. **One calculator call** computes every change: `fin.yoy`, `fin.qoq`, `fin.cagr`, `fin.margin`,
   `fin.surprise`, `fin.pe` as the claims require, plus the move in the share price over the period.
   Read both sides off the preloaded frames; never retype a number.

5. **Look for what the thesis missed.** One `web_search` for material developments since it was
   written that none of the claims anticipated. A thesis can be right on every stated claim and
   still be overtaken.

On an error, rate limit or empty payload, retry once and never substitute a guess. A claim you could
not test is marked unproven with the reason, never assumed to hold.

Evidence ids, the `$TICKER` style and the citation rules are the harness's job — follow the tool
errors when `create_report` pushes back.

## Analysis rules

- **Every claim gets its own verdict:** confirmed, broken, unproven, or no longer measurable because
  the company stopped disclosing it. A thesis is not confirmed or broken as a whole.
- **The price is not a verdict.** A stock that fell while every claim held is a claim about the
  market's view, not about the business. Report the move, and say which it is.
- **Grade against the claim as written,** not against a kinder version of it. If the thesis said 20%
  growth and the company delivered 14%, that claim is broken even if the story is intact.
- **Time-box it.** Every comparison names the period on each side. "Then" is when the thesis was
  written; "now" is the latest reported period, which may lag the thesis by a quarter.
- **Confirmation bias runs both ways.** Give a broken claim and a confirmed claim the same evidentiary
  standard, and state plainly when the evidence is thin on either side.
- **Name what would settle each open claim,** with the date the next data point arrives.
- **Tone.** Professional and direct. No hedging a broken claim, no vindication for a confirmed one,
  no view on what the user should now do.

## Output

Call `create_report` once with `template: "thesis-check"` and these sections, in this order:

| Section | Blocks |
|---|---|
| Thesis | `text`: the thesis in the user's own words, with when it was written and where it came from. Then a `list` of the numbered claims as extracted, and any untestable premises |
| Evidence since | `table` with `key: true`: Claim, Then, Now, Change, Verdict — one row per claim, Then and Now carrying their periods. Then a `list` of developments since the thesis that none of the claims anticipated |
| Verdict | `kpis`: claims confirmed, broken, unproven, and the share price move since the thesis. A `callout`: which part of the argument survived, which did not, and your confidence with its reason. A `list` of what would settle each open claim, with the date the next data point is due |

Then reply in chat with two or three lines: how many claims held, which one broke, and what to watch
next. Never paste the report, a table or a section list into the chat. If `create_report` returns
issues, fix exactly those cells and call it again.

## Do not

- Do not invent or improve the thesis; check the one you were given.
- Do not treat the share price as evidence for or against a business claim.
- Do not mark a claim confirmed on evidence you could not retrieve.
- Do not exceed scope: no price target, no position sizing, no buy or sell call.
- Do not burn Alpha Vantage calls on claims a filing already answers.
