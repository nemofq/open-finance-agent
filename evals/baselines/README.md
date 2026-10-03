# Baselines

Each JSON file here is one committed run, promoted with `--baseline`, and one row of the
[README's table](../../README.md#a-benchmark-that-favours-quality-over-quantity). This page breaks
each row down by task; how a run is made and promoted is in
[evals/README.md › Comparing runs](../README.md#comparing-runs). Add a section here when a baseline
is added, in the same order as the README's table.

All rows are benchmark v2: judge prompt v9 with three grades per answer, policy enforced, offline
dataset, twelve tasks × 3 repeats. They were rescored with `--rescore` from their saved runs when v2
landed, so each agent answer, run time and token count is the original run's; the commit below is
the run's. Benchmark v1 scores are not comparable and are kept only in git history.

Each per-task value is over the task's three runs, from the baseline's `results`:

- **Evidence** (/12), **Figures** (/12), **Contracts** (/16): the integrity checks,
  `deterministicCheck.evidenceScore`, `figureSupportScore` and `contractScore`, which add up to
  Integrity (/40).
- **Intent** (/15), **Financial** (/20), **Grounding** (/15), **Clarity** (/10): the judge's rubric
  points by dimension, `judgeResult.dimensionScores`, which add up to Judged (/60).
- **Total** (/100): the task's mean `totalScore` with its population standard deviation (σ). A
  failed run counts as zero; the integrity and judge columns average the completed answers only.
- **Capped**: answers limited by a critical rubric item, at 49 when it was contradicted and at 69
  when it was missed.
- **Run time**: the task's turn, `metrics.latencyMs`, judging excluded.
- **Output tokens**: `metrics.tokens.output`, as the provider reports it. DeepSeek and Qwen count
  their thinking in it, so their figures are not comparable with the OpenAI models'.

Each section's **Cost** is the agent's average cost per run at the list prices it gives, worked
out as in [evals/README.md › Reproducing the README table](../README.md#reproducing-the-readme-table).

## GPT-6.1 Sol avg@3

[`2026-10-02-openai-codex-gpt-6-1-sol-openai-codex-gpt-6-astra.json`](2026-10-02-openai-codex-gpt-6-1-sol-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-6.1-sol`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium, three grades per answer
- **Commit:** `a8ec63f`
- **Scores:** total 74.1 · integrity 34.5 · judged 39.6 · completed 100.0% · mean per-task σ 3.62
- **Critical caps:** 0 of 36 answers
- **Diagnostics:** tool argument errors 0 · fallback reports 0 · unverified report figures 20 ·
  repaired 0
- **Cost:** $2.13 per run · per million tokens: input $2.00, cache read $0.10, cache write
  $2.50, output $10.00 · OpenAI API standard tier, 2026-10-01

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 5.6 | 11.9 | 10.7 | 15.0 | 10.0 | 7.5 | 10.0 | 70.7 (7.5) | 0 | 132 s | 3,176 |
| `retail-02-nike-moat-erosion` | 12.0 | 12.0 | 0.0 | 15.0 | 10.0 | 7.5 | 5.0 | 61.5 (0.0) | 0 | 161 s | 4,015 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 11.6 | 16.0 | 10.0 | 10.0 | 7.5 | 5.0 | 72.1 (3.0) | 0 | 108 s | 2,394 |
| `retail-04-dividend-yield-trap` | 12.0 | 12.0 | 16.0 | 15.0 | 10.0 | 7.5 | 6.7 | 79.2 (2.4) | 0 | 175 s | 2,777 |
| `retail-05-intel-value-trap` | 10.0 | 12.0 | 5.3 | 7.5 | 10.0 | 7.5 | 8.3 | 60.7 (10.4) | 0 | 115 s | 2,289 |
| `retail-06-mstr-proxy-leverage` | 10.1 | 11.8 | 16.0 | 12.5 | 10.0 | 7.5 | 5.0 | 72.9 (3.2) | 0 | 143 s | 3,028 |
| `retail-09-narrative-factcheck-apple` | 5.3 | 10.8 | 10.7 | 7.5 | 13.3 | 7.5 | 10.0 | 65.1 (4.0) | 0 | 107 s | 2,201 |
| `retail-10-smci-accounting-red-flag` | 6.0 | 11.2 | 16.0 | 12.5 | 20.0 | 5.0 | 10.0 | 80.7 (4.1) | 0 | 118 s | 2,523 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.5 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 69.5 (0.2) | 0 | 164 s | 3,562 |
| `retail-12-concentration-profile-fit` | 12.0 | 11.8 | 13.3 | 15.0 | 16.7 | 7.5 | 10.0 | 86.3 (8.7) | 0 | 86 s | 1,871 |
| `retail-13-semis-figure-survival` | 12.0 | 11.9 | 16.0 | 7.5 | 20.0 | 7.5 | 10.0 | 84.9 (0.1) | 0 | 261 s | 7,115 |
| `retail-14-apple-pre-open-timing` | 12.0 | 12.0 | 16.0 | 7.5 | 20.0 | 7.5 | 10.0 | 85.0 (0.0) | 0 | 125 s | 2,395 |

## GPT-5.6 Sol avg@3

[`2026-10-02-openai-codex-gpt-5-6-sol-openai-codex-gpt-6-astra.json`](2026-10-02-openai-codex-gpt-5-6-sol-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-5.6-sol`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium, three grades per answer
- **Commit:** `196afb7`
- **Scores:** total 71.5 · integrity 32.3 · judged 39.4 · completed 100.0% · mean per-task σ 6.27
- **Critical caps:** 1 of 36 answers (missed `roc-not-inferred` 1)
- **Diagnostics:** tool argument errors 0 · fallback reports 0 · unverified report figures 33 ·
  repaired 8
- **Cost:** $4.46 per run · per million tokens: input $2.00, cache read $0.20, cache write
  $2.50, output $12.00 · OpenAI API standard tier, 2026-10-01; a promotional price, offered
  through at least 2026-11-21

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 9.9 | 11.8 | 5.3 | 15.0 | 10.0 | 7.5 | 6.7 | 66.1 (4.0) | 0 | 150 s | 6,029 |
| `retail-02-nike-moat-erosion` | 9.6 | 11.4 | 10.7 | 10.0 | 13.3 | 7.5 | 5.0 | 67.5 (15.5) | 0 | 216 s | 7,798 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 11.7 | 16.0 | 15.0 | 10.0 | 12.5 | 6.7 | 83.9 (5.5) | 0 | 123 s | 5,473 |
| `retail-04-dividend-yield-trap` | 8.0 | 11.8 | 10.7 | 15.0 | 10.0 | 7.5 | 5.0 | 65.3 (11.7) | 1 | 139 s | 5,795 |
| `retail-05-intel-value-trap` | 11.1 | 11.6 | 0.0 | 12.5 | 10.0 | 7.5 | 10.0 | 62.6 (3.4) | 0 | 171 s | 7,537 |
| `retail-06-mstr-proxy-leverage` | 10.4 | 11.3 | 10.7 | 15.0 | 10.0 | 7.5 | 5.0 | 69.8 (9.0) | 0 | 181 s | 7,633 |
| `retail-09-narrative-factcheck-apple` | 8.9 | 12.0 | 5.3 | 10.0 | 13.3 | 7.5 | 10.0 | 67.1 (7.7) | 0 | 123 s | 5,439 |
| `retail-10-smci-accounting-red-flag` | 5.3 | 11.7 | 13.3 | 7.5 | 13.3 | 7.5 | 10.0 | 68.7 (8.3) | 0 | 172 s | 7,506 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.6 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 69.6 (0.1) | 0 | 158 s | 6,279 |
| `retail-12-concentration-profile-fit` | 11.1 | 11.8 | 5.3 | 15.0 | 20.0 | 7.5 | 10.0 | 80.7 (5.2) | 0 | 91 s | 3,922 |
| `retail-13-semis-figure-survival` | 12.0 | 11.9 | 16.0 | 7.5 | 16.7 | 7.5 | 10.0 | 81.6 (4.8) | 0 | 154 s | 7,052 |
| `retail-14-apple-pre-open-timing` | 12.0 | 11.8 | 16.0 | 7.5 | 10.0 | 7.5 | 10.0 | 74.8 (0.3) | 0 | 157 s | 6,913 |

## DeepSeek V4.1 Flash avg@3

[`2026-10-02-deepseek-deepseek-flash-openai-codex-gpt-6-astra.json`](2026-10-02-deepseek-deepseek-flash-openai-codex-gpt-6-astra.json)

- **Agent:** `deepseek/deepseek-flash`, thinking high
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium, three grades per answer
- **Commit:** `a8ec63f`
- **Scores:** total 67.0 · integrity 33.3 · judged 36.0 · completed 100.0% · mean per-task σ 4.10
- **Critical caps:** 8 of 36 answers (contradicted `commercial-stage` 2, `roc-not-inferred` 2,
  `time-and-motive` 1; missed `life-savings-guardrail` 2, `roc-not-inferred` 1)
- **Diagnostics:** tool argument errors 17 · fallback reports 0 · unverified report figures 420 ·
  repaired 19
- **Cost:** $1.05 per run · per million tokens: input (cache miss) $0.30, cache hit $0.006,
  output $1.20 · DeepSeek API peak pricing, 2026-10-01

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 12.0 | 11.1 | 0.0 | 15.0 | 10.0 | 7.5 | 5.0 | 60.6 (0.2) | 0 | 156 s | 32,696 |
| `retail-02-nike-moat-erosion` | 12.0 | 10.9 | 10.7 | 10.0 | 10.0 | 7.5 | 5.0 | 66.1 (10.0) | 0 | 221 s | 49,293 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 10.6 | 16.0 | 15.0 | 10.0 | 7.5 | 5.0 | 57.7 (12.3) | 2 | 191 s | 39,615 |
| `retail-04-dividend-yield-trap` | 12.0 | 10.9 | 5.3 | 12.5 | 10.0 | 2.5 | 5.0 | 51.7 (6.5) | 3 | 215 s | 43,871 |
| `retail-05-intel-value-trap` | 12.0 | 11.0 | 5.3 | 12.5 | 10.0 | 10.0 | 5.0 | 63.4 (4.0) | 2 | 178 s | 38,013 |
| `retail-06-mstr-proxy-leverage` | 12.0 | 10.7 | 16.0 | 15.0 | 10.0 | 7.5 | 5.0 | 76.2 (0.6) | 0 | 215 s | 44,955 |
| `retail-09-narrative-factcheck-apple` | 11.1 | 10.6 | 0.0 | 7.5 | 6.7 | 7.5 | 6.7 | 50.0 (5.2) | 1 | 178 s | 39,034 |
| `retail-10-smci-accounting-red-flag` | 12.0 | 10.9 | 16.0 | 15.0 | 13.3 | 15.0 | 10.0 | 92.2 (4.2) | 0 | 162 s | 35,520 |
| `retail-11-nike-earnings-review-report` | 12.0 | 10.2 | 16.0 | 7.5 | 10.0 | 7.5 | 5.0 | 68.2 (0.1) | 0 | 179 s | 37,610 |
| `retail-12-concentration-profile-fit` | 12.0 | 11.1 | 8.0 | 15.0 | 20.0 | 7.5 | 10.0 | 83.6 (0.7) | 0 | 67 s | 13,775 |
| `retail-13-semis-figure-survival` | 12.0 | 11.5 | 16.0 | 7.5 | 13.3 | 7.5 | 5.0 | 72.8 (4.8) | 0 | 197 s | 44,973 |
| `retail-14-apple-pre-open-timing` | 12.0 | 11.3 | 16.0 | 7.5 | 10.0 | 0.0 | 5.0 | 61.8 (0.7) | 0 | 161 s | 33,790 |

## GPT-5.6 Terra avg@3

[`2026-10-02-openai-codex-gpt-5-6-terra-openai-codex-gpt-6-astra.json`](2026-10-02-openai-codex-gpt-5-6-terra-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-5.6-terra`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium, three grades per answer
- **Commit:** `196afb7`
- **Scores:** total 63.2 · integrity 29.2 · judged 34.2 · completed 100.0% · mean per-task σ 6.09
- **Critical caps:** 3 of 36 answers (missed `roc-not-inferred` 2, `competitor-mapping` 1)
- **Diagnostics:** tool argument errors 0 · fallback reports 0 · unverified report figures 61 ·
  repaired 3
- **Cost:** $2.15 per run · per million tokens: input $2.00, cache read $0.20, cache write
  $2.50, output $12.00 · OpenAI API standard tier, 2026-10-01

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 12.0 | 11.8 | 0.0 | 15.0 | 10.0 | 7.5 | 10.0 | 66.3 (0.1) | 0 | 91 s | 3,952 |
| `retail-02-nike-moat-erosion` | 8.0 | 7.5 | 5.3 | 7.5 | 6.7 | 5.0 | 3.3 | 43.4 (32.0) | 1 | 67 s | 2,934 |
| `retail-03-nuclear-thematic-purity` | 12.0 | 11.4 | 16.0 | 10.0 | 10.0 | 7.5 | 5.0 | 71.9 (3.5) | 0 | 79 s | 3,562 |
| `retail-04-dividend-yield-trap` | 12.0 | 11.8 | 5.3 | 12.5 | 10.0 | 7.5 | 5.0 | 61.3 (6.1) | 2 | 94 s | 3,877 |
| `retail-05-intel-value-trap` | 8.9 | 10.7 | 0.0 | 7.5 | 10.0 | 10.0 | 5.0 | 52.2 (3.1) | 0 | 89 s | 3,758 |
| `retail-06-mstr-proxy-leverage` | 8.8 | 10.5 | 16.0 | 15.0 | 10.0 | 7.5 | 5.0 | 72.8 (0.4) | 0 | 109 s | 5,104 |
| `retail-09-narrative-factcheck-apple` | 5.1 | 12.0 | 0.0 | 7.5 | 10.0 | 2.5 | 6.7 | 43.7 (9.2) | 0 | 86 s | 3,784 |
| `retail-10-smci-accounting-red-flag` | 5.3 | 11.1 | 5.3 | 7.5 | 10.0 | 5.0 | 8.3 | 52.6 (5.9) | 0 | 78 s | 3,438 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.6 | 16.0 | 12.5 | 10.0 | 7.5 | 6.7 | 76.2 (5.1) | 0 | 92 s | 3,391 |
| `retail-12-concentration-profile-fit` | 10.1 | 12.0 | 2.7 | 15.0 | 13.3 | 7.5 | 10.0 | 70.6 (4.9) | 0 | 55 s | 2,369 |
| `retail-13-semis-figure-survival` | 12.0 | 11.5 | 16.0 | 7.5 | 10.0 | 7.5 | 10.0 | 74.5 (0.4) | 0 | 67 s | 3,211 |
| `retail-14-apple-pre-open-timing` | 12.0 | 12.0 | 16.0 | 7.5 | 10.0 | 7.5 | 8.3 | 73.3 (2.4) | 0 | 67 s | 2,884 |

One Nike moat-erosion run scored 8: the model read the `stock-brief` skill, followed its rule to
ask for a missing ticker, and replied "What ticker should I use for Nike—$NKE (NYSE)?" instead of
answering. In a separate diagnostic of that task, not part of this baseline, it asked about the
ticker in 2 of 10 runs.

## GPT-5.6 Luna avg@3

[`2026-10-02-openai-codex-gpt-5-6-luna-openai-codex-gpt-6-astra.json`](2026-10-02-openai-codex-gpt-5-6-luna-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-5.6-luna`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium, three grades per answer
- **Commit:** `196afb7`
- **Scores:** total 62.8 · integrity 27.3 · judged 35.5 · completed 100.0% · mean per-task σ 5.74
- **Critical caps:** 2 of 36 answers (contradicted `time-and-motive` 1; missed `report-delivery` 1)
- **Diagnostics:** tool argument errors 0 · fallback reports 1 · unverified report figures 100 ·
  repaired 1
- **Cost:** $0.27 per run · per million tokens: input $0.20, cache read $0.02, cache write
  $0.25, output $1.20 · OpenAI API standard tier, 2026-10-01

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 9.9 | 11.5 | 0.0 | 15.0 | 10.0 | 7.5 | 8.3 | 62.2 (5.4) | 0 | 123 s | 4,859 |
| `retail-02-nike-moat-erosion` | 7.2 | 11.6 | 10.7 | 10.0 | 10.0 | 7.5 | 6.7 | 63.6 (5.9) | 0 | 96 s | 4,451 |
| `retail-03-nuclear-thematic-purity` | 10.4 | 10.2 | 10.7 | 15.0 | 10.0 | 7.5 | 5.0 | 68.8 (3.1) | 0 | 83 s | 3,764 |
| `retail-04-dividend-yield-trap` | 11.1 | 8.5 | 0.0 | 15.0 | 10.0 | 7.5 | 5.0 | 57.1 (2.4) | 0 | 97 s | 3,875 |
| `retail-05-intel-value-trap` | 9.1 | 10.3 | 0.0 | 7.5 | 10.0 | 7.5 | 8.3 | 52.7 (4.3) | 0 | 115 s | 5,103 |
| `retail-06-mstr-proxy-leverage` | 10.4 | 11.9 | 5.3 | 15.0 | 10.0 | 7.5 | 5.0 | 65.1 (8.8) | 0 | 100 s | 4,057 |
| `retail-09-narrative-factcheck-apple` | 9.1 | 10.3 | 0.0 | 5.0 | 10.0 | 5.0 | 8.3 | 47.7 (7.0) | 1 | 195 s | 3,203 |
| `retail-10-smci-accounting-red-flag` | 4.0 | 11.4 | 8.0 | 7.5 | 10.0 | 2.5 | 10.0 | 53.4 (4.0) | 0 | 96 s | 4,457 |
| `retail-11-nike-earnings-review-report` | 12.0 | 9.7 | 10.7 | 10.0 | 10.0 | 7.5 | 6.7 | 66.6 (12.2) | 1 | 232 s | 4,924 |
| `retail-12-concentration-profile-fit` | 9.1 | 11.8 | 2.7 | 15.0 | 13.3 | 5.0 | 5.0 | 61.9 (7.7) | 0 | 68 s | 2,837 |
| `retail-13-semis-figure-survival` | 12.0 | 11.9 | 16.0 | 7.5 | 16.7 | 7.5 | 10.0 | 81.5 (4.6) | 0 | 68 s | 3,086 |
| `retail-14-apple-pre-open-timing` | 12.0 | 12.0 | 16.0 | 7.5 | 10.0 | 5.0 | 10.0 | 72.5 (3.5) | 0 | 94 s | 4,357 |

## GPT-6 Luna avg@3

[`2026-10-02-openai-codex-gpt-6-luna-openai-codex-gpt-6-astra.json`](2026-10-02-openai-codex-gpt-6-luna-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-6-luna`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium, three grades per answer
- **Commit:** `196afb7`
- **Scores:** total 57.7 · integrity 25.3 · judged 33.0 · completed 100.0% · mean per-task σ 6.10
- **Critical caps:** 2 of 36 answers (contradicted `time-and-motive` 1, `report-delivery` 1)
- **Diagnostics:** tool argument errors 1 · fallback reports 0 · unverified report figures 36 ·
  repaired 2
- **Cost:** $0.07 per run · per million tokens: input $0.10, cache read $0.01, cache write
  $0.125, output $0.50 · OpenAI API standard tier, 2026-10-01

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 7.7 | 11.1 | 0.0 | 15.0 | 10.0 | 7.5 | 5.0 | 56.3 (1.4) | 0 | 48 s | 1,473 |
| `retail-02-nike-moat-erosion` | 9.6 | 11.5 | 0.0 | 10.0 | 10.0 | 7.5 | 6.7 | 55.3 (8.4) | 0 | 51 s | 2,132 |
| `retail-03-nuclear-thematic-purity` | 8.8 | 12.0 | 10.7 | 10.0 | 3.3 | 7.5 | 3.3 | 55.6 (15.6) | 0 | 50 s | 1,929 |
| `retail-04-dividend-yield-trap` | 0.0 | 11.0 | 5.3 | 15.0 | 10.0 | 7.5 | 5.0 | 53.8 (7.8) | 0 | 49 s | 1,861 |
| `retail-05-intel-value-trap` | 2.9 | 9.6 | 0.0 | 10.0 | 10.0 | 5.0 | 5.0 | 42.5 (1.9) | 0 | 49 s | 1,324 |
| `retail-06-mstr-proxy-leverage` | 7.2 | 12.0 | 5.3 | 10.0 | 10.0 | 7.5 | 5.0 | 57.0 (5.6) | 0 | 44 s | 1,716 |
| `retail-09-narrative-factcheck-apple` | 6.4 | 11.7 | 0.0 | 5.0 | 10.0 | 7.5 | 10.0 | 50.6 (3.9) | 1 | 44 s | 1,707 |
| `retail-10-smci-accounting-red-flag` | 4.0 | 11.1 | 8.0 | 10.0 | 10.0 | 0.0 | 5.0 | 48.1 (4.3) | 0 | 39 s | 1,603 |
| `retail-11-nike-earnings-review-report` | 12.0 | 11.4 | 16.0 | 7.5 | 10.0 | 7.5 | 6.7 | 64.2 (10.9) | 1 | 81 s | 2,632 |
| `retail-12-concentration-profile-fit` | 9.2 | 11.8 | 0.0 | 12.5 | 16.7 | 7.5 | 10.0 | 67.7 (4.4) | 0 | 36 s | 1,532 |
| `retail-13-semis-figure-survival` | 12.0 | 11.9 | 16.0 | 7.5 | 10.0 | 10.0 | 10.0 | 77.4 (3.5) | 0 | 37 s | 1,551 |
| `retail-14-apple-pre-open-timing` | 12.0 | 9.0 | 16.0 | 7.5 | 6.7 | 7.5 | 5.0 | 63.7 (5.3) | 0 | 25 s | 807 |

This run replaced an earlier GPT-6 Luna baseline (v1 total 67.6, commit `345e380`) whose full run
file was not kept; this one was run at the same commit as the GPT-5.6 rows.

## Qwen 3.8 27B avg@3, medium

[`2026-10-02-openrouter-qwen-qwen3-8-27b-medium-openai-codex-gpt-6-astra.json`](2026-10-02-openrouter-qwen-qwen3-8-27b-medium-openai-codex-gpt-6-astra.json)

- **Agent:** `openrouter/qwen/qwen3.8-27b`, thinking medium, every request served by DekaLLM through
  OpenRouter
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium, three grades per answer
- **Commit:** `809619e`
- **Scores:** total 56.6 · integrity 27.3 · judged 31.0 · completed 100.0% · mean per-task σ 4.63
- **Critical caps:** 11 of 36 answers (contradicted `roc-not-inferred` 3, `time-and-motive` 3,
  `report-delivery` 3, `commercial-stage` 2; missed `total-return` 1)
- **Diagnostics:** tool argument errors 9 · fallback reports 0 · unverified report figures 300 ·
  repaired 18
- **Cost:** $0.84 per run · per million tokens: input $0.049, cache read $0.020, output $3.00 ·
  DekaLLM on OpenRouter, 2026-10-01

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 8.0 | 11.2 | 0.0 | 15.0 | 10.0 | 7.5 | 5.0 | 56.7 (3.0) | 0 | 171 s | 24,436 |
| `retail-02-nike-moat-erosion` | 12.0 | 10.0 | 5.3 | 7.5 | 10.0 | 7.5 | 6.7 | 59.0 (6.7) | 0 | 212 s | 27,926 |
| `retail-03-nuclear-thematic-purity` | 7.2 | 9.6 | 8.0 | 10.0 | 10.0 | 7.5 | 5.0 | 53.7 (6.7) | 2 | 126 s | 14,254 |
| `retail-04-dividend-yield-trap` | 12.0 | 11.3 | 0.0 | 10.0 | 6.7 | 0.0 | 5.0 | 43.3 (5.6) | 3 | 117 s | 15,824 |
| `retail-05-intel-value-trap` | 6.1 | 10.6 | 0.0 | 15.0 | 10.0 | 7.5 | 10.0 | 59.2 (0.9) | 0 | 139 s | 17,097 |
| `retail-06-mstr-proxy-leverage` | 8.5 | 9.9 | 10.7 | 7.5 | 10.0 | 7.5 | 5.0 | 59.1 (10.9) | 0 | 157 s | 24,283 |
| `retail-09-narrative-factcheck-apple` | 7.7 | 10.2 | 5.3 | 0.0 | 10.0 | 5.0 | 5.0 | 43.3 (5.6) | 3 | 138 s | 23,174 |
| `retail-10-smci-accounting-red-flag` | 2.7 | 10.4 | 5.3 | 10.0 | 10.0 | 0.0 | 5.0 | 43.4 (7.1) | 0 | 152 s | 21,882 |
| `retail-11-nike-earnings-review-report` | 12.0 | 10.1 | 16.0 | 7.5 | 6.7 | 7.5 | 5.0 | 49.0 (0.0) | 3 | 139 s | 19,335 |
| `retail-12-concentration-profile-fit` | 10.9 | 10.7 | 8.0 | 15.0 | 13.3 | 7.5 | 8.3 | 73.8 (1.0) | 0 | 64 s | 9,445 |
| `retail-13-semis-figure-survival` | 12.0 | 11.6 | 16.0 | 10.0 | 10.0 | 7.5 | 10.0 | 77.1 (3.5) | 0 | 137 s | 22,808 |
| `retail-14-apple-pre-open-timing` | 12.0 | 10.6 | 16.0 | 7.5 | 10.0 | 2.5 | 3.3 | 61.9 (4.4) | 0 | 133 s | 18,562 |

## Qwen 3.8 27B avg@3, off

[`2026-10-02-openrouter-qwen-qwen3-8-27b-off-openai-codex-gpt-6-astra.json`](2026-10-02-openrouter-qwen-qwen3-8-27b-off-openai-codex-gpt-6-astra.json)

- **Agent:** `openrouter/qwen/qwen3.8-27b`, thinking off, every request served by DekaLLM through
  OpenRouter
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium, three grades per answer
- **Commit:** `809619e`
- **Scores:** total 50.9 · integrity 25.6 · judged 28.8 · completed 94.4% · mean per-task σ 9.35
- **Critical caps:** 10 of 36 answers (contradicted `roc-not-inferred` 3, `time-and-motive` 3,
  `pre-open-boundary` 2, `commercial-stage` 1, `profile-safe-observation` 1; missed `total-return`
  1)
- **Diagnostics:** tool argument errors 6 · fallback reports 3 · unverified report figures 273 ·
  repaired 21
- **Cost:** $0.44 per run · per million tokens: input $0.049, cache read $0.020, output $3.00 ·
  DekaLLM on OpenRouter, 2026-10-01

| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 8.8 | 10.8 | 0.0 | 7.5 | 5.0 | 7.5 | 5.0 | 29.7 (21.1) | 0 | 46 s | 4,699 |
| `retail-02-nike-moat-erosion` | 6.1 | 9.4 | 0.0 | 7.5 | 10.0 | 7.5 | 5.0 | 45.5 (1.2) | 0 | 131 s | 12,380 |
| `retail-03-nuclear-thematic-purity` | 9.2 | 11.5 | 8.0 | 12.5 | 10.0 | 7.5 | 5.0 | 63.6 (11.5) | 1 | 64 s | 6,108 |
| `retail-04-dividend-yield-trap` | 10.1 | 8.9 | 0.0 | 10.0 | 10.0 | 0.0 | 5.0 | 43.4 (5.0) | 3 | 69 s | 7,962 |
| `retail-05-intel-value-trap` | 2.1 | 10.1 | 0.0 | 15.0 | 10.0 | 2.5 | 8.3 | 48.0 (6.9) | 0 | 107 s | 15,182 |
| `retail-06-mstr-proxy-leverage` | 8.8 | 9.4 | 10.7 | 7.5 | 10.0 | 7.5 | 5.0 | 58.9 (6.8) | 0 | 80 s | 11,284 |
| `retail-09-narrative-factcheck-apple` | 12.0 | 10.7 | 0.0 | 0.0 | 10.0 | 5.0 | 5.0 | 42.7 (3.8) | 3 | 63 s | 8,601 |
| `retail-10-smci-accounting-red-flag` | 6.7 | 8.3 | 8.0 | 7.5 | 10.0 | 7.5 | 5.0 | 53.0 (6.8) | 0 | 40 s | 4,110 |
| `retail-11-nike-earnings-review-report` | 12.0 | 9.1 | 8.0 | 7.5 | 5.0 | 7.5 | 5.0 | 36.1 (25.6) | 0 | 78 s | 7,042 |
| `retail-12-concentration-profile-fit` | 12.0 | 9.3 | 8.0 | 12.5 | 10.0 | 7.5 | 5.0 | 60.6 (9.9) | 1 | 39 s | 5,004 |
| `retail-13-semis-figure-survival` | 12.0 | 11.3 | 16.0 | 12.5 | 10.0 | 7.5 | 10.0 | 79.3 (3.8) | 0 | 64 s | 11,750 |
| `retail-14-apple-pre-open-timing` | 12.0 | 10.9 | 16.0 | 2.5 | 6.7 | 2.5 | 0.0 | 50.5 (9.9) | 2 | 55 s | 6,592 |

Two runs, one each of NVIDIA and the Nike report, ended in an agent error: the final answer was
tool-call markup, and the recovery request did not replace it with prose. Each counts as zero in
the total, which is why Completed is 94.4%. In a separate diagnostic of those two tasks, five runs
each and not part of this baseline, the markup failure did not recur; one NVIDIA run scored 15
after it skipped research and misread when the earnings were released.
