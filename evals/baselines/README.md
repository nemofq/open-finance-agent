# Baselines

Each JSON file here is one committed run, promoted with `--baseline`, and one row of the
[README's table](../../README.md#a-benchmark-that-favours-quality-over-quantity). This page breaks
each row down by task; how a run is made and promoted is in
[evals/README.md › Comparing runs](../README.md#comparing-runs). Add a section here when a baseline
is added, in the same order as the README's table.

All rows are benchmark v2 with judge prompt v10: judged by GPT-6.2 Sol at medium thinking with three
grades per answer, policy enforced, offline dataset, twelve tasks × 3 repeats. Every row was run
with no model-specific handling. The GPT rows ran on pi 1.6.1, which changed how GPT models are
called on a ChatGPT sign-in; the others ran on pi 1.6.0. For them 1.6.1 differs only in a `$schema`
keyword now kept in one tool's schema sent to Claude, and in retrying an empty OpenRouter reply that
hides an upstream failure, so the rows are directly comparable. The commit in each section is the
run's.

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
  thinking in it (Tencent Hy4 Flash does) and some do not, so figures are not comparable across model makers.

Each section's **Cost** is the agent's average cost per run at the maker's standard list price, not
any time-limited promotional price, worked out as in [evals/README.md › Reproducing the README
table](../README.md#reproducing-the-readme-table).

**Known issues.** An audit of the three critical items that cap most often (2026-10-17) found the
judge applying them as written, with two flaws in the items themselves, left in place so every row
stays graded by one rubric:

- `roc-not-inferred` (dividend trap) also requires saying that the June distribution's tax character
  is unavailable, so an answer that makes no forbidden inference but leaves that out is capped at 69.
- `time-and-motive` (Apple fact-check) asks the answer to treat Berkshire's large Q2 sale as real,
  but the offline record ends at the March 2024 13F, so the item is almost never fully met.

Grades of these two items also vary from one grading to the next: the same answer, graded again, can
move between partial, missed and contradicted on them.

## Gemini 4 Neon avg@3

[`2026-11-23-custom-gemini-4-neon-openai-codex-gpt-6-2-sol.json`](2026-11-23-custom-gemini-4-neon-openai-codex-gpt-6-2-sol.json)

- **Agent:** `gemini-4-neon`, thinking medium
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `092cf23`
- **Scores:** total 75.1 · integrity 35.6 · judged 39.5 · completed 100.0% · mean per-task σ 4.28
- **Critical caps:** 2 of 36 answers missed or contradicted a critical item, none lowered (missed
  `roc-not-inferred` 2)
- **Diagnostics:** tool argument errors 0 · fallback reports 0 · unverified report figures 252 ·
  repaired 7
- **Cost:** $11.37 per run · per million tokens: input $3.00, cached input $0.15, output $15.00 ·
  Gemini API paid tier, Google's list price, 2026-11-23

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 12.0 | 11.3 | 0.0 | 15.0 | 13.3 | 7.5 | 8.3 | 67.4 (6.5) | 0 | 155 s | 12,178 |
| `retail-02-nike-moat-erosion` | 12.0 | 11.3 | 10.7 | 15.0 | 20.0 | 7.5 | 5.0 | 81.5 (7.3) | 0 | 323 s | 20,601 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 11.8 | 13.3 | 15.0 | 10.0 | 12.5 | 6.7 | 81.3 (3.3) | 0 | 179 s | 13,641 |
| `retail-04-dividend-yield-trap` | 12.0 | 10.8 | 5.3 | 12.5 | 10.0 | 7.5 | 5.0 | 63.2 (4.1) | 0 | 231 s | 14,850 |
| `retail-05-intel-value-trap` | 12.0 | 11.7 | 16.0 | 15.0 | 10.0 | 7.5 | 10.0 | 82.2 (0.1) | 0 | 212 s | 13,788 |
| `retail-06-mstr-proxy-leverage` | 12.0 | 11.4 | 16.0 | 15.0 | 10.0 | 7.5 | 6.7 | 78.6 (2.3) | 0 | 217 s | 16,991 |
| `retail-09-narrative-factcheck-apple` | 6.4 | 11.5 | 10.7 | 7.5 | 13.3 | 7.5 | 10.0 | 66.9 (10.6) | 0 | 185 s | 10,788 |
| `retail-10-smci-accounting-red-flag` | 12.0 | 11.8 | 16.0 | 15.0 | 13.3 | 5.0 | 8.3 | 81.5 (6.3) | 0 | 143 s | 8,760 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.4 | 16.0 | 10.0 | 0.0 | 7.5 | 5.0 | 61.9 (3.5) | 0 | 187 s | 13,013 |
| `retail-12-concentration-profile-fit` | 12.0 | 11.3 | 16.0 | 15.0 | 13.3 | 7.5 | 10.0 | 85.2 (4.6) | 0 | 144 s | 8,364 |
| `retail-13-semis-figure-survival` | 12.0 | 11.6 | 16.0 | 7.5 | 20.0 | 7.5 | 10.0 | 84.6 (0.1) | 0 | 232 s | 19,120 |
| `retail-14-apple-pre-open-timing` | 12.0 | 11.2 | 16.0 | 7.5 | 10.0 | 7.5 | 3.3 | 67.5 (2.7) | 0 | 191 s | 12,137 |

## Claude Fable 5.2 avg@3

[`2026-11-22-anthropic-claude-fable-5-2-openai-codex-gpt-6-2-sol.json`](2026-11-22-anthropic-claude-fable-5-2-openai-codex-gpt-6-2-sol.json)

- **Agent:** `claude-fable-5-2`, thinking medium
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `4efd734`
- **Scores:** total 71.4 · integrity 33.3 · judged 39.3 · completed 100.0% · mean per-task σ 3.48
- **Critical caps:** 4 of 36 answers missed or contradicted a critical item, 3 lowered by 40.2
  points (contradicted `roc-not-inferred` 1, `time-and-motive` 1; missed `roc-not-inferred` 2)
- **Diagnostics:** tool argument errors 0 · fallback reports 0 · unverified report figures 49 ·
  repaired 10
- **Cost:** $22.37 per run · per million tokens: input $8.00, cache write $10.00, cache read $0.20, output $40.00 ·
  Anthropic API list price, 2026-11-22

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 12.0 | 12.0 | 5.3 | 15.0 | 10.0 | 7.5 | 10.0 | 71.8 (7.5) | 0 | 84 s | 9,009 |
| `retail-02-nike-moat-erosion` | 12.0 | 11.4 | 16.0 | 15.0 | 10.0 | 7.5 | 5.0 | 76.9 (0.4) | 0 | 124 s | 12,914 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 12.0 | 16.0 | 12.5 | 10.0 | 10.0 | 5.0 | 77.5 (6.1) | 0 | 79 s | 8,192 |
| `retail-04-dividend-yield-trap` | 12.0 | 11.5 | 10.7 | 15.0 | 10.0 | 7.5 | 5.0 | 59.7 (8.2) | 2 (−11.9) | 114 s | 11,673 |
| `retail-05-intel-value-trap` | 12.0 | 11.7 | 0.0 | 7.5 | 10.0 | 7.5 | 10.0 | 58.7 (0.1) | 0 | 98 s | 9,684 |
| `retail-06-mstr-proxy-leverage` | 12.0 | 11.8 | 0.0 | 15.0 | 10.0 | 7.5 | 8.3 | 64.6 (2.2) | 0 | 129 s | 13,136 |
| `retail-09-narrative-factcheck-apple` | 6.4 | 11.8 | 0.0 | 7.5 | 13.3 | 7.5 | 8.3 | 53.4 (3.9) | 1 (−1.5) | 83 s | 8,834 |
| `retail-10-smci-accounting-red-flag` | 12.0 | 11.3 | 16.0 | 12.5 | 16.7 | 12.5 | 6.7 | 87.6 (5.1) | 0 | 68 s | 6,806 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.5 | 16.0 | 12.5 | 10.0 | 7.5 | 5.0 | 74.5 (3.4) | 0 | 106 s | 11,324 |
| `retail-12-concentration-profile-fit` | 12.0 | 11.9 | 8.0 | 15.0 | 13.3 | 7.5 | 10.0 | 77.8 (4.6) | 0 | 69 s | 7,484 |
| `retail-13-semis-figure-survival` | 12.0 | 12.0 | 16.0 | 7.5 | 20.0 | 7.5 | 10.0 | 85.0 (0.0) | 0 | 126 s | 14,266 |
| `retail-14-apple-pre-open-timing` | 12.0 | 11.8 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 69.8 (0.3) | 0 | 83 s | 8,150 |

## DeepSeek V4.1 Flash 1017 avg@3, high

[`2026-11-23-deepseek-deepseek-flash-openai-codex-gpt-6-2-sol.json`](2026-11-23-deepseek-deepseek-flash-openai-codex-gpt-6-2-sol.json)

- **Agent:** `deepseek-flash` (DeepSeek-V4.1-Flash-1017), thinking high; the model takes low, high or
  max, not medium
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `2cd3fff`
- **Scores:** total 71.1 · integrity 34.2 · judged 38.1 · completed 100.0% · mean per-task σ 3.68
- **Critical caps:** 4 of 36 answers missed or contradicted a critical item, 4 lowered by 43.4
  points (contradicted `roc-not-inferred` 3; missed `life-savings-guardrail` 1)
- **Diagnostics:** tool argument errors 12 · fallback reports 0 · unverified report figures 310 ·
  repaired 19
- **Cost:** $1.21 per run · per million tokens: input $0.30, cached input $0.006, output $1.20 ·
  DeepSeek API peak pricing, unchanged since 2026-10-17 per DeepSeek's change log; off-peak hours are half

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 12.0 | 11.5 | 0.0 | 15.0 | 13.3 | 7.5 | 5.0 | 64.4 (4.8) | 0 | 114 s | 21,121 |
| `retail-02-nike-moat-erosion` | 10.9 | 11.5 | 16.0 | 15.0 | 16.7 | 7.5 | 8.3 | 86.0 (2.7) | 0 | 185 s | 34,768 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 11.1 | 16.0 | 15.0 | 10.0 | 7.5 | 5.0 | 76.6 (0.2) | 0 | 142 s | 24,215 |
| `retail-04-dividend-yield-trap` | 12.0 | 10.9 | 5.3 | 15.0 | 10.0 | 5.0 | 5.0 | 49.0 (0.0) | 3 (−14.2) | 159 s | 27,650 |
| `retail-05-intel-value-trap` | 12.0 | 11.3 | 5.3 | 12.5 | 10.0 | 7.5 | 8.3 | 66.7 (1.6) | 1 (−0.3) | 164 s | 27,523 |
| `retail-06-mstr-proxy-leverage` | 10.9 | 10.7 | 10.7 | 12.5 | 10.0 | 7.5 | 6.7 | 68.9 (5.8) | 0 | 232 s | 37,955 |
| `retail-09-narrative-factcheck-apple` | 10.9 | 11.2 | 10.7 | 10.0 | 13.3 | 7.5 | 5.0 | 68.7 (13.6) | 0 | 153 s | 25,695 |
| `retail-10-smci-accounting-red-flag` | 12.0 | 10.1 | 16.0 | 15.0 | 13.3 | 15.0 | 6.7 | 88.1 (6.6) | 0 | 142 s | 23,357 |
| `retail-11-nike-earnings-review-report` | 12.0 | 10.6 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 68.6 (1.0) | 0 | 151 s | 25,420 |
| `retail-12-concentration-profile-fit` | 12.0 | 11.6 | 8.0 | 15.0 | 10.0 | 7.5 | 3.3 | 67.4 (2.1) | 0 | 83 s | 13,676 |
| `retail-13-semis-figure-survival` | 12.0 | 11.6 | 16.0 | 7.5 | 16.7 | 7.5 | 6.7 | 78.0 (2.5) | 0 | 205 s | 41,211 |
| `retail-14-apple-pre-open-timing` | 12.0 | 11.8 | 16.0 | 7.5 | 10.0 | 5.0 | 8.3 | 70.6 (3.2) | 0 | 141 s | 24,976 |

## Gemini 4 Hydrogen avg@3

[`2026-11-23-openrouter-google-gemini-4-hydrogen-openai-codex-gpt-6-2-sol.json`](2026-11-23-openrouter-google-gemini-4-hydrogen-openai-codex-gpt-6-2-sol.json)

- **Agent:** `gemini-4-hydrogen`, thinking medium
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `2a2affa`
- **Scores:** total 69.2 · integrity 32.0 · judged 37.6 · completed 100.0% · mean per-task σ 5.52
- **Critical caps:** 6 of 36 answers missed or contradicted a critical item, 2 lowered by 13.9
  points (contradicted `time-and-motive` 2, `pre-open-boundary` 1; missed `total-return` 3,
  `roc-not-inferred` 2)
- **Diagnostics:** tool argument errors 0 · fallback reports 0 · unverified report figures 208 ·
  repaired 6
- **Cost:** $6.74 per run · per million tokens: input $1.50, cached input $0.075, output $7.50 ·
  Gemini API paid tier, Google's standard list price, 2026-11-23

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 9.9 | 10.2 | 0.0 | 15.0 | 10.0 | 7.5 | 6.7 | 59.3 (1.5) | 0 | 58 s | 8,443 |
| `retail-02-nike-moat-erosion` | 10.9 | 11.4 | 0.0 | 15.0 | 16.7 | 7.5 | 5.0 | 66.5 (6.2) | 0 | 172 s | 27,636 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 11.4 | 13.3 | 15.0 | 10.0 | 7.5 | 5.0 | 74.2 (3.7) | 0 | 127 s | 19,437 |
| `retail-04-dividend-yield-trap` | 12.0 | 11.6 | 5.3 | 7.5 | 10.0 | 7.5 | 5.0 | 58.7 (7.3) | 1 (−0.2) | 96 s | 14,237 |
| `retail-05-intel-value-trap` | 12.0 | 11.7 | 5.3 | 15.0 | 10.0 | 7.5 | 8.3 | 69.9 (9.0) | 0 | 119 s | 18,045 |
| `retail-06-mstr-proxy-leverage` | 12.0 | 10.6 | 16.0 | 15.0 | 10.0 | 10.0 | 8.3 | 81.9 (4.9) | 0 | 117 s | 18,874 |
| `retail-09-narrative-factcheck-apple` | 8.3 | 11.8 | 0.0 | 7.5 | 6.7 | 7.5 | 6.7 | 48.4 (10.7) | 0 | 118 s | 19,019 |
| `retail-10-smci-accounting-red-flag` | 12.0 | 11.7 | 16.0 | 15.0 | 10.0 | 5.0 | 10.0 | 79.7 (7.2) | 0 | 80 s | 13,367 |
| `retail-11-nike-earnings-review-report` | 12.0 | 10.9 | 16.0 | 10.0 | 10.0 | 7.5 | 5.0 | 71.4 (3.5) | 0 | 120 s | 19,957 |
| `retail-12-concentration-profile-fit` | 12.0 | 11.0 | 8.0 | 15.0 | 13.3 | 7.5 | 10.0 | 76.8 (4.4) | 0 | 63 s | 8,921 |
| `retail-13-semis-figure-survival` | 12.0 | 11.5 | 16.0 | 7.5 | 20.0 | 7.5 | 10.0 | 84.5 (0.4) | 0 | 90 s | 16,195 |
| `retail-14-apple-pre-open-timing` | 12.0 | 11.8 | 16.0 | 7.5 | 10.0 | 5.0 | 1.7 | 59.5 (7.5) | 1 (−4.4) | 99 s | 17,558 |

## Claude Opus 5.5 avg@3

[`2026-11-22-anthropic-claude-opus-5-5-openai-codex-gpt-6-2-sol.json`](2026-11-22-anthropic-claude-opus-5-5-openai-codex-gpt-6-2-sol.json)

- **Agent:** `claude-opus-5-5`, thinking medium
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `eb049ce`
- **Scores:** total 68.4 · integrity 31.7 · judged 37.1 · completed 100.0% · mean per-task σ 4.74
- **Critical caps:** 3 of 36 answers missed or contradicted a critical item, 1 lowered by 11.4
  points (contradicted `roc-not-inferred` 1; missed `roc-not-inferred` 1, `time-and-motive` 1)
- **Diagnostics:** tool argument errors 0 · fallback reports 0 · unverified report figures 69 ·
  repaired 5
- **Cost:** $7.39 per run · per million tokens: input $4.00, cache write $5.00, cache read $0.20, output $20.00 ·
  Anthropic API list price, 2026-11-22

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 5.6 | 11.8 | 0.0 | 7.5 | 10.0 | 7.5 | 8.3 | 50.7 (2.6) | 0 | 57 s | 5,693 |
| `retail-02-nike-moat-erosion` | 8.5 | 11.6 | 5.3 | 10.0 | 13.3 | 7.5 | 5.0 | 61.3 (12.6) | 0 | 84 s | 8,529 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 12.0 | 16.0 | 15.0 | 10.0 | 12.5 | 5.0 | 82.5 (3.5) | 0 | 58 s | 5,986 |
| `retail-04-dividend-yield-trap` | 12.0 | 11.0 | 0.0 | 10.0 | 10.0 | 7.5 | 5.0 | 51.7 (1.9) | 1 (−3.8) | 77 s | 7,607 |
| `retail-05-intel-value-trap` | 8.0 | 11.8 | 0.0 | 10.0 | 10.0 | 7.5 | 10.0 | 57.3 (1.6) | 0 | 55 s | 5,459 |
| `retail-06-mstr-proxy-leverage` | 11.5 | 10.9 | 10.7 | 12.5 | 10.0 | 7.5 | 5.0 | 68.0 (5.6) | 0 | 97 s | 9,875 |
| `retail-09-narrative-factcheck-apple` | 4.3 | 11.7 | 10.7 | 7.5 | 10.0 | 5.0 | 8.3 | 57.5 (8.5) | 0 | 61 s | 6,208 |
| `retail-10-smci-accounting-red-flag` | 12.0 | 10.5 | 16.0 | 12.5 | 13.3 | 12.5 | 8.3 | 85.2 (8.3) | 0 | 64 s | 6,338 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.5 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 69.5 (0.1) | 0 | 75 s | 7,681 |
| `retail-12-concentration-profile-fit` | 12.0 | 11.4 | 13.3 | 15.0 | 13.3 | 7.5 | 10.0 | 82.6 (7.7) | 0 | 58 s | 5,776 |
| `retail-13-semis-figure-survival` | 12.0 | 11.9 | 16.0 | 7.5 | 20.0 | 7.5 | 8.3 | 83.3 (2.5) | 0 | 89 s | 9,793 |
| `retail-14-apple-pre-open-timing` | 12.0 | 11.8 | 16.0 | 7.5 | 10.0 | 7.5 | 6.7 | 71.4 (2.0) | 0 | 46 s | 4,706 |

## Tencent Hy4 Flash avg@3, on

[`2026-11-22-openrouter-tencent-hy4-flash-openai-codex-gpt-6-2-sol.json`](2026-11-22-openrouter-tencent-hy4-flash-openai-codex-gpt-6-2-sol.json)

- **Agent:** `hy4-flash`, thinking on; the model has no effort levels, only thinking on or off, and
  ran with thinking on, its default
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `9aace60`
- **Scores:** total 67.6 · integrity 34.8 · judged 34.4 · completed 100.0% · mean per-task σ 6.86
- **Critical caps:** 6 of 36 answers missed or contradicted a critical item, 5 lowered by 56.7
  points (contradicted `time-and-motive` 2, `commercial-stage` 1; missed `roc-not-inferred` 2,
  `life-savings-guardrail` 1)
- **Diagnostics:** tool argument errors 30 · fallback reports 0 · unverified report figures 135 ·
  repaired 12
- **Cost:** $0.28 per run · per million tokens: input $0.07, cached input $0.003, output $0.281 ·
  Tencent's standard price, 2026-11-22

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 9.9 | 11.7 | 5.3 | 12.5 | 10.0 | 7.5 | 5.0 | 61.9 (12.2) | 0 | 127 s | 16,298 |
| `retail-02-nike-moat-erosion` | 12.0 | 11.9 | 5.3 | 12.5 | 10.0 | 7.5 | 5.0 | 64.2 (9.8) | 0 | 231 s | 33,551 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 11.7 | 16.0 | 12.5 | 10.0 | 7.5 | 5.0 | 65.3 (12.0) | 1 (−9.4) | 147 s | 16,247 |
| `retail-04-dividend-yield-trap` | 12.0 | 11.3 | 16.0 | 12.5 | 10.0 | 7.5 | 5.0 | 71.5 (3.5) | 2 (−2.8) | 170 s | 22,215 |
| `retail-05-intel-value-trap` | 12.0 | 11.5 | 0.0 | 7.5 | 10.0 | 7.5 | 6.7 | 55.2 (2.7) | 0 | 181 s | 24,497 |
| `retail-06-mstr-proxy-leverage` | 11.5 | 11.0 | 10.7 | 15.0 | 10.0 | 5.0 | 6.7 | 69.8 (12.8) | 0 | 229 s | 25,822 |
| `retail-09-narrative-factcheck-apple` | 12.0 | 10.4 | 16.0 | 5.0 | 6.7 | 7.5 | 6.7 | 57.5 (12.1) | 2 (−6.7) | 181 s | 25,111 |
| `retail-10-smci-accounting-red-flag` | 10.7 | 11.3 | 16.0 | 12.5 | 10.0 | 0.0 | 8.3 | 68.8 (5.0) | 0 | 183 s | 23,376 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.0 | 16.0 | 12.5 | 10.0 | 7.5 | 5.0 | 74.0 (3.1) | 0 | 173 s | 24,479 |
| `retail-12-concentration-profile-fit` | 10.9 | 12.0 | 8.0 | 12.5 | 10.0 | 7.5 | 8.3 | 69.3 (1.8) | 0 | 79 s | 9,901 |
| `retail-13-semis-figure-survival` | 12.0 | 11.7 | 16.0 | 10.0 | 16.7 | 7.5 | 10.0 | 83.8 (7.4) | 0 | 147 s | 18,444 |
| `retail-14-apple-pre-open-timing` | 12.0 | 12.0 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 70.0 (0.1) | 0 | 118 s | 16,817 |

## GPT-6.1 Terra avg@3

[`2026-11-26-openai-codex-gpt-6-1-terra-openai-codex-gpt-6-2-sol.json`](2026-11-26-openai-codex-gpt-6-1-terra-openai-codex-gpt-6-2-sol.json)

- **Agent:** `gpt-6.1-terra`, thinking medium
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `ade0c1a`
- **Scores:** total 67.2 · integrity 32.6 · judged 35.3 · completed 100.0% · mean per-task σ 3.27
- **Critical caps:** 3 of 36 answers missed or contradicted a critical item, 3 lowered by 24.0
  points (missed `roc-not-inferred` 3)
- **Diagnostics:** tool argument errors 0 · fallback reports 0 · unverified report figures 17 ·
  repaired 0
- **Cost:** $0.98 per run · per million tokens: input $1.00, cached input $0.05, output $5.00 ·
  OpenAI API list price, 2026-11-26

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 9.9 | 11.8 | 0.0 | 12.5 | 10.0 | 7.5 | 10.0 | 61.7 (3.4) | 0 | 51 s | 2,123 |
| `retail-02-nike-moat-erosion` | 10.7 | 12.0 | 0.0 | 10.0 | 10.0 | 7.5 | 6.7 | 56.8 (2.3) | 0 | 65 s | 2,468 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 10.4 | 16.0 | 10.0 | 10.0 | 7.5 | 5.0 | 70.9 (4.8) | 0 | 44 s | 1,991 |
| `retail-04-dividend-yield-trap` | 12.0 | 11.5 | 16.0 | 15.0 | 10.0 | 7.5 | 5.0 | 69.0 (0.0) | 3 (−8.0) | 36 s | 1,651 |
| `retail-05-intel-value-trap` | 10.4 | 8.0 | 10.7 | 7.5 | 10.0 | 7.5 | 10.0 | 64.0 (9.8) | 0 | 65 s | 2,496 |
| `retail-06-mstr-proxy-leverage` | 9.1 | 11.7 | 16.0 | 15.0 | 10.0 | 7.5 | 5.0 | 74.3 (0.4) | 0 | 48 s | 2,002 |
| `retail-09-narrative-factcheck-apple` | 4.3 | 12.0 | 5.3 | 7.5 | 10.0 | 7.5 | 5.0 | 51.6 (4.5) | 0 | 39 s | 1,718 |
| `retail-10-smci-accounting-red-flag` | 5.3 | 11.2 | 13.3 | 10.0 | 10.0 | 0.0 | 6.7 | 56.6 (3.5) | 0 | 46 s | 1,944 |
| `retail-11-nike-earnings-review-report` | 12.0 | 12.0 | 16.0 | 7.5 | 10.0 | 7.5 | 8.3 | 73.3 (2.4) | 0 | 58 s | 2,515 |
| `retail-12-concentration-profile-fit` | 12.0 | 12.0 | 8.0 | 15.0 | 10.0 | 5.0 | 10.0 | 72.0 (3.5) | 0 | 33 s | 1,211 |
| `retail-13-semis-figure-survival` | 12.0 | 12.0 | 16.0 | 7.5 | 16.7 | 7.5 | 10.0 | 81.7 (4.7) | 0 | 54 s | 2,358 |
| `retail-14-apple-pre-open-timing` | 12.0 | 12.0 | 16.0 | 7.5 | 10.0 | 7.5 | 10.0 | 75.0 (0.0) | 0 | 51 s | 2,165 |

## GPT-6.2 Astra avg@3

[`2026-11-26-openai-codex-gpt-6-2-astra-openai-codex-gpt-6-2-sol.json`](2026-11-26-openai-codex-gpt-6-2-astra-openai-codex-gpt-6-2-sol.json)

- **Agent:** `gpt-6.2-astra`, thinking medium
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `ade0c1a`
- **Scores:** total 63.7 · integrity 29.6 · judged 34.9 · completed 100.0% · mean per-task σ 2.60
- **Critical caps:** 3 of 36 answers missed or contradicted a critical item, 3 lowered by 25.5
  points (missed `roc-not-inferred` 3)
- **Diagnostics:** tool argument errors 0 · fallback reports 0 · unverified report figures 9 ·
  repaired 0
- **Cost:** $6.86 per run · per million tokens: input $8.00, cached input $0.40, output $40.00 ·
  OpenAI API list price, 2026-11-26

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 5.6 | 12.0 | 0.0 | 15.0 | 10.0 | 7.5 | 6.7 | 56.8 (2.4) | 0 | 58 s | 2,139 |
| `retail-02-nike-moat-erosion` | 11.3 | 11.7 | 0.0 | 15.0 | 10.0 | 7.5 | 8.3 | 63.9 (3.7) | 0 | 85 s | 3,119 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 12.0 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 70.0 (0.0) | 0 | 42 s | 1,394 |
| `retail-04-dividend-yield-trap` | 12.0 | 12.0 | 16.0 | 15.0 | 10.0 | 7.5 | 5.0 | 69.0 (0.0) | 3 (−8.5) | 39 s | 1,368 |
| `retail-05-intel-value-trap` | 8.9 | 10.0 | 0.0 | 7.5 | 10.0 | 7.5 | 10.0 | 53.9 (3.5) | 0 | 51 s | 1,694 |
| `retail-06-mstr-proxy-leverage` | 9.9 | 12.0 | 0.0 | 15.0 | 10.0 | 7.5 | 6.7 | 61.0 (2.1) | 0 | 52 s | 1,747 |
| `retail-09-narrative-factcheck-apple` | 5.2 | 4.0 | 0.0 | 7.5 | 10.0 | 7.5 | 5.0 | 39.2 (6.6) | 0 | 50 s | 1,592 |
| `retail-10-smci-accounting-red-flag` | 6.0 | 10.6 | 16.0 | 7.5 | 13.3 | 0.0 | 8.3 | 61.8 (2.3) | 0 | 33 s | 1,104 |
| `retail-11-nike-earnings-review-report` | 12.0 | 12.0 | 16.0 | 7.5 | 10.0 | 7.5 | 8.3 | 73.3 (2.4) | 0 | 81 s | 2,740 |
| `retail-12-concentration-profile-fit` | 12.0 | 12.0 | 8.0 | 7.5 | 10.0 | 7.5 | 8.3 | 65.3 (2.4) | 0 | 38 s | 1,285 |
| `retail-13-semis-figure-survival` | 12.0 | 12.0 | 16.0 | 10.0 | 10.0 | 7.5 | 10.0 | 77.5 (3.5) | 0 | 67 s | 2,723 |
| `retail-14-apple-pre-open-timing` | 12.0 | 12.0 | 16.0 | 7.5 | 10.0 | 7.5 | 8.3 | 73.3 (2.4) | 0 | 63 s | 1,957 |

## Claude Sonnet 5.5 avg@3

[`2026-11-22-anthropic-claude-sonnet-5-5-openai-codex-gpt-6-2-sol.json`](2026-11-22-anthropic-claude-sonnet-5-5-openai-codex-gpt-6-2-sol.json)

- **Agent:** `claude-sonnet-5-5`, thinking medium
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `364c949`
- **Scores:** total 60.0 · integrity 25.7 · judged 34.6 · completed 100.0% · mean per-task σ 4.09
- **Critical caps:** 4 of 36 answers missed or contradicted a critical item, 1 lowered by 11.4
  points (contradicted `roc-not-inferred` 2, `commercial-stage` 1; missed `roc-not-inferred` 1)
- **Diagnostics:** tool argument errors 8 · fallback reports 0 · unverified report figures 79 ·
  repaired 5
- **Cost:** $2.39 per run · per million tokens: input $2.00, cache write $2.50, cache read $0.10, output $10.00 ·
  Anthropic API list price, 2026-11-22

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 9.9 | 12.0 | 0.0 | 7.5 | 10.0 | 7.5 | 8.3 | 55.2 (2.8) | 0 | 37 s | 4,511 |
| `retail-02-nike-moat-erosion` | 7.5 | 11.5 | 0.0 | 10.0 | 10.0 | 7.5 | 5.0 | 51.4 (4.6) | 0 | 47 s | 5,965 |
| `retail-03-nuclear-thematic-purity` | 2.4 | 11.9 | 2.7 | 10.0 | 10.0 | 7.5 | 5.0 | 49.4 (10.8) | 0 | 33 s | 4,524 |
| `retail-04-dividend-yield-trap` | 10.1 | 11.1 | 0.0 | 12.5 | 10.0 | 7.5 | 5.0 | 52.5 (5.6) | 1 (−3.8) | 42 s | 5,316 |
| `retail-05-intel-value-trap` | 4.3 | 12.0 | 0.0 | 12.5 | 10.0 | 7.5 | 10.0 | 56.3 (2.0) | 0 | 38 s | 4,928 |
| `retail-06-mstr-proxy-leverage` | 8.8 | 11.1 | 10.7 | 12.5 | 10.0 | 7.5 | 5.0 | 65.5 (6.1) | 0 | 37 s | 5,112 |
| `retail-09-narrative-factcheck-apple` | 2.1 | 10.9 | 0.0 | 7.5 | 10.0 | 0.0 | 6.7 | 37.2 (3.1) | 0 | 28 s | 3,574 |
| `retail-10-smci-accounting-red-flag` | 8.0 | 12.0 | 8.0 | 15.0 | 10.0 | 5.0 | 10.0 | 68.0 (7.1) | 0 | 29 s | 3,274 |
| `retail-11-nike-earnings-review-report` | 12.0 | 10.9 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 68.9 (0.2) | 0 | 45 s | 6,321 |
| `retail-12-concentration-profile-fit` | 10.1 | 9.9 | 2.7 | 15.0 | 13.3 | 7.5 | 1.7 | 60.2 (6.6) | 0 | 32 s | 4,037 |
| `retail-13-semis-figure-survival` | 12.0 | 11.9 | 16.0 | 7.5 | 20.0 | 7.5 | 10.0 | 84.9 (0.0) | 0 | 39 s | 5,367 |
| `retail-14-apple-pre-open-timing` | 12.0 | 11.9 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 69.9 (0.1) | 0 | 48 s | 5,932 |

## Inkling 2 Small avg@3

[`2026-11-23-openrouter-thinkingmachines-inkling-2-small-openai-codex-gpt-6-2-sol.json`](2026-11-23-openrouter-thinkingmachines-inkling-2-small-openai-codex-gpt-6-2-sol.json)

- **Agent:** `inkling-2-small`, thinking medium
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `bef6c83`
- **Scores:** total 59.9 · integrity 25.4 · judged 36.3 · completed 97.2% · mean per-task σ 9.59
- **Critical caps:** 5 of 36 answers missed or contradicted a critical item, none lowered
  (contradicted `roc-not-inferred` 2, `commercial-stage` 1, `time-and-motive` 1; missed
  `roc-not-inferred` 1, `total-return` 1)
- **Diagnostics:** tool argument errors 26 · fallback reports 0 · unverified report figures 156 ·
  repaired 11
- **Cost:** $0.45 per run · per million tokens: input $0.30, cached input $0.03, output $1.00 ·
  list price, 2026-11-23

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 8.0 | 11.9 | 0.0 | 12.5 | 10.0 | 7.5 | 8.3 | 58.2 (5.9) | 0 | 29 s | 5,244 |
| `retail-02-nike-moat-erosion` | 12.0 | 10.7 | 0.0 | 10.0 | 13.3 | 7.5 | 6.7 | 60.2 (11.3) | 0 | 24 s | 6,523 |
| `retail-03-nuclear-thematic-purity` | 2.4 | 11.7 | 2.7 | 12.5 | 10.0 | 7.5 | 5.0 | 51.8 (9.6) | 0 | 20 s | 4,780 |
| `retail-04-dividend-yield-trap` | 4.0 | 10.9 | 0.0 | 7.5 | 10.0 | 5.0 | 6.7 | 44.1 (6.6) | 0 | 22 s | 4,947 |
| `retail-05-intel-value-trap` | 0.0 | 11.6 | 0.0 | 15.0 | 10.0 | 2.5 | 6.7 | 45.7 (3.6) | 0 | 24 s | 4,111 |
| `retail-06-mstr-proxy-leverage` | 7.5 | 10.2 | 10.7 | 15.0 | 10.0 | 7.5 | 5.0 | 65.9 (9.5) | 0 | 34 s | 6,458 |
| `retail-09-narrative-factcheck-apple` | 4.3 | 11.9 | 0.0 | 10.0 | 6.7 | 7.5 | 10.0 | 50.3 (7.4) | 0 | 36 s | 4,945 |
| `retail-10-smci-accounting-red-flag` | 9.3 | 10.7 | 10.7 | 15.0 | 13.3 | 5.0 | 8.3 | 72.4 (11.1) | 0 | 47 s | 6,899 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.4 | 16.0 | 11.3 | 10.0 | 7.5 | 5.0 | 48.8 (34.7) | 0 | 43 s | 6,857 |
| `retail-12-concentration-profile-fit` | 10.9 | 10.6 | 8.0 | 15.0 | 16.7 | 7.5 | 6.7 | 75.3 (7.6) | 0 | 14 s | 5,089 |
| `retail-13-semis-figure-survival` | 12.0 | 11.3 | 16.0 | 7.5 | 16.7 | 7.5 | 8.3 | 79.3 (4.2) | 0 | 25 s | 6,142 |
| `retail-14-apple-pre-open-timing` | 12.0 | 11.7 | 16.0 | 7.5 | 10.0 | 5.0 | 5.0 | 67.2 (3.7) | 0 | 90 s | 6,774 |

## GPT-6 Luna avg@3

[`2026-11-26-openai-codex-gpt-6-luna-openai-codex-gpt-6-2-sol.json`](2026-11-26-openai-codex-gpt-6-luna-openai-codex-gpt-6-2-sol.json)

- **Agent:** `gpt-6-luna`, thinking medium
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `ade0c1a`
- **Scores:** total 59.3 · integrity 26.6 · judged 32.8 · completed 100.0% · mean per-task σ 4.31
- **Critical caps:** 3 of 36 answers missed or contradicted a critical item, none lowered (missed
  `roc-not-inferred` 3, `total-return` 2)
- **Diagnostics:** tool argument errors 1 · fallback reports 0 · unverified report figures 15 ·
  repaired 1
- **Cost:** $0.07 per run · per million tokens: input $0.10, cached input $0.01, output $0.50 ·
  OpenAI API list price, 2026-11-26

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 5.6 | 11.8 | 0.0 | 10.0 | 10.0 | 7.5 | 5.0 | 49.9 (3.7) | 0 | 48 s | 1,820 |
| `retail-02-nike-moat-erosion` | 4.8 | 11.5 | 0.0 | 7.5 | 10.0 | 7.5 | 5.0 | 46.3 (0.4) | 0 | 51 s | 2,076 |
| `retail-03-nuclear-thematic-purity` | 6.4 | 12.0 | 5.3 | 10.0 | 6.7 | 7.5 | 5.0 | 52.9 (9.3) | 0 | 34 s | 1,423 |
| `retail-04-dividend-yield-trap` | 12.0 | 10.7 | 0.0 | 7.5 | 10.0 | 7.5 | 5.0 | 52.7 (1.3) | 0 | 84 s | 3,670 |
| `retail-05-intel-value-trap` | 2.1 | 11.6 | 0.0 | 10.0 | 10.0 | 5.0 | 8.3 | 47.1 (3.6) | 0 | 35 s | 1,406 |
| `retail-06-mstr-proxy-leverage` | 6.9 | 11.6 | 16.0 | 15.0 | 10.0 | 7.5 | 5.0 | 72.0 (0.2) | 0 | 49 s | 2,046 |
| `retail-09-narrative-factcheck-apple` | 3.1 | 12.0 | 0.0 | 7.5 | 13.3 | 5.0 | 8.3 | 49.2 (13.0) | 0 | 42 s | 1,643 |
| `retail-10-smci-accounting-red-flag` | 4.0 | 12.0 | 8.0 | 12.5 | 10.0 | 0.0 | 5.0 | 51.5 (3.5) | 0 | 36 s | 1,595 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.5 | 16.0 | 7.5 | 10.0 | 7.5 | 8.3 | 72.9 (2.3) | 0 | 53 s | 2,279 |
| `retail-12-concentration-profile-fit` | 12.0 | 11.7 | 8.0 | 12.5 | 16.7 | 7.5 | 8.3 | 76.7 (6.3) | 0 | 29 s | 1,349 |
| `retail-13-semis-figure-survival` | 12.0 | 11.9 | 16.0 | 7.5 | 10.0 | 10.0 | 10.0 | 77.4 (3.5) | 0 | 27 s | 1,232 |
| `retail-14-apple-pre-open-timing` | 12.0 | 12.0 | 16.0 | 7.5 | 3.3 | 7.5 | 5.0 | 63.3 (4.7) | 0 | 23 s | 1,014 |

## Claude Haiku 5.5 avg@3

[`2026-11-22-anthropic-claude-haiku-5-5-openai-codex-gpt-6-2-sol.json`](2026-11-22-anthropic-claude-haiku-5-5-openai-codex-gpt-6-2-sol.json)

- **Agent:** `claude-haiku-5-5`, thinking medium
- **Judge:** `gpt-6.2-sol`, thinking medium, three grades per answer
- **Commit:** `364c949`
- **Scores:** total 57.9 · integrity 26.8 · judged 31.3 · completed 100.0% · mean per-task σ 4.97
- **Critical caps:** 4 of 36 answers missed or contradicted a critical item, 1 lowered by 3.5 points
  (contradicted `pre-open-boundary` 1; missed `roc-not-inferred` 2, `total-return` 1,
  `life-savings-guardrail` 1)
- **Diagnostics:** tool argument errors 22 · fallback reports 1 · unverified report figures 102 ·
  repaired 5
- **Cost:** $0.19 per run · per million tokens: input $0.10, cache write $0.125, cache read $0.01, output $0.50 ·
  Anthropic API list price, 2026-11-22; no request exceeded the 100,000-token prompt tier

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 12.0 | 11.4 | 0.0 | 10.0 | 10.0 | 7.5 | 5.0 | 55.9 (3.6) | 0 | 51 s | 10,026 |
| `retail-02-nike-moat-erosion` | 8.3 | 11.4 | 0.0 | 7.5 | 10.0 | 7.5 | 5.0 | 49.6 (0.6) | 0 | 67 s | 14,091 |
| `retail-03-nuclear-thematic-purity` | 8.8 | 11.3 | 8.0 | 10.0 | 6.7 | 7.5 | 1.7 | 53.9 (4.9) | 0 | 36 s | 7,572 |
| `retail-04-dividend-yield-trap` | 6.4 | 9.7 | 0.0 | 7.5 | 10.0 | 7.5 | 5.0 | 46.1 (0.9) | 0 | 47 s | 9,405 |
| `retail-05-intel-value-trap` | 2.1 | 11.6 | 0.0 | 15.0 | 10.0 | 2.5 | 6.7 | 47.9 (5.5) | 0 | 37 s | 7,791 |
| `retail-06-mstr-proxy-leverage` | 7.5 | 11.2 | 10.7 | 7.5 | 6.7 | 5.0 | 5.0 | 53.5 (17.1) | 0 | 49 s | 9,145 |
| `retail-09-narrative-factcheck-apple` | 8.9 | 11.3 | 5.3 | 7.5 | 10.0 | 7.5 | 5.0 | 55.5 (2.9) | 0 | 54 s | 11,095 |
| `retail-10-smci-accounting-red-flag` | 8.0 | 9.6 | 8.0 | 15.0 | 10.0 | 7.5 | 8.3 | 66.4 (8.9) | 0 | 44 s | 8,652 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.4 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 69.4 (0.4) | 0 | 75 s | 15,555 |
| `retail-12-concentration-profile-fit` | 6.9 | 11.4 | 2.7 | 12.5 | 10.0 | 7.5 | 10.0 | 61.0 (2.0) | 0 | 31 s | 5,269 |
| `retail-13-semis-figure-survival` | 12.0 | 11.5 | 16.0 | 7.5 | 10.0 | 7.5 | 8.3 | 72.8 (2.9) | 0 | 75 s | 17,727 |
| `retail-14-apple-pre-open-timing` | 12.0 | 12.0 | 16.0 | 5.0 | 6.7 | 7.5 | 5.0 | 63.0 (9.9) | 1 (−1.2) | 12 s | 2,072 |
