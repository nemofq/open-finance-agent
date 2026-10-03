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

Each section's **Cost** is the agent's average cost per run at the list prices it gives, worked
out as in [evals/README.md › Reproducing the README table](../README.md#reproducing-the-readme-table).

All runs: benchmark version 1, policy enforced, offline dataset, twelve tasks × 3 repeats.

## GPT-6.1 Sol avg@3

[`2026-09-30-openai-codex-gpt-6-1-sol-openai-codex-gpt-6-astra.json`](2026-09-30-openai-codex-gpt-6-1-sol-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-6.1-sol`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `a8ec63f`
- **Scores:** checks 35.8 · judge 49.0 · total 84.8 · mean per-task σ 2.73
- **Diagnostics:** tool argument errors 0 · unverified report figures 20 · repaired 0
- **Cost:** $2.13 per run · per million tokens: input $2.00, cache read $0.10, cache write
  $2.50, output $10.00 · OpenAI API standard tier, 2026-10-01

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

## GPT-5.6 Sol avg@3

[`2026-10-01-openai-codex-gpt-5-6-sol-openai-codex-gpt-6-astra.json`](2026-10-01-openai-codex-gpt-5-6-sol-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-5.6-sol`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `196afb7`
- **Scores:** checks 36.1 · judge 46.8 · total 82.8 · mean per-task σ 2.69
- **Diagnostics:** tool argument errors 0 · unverified report figures 33 · repaired 8
- **Cost:** $4.46 per run · per million tokens: input $2.00, cache read $0.20, cache write
  $2.50, output $12.00 · OpenAI API standard tier, 2026-10-01; a promotional price, offered
  through at least 2026-11-21

| Task | Checks | Intent | Financial | Grounding | Clarity | Total (σ) | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 34.0 | 12.0 | 14.3 | 13.0 | 8.0 | 81.3 (0.9) | 150 s | 6,029 |
| `retail-02-nike-moat-erosion` | 37.0 | 12.0 | 13.3 | 10.3 | 7.7 | 80.3 (6.8) | 216 s | 7,798 |
| `retail-03-nuclear-thematic-purity` | 40.0 | 13.0 | 13.7 | 14.0 | 8.0 | 88.7 (0.5) | 123 s | 5,473 |
| `retail-04-dividend-yield-trap` | 35.0 | 14.0 | 9.7 | 9.7 | 6.7 | 75.0 (5.7) | 139 s | 5,795 |
| `retail-05-intel-value-trap` | 37.7 | 13.0 | 13.7 | 12.0 | 8.7 | 85.0 (4.3) | 171 s | 7,537 |
| `retail-06-mstr-proxy-leverage` | 37.7 | 14.0 | 14.3 | 11.0 | 8.0 | 85.0 (2.2) | 181 s | 7,633 |
| `retail-09-narrative-factcheck-apple` | 29.0 | 12.0 | 14.3 | 10.0 | 8.7 | 74.0 (3.3) | 123 s | 5,439 |
| `retail-10-smci-accounting-red-flag` | 25.0 | 12.7 | 16.3 | 10.3 | 8.7 | 73.0 (0.8) | 172 s | 7,506 |
| `retail-11-nike-earnings-review-report` | 40.0 | 14.3 | 16.7 | 12.7 | 9.0 | 92.7 (1.2) | 158 s | 6,279 |
| `retail-12-concentration-profile-fit` | 37.7 | 11.7 | 18.3 | 10.3 | 8.3 | 86.3 (3.3) | 91 s | 3,922 |
| `retail-13-semis-figure-survival` | 40.0 | 13.7 | 19.0 | 9.7 | 10.0 | 92.3 (0.5) | 154 s | 7,052 |
| `retail-14-apple-pre-open-timing` | 40.0 | 8.0 | 14.3 | 10.3 | 7.7 | 80.3 (2.9) | 157 s | 6,913 |

Every run completed. Like GPT-6.1 Sol, it misses required evidence on SMCI in every run (checks
25/40) while the judge scores those answers 47–49/60.

## DeepSeek V4.1 Flash avg@3

[`2026-09-30-deepseek-deepseek-flash-openai-codex-gpt-6-astra.json`](2026-09-30-deepseek-deepseek-flash-openai-codex-gpt-6-astra.json)

- **Agent:** `deepseek/deepseek-flash`, thinking high
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `a8ec63f`
- **Scores:** checks 39.1 · judge 38.1 · total 77.3 · mean per-task σ 2.69
- **Diagnostics:** tool argument errors 17 · unverified report figures 420 · repaired 19
- **Cost:** $1.05 per run · per million tokens: input (cache miss) $0.30, cache hit $0.006,
  output $1.20 · DeepSeek API peak pricing, 2026-10-01

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

## GPT-5.6 Terra avg@3

[`2026-10-01-openai-codex-gpt-5-6-terra-openai-codex-gpt-6-astra.json`](2026-10-01-openai-codex-gpt-5-6-terra-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-5.6-terra`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `196afb7`
- **Scores:** checks 34.9 · judge 42.2 · total 77.1 · mean per-task σ 6.08
- **Diagnostics:** tool argument errors 0 · unverified report figures 61 · repaired 3
- **Cost:** $2.15 per run · per million tokens: input $2.00, cache read $0.20, cache write
  $2.50, output $12.00 · OpenAI API standard tier, 2026-10-01

| Task | Checks | Intent | Financial | Grounding | Clarity | Total (σ) | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 36.7 | 12.0 | 13.3 | 13.0 | 8.3 | 83.3 (4.0) | 91 s | 3,952 |
| `retail-02-nike-moat-erosion` | 28.3 | 9.3 | 7.0 | 6.7 | 5.0 | 56.3 (34.2) | 67 s | 2,934 |
| `retail-03-nuclear-thematic-purity` | 40.0 | 11.3 | 11.0 | 12.7 | 6.0 | 81.0 (0.8) | 79 s | 3,562 |
| `retail-04-dividend-yield-trap` | 40.0 | 13.7 | 7.3 | 9.3 | 6.0 | 76.3 (0.5) | 94 s | 3,877 |
| `retail-05-intel-value-trap` | 33.0 | 9.3 | 10.3 | 11.0 | 6.7 | 70.3 (2.9) | 89 s | 3,758 |
| `retail-06-mstr-proxy-leverage` | 35.3 | 12.7 | 13.0 | 10.7 | 7.3 | 79.0 (2.8) | 109 s | 5,104 |
| `retail-09-narrative-factcheck-apple` | 24.3 | 10.3 | 11.0 | 9.0 | 7.3 | 62.0 (6.2) | 86 s | 3,784 |
| `retail-10-smci-accounting-red-flag` | 28.0 | 12.3 | 14.0 | 8.7 | 8.3 | 71.3 (9.0) | 78 s | 3,438 |
| `retail-11-nike-earnings-review-report` | 39.7 | 14.0 | 16.3 | 12.3 | 9.7 | 92.0 (2.2) | 92 s | 3,391 |
| `retail-12-concentration-profile-fit` | 35.3 | 12.0 | 17.7 | 10.0 | 9.0 | 84.0 (5.1) | 55 s | 2,369 |
| `retail-13-semis-figure-survival` | 38.3 | 13.7 | 15.0 | 10.3 | 10.0 | 87.3 (2.5) | 67 s | 3,211 |
| `retail-14-apple-pre-open-timing` | 40.0 | 9.3 | 14.3 | 11.3 | 7.3 | 82.3 (2.9) | 67 s | 2,884 |

Every run completed. One Nike moat-erosion run scored 8: the model read the `stock-brief` skill,
followed its rule to ask for a missing ticker, and replied "What ticker should I use for
Nike—$NKE (NYSE)?" instead of answering, which widens that task's σ to 34.2. In a separate
diagnostic of that task, not part of this baseline, it asked about the ticker in 2 of 10 runs.

## GPT-5.6 Luna avg@3

[`2026-10-01-openai-codex-gpt-5-6-luna-openai-codex-gpt-6-astra.json`](2026-10-01-openai-codex-gpt-5-6-luna-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-5.6-luna`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `196afb7`
- **Scores:** checks 35.0 · judge 40.8 · total 75.8 · mean per-task σ 3.63
- **Diagnostics:** tool argument errors 0 · fallback reports 1 · unverified report figures 100 ·
  repaired 1
- **Cost:** $0.27 per run · per million tokens: input $0.20, cache read $0.02, cache write
  $0.25, output $1.20 · OpenAI API standard tier, 2026-10-01

| Task | Checks | Intent | Financial | Grounding | Clarity | Total (σ) | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 32.3 | 11.7 | 11.7 | 11.7 | 7.3 | 74.7 (6.3) | 123 s | 4,859 |
| `retail-02-nike-moat-erosion` | 34.0 | 13.0 | 10.3 | 9.7 | 7.7 | 74.7 (3.1) | 96 s | 4,451 |
| `retail-03-nuclear-thematic-purity` | 37.3 | 11.7 | 11.0 | 12.7 | 6.7 | 79.3 (2.6) | 83 s | 3,764 |
| `retail-04-dividend-yield-trap` | 36.3 | 13.7 | 8.3 | 8.7 | 6.0 | 73.0 (5.7) | 97 s | 3,875 |
| `retail-05-intel-value-trap` | 35.7 | 11.3 | 10.7 | 12.0 | 8.3 | 78.0 (2.4) | 115 s | 5,103 |
| `retail-06-mstr-proxy-leverage` | 38.0 | 12.0 | 13.0 | 9.7 | 7.0 | 79.7 (2.4) | 100 s | 4,057 |
| `retail-09-narrative-factcheck-apple` | 30.3 | 10.3 | 11.7 | 9.0 | 7.3 | 68.7 (4.0) | 195 s | 3,203 |
| `retail-10-smci-accounting-red-flag` | 24.7 | 11.3 | 12.7 | 7.7 | 7.3 | 63.7 (2.1) | 96 s | 4,457 |
| `retail-11-nike-earnings-review-report` | 39.0 | 10.3 | 11.3 | 10.0 | 6.7 | 77.3 (5.4) | 232 s | 4,924 |
| `retail-12-concentration-profile-fit` | 32.7 | 10.7 | 15.7 | 8.3 | 6.7 | 74.0 (5.7) | 68 s | 2,837 |
| `retail-13-semis-figure-survival` | 40.0 | 13.3 | 18.0 | 9.7 | 10.0 | 91.0 (0.8) | 68 s | 3,086 |
| `retail-14-apple-pre-open-timing` | 40.0 | 7.3 | 12.7 | 8.7 | 7.3 | 76.0 (2.9) | 94 s | 4,357 |

Every run completed.

## GPT-6 Luna avg@3

[`2026-10-02-openai-codex-gpt-6-luna-openai-codex-gpt-6-astra.json`](2026-10-02-openai-codex-gpt-6-luna-openai-codex-gpt-6-astra.json)

- **Agent:** `openai-codex/gpt-6-luna`, thinking medium
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `196afb7`
- **Scores:** checks 30.7 · judge 39.0 · total 69.7 · mean per-task σ 3.96
- **Diagnostics:** tool argument errors 1 · unverified report figures 36 · repaired 2
- **Cost:** $0.07 per run · per million tokens: input $0.10, cache read $0.01, cache write
  $0.125, output $0.50 · OpenAI API standard tier, 2026-10-01

| Task | Checks | Intent | Financial | Grounding | Clarity | Total (σ) | Run time | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `retail-01-nvda-beat-and-drop` | 26.7 | 10.3 | 10.0 | 11.3 | 7.7 | 66.0 (2.4) | 48 s | 1,473 |
| `retail-02-nike-moat-erosion` | 32.0 | 12.0 | 8.7 | 7.0 | 6.7 | 66.3 (8.1) | 51 s | 2,132 |
| `retail-03-nuclear-thematic-purity` | 36.0 | 10.3 | 9.0 | 12.3 | 6.0 | 73.7 (4.9) | 50 s | 1,929 |
| `retail-04-dividend-yield-trap` | 24.7 | 13.3 | 7.3 | 8.0 | 6.0 | 59.3 (1.7) | 49 s | 1,861 |
| `retail-05-intel-value-trap` | 22.7 | 10.0 | 7.0 | 7.3 | 7.7 | 54.7 (4.8) | 49 s | 1,324 |
| `retail-06-mstr-proxy-leverage` | 27.0 | 11.7 | 12.0 | 9.7 | 7.0 | 67.3 (1.7) | 44 s | 1,716 |
| `retail-09-narrative-factcheck-apple` | 28.0 | 11.7 | 11.7 | 9.3 | 8.7 | 69.3 (3.4) | 44 s | 1,707 |
| `retail-10-smci-accounting-red-flag` | 24.7 | 13.0 | 13.3 | 8.0 | 7.7 | 66.7 (4.6) | 39 s | 1,603 |
| `retail-11-nike-earnings-review-report` | 40.0 | 11.3 | 12.7 | 10.3 | 8.7 | 83.0 (5.0) | 81 s | 2,632 |
| `retail-12-concentration-profile-fit` | 33.0 | 11.3 | 17.7 | 10.0 | 8.7 | 80.7 (0.9) | 36 s | 1,532 |
| `retail-13-semis-figure-survival` | 35.0 | 12.7 | 10.0 | 10.7 | 9.3 | 77.7 (8.7) | 37 s | 1,551 |
| `retail-14-apple-pre-open-timing` | 39.0 | 9.3 | 6.7 | 10.0 | 6.7 | 71.7 (1.2) | 25 s | 807 |

Every run completed. This run replaced an earlier GPT-6 Luna baseline (total 67.6, commit
`345e380`) whose full run file was not kept; this one was run at the same commit as the GPT-5.6
rows.

## Qwen 3.8 27B avg@3, medium

[`2026-10-01-openrouter-qwen-qwen3-8-27b-medium-openai-codex-gpt-6-astra.json`](2026-10-01-openrouter-qwen-qwen3-8-27b-medium-openai-codex-gpt-6-astra.json)

- **Agent:** `openrouter/qwen/qwen3.8-27b`, thinking medium, every request served by DekaLLM through
  OpenRouter
- **Judge:** `openai-codex/gpt-6-astra`, thinking medium
- **Commit:** `809619e`
- **Scores:** checks 35.2 · judge 30.2 · total 65.4 · mean per-task σ 3.87
- **Diagnostics:** tool argument errors 9 · unverified report figures 300 · repaired 18
- **Cost:** $0.84 per run · per million tokens: input $0.049, cache read $0.020, output $3.00 ·
  DekaLLM on OpenRouter, 2026-10-01

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
- **Cost:** $0.44 per run · per million tokens: input $0.049, cache read $0.020, output $3.00 ·
  DekaLLM on OpenRouter, 2026-10-01

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
but scores 12–14 from the judge. In a separate diagnostic of the NVIDIA and Nike-report tasks,
five runs each and not part of this baseline, the tool-call markup failure did not recur; one NVIDIA
run scored 15 after it skipped research and misread when the earnings were released.
