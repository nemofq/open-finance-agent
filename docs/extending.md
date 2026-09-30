# Extending Open Finance Agent

One recipe per kind of contribution, each in the same shape: when to pick it, the **Files** it
touches, the **Steps**, and its **Checks**. [CONTRIBUTING.md](../CONTRIBUTING.md) has the setup,
the [directory map](../CONTRIBUTING.md#where-things-go) and the
[checks](../CONTRIBUTING.md#checks) every change runs.

| Contribution | Code? | Pick it when |
| :--- | :--- | :--- |
| [Skill](#skill) | No | You have a research playbook, optionally promising a report. |
| [MCP server](#mcp-server) | No | An existing server should become a data connection or a general tool. |
| [Data connection or tool module](#data-connection-or-tool-module) | Yes | Your data needs structured facts, a settings form or ticker hooks. |
| [Tool on an existing capability](#tool-on-an-existing-capability) | Yes | A capability already there needs one more operation. |
| [Policy rule](#policy-rule) | Yes | A failure seen in transcripts should be blocked, followed up or flagged. |
| [Harness concern](#harness-concern) | Yes | A theme needs a home and no existing concern owns it. |
| [Report template or block](#report-template-or-block) | Yes | A report needs fixed sections or a new kind of block. |
| [Calculator function](#calculator-function) | Yes | The model needs a formula `fin` lacks. |
| [LLM provider type](#llm-provider-type) | Yes | You need a model service no provider type reaches. |
| [Attachment parser](#attachment-parser) | Yes | The composer should take a file format it does not. |
| [Benchmark task](#benchmark-task) | No | A scenario the benchmark should cover; you propose it, the maintainer adds it. |

## Skill

**A skill is a research playbook the model follows, with no code.** It is a markdown file in the
[agentskills.io](https://agentskills.io) format, so the same file works in pi and Claude Code. The
frontmatter names the skill and can promise a report, which the harness enforces.

**Files:** `~/.open-finance-agent/skills/<name>/SKILL.md`, or `skills/<name>/SKILL.md` to bundle
it in the repo.

```markdown
---
name: dividend-screen
description: Screen tickers for dividend durability from payout ratio, free cash flow cover and dividend history in XBRL; flags cuts. Delivers a peer-comps report. Use when the user asks whether a dividend is safe or wants income candidates compared.
metadata:
  inputs: [tickers]
  requires: [fundamentals, filings]
  output: peer-comps
  profile: [objectives.primary]
  holdings: false
---

# Dividend Screen

## Process
1. Resolve each ticker with `edgar_lookup_company`.
2. Pull `edgar_financials` with statement `key_metrics`, period `annual`.
...

## Report
Call `create_report` with `template: "peer-comps"`: Peer set, Comparison (one `table`), Read-through.
```

The fields, as `src/lib/skills/loader.ts` reads them:

| Field | What it does |
| :--- | :--- |
| `name` | 1 to 64 lowercase letters, digits or hyphens; must equal the folder name. |
| `description` | Required, max 1,024 characters. The model and the `/` picker see this, so write what the skill does, produces, and when to use it. |
| `metadata.output` | The report template it promises. The delivery concern follows up if the report is missing, so declare it only when a report is always the deliverable. It is the only metadata field the harness enforces. |
| `metadata.inputs`, `requires`, `profile`, `holdings` | Declarative. They stay in the frontmatter, but the app does not parse them. |
| `disable-model-invocation: true` | Leaves the skill runnable only from the `/` picker. |

Describe the report's *outline*, never its markup: `create_report` takes a spec, and the closing
sections and the disclaimer are [generated](architecture.md#reports).

**Steps:**

1. **Write the file** with the frontmatter above and the process the model should follow.
2. **Put it where the loader looks.** There is no registration step: the loader finds the folder.
   - For yourself: `~/.open-finance-agent/skills/<name>/SKILL.md`, or write it in
     Settings › Skills. Editing a skill in Settings keeps its metadata.
   - Bundled in the repo: add the folder under `skills/` and, if it promises a new template, add
     the [template](#report-template-or-block).

   User skills override bundled ones with the same name. A file that breaks a rule, including
   frontmatter that is not valid YAML, is skipped with a warning.

**Checks:** `pnpm vitest run src/lib/skills src/lib/reports` (the loader and template tests), then
run the skill once against a real model and read the report.

## MCP server

**An MCP server you already run becomes a data connection or a general tool, with no code.** You
only say what the server *is*, which is the one thing the harness cannot infer.

**Files:** none; it is configuration. The same entry can be written to `config.json` under
`mcp.servers`; the schema is `mcpServerSchema` in `src/lib/config/schema.ts`.

**Steps:**

1. **Open the MCP servers section** of Settings › Data connections or Settings › General tools,
   and pick HTTP (Streamable HTTP, falling back to SSE) or stdio.
2. **Say what the server is:**
   - **A data connection** supplies market or filing data. Its results are registered as evidence
     at the tier you give it (default 2) and cross-checked; the coverage domains you tick are what
     the trusted-sources rule reads before allowing a web search.
   - **A general tool** is everything else. Its results are not sourced figures, and the
     [privacy rule (P3)](architecture.md#the-rules) blocks a call whose arguments carry your
     account names or distinctive position figures.
3. **Test connection** lists the server's tools; tick the ones the agent may call (an empty list
   exposes all of them). Tools arrive as `<serverId>__<toolName>`, with every character outside
   `[A-Za-z0-9_-]` replaced by `_`.

A generic server's results have numbers extracted from text but no structured facts; only a
[module](#data-connection-or-tool-module) can attach facts.

**Checks:** **Test connection** in Settings, then one chat that calls the server's tools.

## Data connection or tool module

**A module is how data arrives with structured facts, a settings form and ticker hooks.** It
contributes tools, a settings form and optional UI hooks. The interface is `Module` in
`src/lib/tools/contracts.ts`; every tool is a `FinanceTool<typeof parameters>` whose `meta`
declares its class, source tier, coverage, effect and as-of support.
`src/lib/providers/example/` is a complete provider for a made-up vendor, Acme, compiled and
tested but not registered: copy the folder and rename it to start.

**Files:** `src/lib/providers/<name>/module.ts` and its `module.test.ts`, one import in
`src/lib/tools/registry.ts`.

**Steps:**

1. **Write `src/lib/providers/<name>/module.ts`** exporting a `Module` with `id`, `name`, `kind`
   (`data-provider`, `financial-tool` or `tool`, which chooses the settings page), `description`
   (shown on its settings card), `settings`, `defaultConfig`, optional `validate`, and
   `createTools(cfg, ctx)`. Return `[]` when the module is enabled but not configured. The system
   prompt lists each tool by its `label`, a data tool under its source's name, tier and coverage.
2. **Declare each tool.** `parameters` is a TypeBox schema from `typebox`; every description in
   it is read by the model. `meta.source` with an honest [tier](architecture.md#evidence) is what
   lists the tool under Data connections and what routes the model here before the web.
   `meta.effect` is `read` for a data tool, even one that calls a vendor's API; `ToolEffect` says
   what each effect makes the harness do. `meta.supportsAsOf: true` is a promise that the tool
   drops anything dated after `ctx.asOf`; keep it.
3. **Wrap the raw provider call in `sourceRequest`** from `src/lib/data/source-snapshot.ts`, with
   JSON-safe canonical arguments and no credentials. It is where the benchmark answers from its
   offline dataset (or captures a live response for it), and a no-op outside it. Pass the
   `AbortSignal` to `fetch` so Stop cancels the request.
4. **Return `StructuredDetails`** (`src/lib/evidence/types.ts`): a one-line `summary`, `facts` as
   metric, period, value and unit, and `table` for a series the calculator should load. Build them
   when the tool runs, from the data you fetched; the evidence engine has no code for any provider.
   Fields you leave out are filled from the text by the generic normaliser: the numbers when there
   are no facts, and the date only for a result without a `summary`.
5. **Register it**: import it in `src/lib/tools/registry.ts` and add it to `builtinModules`. Its
   `defaultConfig` is the only copy of its defaults: a module config.json has never saved runs on
   them, in the agent and on the settings page alike.

The heart of the example; a test fails when this excerpt and the file differ:

```ts
async function fetchCloses(apiKey: string, ticker: string, asOf: string | undefined, signal?: AbortSignal): Promise<AcmeClose[]> {
  const url = `${API}/prices?symbol=${encodeURIComponent(ticker)}${asOf ? `&before=${asOf}` : ""}`;
  // The benchmark's source seam: JSON-safe canonical arguments, never the key.
  return sourceRequest({ source: "acme", operation: "prices", args: { ticker, before: asOf ?? null } }, async () => {
    // The signal is what lets Stop cancel the request.
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
    if (!res.ok) throw acmeError(res.status);
    return (await res.json()) as AcmeClose[];
  });
}

function pricesTool(apiKey: string, asOf?: string): FinanceTool<typeof parameters, StructuredDetails> {
  return {
    name: "acme_prices",
    label: "Acme price history",
    description: "Daily closing prices for one ticker, split-adjusted, most recent last.",
    parameters,
    meta,
    async execute(_toolCallId, params, signal) {
      const ticker = params.ticker.trim().replace(/^\$/, "").toUpperCase();
      const fetched = await fetchCloses(apiKey, ticker, asOf, signal);
      // Do not trust the vendor's filter alone: `supportsAsOf` is our promise, not theirs.
      const closes = fetched.filter((row) => !asOf || row.date <= asOf).slice(-(params.limit ?? 30));
      if (closes.length === 0) throw new Error(`Acme has no prices for ${ticker}${asOf ? ` on or before ${asOf}` : ""}.`);
      const lines = closes.map((row) => `| ${row.date} | ${row.close.toFixed(2)} |`);
      return {
        content: [{ type: "text", text: [`${ticker} daily closes (USD)`, "", "| Date | Close |", "| :--- | ---: |", ...lines].join("\n") }],
        // Structured details are what the evidence ledger indexes exactly, instead of reading the text.
        details: {
          summary: `Acme daily closes, $${ticker}, ${closes.length} days`,
          asOf: closes.at(-1)?.date,
          entity: { ticker },
          unit: "USD",
          currency: "USD",
          periods: closes.map((row) => row.date),
          facts: closes.map((row) => ({ metric: "close", period: row.date, periodType: "instant", value: row.close, unit: "USD", end: row.date })),
          table: { columns: ["date", "close"], rows: closes.map((row) => [row.date, row.close]), index: "date" },
        },
      };
    },
  };
}
```

The settings page renders itself from `settings`: `secret`, `text`, `toggle`, `select` and
`multiselect` fields, a Validate button wired to `validate()`, and a Save per card. Every `secret`
field is masked before config reaches the browser, whatever its key is called.

`ui.quote(symbol, cfg)` and `ui.searchSymbols(query, cfg)` feed the ticker hover card and the `$`
autocomplete when present, given the same config as `createTools`; the first enabled module in
registry order that quotes prices the card. Their shapes are in `src/lib/tickers/types.ts`.

**Checks:** `pnpm vitest run src/lib/providers/<name> src/lib/tools`. Start your test from
`src/lib/providers/example/module.test.ts`: a fake `fetch`, the contract checks in
`src/lib/tools/testing.ts` that `registry.test.ts` runs on every built-in module, the as-of
filter, and the result through `registerToolResult` into indexed evidence.

- `registry.test.ts` builds each offline module from its `defaultConfig`, enabled, with a
  placeholder in every empty `required` secret or text field, and expects at least one tool, so
  mark the key field `required: true`.
- A module that needs the network to list its tools goes in its `needsNetwork` set instead.
- A networked provider also gets a live test behind `OFA_LIVE_TESTS=1` and a variable for its key.

## Tool on an existing capability

**When a capability already exists, one more operation is one more tool, not a new module.** A
`FinanceTool<typeof parameters>` with its own `meta`, returned from the module's `createTools`,
needs no other registration.

**Files:** that capability's adapter, `src/lib/<capability>/tool.ts` (for example
`src/lib/portfolio/tool.ts`) or the provider's `module.ts`, and a test beside it.

**Steps:**

1. **Add the tool** to the adapter and return it from `createTools`.
2. **Decide who records its evidence.** A tool that creates evidence of its own, as the calculator
   adds `C` and `A` entries, uses `ctx.evidence`; a data tool does not, because `afterTool`
   registers its result for it.
3. **Mind the benchmark.** In the benchmark's offline mode a `write-local` tool is answered with a
   no-op success, and every benchmark run uses a throwaway data folder, so a benchmark never edits
   user data.

**Checks:** `pnpm vitest run src/lib/<capability> src/lib/tools`, with a test beside the tool;
`registry.test.ts` checks its `meta`.

## Policy rule

**A failure seen in transcripts becomes a rule that blocks, follows up or flags it.** A rule is a
pure function from an event and a `RuleContext` (the ledger, the tools, the session state) to a
`Verdict`, or nothing. Each stage has its own type in `src/lib/policy/events.ts`:

| Type | May |
| :--- | :--- |
| `BeforeToolRule` | Block, or serve from evidence. |
| `AfterToolRule` | Annotate. |
| `BeforeStopRule` | Ask for a follow-up, or flag. |
| `BeforeModelRule` | Add a note. |

**Files:** `src/lib/policy/rules/<meaning>.ts` and `<meaning>.test.ts`, `src/lib/policy/types.ts`,
`src/lib/policy/summary.ts`, `src/lib/policy/rules/index.ts`.

**Steps:**

1. **Write `src/lib/policy/rules/<meaning>.ts`** exporting the function, named `p<N>` plus what it
   checks, with a doc comment that says what it catches and what it does about it. Give it a new
   id in `RuleId` (`src/lib/policy/types.ts`) and its title in `RULE_TITLES`
   (`src/lib/policy/summary.ts`).
2. **Add it to its stage list** in `src/lib/policy/rules/index.ts` (`BEFORE_TOOL_RULES`,
   `AFTER_TOOL_RULES` or `BEFORE_STOP_RULES`). Order matters within a stage: privacy runs before
   routing, a duplicate is served before anything decides where data should come from, and the
   first stop verdict wins. A `BeforeModelRule` has no stage list: a harness concern calls it, as
   `src/lib/harness/user.ts` calls the profile-fit rule in `beforeTurn`.
3. **Test its allow, block or flag paths** directly, without an agent, in `<meaning>.test.ts`.
4. **Calibrate before enforcing**: run the benchmark with `--observe`, review the recorded
   verdicts against the judge's grounding feedback, tune, then enable
   ([evals/README.md › Calibrating a policy rule](../evals/README.md#calibrating-a-policy-rule)).

**Checks:** `pnpm vitest run src/lib/policy`, then the benchmark in observe mode (step 4).

## Harness concern

**Only when no existing concern owns the theme**: usually one that spans several hook points, or,
like `conduct`, a section of the system prompt that belongs to no other theme. The hooks are
listed in [architecture.md](architecture.md#the-concern-contract).

**Files:** `src/lib/harness/<name>.ts` and `<name>.test.ts`, the `compose([...])` list in
`src/lib/agent/factory.ts`.

**Steps:**

1. **Write `src/lib/harness/<name>.ts`** exporting a `Concern` (`src/lib/harness/concern.ts`).
   Keep it to its one theme: a concern that grows a second one is two concerns.
2. **Decide once, read everywhere.** Decide in `beforeTurn`, write the decision on `TurnState` in
   a field that names you as owner, and read it everywhere else.
3. **Stay off pi's options.** Import pi types only for messages and tools; the composer is the
   only file that touches `AgentOptions`. The transcript `beforeTurn`, `afterRun` and `afterTurn`
   receive starts with pi's own system message, which no request is built from: place or cut
   messages after it (`splitSystemHead`), never by absolute position.
4. **Compose it**: add it to the `compose([...])` list in `src/lib/agent/factory.ts` in the
   position its ordering needs.

**Checks:** `pnpm vitest run src/lib/harness src/lib/agent`, with a `<name>.test.ts` driving the
concern's hooks directly.

## Report template or block

**A template fixes the sections a reader must find; a block is a new kind of content.** Every
figure must name its evidence; a block that cannot does not belong.

**Files:** a template touches `src/lib/reports/templates.ts`. A block type touches
`src/lib/reports/schema.ts`, `validate.ts` and `render/blocks.ts`.

**Steps for a template:**

1. **Append a `ReportTemplate`** (`src/lib/reports/spec.ts`) to `reportTemplates` in
   `src/lib/reports/templates.ts`: its `id`, a display `name`, and `requiredSections`.
2. **Word the required sections** as the headings a reader must find. They are matched by their
   words, ignoring case, punctuation and spacing, anywhere in a heading.

**Steps for a block type:**

1. **Add its schema** in `src/lib/reports/schema.ts`; the types in `spec.ts` follow from it.
2. **Validate its evidence** in `validate.ts`.
3. **Render it** in `render/blocks.ts`, for both the document and the slide format.

The benchmark reads delivered reports through `specSurfaces` in `validate.ts`, which walks each
block with the validator's own `walkBlock`, so a block the validator checks is also scored.

**Checks:** `pnpm vitest run src/lib/reports` (schema, validation and renderer tests), then create
one report of each format against a real model.

## Calculator function

**When the model needs a formula `fin` lacks, it goes in `fin`, not in the prompt.** `fin` is pure
standard library so its golden values are identical on every OS.

**Files:** one module in `sandbox/fin/`, `sandbox/fin/__init__.py`,
`sandbox/fin/tests/test_fin.py`.

**Steps:**

1. **Add the function** to the right module in `sandbox/fin/` (`growth.py`, `profitability.py`,
   `valuation.py`, `cashflow.py`, `earnings.py`, `funds.py`, `options.py`, `portfolio.py`,
   `risk.py`).
2. **Decorate it** with `@api(group=..., summary=...)` from `registry.py`.
3. **Import it** in `sandbox/fin/__init__.py`; `__all__` follows from the registry.
4. **Return a `FinResult`, `FinVector` or `FinStruct`**, following the conventions in
   `sandbox/fin/CONVENTIONS.md` (units, periods, signs, what to return).
5. **Add golden cases** to `sandbox/fin/tests/test_fin.py`.

**Checks:**

```bash
python3 -m unittest discover -s sandbox/fin/tests -v
python3 -m unittest discover -s sandbox/tests -v
OFA_SANDBOX_TESTS=1 npx vitest run src/lib/sandbox src/lib/calculator   # boots Deno and Pyodide, minutes
```

## LLM provider type

**A provider type reaches a model service; config holds its instances.** Code defines
provider types over pi-ai's `Models` runtime.

Every type is one row of `llmProviderTypeTable` in `src/lib/llm/provider-types.ts`: its name,
description and key help, the auth kinds it offers, and whether it can be added more than once.
The row's key is the type id saved in `config.json`. Rows sit in the order the "Add provider"
dialog lists them; `featured` rows are shown before "More providers" is opened, the rest are
sorted by `category`, and rows sharing a `family` (a company's regional editions) are one row
until one is picked. The config schema, the Settings catalog, the dialog's rows and whether a key is
required are all derived from it.

**Files:** `src/lib/llm/provider-types.ts`, then either `src/lib/llm/providers/pi-backed.ts` or a
new `src/lib/llm/providers/<type>.ts` with `src/lib/llm/providers/index.ts`; sometimes
`src/lib/llm/catalog.ts` and `src/lib/config/schema.ts`.

**Steps:**

1. **Add the table row.** A dialog row that should read differently from its type, as
   "Claude (Pro/Max)" does, gets an entry in `entryOverrides` in `src/lib/llm/catalog.ts`.
2. **A type pi-ai already implements** is two edits (every pi provider is in but Radius and
   TypeSafe, which serves only a classifier model; a pi-ai upgrade that adds one fails the
   typecheck of `piBuiltinProviders` in `schema.ts`): the table row, with `multiple: false` and the
   type's pi provider id as its key, and its pi factory in `piProviders` in
   `src/lib/llm/providers/pi-backed.ts`, whose definition covers every such type.
   The compiler reports a missing pi factory and a key that is not a pi provider id;
   `src/lib/llm/providers/pi-backed.test.ts` reports an auth kind pi does not implement for it.
3. **A type pi-ai does not implement** needs the table row and a definition of its own:
   - **Write `src/lib/llm/providers/<type>.ts`** implementing `LlmProviderDefinition` from
     `src/lib/llm/types.ts` (`toPiProvider`, `validate`, `listModels`, `toPiModel`, optionally
     `catalogModels`), and list it in `llmProviderDefinitions` in
     `src/lib/llm/providers/index.ts`. `validate` and `listModels` are handed pi's `Models`.
   - **A type that speaks OpenAI chat completions** builds `toPiProvider` and `toPiModel` with
     `completionsProvider` and `completionsModel` from `src/lib/llm/providers/completions.ts` and
     writes only the other two.
   - **A single-instance type** still takes a pi provider id as its key, as OpenRouter does, and
     joins OpenRouter in the types `PiBackedType` excludes in `pi-backed.ts`.
   - **A type added many times** (`multiple: true`) is an endpoint the user names, so its config
     schema is written out in `endpointProviderSchemas` in `src/lib/config/schema.ts`.
   - The compiler reports a missing definition and a missing endpoint schema.
4. **Describe the models honestly.** Report the real `contextWindow`; every budget is a fraction
   of it. Set `input` to include `image` only for models that accept pictures. List only
   tool-capable models.
5. **Ask for what else it needs.** A type pi resolves from more than a key (an account ID, a
   region, a choice between a key and a profile) declares it in the row's `setup`: `methods` for
   the choice, `fields` for the values, each named as pi reads it. The card renders them, the
   schema accepts only those, and pi's own auth resolves them from the config and nothing else.
6. **Name any other secret.** A `setup` field marked `secret` is masked like the key; any other
   secret field is named in the row's `secretFields`.

Credentials are the app's, not the type's
([architecture › LLM providers](architecture.md#llm-providers)). A type whose row offers OAuth
needs no UI: the connect dialog renders pi's events and prompts. **Test** in Settings sends one
request shaped like an agent turn (a system prompt, a tool, the reasoning effort), then probes
thinking and image input as the model declares them, so a server that rejects tools, the system
role or a reasoning effort fails there rather than mid-chat.

**Upgrading pi-ai** can drop model ids users have saved. `node scripts/pi-catalog-diff.mjs <old
version>` lists them per offered provider, with the provider's new ids; give each true successor
(same family and tier) a row in `src/lib/llm/model-aliases.ts` and leave the rest out as retired.

**Checks:** `pnpm vitest run src/lib/llm src/lib/config`, then its live tests
([CONTRIBUTING.md](../CONTRIBUTING.md#checks)) and **Test** in Settings.

## Attachment parser

**When the composer should take a file format it does not.** A parser turns bytes into a
`ParsedAttachment` (`src/lib/attachments/types.ts`): prose and table parts, an outline, warnings.

**Files:** `src/lib/attachments/` (the parser, `formats.ts`, `signatures.ts`,
`parse/registry.ts`) and one line of `next.config.ts`.

**Steps:**

1. **Write `src/lib/attachments/parse/<format>.ts`** exporting
   `parse(bytes, name): Promise<ParsedAttachment>`. Respect the caps in `limits.ts`; hitting one
   sets `truncated` and adds a warning, it never fails the upload. A zip-based format opens its
   archive with `inspectZip` from `zip.ts`, which refuses one over the caps before inflating
   anything, and rethrows its `ZipTooLarge`, as `docx.ts` does. Warnings state counts and sizes
   with `count` and `megabytes` from `wording.ts`.
2. **Declare the format** in `src/lib/attachments/formats.ts`: add the row to `DOCUMENT_ROWS`,
   keyed by extension, with its `parser` id, the `containers` it accepts and its `mimeType`;
   `ParserId` and `DOCUMENT_TYPES` follow from it. `kind` is `document`, `table` or `pdf`; a table
   is never inlined and is registered as evidence for the calculator. The composer's `accept` list
   follows from the row. A format worth explaining rather than refusing goes in
   `REJECTED_EXTENSIONS` instead. Magic bytes live in `src/lib/attachments/signatures.ts`; add the
   format's there and extend `parse/sniff.ts` only if the container check needs it.
3. **Register the loader** in `PARSERS` in `src/lib/attachments/parse/registry.ts`, with the
   `turbopackIgnore` comment the others carry. The map is typed over `ParserId`, so a missing
   loader fails the typecheck. Add the parser's file name to the `/api/attachments` entry of
   `outputFileTracingIncludes` in `next.config.ts`, since nothing imports the worker for the build
   to trace; `parse/worker.test.ts` fails until it is there.

Parsing runs in a worker thread under a timeout and a heap limit, as erasable TypeScript: import
every type with `import type`, and never import a parser from request-thread code; only the worker
imports `parse/registry.ts`. `src/lib/attachments/parse/new-format.test.ts` walks these three
steps end to end with a test-only format: through the real worker, then staged, claimed and served
by the real store and route. Build fixtures in the test where the format allows it; commit a
binary only when nothing else will do.

**Checks:** `pnpm vitest run src/lib/attachments src/architecture`, which loads every parser
through the real worker (`parse/index.test.ts`) and checks the parser boundary.

## Benchmark task

**Adding or changing a benchmark task is maintainer-only, because every task changes the
scores.** You contribute the scenario; the maintainer builds the task and its offline data.

**Files:** none in the repo; an issue from the
[benchmark task template](../.github/ISSUE_TEMPLATE/benchmark_task.md).

**Steps:**

1. **Open an issue** with the benchmark task template, giving the prompt in a retail investor's
   voice, its as-of date, what a good answer must show and the sources it needs.
2. **The maintainer adds it.**
   [evals/README.md › Maintaining the dataset](../evals/README.md#maintaining-the-dataset) says
   why and is the maintainer's recipe.

**Checks:** none on your side; the maintainer's recipe covers them.
