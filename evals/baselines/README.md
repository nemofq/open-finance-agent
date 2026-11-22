# Baselines

Each JSON file here is one committed run, promoted with `--baseline`, and one row of the
[README's table](../../README.md#a-benchmark-that-favours-quality-over-quantity). This page breaks
each row down by task; how a run is made and promoted is in
[evals/README.md › Comparing runs](../README.md#comparing-runs). Add a section here when a baseline
is added, in the same order as the README's table.

All rows are benchmark v2 with judge prompt v10: judged by GPT-6.2 Sol at medium thinking with three
grades per answer, policy enforced, offline dataset, twelve tasks × 3 repeats. Every row was run on
the same release of the app and its model library (pi 1.6.0), with no model-specific handling, so the
rows are directly comparable. The commit in each section is the run's.

Rows published before 2026-11-21 were run on earlier code and judged by GPT-6 Astra. They are not
comparable with these and are kept only in git history, as are benchmark v1 scores.

Each per-task value is over the task's three runs, from the baseline's `results`:

- **Evidence** (/12), **Figures** (/12), **Contracts** (/16): the integrity checks,
  `deterministicCheck.evidenceScore`, `figureSupportScore` and `contractScore`, which add up to
  Integrity (/40).
- **Intent** (/15), **Financial** (/20), **Grounding** (/15), **Clarity** (/10): the judge's rubric
  points by dimension, `judgeResult.dimensionScores`, which add up to Judged (/60).
- **Total** (/100): the task's mean `totalScore` with its population standard deviation (σ). A
  failed run counts as zero; the integrity and judge columns average the completed answers only.
- **Capped**: answers a critical rubric item's cap actually lowered, capped at 49 when the item was
  contradicted and at 69 when it was missed, with the points the caps took off the task's mean Total:
  `2 (−9.2)`. An answer already below its cap is not counted.
- **Run time**: the task's turn, `metrics.latencyMs`, judging excluded.
- **Output tokens**: `metrics.tokens.output`, as the provider reports it. Some providers count
  thinking in it and some do not, so figures are not comparable across model makers.

Each section's **Cost** is the agent's average cost per run at the list prices it gives, worked
out as in [evals/README.md › Reproducing the README table](../README.md#reproducing-the-readme-table).

**Known issues.** An audit of the three critical items that cap most often (2026-10-17) found the
judge applying them as written, with two flaws in the items themselves, left in place so every row
stays graded by one rubric:

- `roc-not-inferred` (dividend trap) also requires saying that the June distribution's tax character
  is unavailable, so an answer that makes no forbidden inference but leaves that out is capped at 69.
- `time-and-motive` (Apple fact-check) asks the answer to treat Berkshire's large Q2 sale as real,
  but the offline record ends at the March 2024 13F, so the item is almost never fully met.

Grades of these two items also vary from one grading to the next: the same answer, graded again, can
move between partial, missed and contradicted on them.

## GPT-6.2 Astra avg@3

[`2026-11-21-openai-codex-gpt-6-2-astra-openai-codex-gpt-6-2-sol.json`](2026-11-21-openai-codex-gpt-6-2-astra-openai-codex-gpt-6-2-sol.json)

- **Agent:** `openai-codex/gpt-6.2-astra`, thinking medium, through a ChatGPT sign-in
- **Judge:** `openai-codex/gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `52ca646`
- **Scores:** total 62.8 · integrity 29.1 · judged 34.2 · completed 100.0% · mean per-task σ 3.91
- **Critical caps:** 3 of 36 answers missed or contradicted a critical item, 3 lowered by 18.0
  points (missed `roc-not-inferred` 3)
- **Diagnostics:** tool argument errors 0 · fallback reports 0 · unverified report figures 12 ·
  repaired 1
- **Cost:** $5.88 per run · per million tokens: input $8.00, cached input $0.40, output $40.00 ·
  OpenAI API list price, 2026-11-21

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 5.6 | 12.0 | 0.0 | 12.5 | 10.0 | 7.5 | 6.7 | 54.3 (5.1) | 0 | 58 s | 1,574 |
| `retail-02-nike-moat-erosion` | 7.6 | 11.5 | 0.0 | 15.0 | 10.0 | 7.5 | 8.3 | 60.0 (1.8) | 0 | 85 s | 2,252 |
| `retail-03-nuclear-thematic-purity` | 10.8 | 12.0 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 68.8 (1.7) | 0 | 43 s | 1,091 |
| `retail-04-dividend-yield-trap` | 12.0 | 12.0 | 16.0 | 12.5 | 10.0 | 7.5 | 5.0 | 69.0 (0.0) | 3 (−6.0) | 47 s | 1,321 |
| `retail-05-intel-value-trap` | 3.7 | 9.9 | 0.0 | 7.5 | 10.0 | 5.0 | 10.0 | 46.1 (4.7) | 0 | 53 s | 1,377 |
| `retail-06-mstr-proxy-leverage` | 4.5 | 12.0 | 0.0 | 15.0 | 10.0 | 5.0 | 5.0 | 51.5 (2.8) | 0 | 48 s | 1,119 |
| `retail-09-narrative-factcheck-apple` | 5.2 | 8.0 | 5.3 | 7.5 | 13.3 | 7.5 | 5.0 | 51.9 (16.8) | 0 | 48 s | 1,345 |
| `retail-10-smci-accounting-red-flag` | 6.0 | 11.2 | 16.0 | 7.5 | 13.3 | 0.0 | 8.3 | 62.4 (6.5) | 0 | 32 s | 892 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.6 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 69.6 (0.3) | 0 | 75 s | 2,313 |
| `retail-12-concentration-profile-fit` | 12.0 | 12.0 | 8.0 | 7.5 | 10.0 | 5.0 | 10.0 | 64.5 (3.5) | 0 | 38 s | 957 |
| `retail-13-semis-figure-survival` | 12.0 | 12.0 | 16.0 | 12.5 | 10.0 | 7.5 | 10.0 | 80.0 (3.5) | 0 | 56 s | 1,847 |
| `retail-14-apple-pre-open-timing` | 12.0 | 12.0 | 16.0 | 7.5 | 10.0 | 7.5 | 10.0 | 75.0 (0.0) | 0 | 63 s | 1,687 |

## GPT-6.1 Terra avg@3

[`2026-11-21-openai-codex-gpt-6-1-terra-openai-codex-gpt-6-2-sol.json`](2026-11-21-openai-codex-gpt-6-1-terra-openai-codex-gpt-6-2-sol.json)

- **Agent:** `openai-codex/gpt-6.1-terra`, thinking medium, through a ChatGPT sign-in
- **Judge:** `openai-codex/gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `52ca646`
- **Scores:** total 60.4 · integrity 29.6 · judged 31.0 · completed 100.0% · mean per-task σ 1.36
- **Critical caps:** 2 of 36 answers missed or contradicted a critical item, 1 lowered by 8.5 points
  (missed `roc-not-inferred` 2)
- **Diagnostics:** tool argument errors 0 · fallback reports 0 · unverified report figures 8 ·
  repaired 0
- **Cost:** $0.55 per run · per million tokens: input $1.00, cached input $0.05, output $5.00 ·
  OpenAI API list price, 2026-11-21

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 5.6 | 11.8 | 0.0 | 7.5 | 10.0 | 7.5 | 5.0 | 47.4 (0.3) | 0 | 31 s | 1,210 |
| `retail-02-nike-moat-erosion` | 12.0 | 12.0 | 0.0 | 7.5 | 10.0 | 7.5 | 5.0 | 54.0 (0.0) | 0 | 43 s | 1,653 |
| `retail-03-nuclear-thematic-purity` | 9.6 | 12.0 | 13.3 | 10.0 | 10.0 | 7.5 | 1.7 | 64.1 (1.1) | 0 | 27 s | 1,227 |
| `retail-04-dividend-yield-trap` | 4.9 | 12.0 | 16.0 | 15.0 | 10.0 | 7.5 | 5.0 | 67.6 (1.5) | 1 (−2.8) | 32 s | 1,198 |
| `retail-05-intel-value-trap` | 6.1 | 10.9 | 0.0 | 7.5 | 10.0 | 7.5 | 5.0 | 47.0 (1.1) | 0 | 36 s | 1,460 |
| `retail-06-mstr-proxy-leverage` | 8.0 | 12.0 | 16.0 | 12.5 | 10.0 | 7.5 | 5.0 | 71.0 (3.5) | 0 | 26 s | 1,155 |
| `retail-09-narrative-factcheck-apple` | 2.1 | 12.0 | 0.0 | 7.5 | 10.0 | 5.0 | 5.0 | 41.6 (0.5) | 0 | 30 s | 1,266 |
| `retail-10-smci-accounting-red-flag` | 4.7 | 11.4 | 10.7 | 7.5 | 10.0 | 0.0 | 10.0 | 54.2 (4.5) | 0 | 41 s | 1,856 |
| `retail-11-nike-earnings-review-report` | 12.0 | 12.0 | 16.0 | 7.5 | 3.3 | 7.5 | 8.3 | 66.7 (2.4) | 0 | 33 s | 1,346 |
| `retail-12-concentration-profile-fit` | 12.0 | 12.0 | 8.0 | 12.5 | 10.0 | 0.0 | 6.7 | 61.2 (1.2) | 0 | 27 s | 1,021 |
| `retail-13-semis-figure-survival` | 12.0 | 11.9 | 16.0 | 7.5 | 10.0 | 7.5 | 10.0 | 74.9 (0.1) | 0 | 31 s | 1,367 |
| `retail-14-apple-pre-open-timing` | 12.0 | 12.0 | 16.0 | 7.5 | 10.0 | 7.5 | 10.0 | 75.0 (0.0) | 0 | 26 s | 1,016 |
