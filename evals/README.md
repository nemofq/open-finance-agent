# Benchmark

**A good eval does more than rank.** It separates a better model or harness from a worse one, and it
says clearly what to fix. The benchmark in `evals/` is built for both jobs, measured the way a user
would experience the answers: does a change to the prompt, the rules, the tools or the model make
them better or worse? This page is why it is built the way it is, how to run it, what it scores, and
how the dataset behind it is maintained.

**Separating better from worse** needs every run to see the same world. Twelve historical 2024 tasks
run against a hermetic offline dataset (`evals/dataset/db.json.gz`), so no financial-data provider
is called and the data cannot change between runs. Runs are compared only with the
same settings. Eval v2 compares matched task/repeat cells with paired bootstrap confidence intervals
instead of applying one task's standard deviation as a universal noise threshold
([comparing runs](#comparing-runs)).

**Saying what to fix** needs more than a number. Every deterministic check notes what was missed,
the judge writes feedback for each of its four dimensions, and each result carries diagnostics (tool
argument errors, fallback and unverified report figures) and an offline audit of the requests the
dataset refused and why ([scoring](#scoring)).

The agent and judge models are called, so a run needs whatever network their endpoints do, and it
costs what they charge. It is a developer tool with no UI. `pnpm test` runs the harness's own unit
tests, never the benchmark.

## Principles

- **Measure the product path.** A task runs through the same `runTurn` as a chat, with a fixed
  `TimeContext` from the task's as-of date.
- **Closed world, point in time.** Only what was knowable at the task's cutoff is served
  ([the offline dataset](#the-offline-dataset)).
- **The tool contract is the production one.** The model sees the production tool names and the
  providers' own response shapes, and local tools run their real code.
- **Semantic quality first.** Sixty points come from item-level semantic grading; forty integrity
  points verify source use, figure support and task-specific delivery contracts ([scoring](#scoring)).
- **The chat's own budget.** A turn runs under the same model-call limit and turn deadline as a
  chat, so a score reflects what a user of that endpoint would get
  ([turn limits](#the-offline-dataset)).
- **Invalid beats wrong.** A dataset integrity failure or a failed judgement makes a result invalid
  and unscored, never silently zero ([result status](#result-status)).

## Quick start

```bash
# The whole suite: every task once, against the offline dataset
pnpm eval --agent <provider/model> --judge <provider/model>

# One task, or three repeats of each task to measure noise
pnpm eval --agent <provider/model> --judge <provider/model> --task retail-01-nvda-beat-and-drop
pnpm eval --agent <provider/model> --judge <provider/model> --repeat 3

# Rescore a trace-bearing v1 run, or compare a v2 candidate to a v2 baseline
pnpm eval --rescore evals/results/run-old.json --judge-repeat 3
pnpm eval --agent <provider/model> --judge <provider/model> --repeat 3 --judge-repeat 3 \
  --compare evals/baselines/<v2-baseline>.json

# The tasks, and the models the configured providers offer
npx tsx evals/cli.ts --list
npx tsx evals/cli.ts --list-models
```

A model spec is `provider/model`, where the provider is the id of one configured in Settings.
Provider ids never contain a slash, so everything after the first one is the model:
`local/Qwen/Qwen3-32B` is the model `Qwen/Qwen3-32B` on the provider `local`. When the judge is also
one of the agents, the run is marked **self-judged** and cannot become a baseline.

Results go to `evals/results/` (gitignored): the full run as JSON and a readable Markdown summary.
The exit code is non-zero for harness errors, for an offline run with an invalid result and for a
record run whose capture failed, never for a low score.

## Options

| Option | Description |
| :--- | :--- |
| `--agent <spec[,spec…]>` | Agent model(s) to evaluate; several agents share one judge. |
| `--judge <spec>` | Judge model. |
| `--task <id[,id…]>` | Run only these tasks; repeatable. |
| `--repeat <n>` | Run each task n times (default 1). |
| `--judge-repeat <n>` | Independent item-level judge votes per answer (default 1; a baseline requires 3). |
| `--fixtures <mode>` | `offline` (default), `live` or `record`; see below. |
| `--thinking <level>` | The agent's level, one of pi-ai's: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max` (default: the config's setting). pi-ai clamps it to the nearest level each model accepts; the summary's `Sent` says what went out. |
| `--judge-thinking <level>` | The judge's level, from the same seven, sent on the grading and format-repair requests (default: none sent, as before the flag, so runs stay comparable; `off` sends none either). Recorded as `judgeThinking` and checked on `--resume`; `--judge-only` reuses the run's own. |
| `--observe` | Run the policy rules in observe mode: verdicts are recorded, nothing is blocked. |
| `--baseline <name>` | Also write the run's summary to `evals/baselines/<name>.json`; see [Comparing runs](#comparing-runs) for when it is refused and how to name it. |
| `--checkpoint <path>` | Checkpoint written after every task cell. An offline run writes `offline-eval-checkpoint.json` in the `--out` folder unless told otherwise. |
| `--resume <path>` | Skip the cells a checkpoint of the same run already holds; a cell saved with a harness or judge error runs again. |
| `--judge-only <path>` | Finish a saved run JSON: judge the results whose judgement is missing or failed, with the run's own judge and judge thinking, so `--judge` and `--judge-thinking` are refused beside it. A run written before results recorded their diagnostics is refused. Takes `--baseline`. |
| `--rescore <path>` | Recompute v2 integrity and semantic scores from a saved run's full traces, write a new file and leave the original untouched. Trace-stripped baselines cannot be rescored. |
| `--compare <baseline>` | Compare the completed or rescored run with a same-version baseline using matched task/repeat pairs and regression gates. |
| `--out <dir>` | Where results go (default `evals/results/`). |
| `--config <path>` | The `config.json` to copy into the run (default: your data folder's). |
| `--keep` | Keep the run's temporary data folder for inspection. |
| `--list`, `--list-models`, `--help` | List the tasks or the configured models, or show the options. |

### Data modes

- **`offline`** (the default) serves the committed dataset. It is the only mode whose scores count.
- **`live`** runs the tasks against the real data providers, for debugging a tool. The run is
  judged, but its summary is marked invalid and it cannot be compared or promoted.
- **`record`** is the maintainer's capture step for the dataset; see
  [Maintaining the dataset](#maintaining-the-dataset).

### Isolation

Every run works in a throwaway data folder (`OFA_HOME=ofa-eval-*` in the system temp folder), and
every task cell in a fresh folder of its own inside it. Only `config.json` is copied in, so profile
data, holdings, chats, evidence and memory never leak between tasks. The one file the run uses in
place is the `auth.json` beside that config, which holds the tokens of providers you sign in to: a
token the run refreshes is written back there, behind the same lock the app takes, so a provider
that rotates refresh tokens keeps your app signed in. Nothing else is written to your own data
folder. `--keep` leaves the folders for inspection.

## The tasks

| Task ID | As of | Scenario | What it tests |
| :--- | :--- | :--- | :--- |
| `retail-01-nvda-beat-and-drop` | 2024-08-29 | NVIDIA Q2 FY25 earnings beat and stock drop | Can it tell a reported quarterly beat from forward margin compression and the market's reaction? |
| `retail-02-nike-moat-erosion` | 2024-07-05 | Nike moat erosion against competitors | Can it analyse competition from Hoka (Deckers) and On Holding without reading one quarter as structural decline? |
| `retail-03-nuclear-thematic-purity` | 2024-09-23 | Nuclear power theme purity | Can it separate producers with signed hyperscaler PPAs (Constellation, Vistra, Talen) from uranium miners and pre-revenue SMR start-ups? |
| `retail-04-dividend-yield-trap` | 2024-06-15 | YieldMax covered-call ETFs (TSLY/MSTY) | Can it explain synthetic option yield, return of capital (ROC) and NAV erosion, rather than take the nominal yield at face value? |
| `retail-05-intel-value-trap` | 2024-08-05 | Intel dividend cut and foundry losses | Does it weigh multi-billion foundry capex burn and restructuring against low headline valuation multiples? |
| `retail-06-mstr-proxy-leverage` | 2024-11-25 | MicroStrategy bitcoin proxy leverage | Can it analyse the bitcoin on the balance sheet, the terms of the zero-coupon convertible debt and the equity's premium to NAV? |
| `retail-09-narrative-factcheck-apple` | 2024-08-06 | Apple narrative fact-check | Does it keep to the filings public at the time and separate Berkshire's 13F sales from speculative narratives? |
| `retail-10-smci-accounting-red-flag` | 2024-10-31 | Super Micro auditor resignation (EY) | Does it quote the Item 4.01 8-K disclosure directly and weigh the governance and listing-compliance risk? |
| `retail-11-nike-earnings-review-report` | 2024-06-28 | Nike earnings review report | Can it deliver a structured earnings review report, with citations and formatted financial sections? |
| `retail-12-concentration-profile-fit` | 2024-09-20 | Portfolio concentration against the profile | Does it read the seeded holdings, spot single-stock concentration and flag speculative products the profile does not allow? |
| `retail-13-semis-figure-survival` | 2024-11-22 | Multi-turn semiconductor comparison | Does it keep its figures across turns while comparing eight quarters of revenue, margins and EPS for NVDA, AMD and INTC? |
| `retail-14-apple-pre-open-timing` | 2024-10-31 08:15 ET | Apple pre-market timing boundary | Does it respect the 08:15 ET session boundary, using the prior close and treating earnings not yet released as unavailable? |

There is no `retail-07` or `retail-08`: the remaining tasks kept their ids when those two left the
suite. `retail-07`, an anonymised biotech catalyst task, was deleted because its prompt did not
identify the company and its inputs rested on loosely sourced estimates; `retail-08`, a rate-cut
reinvestment task, was deferred when the offline dataset's scope was set to these twelve, and its
definition was later removed with the other deferred tasks.

Known gaps in the captured corpus (the v2 scoring issue records the required recapture):

- `retail-09`: Berkshire's Q2 2024 10-Q (filed 3 August 2024) is not captured; the dataset provides
  the 13F filings for Q3 2023 to Q1 2024, amendments included.
- `retail-06`: the text of MicroStrategy's 8-K filed 18 November 2024 is not captured, only its
  index entry; the dataset provides the text of the 8-Ks filed 20 and 25 November 2024, and the Q3
  10-Q.
- `retail-11`: Nike's FY25 guidance was given on the earnings call; the dataset provides the
  27 June 2024 8-K Ex. 99.1 release.

## The offline dataset

- **Served over MCP**: SEC EDGAR filings, XBRL financial facts, historical market bars, Alpha
  Vantage fundamentals and captured web documents, under the production tool names (`edgar_*`,
  `market_quotes`, `alphavantage__*`, `web_search`, `web_fetch`).
- **Point in time**: every table is filtered by the task's cutoff date (and, for `retail-14`, its
  intraday time), so peers can be compared without seeing the future. A request the dataset cannot
  answer gets the provider's own empty shape, and the offline audit records why: not captured, out
  of scope, or dated after the cutoff.
- **Local tools stay live**: the Python calculator, `create_report`, `evidence_get` and
  `portfolio_get` run their production code; tools that write local state are skipped.
- **Turn limits**: each turn runs under the agent loop's own
  [execution budget](../docs/architecture.md#the-execution-budget), model calls and turn deadline
  included, exactly as in a chat. The runner only adds a backstop: a turn still running 20 minutes
  after it started has ignored its own deadline and is aborted. Transient provider failures are
  retried with exponential backoff up to 6 times.
- **Integrity**: a run first checks every selected task against
  `evals/dataset/coverage-contract.json`; a dataset integrity error during a task makes that result
  invalid rather than scoring it.

## Scoring

Every successfully completed task is scored out of 100: 40 deterministic integrity points and 60
semantic points. Figure checks count only non-exempt prices, amounts, margins, growth rates and the
like. Years, dates, fiscal labels, tickers, SEC item numbers, ordinals and small counts are exempt
([architecture › Evidence](../docs/architecture.md#evidence)).

### Deterministic integrity (40 points)

1. **Required source/fact acquisition and use (12)**: a requirement earns half credit when the
   source or fact is acquired and full credit only when the answer or delivered report uses it via
   a supported figure, a source excerpt, or a calculation whose inputs lead back to the entry. A
   bare evidence tag or URL earns nothing. Acquisition is an integrity signal, not a proxy for a
   correct conclusion; the semantic rubric grades the interpretation.
2. **Figure support precision (12)**: the exact supported-figure ratio, with no rounding to full
   credit. A harness-repaired citation remains a repair diagnostic and receives no model credit.
3. **Task-specific contracts (16)**: each task declares exact obligations. Calculation contracts require a
   visible calculator result that matches an independently recomputed target within a stated
   tolerance, with the specified source periods, subjects and input IDs in its lineage. Other
   contracts require reading and explicitly citing named primary sources, preserving exact
   cross-turn facts and evidence, a quote from the required date, no look-ahead, or agent-created
   report delivery. Citation is traceability, not a claim that the source was interpreted correctly;
   the semantic judge handles that. A generic tool call,
   unrelated calculation, or fallback report earns no contract points. Where the offline corpus
   cannot pin a trustworthy numeric target, the contract tests a specific evidence or delivery
   obligation instead. Entity discovery and raw calculator use remain diagnostic only.

### Semantic quality (60 points)

The judge returns `met`, `partial`, `missed` or `contradicted` for every weighted rubric item, with
answer excerpts, evidence ids and a reason. Code—not the judge—maps those verdicts to
`1 / 0.5 / 0 / 0` and calculates the score:

- **Intent / critical outcome (15)**: whether the answer addresses the investor's real question.
- **Financial reasoning (20)**: accounting correctness, context and balance.
- **Grounding and evidence interpretation (15)**: fidelity to the retrieved evidence; unsupported
  or post-cutoff claims are penalised.
- **Clarity and guardrails (10)**: structure, disclaimers and no unhedged personal advice.

Critical zero-weight gates prevent a polished but materially wrong answer from hiding inside a
dimension average: a missed critical item caps the combined score at 69; an explicit contradiction
caps it at 49. The judge never sees the deterministic score. Its packet contains the complete
visible answer and report prose, relevant evidence excerpts, policy checks, time boundary and data
gaps instead of a dump of every tool output.

With `--judge-repeat 3`, each item uses repeated votes and a median aggregation. A baseline still
requires three task repeats and three judge votes per answer; there is no anchor-calibration gate.

### Result status

`completed` results, and `agent_budget` results that still answered, are judged and scored. An
`agent_timeout`, an `agent_error`, or a budget stop without an answer scores 0. Infrastructure,
harness and judge errors are marked invalid and left unscored, never zeroed; `--judge-only` can
finish a run whose judge failed. Latency, cost and tool/model calls remain diagnostics.

Every model summary reports three separate outcomes: `completionRate`, `qualityOnCompleted` and
`expectedUserScore`. The last is the task-macro average with model failures scored as zero and is
the primary ranking metric; timeout/error cells are excluded from conditional quality.

## Comparing runs

The committed baselines are benchmark v2, judge prompt v9 with three grades per answer. A v1 run
file stays readable, but v2 refuses to compare it directly: rescore a trace-bearing v1 run first.
Committed baselines omit traces and therefore cannot be rescored. `--compare` requires the same benchmark and judge-prompt
versions, task order and repeat count, then reports paired expected-score delta, a one-sided 95% bootstrap lower bound,
win/tie/loss, completion delta, critical-contradiction delta and per-task regressions.

Default regression gates are: completion no worse than -5 percentage points; expected-score lower
95% bound at least -2; no new critical contradiction in at least 2/3 repeats of any task; and no
single-task mean decline greater than 8 points. Latency, cost and call counts stay separate.

A run worth keeping can be promoted to a baseline:

```bash
pnpm eval --agent <provider/model> --judge <provider/model> \
  --repeat 3 --judge-repeat 3 --baseline <name>
```

It writes the summary without traces (scores, feedback, metrics, task hashes, commit) to
`evals/baselines/<name>.json`, creating the folder. Promotion is refused for a self-judged run,
fewer than three task repeats, fewer than three judge votes, a non-offline
run or any invalid result.

Name it `<date>-<agent>-<judge>`, each model spec lowercased with every run of other characters
replaced by a dash; the CLI suggests the name after an eligible run. For agent
`local/Qwen/Qwen3-32B` and judge `openrouter/openai/gpt-5`:

```
2026-09-24-local-qwen-qwen3-32b-openrouter-openai-gpt-5.json
```

### Reproducing the README table

**The [README](../README.md#a-benchmark-that-favours-quality-over-quantity) table is the
published reference**, so every row must state the settings it was run with: agent, judge,
thinking level, judge thinking when set, policy mode, repeats and benchmark version.
The summary's header prints all of them (`Thinking`, `Judge thinking`, `Policy`,
`Tasks: <n> × <repeats>`, `Benchmark version`), and the run JSON holds them as `thinking`,
`judgeThinking`, `policyMode`, `repeat` and `benchmarkVersion`. The Model column names the agent
followed by `avg@<repeats>`, Thinking effort is the agent's thinking level, and Judge model names
the judge followed by its thinking level when one was set; policy mode and benchmark version go in
the note under the table. Each row is one run, promoted with `--baseline`, and also gets a section
in [evals/baselines/README.md](baselines/README.md) with its per-task scores, taken from the
baseline's `results`:

```bash
pnpm eval --agent <provider/model> --judge <provider/model> --thinking <level> \
  --judge-thinking <level> --repeat 3 --judge-repeat 3
```

Each column comes from the agent's entry in `agentSummaries` of the run or baseline JSON:

| README column | Run JSON |
| :--- | :--- |
| Total (/100) | `expectedUserScore` |
| Integrity (/40) | `averageIntegrityScore` |
| Judged (/60) | `averageSemanticScore` |
| Completed | `completionRate` |
| Avg. cost per run | each of `results[].metrics.tokens` at the provider's list prices, summed, ÷ repeats; see below |
| Avg. run time | `metrics.latencyMs` × tasks; the summary's `Mean latency` row × tasks |
| Avg. output tokens per run | `metrics.tokens.output` ÷ repeats |
| Avg. tool calls per run | the length of each `results[].toolCalls`, summed, ÷ repeats (run JSON only) |

Expected user score includes valid model failures as zero, while Integrity and Judged average the
completed answers only (`qualityOnCompleted` is their combined total); invalid infrastructure,
harness and judge results are left out. Runtime, output tokens
and tool calls are totals for one run
of the task set, averaged over the repeats. `Mean latency` is the mean wall-clock time of one
task's turn, measured before the judge runs, so judging is not included; times the number of tasks,
it is the run time. Output tokens are summed over every task and repeat, so divide by the repeats.

Tool calls have no total in the summary: each result's line in the detailed results reads
`Tools (<n>)`, and the CLI's progress line prints `<n> tool calls` per result. Count them from the
run JSON, not a baseline, which drops `toolCalls` with the other traces. The `Model calls` row
counts model requests, not tool calls.

Cost is the agent's alone: every row shares a judge, so its cost would only add the same amount to
each. For each result, uncached input (`tokens.input`), cache reads (`tokens.cacheRead`), cache
writes (`tokens.cacheWrite`) and output (`tokens.output`) are each priced at the provider's list
price per million tokens; the results are summed and divided by the repeats. A baseline keeps
`metrics.tokens` for every result, so its cost can be worked out from the baseline alone. Use the
provider's published list price on the day the row is added, even when the run went through a
subscription, and record the four prices, their source and the date in the row's section of
[evals/baselines/README.md](baselines/README.md). The summary's `Cost` row is not used: it prices
every token at the one rate the app's model catalog holds, which is not what a provider pinned to
one host, or a provider with peak and off-peak rates, charges. Output tokens are what the provider
reports, so a provider that reports little of its reasoning also shows a low cost.

The quality-against-cost chart above the table (`docs/images/benchmark-quality-cost-light.svg` and
`-dark.svg`) plots each row's Total against its average cost per run, with a bar spanning its runs'
totals, so it is redrawn with every row added.

### Calibrating a policy rule

1. Measure noise: run with `--repeat 3 --judge-repeat 3`.
2. Observe: run with `--observe` to record what the rules would do without letting them act. The
   runner always passes its own policy mode, so the app's `OFA_POLICY_OBSERVE` variable has no
   effect on a benchmark run.
3. Compare the observed interventions with the judge's grounding scores, and tune the rule.
4. Enforce: run again without `--observe`, with the same settings, and compare.

## Troubleshooting

Each run writes `run-<timestamp>.json` (the full run) and `summary-<timestamp>.md` (per-task
scores, deterministic notes and judge feedback) to `evals/results/`; `--keep` also keeps the run's
data folder.

- **`judge_error`**: judge the missing results again from the saved agent traces, with the run's
  own judge: `pnpm eval --judge-only evals/results/run-<timestamp>.json`.
- **`agent_budget`**: the turn reached its model-call limit, or its research rounds stopped finding
  anything new or kept failing. The tool traces in the run file show which.
- **`agent_timeout`**: the turn reached its deadline, usually a slow endpoint or long reasoning. A
  lower `--thinking` level can shorten each request.
- **`infra_error`**: the provider kept failing through its retries. The result is invalid and
  unscored.

## Maintaining the dataset

Adding or changing a task, and recompiling the dataset, is **maintainer-only**. The compiler needs
the maintainer's capture backup: one capture per task, holding third-party provider responses that
are not redistributed in this repository. To propose a task, open an issue with the prompt, its
as-of date, what a good answer must show, and the sources it needs.

For a maintainer, a new or changed task goes like this:

1. **Define it** in `evals/tasks.ts`: the prompt in a retail investor's voice, the as-of date (and
   time, if the market session matters), latent intent, expected entities, rubric and its `dataset`
   scope (peer tickers, search topics, and an `evals/source-materials/` folder for hand-captured
   sources). Add its cutoff and evidence requirements to `evals/dataset/coverage-contract.json`; a
   test holds the two files to the same cutoffs. A task that declares a `profile` also names its
   frozen prompt text in `profilePrompt`, a file in `evals/dataset/profiles/`; see
   [Harness seams](#harness-seams).
2. **Capture** its data from the live providers, which needs their keys configured:

   ```bash
   pnpm eval --agent <provider/model> --judge <provider/model> --task <id> --fixtures record
   ```

   Every provider response the agent's tools fetch is added to `evals/fixtures/<id>.json`
   (gitignored); recording again adds to a capture and never removes from it. The run is unscored
   and the judge is not called. A task with an as-of time runs at that instant without a
   point-in-time cutoff, so review its capture by hand.
3. **Compile** the dataset from the captures of all twelve tasks and the pinned source materials:

   ```bash
   npx tsx scripts/compile-offline-dataset.ts --source evals/fixtures
   ```

   It writes `evals/dataset/db.json.gz` and `evals/dataset/manifest.json`, then validates them
   against the coverage contract and exits non-zero if any requirement is not met.
4. **Check** it against at least two agent models, and bump `BENCHMARK_VERSION` in `evals/types.ts`
   when tasks or scoring change.

## Harness seams

`evals/` reaches into the agent runtime at three explicit seams:

- **`wrapTool`** and **`keepTool`** on `TurnInput`: the first routes each data tool to the offline
  dataset without changing what the model is told about it (`meta`, `label`, `parameters`), and
  the second leaves out a tool the offline dataset cannot serve.
- **`profileBlock`** on `TurnInput`: the investor profile text the system prompt carries, read from
  the task's `profilePrompt` file in `evals/dataset/profiles/` (its trailing newline dropped). The
  text is frozen, so a change to how the app renders a profile never changes what the task's model
  reads; the task's structured `profile` is still seeded, so P12 and the tools read it as before.
  Change the file only with a `BENCHMARK_VERSION` bump.
- **`sourceRequest`** in `src/lib/data/source-snapshot.ts` sits below the model-facing tools at
  provider I/O, so a provider request that still reaches it offline gets the provider's empty
  result, or an integrity error, never the network; in `record` mode it is where captures are
  taken.

## Code layout

The implementation is grouped by responsibility, with each `.test.ts` beside the code it tests:

| Folder | Responsibility |
| :--- | :--- |
| `harness/` | Run and task execution, temporary homes, checkpoints, turn limits, tool routing and capture. |
| `offline/` | Dataset loading and coverage validation, the mock MCP server and its provider handlers. |
| `scoring/` | Deterministic checks, the LLM judge, evidence analysis and delivered report content. |
| `reporting/` | Run artifacts, summaries, metrics, diagnostics and statistics. |

The CLI (`cli.ts`), task definitions (`tasks.ts`) and shared types and helpers stay at the root.
The `dataset/`, `source-materials/`, `baselines/` (created by the first `--baseline`) and ignored
`results/` and `fixtures/` folders hold data rather than implementation. `pnpm test` discovers the
harness tests in every subfolder; `pnpm eval` runs the benchmark.

### Key files

| Path | Purpose |
| :--- | :--- |
| `evals/cli.ts` | The command line: options, progress and the final table. |
| `evals/harness/runner.ts` | One run: every agent × task × repeat through `runTurn`, and each result's status. |
| `evals/harness/turn-bounds.ts` | The hung-turn backstop and the transient-retry allowance. |
| `evals/harness/tool-seam.ts` | Serves the offline dataset to the agent's tools (or leaves them live, or captures). |
| `evals/scoring/checks.ts` | The 40 deterministic integrity points. |
| `evals/scoring/judge.ts` | The judge prompt and parsing its grades. |
| `evals/tasks.ts` | The tasks, their rubrics and their dataset scope. |
| `evals/reporting/summary.ts`, `evals/reporting/report.ts` | Per-task and per-agent statistics; run files and baselines. |
| `evals/offline/mock-mcp*.ts` | The in-process MCP server over the dataset, one handler module per provider. |
| `evals/dataset/` | The compiled dataset, its manifest and the coverage contract. |
| `evals/source-materials/` | Third-party source captures compiled into the offline dataset. See [`NOTICE.md`](source-materials/NOTICE.md) for provenance and terms. |
| `evals/harness/capture.ts`, `scripts/compile-offline-dataset.ts` | Maintainer-only: capture files and the compiler that reads them. |
| `evals/types.ts` | Shared types and `BENCHMARK_VERSION`. |
