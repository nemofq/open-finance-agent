# Baselines

> These checked-in runs are benchmark v1 history from main. Eval v2 keeps them readable but rejects
> direct comparison; use `--rescore` on a full trace-bearing run before comparing across the scoring
> migration. Baseline JSON intentionally omits traces and cannot itself be rescored.

Each JSON file here is one committed run, promoted with `--baseline`, and one row of the
[README's table](../../README.md#a-benchmark-that-favours-quality-over-quantity). This page breaks
each row down by task; how a run is made and promoted is in
[evals/README.md › Comparing runs](../README.md#comparing-runs). Add a section here when a baseline
is added, in the same order as the README's table.

Every value is the mean of the task's three runs, from the baseline's `results`. A run that ended in
an agent error or timeout scores 0 in every score column, as the benchmark scores it:

- **Checks** (/40): the deterministic checks, `deterministicCheck.score`.
- **Intent** (/15), **Financial** (/20), **Grounding** (/15), **Clarity** (/10): the judge's four
  dimensions, `judgeResult.intentScore`, `financialScore`, `groundingScore` and
  `retailClarityScore`.
- **Total** (/100): `totalScore`, with the population standard deviation (σ) of the three runs.
- **Run time**: the task's turn, `metrics.latencyMs`, judging excluded.
- **Output tokens**: `metrics.tokens.output`, as the provider reports it. DeepSeek and Qwen count
  their thinking in it, so their figures are not comparable with the OpenAI models'.

All runs: benchmark version 1, policy enforced, offline dataset, twelve tasks × 3 repeats.

## GPT-6.1 Sol avg@3

[`2026-09-30-openai-codex-gpt-6-1-sol-openai-codex-gpt-6-astra.json`](2026-09-30-openai-codex-gpt-6-1-sol-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-6.1-sol`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `a8ec63f`
- **Scores:** checks 35.8 · judge 49.0 · total 84.8 · mean per-task σ 2.73
- **Diagnostics:** tool argument errors 0 · unverified report figures 20 · repaired 0

| Task | Checks | Intent | Financial | Grounding | Clarity | Total (σ) | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 32.0 | 12.7 | 15.7 | 12.3 | 9.0 | 81.7 (1.9) | 132 s | 3,176 |
| `retail-02-nike-moat-erosion` | 40.0 | 14.0 | 14.3 | 12.7 | 9.0 | 90.0 (1.4) | 161 s | 4,015 |
| `retail-03-nuclear-thematic-purity` | 40.0 | 12.3 | 12.3 | 13.7 | 7.7 | 86.0 (2.8) | 108 s | 2,394 |
| `retail-04-dividend-yield-trap` | 40.0 | 14.7 | 10.0 | 11.7 | 7.0 | 83.3 (3.7) | 175 s | 2,777 |
| `retail-05-intel-value-trap` | 34.7 | 11.7 | 12.3 | 12.3 | 8.0 | 79.0 (7.1) | 115 s | 2,289 |
| `retail-06-mstr-proxy-leverage` | 35.3 | 13.7 | 16.0 | 12.7 | 8.3 | 86.0 (0.8) | 143 s | 3,028 |
| `retail-09-narrative-factcheck-apple` | 30.0 | 12.7 | 14.3 | 10.3 | 8.7 | 76.0 (5.7) | 107 s | 2,201 |
| `retail-10-smci-accounting-red-flag` | 24.7 | 14.3 | 18.7 | 10.7 | 8.7 | 77.0 (2.2) | 118 s | 2,523 |
| `retail-11-nike-earnings-review-report` | 40.0 | 13.3 | 17.0 | 14.0 | 9.3 | 93.7 (1.7) | 164 s | 3,562 |
| `retail-12-concentration-profile-fit` | 40.0 | 12.3 | 18.0 | 11.0 | 9.0 | 90.3 (2.4) | 86 s | 1,871 |
| `retail-13-semis-figure-survival` | 33.0 | 13.0 | 19.7 | 9.3 | 10.0 | 85.0 (2.2) | 261 s | 7,115 |
| `retail-14-apple-pre-open-timing` | 40.0 | 9.7 | 17.3 | 13.7 | 9.0 | 89.7 (0.9) | 125 s | 2,395 |

Its lost checks are almost all required evidence: in every SMCI run the ledger holds neither the
Item 4.01 8-K nor the delayed 10-K notice (evidence 0/15), and every NVIDIA run misses the Q2 FY25
revenue and gross-margin entries (7/15).

## DeepSeek V4.1 Flash avg@3

[`2026-09-30-deepseek-deepseek-flash-openai-codex-gpt-6-astra.json`](2026-09-30-deepseek-deepseek-flash-openai-codex-gpt-6-astra.json)

- **Agent:** `deepseek/deepseek-flash`, thinking high
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `a8ec63f`
- **Scores:** checks 39.1 · judge 38.1 · total 77.3 · mean per-task σ 2.69
- **Diagnostics:** tool argument errors 17 · unverified report figures 420 · repaired 19

| Task | Checks | Intent | Financial | Grounding | Clarity | Total (σ) | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 38.0 | 11.7 | 13.7 | 10.3 | 5.3 | 79.0 (1.4) | 156 s | 32,696 |
| `retail-02-nike-moat-erosion` | 39.3 | 11.3 | 8.7 | 9.0 | 4.7 | 73.0 (0.8) | 221 s | 49,293 |
| `retail-03-nuclear-thematic-purity` | 39.7 | 12.7 | 10.0 | 9.0 | 6.0 | 77.3 (0.5) | 191 s | 39,615 |
| `retail-04-dividend-yield-trap` | 40.0 | 11.3 | 7.0 | 6.3 | 4.7 | 69.3 (7.0) | 215 s | 43,871 |
| `retail-05-intel-value-trap` | 39.7 | 10.0 | 10.3 | 9.7 | 3.7 | 73.3 (6.2) | 178 s | 38,013 |
| `retail-06-mstr-proxy-leverage` | 39.7 | 12.3 | 8.3 | 8.0 | 5.3 | 73.7 (1.7) | 215 s | 44,955 |
| `retail-09-narrative-factcheck-apple` | 37.3 | 12.0 | 12.0 | 10.3 | 6.7 | 78.3 (0.5) | 178 s | 39,034 |
| `retail-10-smci-accounting-red-flag` | 39.7 | 14.7 | 14.0 | 11.7 | 7.3 | 87.3 (1.7) | 162 s | 35,520 |
| `retail-11-nike-earnings-review-report` | 39.0 | 11.7 | 12.0 | 9.3 | 5.3 | 77.3 (4.0) | 179 s | 37,610 |
| `retail-12-concentration-profile-fit` | 39.7 | 13.0 | 15.3 | 10.7 | 8.0 | 86.7 (4.1) | 67 s | 13,775 |
| `retail-13-semis-figure-survival` | 37.7 | 12.3 | 15.3 | 9.3 | 7.3 | 82.0 (1.4) | 197 s | 44,973 |
| `retail-14-apple-pre-open-timing` | 39.7 | 8.3 | 9.0 | 7.0 | 5.7 | 69.7 (2.9) | 161 s | 33,790 |

## GPT-6 Luna avg@3

[`2026-09-30-openai-codex-gpt-6-luna-openai-codex-gpt-6-astra.json`](2026-09-30-openai-codex-gpt-6-luna-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-6-luna`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `345e380`
- **Scores:** checks 29.8 · judge 37.8 · total 67.6 · mean per-task σ 6.13
- **Diagnostics:** tool argument errors 0 · unverified report figures 68 · repaired 5

| Task | Checks | Intent | Financial | Grounding | Clarity | Total (σ) | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 26.7 | 10.0 | 9.0 | 9.7 | 8.0 | 63.3 (4.7) | 43 s | 1,435 |
| `retail-02-nike-moat-erosion` | 23.7 | 10.0 | 8.7 | 9.0 | 6.7 | 58.0 (3.7) | 55 s | 2,208 |
| `retail-03-nuclear-thematic-purity` | 36.0 | 10.0 | 8.3 | 13.3 | 6.0 | 73.7 (3.9) | 48 s | 1,596 |
| `retail-04-dividend-yield-trap` | 26.7 | 13.3 | 6.7 | 4.7 | 5.3 | 56.7 (11.4) | 44 s | 1,734 |
| `retail-05-intel-value-trap` | 21.3 | 10.7 | 7.7 | 7.0 | 8.0 | 54.7 (5.2) | 29 s | 1,149 |
| `retail-06-mstr-proxy-leverage` | 20.0 | 11.7 | 11.0 | 5.3 | 7.3 | 55.3 (10.3) | 39 s | 1,466 |
| `retail-09-narrative-factcheck-apple` | 29.7 | 11.3 | 11.0 | 6.7 | 8.0 | 66.7 (4.5) | 43 s | 1,677 |
| `retail-10-smci-accounting-red-flag` | 28.3 | 13.0 | 13.0 | 11.0 | 8.0 | 73.3 (4.5) | 38 s | 1,486 |
| `retail-11-nike-earnings-review-report` | 36.3 | 12.3 | 12.7 | 8.3 | 8.7 | 78.3 (6.0) | 76 s | 2,671 |
| `retail-12-concentration-profile-fit` | 35.3 | 11.7 | 17.0 | 10.3 | 8.0 | 82.3 (2.9) | 36 s | 1,549 |
| `retail-13-semis-figure-survival` | 33.7 | 11.7 | 9.0 | 9.3 | 9.3 | 73.0 (7.3) | 36 s | 1,292 |
| `retail-14-apple-pre-open-timing` | 39.3 | 8.7 | 9.7 | 10.0 | 7.7 | 75.3 (9.0) | 27 s | 935 |

## Qwen 3.8 27B avg@3, medium

[`2026-10-01-openrouter-qwen-qwen3-8-27b-medium-openai-codex-gpt-6-astra.json`](2026-10-01-openrouter-qwen-qwen3-8-27b-medium-openai-codex-gpt-6-astra.json)

- **Agent:** `openrouter/qwen/qwen3.8-27b`, thinking medium, every request served by DekaLLM through
  OpenRouter
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `809619e`
- **Scores:** checks 35.2 · judge 30.2 · total 65.4 · mean per-task σ 3.87
- **Diagnostics:** tool argument errors 9 · unverified report figures 300 · repaired 18

| Task | Checks | Intent | Financial | Grounding | Clarity | Total (σ) | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 31.3 | 10.0 | 10.7 | 10.7 | 6.0 | 68.7 (2.9) | 171 s | 24,436 |
| `retail-02-nike-moat-erosion` | 39.0 | 10.3 | 6.7 | 5.7 | 5.7 | 67.3 (2.6) | 212 s | 27,926 |
| `retail-03-nuclear-thematic-purity` | 33.0 | 9.0 | 7.0 | 4.3 | 4.0 | 57.3 (4.5) | 126 s | 14,254 |
| `retail-04-dividend-yield-trap` | 40.0 | 9.3 | 3.7 | 3.0 | 3.7 | 59.7 (3.1) | 117 s | 15,824 |
| `retail-05-intel-value-trap` | 32.3 | 12.7 | 9.3 | 5.0 | 7.7 | 67.0 (1.6) | 139 s | 17,097 |
| `retail-06-mstr-proxy-leverage` | 34.7 | 11.3 | 6.3 | 6.7 | 4.3 | 63.3 (5.2) | 157 s | 24,283 |
| `retail-09-narrative-factcheck-apple` | 34.0 | 5.7 | 7.0 | 4.7 | 4.0 | 55.3 (7.7) | 138 s | 23,174 |
| `retail-10-smci-accounting-red-flag` | 24.7 | 11.0 | 8.3 | 5.3 | 4.7 | 54.0 (4.5) | 152 s | 21,882 |
| `retail-11-nike-earnings-review-report` | 39.3 | 11.0 | 7.3 | 7.0 | 6.0 | 70.7 (4.9) | 139 s | 19,335 |
| `retail-12-concentration-profile-fit` | 36.7 | 12.0 | 14.0 | 8.7 | 7.3 | 78.7 (2.6) | 64 s | 9,445 |
| `retail-13-semis-figure-survival` | 37.7 | 13.0 | 11.0 | 8.7 | 8.3 | 78.7 (2.4) | 137 s | 22,808 |
| `retail-14-apple-pre-open-timing` | 39.3 | 8.7 | 6.0 | 5.7 | 4.3 | 64.0 (4.3) | 133 s | 18,562 |

Every run completed. Its points go mostly in the judge's financial, grounding and clarity
dimensions; the yield-trap task keeps full checks but scores 3.0–3.7 on each of those three.

## Qwen 3.8 27B avg@3, off

[`2026-10-01-openrouter-qwen-qwen3-8-27b-off-openai-codex-gpt-6-astra.json`](2026-10-01-openrouter-qwen-qwen3-8-27b-off-openai-codex-gpt-6-astra.json)

- **Agent:** `openrouter/qwen/qwen3.8-27b`, thinking off, every request served by DekaLLM through
  OpenRouter
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `809619e`
- **Scores:** checks 33.6 · judge 26.8 · total 59.4 · mean per-task σ 8.89
- **Diagnostics:** tool argument errors 6 · fallback reports 3 · unverified report figures 273 ·
  repaired 21

| Task | Checks | Intent | Financial | Grounding | Clarity | Total (σ) | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 31.3 | 5.3 | 4.3 | 7.0 | 4.3 | 41.0 (29.1) | 46 s | 4,699 |
| `retail-02-nike-moat-erosion` | 30.0 | 8.0 | 7.0 | 6.0 | 5.3 | 56.3 (5.9) | 131 s | 12,380 |
| `retail-03-nuclear-thematic-purity` | 35.0 | 10.0 | 8.3 | 8.3 | 5.0 | 66.7 (6.5) | 64 s | 6,108 |
| `retail-04-dividend-yield-trap` | 36.3 | 9.3 | 4.3 | 3.3 | 3.7 | 57.0 (5.4) | 69 s | 7,962 |
| `retail-05-intel-value-trap` | 27.0 | 12.3 | 8.3 | 5.0 | 7.7 | 60.3 (6.3) | 107 s | 15,182 |
| `retail-06-mstr-proxy-leverage` | 34.7 | 9.0 | 5.7 | 6.3 | 4.3 | 60.0 (4.1) | 80 s | 11,284 |
| `retail-09-narrative-factcheck-apple` | 38.0 | 6.3 | 7.0 | 5.3 | 4.7 | 61.3 (4.8) | 63 s | 8,601 |
| `retail-10-smci-accounting-red-flag` | 30.7 | 11.0 | 9.7 | 7.3 | 5.7 | 64.3 (4.5) | 40 s | 4,110 |
| `retail-11-nike-earnings-review-report` | 25.7 | 5.7 | 2.7 | 4.0 | 3.3 | 41.3 (29.3) | 78 s | 7,042 |
| `retail-12-concentration-profile-fit` | 39.0 | 10.0 | 13.0 | 7.0 | 4.3 | 73.3 (4.2) | 39 s | 5,004 |
| `retail-13-semis-figure-survival` | 35.3 | 13.7 | 11.3 | 8.7 | 9.3 | 78.3 (5.4) | 64 s | 11,750 |
| `retail-14-apple-pre-open-timing` | 39.7 | 4.0 | 3.3 | 3.7 | 2.0 | 52.7 (1.2) | 55 s | 6,592 |

Two runs, one each of NVIDIA and the Nike report, ended in an agent error: the final answer was
tool-call markup, and the recovery request did not replace it with prose. Each scores 0, which is
what widens those two tasks' σ to about 29. On the Apple pre-open task every run meets the checks
but scores 12–14 from the judge.
