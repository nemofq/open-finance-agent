# Architecture

This page is for anyone changing the harness, or wondering why the agent behaved as it did in a
turn. Everything here serves what the [README](../README.md) promises: trusted sources come first,
the model does no mental math, and every number traces back to its source.

## Core concepts

- **Evidence entry.** One recorded result with an id, of one kind: retrieved from a source (E),
  computed by the calculator (C), declared as an assumption (A) or given by the user (U). A report
  is an entry (R) over them.
- **Ledger.** A chat's evidence entries, rebuilt from its transcript every turn; the payloads
  behind them sit on disk beside the chat ([Evidence](#evidence)).
- **Source tier.** How far a source is trusted, from 1 (filings) to 4 (the open web and
  attachments) ([Evidence](#evidence)).
- **Figure.** A number in an answer or report that verification checks against the ledger. Years,
  dates, fiscal labels, ordinals, tickers, ids and small counts are exempt
  (`src/lib/evidence/figures.ts`).
- **Turn.** One user message and all the agent does to answer it, run by `runTurn` from the chat,
  a scheduled task or the benchmark, with a `TimeContext` (`src/lib/time/types.ts`) fixing its
  local time, zone, market state and optional as-of date.
- **Concern.** An object that owns one theme of a turn and implements some of its hook points
  ([The concern contract](#the-concern-contract)).
- **Delivery.** How a turn answers (chat, report or auto), the template it promised, and whether
  the report exists yet (`Delivery` in `src/lib/harness/delivery/resolve.ts`).
- **Observe mode.** Every rule records its verdict and none acts ([The rules](#the-rules)).

## Layers

```
Entry points      chat route (SSE, browser time zone) · scheduled runner · benchmark CLI (fixed as-of)
                                            │
Turn runtime      runTurn()  →  buildAgent()  →  compose(concerns)  →  pi Agent
                                            │
Concerns          execution · time · capabilities · user · attachments · conduct ·
                  evidence · delivery · policy · compaction · view · (telemetry, benchmark only)
                                            │
Engines           policy rules · context budgets and compaction · evidence ledger · report validator
                                            │
Capabilities      data connections: EDGAR, Alpha Vantage, Market Quotes, MCP (data)
                  financial tools:  financial_calculator, create_report
                  general tools:    web_search, web_fetch, memory_update, read_skill, evidence_get,
                                    portfolio_get, read_attachment,
                                    scheduled_task_*, MCP (general)
                                            │
Execution         Deno + Pyodide sandbox · document parsers in a worker · pi-ai Models
                                            │
State             one data folder of plain files: settings, sign-ins, chats, evidence, holdings
```

| Layer | Where |
| :--- | :--- |
| Entry points | `src/app/api/sessions/[id]/messages/route.ts`, `src/lib/scheduled/runner.ts`, `evals/cli.ts` |
| Turn runtime | `src/lib/agent/turn.ts`, `factory.ts`, `execution.ts` |
| Concerns | `src/lib/harness/`; `execution` is an inline object in `factory.ts` built from `src/lib/agent/execution.ts`, and so is the benchmark's `telemetry`, built from its tool seam |
| Engines | `src/lib/policy/`, `src/lib/context/`, `src/lib/evidence/`, `src/lib/reports/` |
| Capabilities | `src/lib/providers/<name>/module.ts` and `src/lib/<capability>/tool.ts`, listed in `src/lib/tools/registry.ts`; the MCP client and tool factory that the MCP servers module and Alpha Vantage share are in `src/lib/mcp/` |
| Execution | `src/lib/sandbox/` with `sandbox/`, `src/lib/attachments/parse/`, `src/lib/llm/` |
| State | `src/lib/paths.ts`, down to one chat's folder (`sessionDir`); the evidence folder inside it is laid out in `src/lib/evidence/store.ts`; the whole layout is in [usage › Data folder](usage.md#data-folder-and-privacy) |

## The concern contract

**Each file reads as an intent; the composition reads as the loop.** A concern is an object that
names itself and implements any subset of the hook points below. `compose()` in
`src/lib/harness/concern.ts` runs the concerns in the order `factory.ts` lists them and is the only
harness file that imports pi's wiring types, which `src/architecture/architecture.test.ts`
enforces along with the [import rules in CONTRIBUTING.md](../CONTRIBUTING.md#code-style).

| Hook | When | What a concern may do |
| :--- | :--- | :--- |
| `promptSection` | when the agent is built | Contribute a section of the system prompt |
| `beforeTurn` | before the model's first call | Decide once, write the decision on `TurnState`, rewrite the message list |
| `turnNote` | every model request | Add a line to the per-turn note: the exact time, market state, pending delivery |
| `transformContext` | every model request | Reshape the messages the model sees (stub old results, apply compaction) |
| `toLlm` | last step before the provider | Hydrate attachments into the provider-shaped messages |
| `tools` | every model request | Filter the tools offered this request |
| `prepareNextTurn` | between model requests | Replace the context before the next request; the first concern that has it owns it (compaction) |
| `wrapTool` | at build | Wrap a tool (argument synonyms, the call-failure guard, the benchmark's seam) |
| `toolIssued` | each call the model issues | Count an attempt before any check |
| `beforeTool` | before a tool runs | Return a block with a reason |
| `afterTool` | after a tool runs | Rewrite the result: register it, tag it, annotate it, shrink it |
| `toolResult` | after a tool runs | Observe the final result |
| `beforeRunEnd` | the model wants to stop | Return a follow-up (the model revises) or a flag (recorded) |
| `afterRun` | the run ended | Recover: compaction retries after a context overflow. When no concern recovers, `execution.recovery` (passed in by `turn.ts`) asks once for the answer after a cut-off |
| `afterTurn` | the turn is over | Add a deterministic artifact, such as a report rendered from the answer |

Three rules keep it small:

- **Decide once.** Compute decisions in `beforeTurn`, store them on `TurnState`, and only read
  them thereafter.
- **Shortest time scale.** What holds for the whole chat goes in the prompt, what holds for the
  turn in the note, and what belongs to one result in `afterTool`.
- **One owner per field.** Each `TurnState` field is annotated with its owner, a concern or
  `compose`; only the owner writes it, and it may advance its own field later, as delivery moves
  `turn.delivery` from pending to created.

`compose()` builds every provider request itself (`requestContext`), from the composed prompt, the
turn note, the tools the concerns offer and the chat. pi keeps a system message of its own, the
prompt and the tool declarations, in the transcript; nothing in the harness reads it, and it never
reaches a saved chat, the browser or the model's view of the chat. `transformContext` sees the chat
without it, but `beforeTurn`, `prepareNextTurn`, `afterRun` and `afterTurn` get the transcript with
it at index 0, so a concern never places or cuts messages by absolute position: it splits the head
off with `splitSystemHead` (`src/lib/agent/messages.ts`) and puts it back in front, as
`compaction.ts` does.

### The concerns

In compose order, which is the order every hook runs them in. The files are in `src/lib/harness/`
unless noted.

| Concern | Intent | Hooks |
| :--- | :--- | :--- |
| `execution` | One budget around the model's requests: stop research that has run out of time, calls or progress, and a tool that keeps failing (inline in `factory.ts`, from `src/lib/agent/execution.ts`) | `wrapTool`, `beforeTool`, `toolResult` |
| `time` | Every request knows the date, the time and the US market's state, and uses only what was published by then | `turnNote` |
| `capabilities` | Tell the model which connections, tools, tiers and skills it has, in one argument vocabulary | `promptSection`, `wrapTool` |
| `user` | Bring in the investor profile and memory, and note a request the profile does not fit (P12) | `promptSection`, `beforeTurn`, `turnNote` |
| `attachments` | Register a message's documents as evidence, and put their content back on the way to the model | `beforeTurn`, `toLlm` |
| `conduct` | Who the agent is and how it works: research not advice, citation style, method; prompt text only | `promptSection` |
| `evidence` | Every tool result and user figure becomes a ledger entry with a tag the model can cite | `beforeTurn`, `turnNote`, `afterTool` |
| `delivery` | The turn answers the way it promised, in chat or as a report, and a missing report is rendered from the answer | `promptSection`, `beforeTurn`, `transformContext`, `turnNote`, `tools`, `beforeTool`, `toolResult`, `beforeRunEnd`, `afterTurn` |
| `policy` | Run [the rules](#the-rules) at their stages and record every verdict | `beforeTurn`, `toolIssued`, `beforeTool`, `afterTool`, `beforeRunEnd` |
| `compaction` | Keep a long chat inside the window with a checkpoint whose figures the ledger holds | `beforeTurn`, `transformContext`, `prepareNextTurn`, `afterRun` |
| `view` | Show the model a bounded view of each result, and stub old ones to their evidence ids | `transformContext`, `afterTool` |
| `telemetry` | Benchmark only: the tool seam that serves data tools from the offline dataset or captures live responses for it (inline in `factory.ts`) | `wrapTool` |

## Life of a turn

1. **A caller starts it.** The chat route, the scheduled runner or the benchmark resolves the
   turn's time, builds a `TurnInput` and calls `runTurn` (both types in
   `src/lib/agent/turn-types.ts`). Skill expansion, persistence and the title live in the turn
   runtime, not the caller.
2. **The agent is built.** `buildAgent` resolves the model, rebuilds the ledger from the
   transcript, collects the enabled tools and composes the concerns into one system prompt and
   pi's hooks.
3. **The turn decides once.** The user's figures and attachments become U entries, delivery
   chooses chat, report or auto, the profile is checked against the request, and a chat already
   past its compaction threshold is compacted.
4. **The model researches.** Each request sees a context the concerns shaped and a note on the
   turn. Each tool call passes the budget and the rules on the way in, and is registered, tagged,
   annotated and shrunk on the way out. When the window fills between requests, compaction steps
   in.
5. **The model wants to stop.** Its answer goes past delivery and the stop rules, which may send it
   back to revise within a follow-up budget of three shared by all of them, or record a flag.
6. **The run ends.** A context overflow is recovered by compaction, and research cut off early
   gets one request without tools to answer from what it has. Then placeholders in the answer are
   resolved, and an analysis that should have been a report is rendered as one.
7. **Nothing is lost.** The transcript is written after every message and the ledger is flushed at
   the end; `done` is sent only once the last write has landed.

**Streaming.** Agent events map to a small wire protocol (`message_start`, `text_delta`,
`thinking_delta`, `tool_call_pending`, `tool_call_start`, `tool_call_end`, `message_end`, `usage`,
`check`, `context`, `title`, `answer_updated`, `done`, `error`) streamed over SSE. A revised answer
replaces the draft in place. A browser that re-attaches to a running turn through
`/api/sessions/[id]/stream` gets a `snapshot` of the transcript, then the events since.

**One run per chat.** A run registry keyed by chat lets `/api/sessions/[id]/abort` stop the agent
and rejects a second concurrent run on the same chat. The run belongs to the chat, not the tab.

## Every turn knows what time it is

A model's sense of "now" is its training data, and a finance question often turns on the date:
whether earnings are out yet, whether today's price is a close. So every turn resolves a
`TimeContext` locally, with no network call (`src/lib/time/`).

- **The local clock.** The date and time in the user's zone: the browser's for a chat (else the
  zone the chat last saw, then the server's, then UTC), the schedule's for a scheduled task.
- **The US market.** The session at that instant in New York: pre-market from 04:00, open
  09:30–16:00, after-hours to 20:00, closed otherwise, with 13:00 early closes. The NYSE and Nasdaq
  calendar is computed from rules, plus a table of unscheduled closures, so it knows holidays, the
  last completed session and the next open.

The `time` concern writes this into the turn note, not the prompt, so a chat continued the next day
knows. The note also tells the model to use only what was published by that cutoff, and before the
open, to tell pre-market moves from the last close and not to treat a period's results as public
until their release.

**The benchmark pins the date.** A fixed-mode turn has an as-of date, which stands after that
day's close. Data modules receive it as `ModuleContext.asOf` and those that declare `supportsAsOf`
answer as of that date; any entry published or dated after it is marked as look-ahead and its
values withheld ([P13](#the-rules)). On a live turn the cutoff is the turn's own date and instant.

## The execution budget

`src/lib/agent/execution.ts` puts one budget around the SDK's requests; the SDK still owns the
loop and transport retries. The defaults, typed as `ExecutionLimits` there:

| Limit | Default |
| :--- | ---: |
| Model requests per turn | 32 |
| Tool rounds since the last new evidence, when calls succeed | 6 |
| Tool rounds since the last new evidence, when every call fails | 10 |
| Failures in a row of one tool before it is blocked | 3 |
| One model request | 240 s, 360 s for a reasoning model |
| One turn, setup and compaction included | 720 s |
| Reserved for the final completion | 90 s, capped at a third of what remains |
| Output tokens per request | 24,576 researching, 12,288 repairing, 8,192 recovering, 4,096 finishing |

Progress means a new source, a new calculation or a reread whose content is new, such as a
distinct slice of retained evidence; failed calls, look-ahead entries and content already seen do
not count. When research stops early the model is asked once, without tools, to answer from what
it has and to name the gap. The output cap never exceeds the model's own maximum, and a reasoning
model gets half as much again when finishing or repairing, because its thinking counts against
the same cap.

## The rules

There is one policy and no strictness setting. Blocks are for what is cheap to prevent,
follow-ups for the failures that would mislead a reader, and everything else is a flag, so a
weaker model is never sent into a correction loop. Every rule is a pure function in
`src/lib/policy/rules/` from an event, the ledger and the chat's state to a verdict, tested on its
allow, block and flag paths without an agent. `rules/index.ts` lists them by stage in the order
they run; the profile-fit rule runs before the model, from the `user` concern.

| Stage | Rule | File | What happens |
| :--- | :--- | :--- | :--- |
| **Before the model:** note | P12 Profile mismatch | `profile-fit.ts` | A request naming instruments outside a non-empty allowed list, an excluded sector or theme, or instruments beyond a beginner's experience adds a note asking the answer to say so. It reads only the current message, by whole words and phrases |
| **Before a tool:** Block | P3 Personal data leaving | `private-data.ts` | A web search, web fetch or general MCP call whose arguments carry an account name of four or more characters, or a distinctive position size, cost basis or average cost (not a whole number, not a multiple of ten, or 10,000 or more), is blocked |
| | P2 Duplicate data call | `reuse-evidence.ts` | The same data call with the same arguments, still fresh, is blocked with a pointer to the existing entry for `evidence_get` |
| | P1 Trusted sources first | `trusted-sources.ts` | A web search, web fetch or general MCP call for something an enabled data connection covers is blocked, naming the connection. The block lifts once that connection was tried for the company, errored, returned nothing or does not cover the field, and is only an annotation once a covering tool was tried this turn |
| **After a tool:** Annotate | P4 Stale quote | `stale-quotes.ts` | A price older than the last completed session is annotated |
| | P5 Sources disagree | `source-conflicts.ts` | A conflicting figure is annotated on the result; the answer is flagged before stop if it never mentions the conflict |
| | P6 Undeclared calculator constants | `calculator-assumptions.ts` | A constant in no evidence entry and not declared with `assume()` is recorded; the calculator warns in its own result |
| | P13 Look-ahead evidence | `look-ahead.ts` | An entry dated after the turn's as-of date (today, on a live turn) is marked and its values are withheld from the result text; the benchmark counts it |
| **Before stop:** Follow up or flag | P8 Unsourced figures | `answer-grounding.ts` | A figure matching no evidence entry gets one follow-up, then becomes a flag |
| | P9 Unverified figures | `weak-sources.ts` | A figure whose every matching ledger entry is tier 4 (the open web, or an attachment) is flagged as unverified; nothing is rewritten |
| | P11 Recommendation wording | `recommendation-language.ts` | "You should buy" and its relatives are flagged on the answer; nothing is rewritten |
| **Before stop and after the turn:** delivery | `delivery` Answer delivery | `harness/delivery/` | An answer with unresolvable evidence placeholders, or an analysis that should have been a report, is sent back within the shared follow-up budget; a report still missing at the end is rendered from the answer |
| **In `create_report`:** refuse or qualify | Report validation | `reports/validate.ts` | A malformed or oversized spec is refused with the field named. A figure the ledger cannot confirm is listed under the report's Verification notes and returned to the model to qualify; a citation whose value another entry holds is repaired |

Rule ids are stable and never reused: P7, P10, P14 and P15 were retired, so the numbering has gaps.

`OFA_POLICY_OBSERVE=1` runs every rule in observe mode in the app: verdicts are recorded, nothing
acts. The benchmark sets the mode itself, so a rule is calibrated there with `--observe` before it
is allowed to block.

## Evidence

Every source has a tier: 1 filings and the issuer's own releases, 2 a licensed data vendor, 3
allowlisted financial press, 4 the open web and anything the user attached. A web page takes its
tier from its domain.

**A result is indexed by facts, not scraped.** A module that returns `StructuredDetails` gets exact
metric, period and value triples indexed, which is what lets two sources be cross-checked and what
the calculator loads as a frame. Providers describe their results completely when the tool runs
(summary, entity, dates, facts, table), so the evidence engine knows no provider: every result
goes through `src/lib/evidence/normalizers/generic.ts`, which takes what the tool attached and
extracts the numbers from the text of a result without facts. The web tools alone have their own
normalizer (`web.ts`), which tiers a page by its URL.

**An attachment is evidence at the lowest tier.** A worksheet becomes a `U` entry the calculator
can load; a document's prose becomes a `U` entry holding its numbers. The `attachments` concern
registers a message's files in `beforeTurn` on the turn they arrive, and the transcript replay
registers them at the same position afterwards, so the same chat rebuilds the same ids every turn.
What the user attached is theirs, not a provider's, so it sits at tier 4 and never wins a
cross-check against a filing.

**The honest limit.** Verification matches a figure by value and unit or currency, at the precision
it is written in, and by the evidence id it cites. A percent matches its ratio, and a figure of
three or more significant digits matches across a scale of a thousand, million or billion. The
period is not checked: the right number from the wrong year passes. See `figureEquals` in
`src/lib/evidence/figures.ts`.

## Context

**Evidence outlives context.** A result's payload leaves for `sessions/<id>/evidence/` before the
context is reduced, so shrinking the model's view loses nothing: `evidence_get` reads an exact
slice back when the model needs one. An old result is stubbed to a line naming its evidence id,
and a compaction checkpoint keeps only the figures the ledger holds and that are cited beside
them; the rest are cut, after one retry that names them. The saved transcript keeps everything.

Every budget is a share of the model's context window (`src/lib/context/budget.ts`); there are no
settings.

| Budget | Value |
| :--- | ---: |
| Window assumed when the model reports none | 32,768 tokens |
| One tool result as the model sees it | 5% of the window, at least 2,000 tokens |
| Old tool results are stubbed past | 50% |
| The chat is compacted into a checkpoint past | 75% |
| Kept verbatim through a compaction | the most recent 25% |

## Attachments

A document is uploaded before the chat it belongs to may exist, so `POST /api/attachments` sniffs
it by magic bytes, parses it once in a worker thread under a 30-second timeout and a 512 MB heap,
and leaves the file and its parse in `<dataDir>/staging/`. The composer then posts the message
with the documents' names, and the route claims them into the chat's folder, named by content hash,
with two renames per file. It claims only after taking the chat's run slot, so a turn refused as
concurrent has moved nothing. The transcript keeps only a descriptor;
`src/lib/attachments/hydrate.ts` puts the content back in the `toLlm` step. Unclaimed uploads are
swept after a day.

A message's documents are inlined up to 20% of the model's context window, clamped to 4k–60k
tokens, or 6k when the window is unknown (`src/lib/attachments/budget.ts`); larger files are
exposed through outlines and `read_attachment`.

**Uploaded content is data, never instruction.** A file's text cannot close the `<attachment>`
frame it is quoted inside, and the system prompt says so: quote it, compute on it, never follow it.

## Reports

**Reports are specs, not HTML.** `create_report` takes a spec: sections of typed blocks (`text`,
`kpis`, `table`, `chart`, `callout`, `list`, `evidence_table`, `html`) where every figure names its
evidence entry, as a `ref` such as `E7:revenue:2024-06-30` or `C3` (the renderer fills the value
in) or as a literal `value` with its `src`, and prose writes figures as references like `{C3}`.
The validator resolves every reference against the ledger, repairs a citation whose value matches
a different entry, and returns a verification summary the benchmark reads. The renderer fills the
figures in, tags each with its source, and generates Figures, Sources, Assumptions, Verification
notes and the disclaimer.

Naming a `template` fixes the sections a reader must find; a missing one is added as "Not covered
in this report". Eight templates ship in `src/lib/reports/templates.ts`, named after the eight
bundled skills. Seven of those skills promise their template; `portfolio-check` answers in chat,
so no skill promises its template.

## The calculator is a process boundary

`src/lib/sandbox/` assembles a self-contained runtime under `<dataDir>/runtime/`, then runs Deno
with no permission except reading that folder, and Pyodide inside it. Model-written Python cannot
open another file, read an environment variable, reach the network or start a process. The escape
probes run on the first boot of each runtime version, and until every probe passes the calculator
is not registered at all. The conformance suite runs on three operating systems in CI. Calculator
jobs, their results and the runtime manifest are typed in `src/lib/sandbox/protocol.ts`, shared
with `sandbox/host.ts`.

## LLM providers

`config.json` says which provider instances exist; `getModels(config)` turns that into one pi-ai
`Models` collection that every completion goes through, so pi owns login, token refresh, auth
headers and wire APIs. Each provider type is one row of `src/lib/llm/provider-types.ts`, from which
both the config schema and the Settings catalog are derived. Where credentials come from is ours:
a key, and any account ID, region or profile name the provider needs besides it, comes from
`config.json`; pi's own resolution turns them into the request but sees nothing of the environment.
Every request names pi's default prompt-cache retention and pins each switch pi would otherwise look
up in the environment to its neutral value (`requestSettings` in
`src/lib/llm/providers/pi-backed.ts`), and the variables that pi or an SDK it drives reads straight
from `process.env`, which add headers, move a request to another host or turn a Gemini request into
a Vertex one, are removed by `src/lib/llm/ambient-env.ts`, which names them: at startup, and again
whenever a request or sign-in takes a pi collection, since `next dev` restores the environment it
started with when a `.env` file or a route changes. What the environment can still change is what a
user chooses or pi cannot be kept from: the standard proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`,
`ALL_PROXY` and `NO_PROXY`, in either case); `PI_OAUTH_CALLBACK_HOST`, the address a sign-in's local
callback server listens on; for Bedrock, `AWS_PROFILE` and the AWS SDK's own configuration (the
`~/.aws` files of that profile or the default one, and the SDK's other `AWS_*` settings, such as
`AWS_USE_FIPS_ENDPOINT`), and an exported `AWS_BEARER_TOKEN_BEDROCK` or `AWS_SESSION_TOKEN`, which
pi's Bedrock API reads when the config holds none; for Vertex, a gcloud sign-in or service account
file on this machine, read by Google's auth library with its own variables, such as
`GOOGLE_CLOUD_QUOTA_PROJECT`. A sign-in token lives in `auth.json`, mode 0600, refreshed behind a
cross-process lock, and never reaches the browser. A login pi drives as one long promise is
bridged to the browser over four routes under `/api/settings/llm/oauth`. A sign-in that lapsed surfaces everywhere as `reauth_required`, which
the chat answers with a [Reconnect banner](usage.md#llm-providers). A saved model ref is
resolved in one place, `resolveModel`: a model pi no longer lists is `model_missing`, and nothing
stands in for it. A model pi renamed has a row in `src/lib/llm/model-aliases.ts`, and startup
moves the default model and standalone scheduled tasks to its successor
(`src/lib/llm/model-rewrite.ts`); a started chat is never moved. Agent requests to OpenRouter,
OpenCode and Baseten carry the chat's random id, so the provider can keep a chat on one backend
and reuse its prompt cache. OpenCode refuses a request without one, so its title and compaction
requests carry the chat's id too, and a request outside any chat (Validate, Test, mapping
assistance) a fresh one (`src/lib/llm/opencode.ts`).

## Shared contracts

The types a [recipe](extending.md) builds on, and the ones behind what a pull request must
[preserve](../CONTRIBUTING.md#pull-requests): tool names, module ids, storage formats, evidence ids
and SSE event shapes.

| Contract | Purpose | Defined in |
| :--- | :--- | :--- |
| `Concern`, `TurnState`, `SessionCtx` | The harness contract | `src/lib/harness/concern.ts` |
| `ToolMeta`, `FinanceTool`, `Module`, `ModuleContext`, `SettingsField`, `TurnKind` | What a tool declares and what a module gets | `src/lib/tools/contracts.ts` |
| `Quote`, `SymbolHit`, `TickerSnapshot` | What a module's `ui` hooks return, and what the ticker hover card shows | `src/lib/tickers/types.ts` |
| `EvidenceEntry`, `EvidenceLedger`, `StructuredDetails` | E, C, A, U and R entries, and what a result may attach | `src/lib/evidence/types.ts` |
| `Verdict`, `CheckRecord`, `RuleId` | A rule's outcome and its transcript record | `src/lib/policy/types.ts` |
| `BeforeToolRule`, `AfterToolRule`, `BeforeStopRule`, `BeforeModelRule` | The rule signatures, one per stage | `src/lib/policy/events.ts` |
| `ReportSpec` | A structured report, typed from its schema | `src/lib/reports/schema.ts`, re-exported from `spec.ts` |
| `LlmProviderDefinition` | What a provider type implements | `src/lib/llm/types.ts` |
| `ParsedAttachment`, `StoredAttachment` | What a parser returns, what the transcript keeps | `src/lib/attachments/types.ts` |
| `DOCUMENT_TYPES`, `ParserId` | Which files are taken and who parses them, both derived from `DOCUMENT_ROWS` | `src/lib/attachments/formats.ts` |
| `SkillMessage`, `ScheduledMessage`, the fields added to pi's messages | The message model: what a transcript holds | `src/lib/agent/messages.ts` |
| `SessionFile`, `SessionHeader` | A saved chat, and its metadata without the transcript | `src/lib/sessions/types.ts` |
| `SseEvent` | The wire protocol to the browser | `src/lib/agent/events.ts` |
| `PortfolioStore` | Holdings ledger storage | `src/lib/portfolio/types.ts` |
| Scheduled task schemas | A task's schedule and destination, and what creating or editing one takes, for the tools and the routes alike | `src/lib/scheduled/schema.ts` |
