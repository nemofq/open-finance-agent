---
name: filing-changes
description: >-
  Diff a company's latest annual or quarterly report against the one before it. Locates both
  filings, reads the risk factors, the outlook and guidance language and the management discussion
  in each, and reports what was added, removed, quantified, softened or hardened, with the filing
  and the wording behind every change. Delivers a filing-changes report: filing, what changed, why
  it matters. Use when the user asks what is new in the latest 10-K or 10-Q, whether the risk
  disclosures changed, whether management's language shifted, or invokes /filing-changes. Not for
  the numbers of a quarter just reported — use earnings-review.
license: MIT
metadata:
  version: "1.0"
  category: filings
  inputs: [ticker]
  requires: [filings, fundamentals]
  output: filing-changes
  profile: [experience.level, style.depth]
  holdings: false
---

# Filing Changes

## Purpose

What a company chose to say differently this time. Added and removed risk factors, guidance
language that moved, and a management discussion whose emphasis shifted — each traced to the
sentence that carries it.

## Inputs

- **Required:** one ticker. If the user did not give one, ask for it and stop.
- **Infer rather than ask:** which pair to compare. Default to the two most recent filings of the
  same form: this year's 10-K against last year's, or this quarter's 10-Q against the previous one.
  If the user names a form or a period, use theirs.

## Process

Step 1 finds both documents; steps 3 and 4 read them, so issue the two reads for each filing in one
batch per filing — four `edgar_read_filing` calls in two batches. Never re-read a document you have
already read in this chat.

1. **Identify and locate.** `edgar_lookup_company`, then `edgar_filings` with
   `forms: ["10-K", "10-Q"]`, `limit: 8`. Take the latest filing and the previous filing of the
   same form, and keep both document URLs with their filing dates and accession numbers. A foreign
   private issuer files 20-F and 6-K instead; use the equivalent pair and say which forms you read.

2. **Confirm the pair is comparable.** Same form, consecutive periods, same registrant. If the
   company changed fiscal year, restated, or filed an amendment, say so before comparing.

3. **Risk factors, both filings.** `edgar_read_filing` on each with
   `query: "risk factors"`. In a 10-K expect the full list; in a 10-Q expect only the material
   changes the company chose to disclose, which is itself the signal.

4. **Outlook and management discussion, both filings.** `edgar_read_filing` on each with
   `query: "outlook guidance management discussion results of operations"`. Take the forward-looking
   sentences, the explanations of the period's results, and any quantified commitment.

5. **Quantify where the filings do.** When both filings state the same figure, use
   `edgar_financials` (`statement: "key_metrics"`, matching period) to put the change in context, and
   compute the delta in `financial_calculator` with `fin.yoy` or `fin.qoq` — never by hand.

6. **Verify anything surprising.** If a change looks material and the filing language is ambiguous,
   `edgar_search_filings` for the exact phrase to see whether it is boilerplate that many filers use.

On an error or empty payload, retry once and never substitute a guess. A section you could not read
is reported as unread, not inferred.

Evidence ids, the `$TICKER` style and the citation rules are the harness's job — quote from the
filings through `evidence_get` rather than from memory, and follow the tool errors when
`create_report` pushes back.

## Analysis rules

- **A change is a quotation.** Every reported change carries the before and after wording, or the
  sentence that appeared or vanished. A paraphrase without the words behind it is not a finding.
- **Direction, not just difference.** Say whether the language hardened (a risk newly quantified, a
  hedge removed, a commitment made) or softened (a range widened, "expects" downgraded to "may",
  a metric no longer disclosed). Softening is often the finding.
- **A removed risk factor is as interesting as a new one,** and a risk moved higher in the order,
  or newly given its own heading, is a deliberate signal.
- **A stopped disclosure is a change.** A KPI, a segment or a customer concentration that used to be
  in the filing and is not any more gets its own line.
- **Boilerplate is filtered out.** Language that most filers in the sector print verbatim is not a
  change in this company's position; when in doubt, check with a full-text search before reporting it.
- **Rank by materiality,** not by order of appearance: what changes the economics first, what changes
  the risk profile second, what changes only the presentation last.
- **Tone.** Professional and direct. Report what the filing says; do not infer intent management did
  not state.

## Output

Call `create_report` once with `template: "filing-changes"` and these sections, in this order:

| Section | Blocks |
|---|---|
| Filing | `kpis`: the new filing's form, filing date, period and accession, and the same for the one it is compared against. A `text` block noting anything that makes the pair less comparable |
| What changed | `table` with `key: true`: Area, Then, Now, Direction — one row per change, Area being the risk factor, the guidance line or the MD&A topic, Then and Now the actual wording. Then a `list` of disclosures that were dropped or newly added |
| Why it matters | `list`: the changes that move the economics or the risk profile, each with what it would take to confirm the concern, in materiality order. A `callout` for the single most consequential change |

Then reply in chat with two or three lines: the two filings compared and the one change that
matters most. Never paste the report, a table or a section list into the chat. If `create_report`
returns issues, fix exactly those cells and call it again.

## Do not

- Do not report a change without the wording from both filings behind it.
- Do not compare filings of different forms, or across a fiscal-year change, without saying so.
- Do not treat sector-wide boilerplate as a company-specific signal.
- Do not exceed scope: no valuation, no price target, no buy or sell call.
