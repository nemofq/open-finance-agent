# Contributing

Contributions are welcome through pull requests. Report a security problem privately
([README › Security](README.md#security)), never in an issue.

## What the project most needs

The [roadmap](README.md#roadmap-and-contributing) sets the order. Each of these has a recipe in
[docs/extending.md](docs/extending.md):

- **[Data connections](docs/extending.md#data-connection-or-tool-module)** come first, starting
  from the tested example in `src/lib/providers/example/`.
- **[Skills](docs/extending.md#skill)**: research playbooks in `SKILL.md` format for everyday
  workflows.
- **[Benchmark tasks](evals/README.md#maintaining-the-dataset)**, proposed with the benchmark-task
  issue template; only the maintainer can add one.
- **[Tools on existing capabilities](docs/extending.md#tool-on-an-existing-capability)**, such as
  more EDGAR forms or Alpha Vantage operations.
- **The rest:** [calculator functions](docs/extending.md#calculator-function) in `fin`,
  [policy rules](docs/extending.md#policy-rule) that catch real failures seen in transcripts,
  [LLM provider types](docs/extending.md#llm-provider-type) and
  [attachment formats](docs/extending.md#attachment-parser).

## Setup

Node 24 or newer and [pnpm](https://pnpm.io/installation) 12 or newer. Python is not required to
run the app; the calculator brings its own. Any `python3` runs the `fin` golden tests locally; CI
uses Python 3.12.

```bash
pnpm install
OFA_HOME=/tmp/ofa-dev pnpm dev      # http://localhost:3000, against throwaway data
```

`pnpm sandbox:fetch` retries the calculator runtime download that `pnpm install` runs
([quick start](README.md#quick-start)).

## Where things go

| Change | Lives in | Read first |
| :--- | :--- | :--- |
| Data connection | `src/lib/providers/<name>/module.ts`, an import and an array entry in `src/lib/tools/registry.ts` | [extending](docs/extending.md#data-connection-or-tool-module) |
| Tool on a capability | `src/lib/<capability>/tool.ts` or the provider's `module.ts` | [extending](docs/extending.md#tool-on-an-existing-capability) |
| Skill | `skills/<name>/SKILL.md` to bundle it; your own in the data folder or Settings › Skills | [extending](docs/extending.md#skill) |
| MCP server | Settings, or `mcp.servers` in `config.json`; no repo change | [extending](docs/extending.md#mcp-server) |
| Policy rule | `src/lib/policy/rules/<meaning>.ts` | [extending](docs/extending.md#policy-rule), [architecture › The rules](docs/architecture.md#the-rules) |
| Harness concern, execution budget | `src/lib/harness/`, `src/lib/agent/execution.ts` | [extending](docs/extending.md#harness-concern), [architecture › The concern contract](docs/architecture.md#the-concern-contract) |
| Report template or block | `src/lib/reports/` | [extending](docs/extending.md#report-template-or-block) |
| Evidence, context | `src/lib/evidence/`, `src/lib/context/` | [architecture](docs/architecture.md) |
| Calculator | `sandbox/fin/`, `src/lib/calculator/`, `src/lib/sandbox/` | [extending](docs/extending.md#calculator-function), [`sandbox/fin/CONVENTIONS.md`](sandbox/fin/CONVENTIONS.md) |
| LLM providers | `src/lib/llm/` | [extending](docs/extending.md#llm-provider-type) |
| Attachments | `src/lib/attachments/` | [extending](docs/extending.md#attachment-parser) |
| UI | `src/components/<feature>/`, `src/app/` | the installed Next docs |
| Benchmark | `evals/` | [evals/README.md](evals/README.md) |

Also: `scripts/` (install and build helpers, the offline dataset compiler, the pi-ai catalog
diff), `sandbox/` (the Deno and Pyodide runtime, its boundary checks), `e2e/` (the browser test)
and `docs/`.

## Checks

Run what CI runs before opening a pull request. The `validate` job:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The `browser` job installs headless Chromium
(`pnpm exec playwright install --with-deps --only-shell chromium`), builds, then runs:

```bash
pnpm test:browser
```

`pnpm test` runs vitest over `src/**/*.test.ts` and `evals/**/*.test.ts` offline, never the
benchmark. Anything that touches a real network sits behind a guard and is skipped by default.
`pnpm test:browser` starts the production build on a scratch data folder with a scripted model
(`e2e/stub-llm.ts`) and drives one chat in headless Chromium over an uploaded document, through to
its report; a second test checks that the sidebar reports a failed chat delete on `/portfolio`, and
`e2e/report-layout.spec.ts` checks that a deliberately wide report never scrolls the page sideways
at 360, 600 and 800 pixels. It needs no key and no network.

Some changes need more:

| If you touch | Also run |
| :--- | :--- |
| `sandbox/`, `scripts/sandbox-fetch.mjs`, `src/lib/sandbox/`, `src/lib/calculator/` | `python3 -m unittest discover -s sandbox/fin/tests -v`, `python3 -m unittest discover -s sandbox/tests -v` and `OFA_SANDBOX_TESTS=1 npx vitest run src/lib/sandbox src/lib/calculator`. The last boots Deno and Pyodide and takes minutes. CI repeats all three on three operating systems |
| A policy rule, the prompt, delivery, or a tool's description | The benchmark, in observe mode first (`--observe`), then enforced. It needs two models and costs money, so it is run by hand ([evals/README.md › Comparing runs](evals/README.md#comparing-runs)) |
| A networked provider or an LLM provider type | Its live tests, below |

Live tests run only when their variables are set. Vitest does not load `.env.local`, so export
them or pass them inline:

| Variable | Used for |
| :--- | :--- |
| `OFA_LIVE_TESTS=1` | Turns on every networked test, such as MCP connectivity |
| `OPENROUTER_API_KEY_TEST` | An OpenRouter key: the agent end to end with EDGAR tools and a skill |
| `CUSTOM_LLM_URL` | An OpenAI-compatible base URL, including `/v1`: Validate, Test and the agent end to end |
| `CUSTOM_LLM_API_KEY` | That endpoint's key, if it has one |
| `CUSTOM_LLM_AVAILABLE` | Comma-separated model ids it serves; the first must be tool-capable |
| `OFA_BROWSER_EXECUTABLE` | A Chromium binary for `pnpm test:browser` to drive instead of the one `playwright install` downloads |

## Pull requests

- Branch from the latest `main`; one PR solves one clearly stated problem. The PR template lists
  the gates to tick.
- Structural moves and behaviour changes go in separate PRs. A behaviour change states its
  observable effect and carries a regression test.
- Preserve tool names, module ids in `config.json`, HTTP routes, storage formats, evidence ids
  and SSE event shapes unless the PR is about changing one; saved chats must still load.
- Say what you ran. If the benchmark ran, name the agent, judge, thinking level and the numbers
  before and after with the same settings; if it did not, say why it need not.
- No credentials, tokens, local data, eval results or generated files in the diff.
- Anything touching the harness contract, storage formats, the sandbox's permissions or the
  benchmark's scoring starts as an issue; a small doc fix need not.

## Code style

**Everywhere.** These hold in every file:

- Small, single-purpose files with explicit types at every boundary. No `any`, no non-null
  assertions to silence the checker. Size is a review signal, not a test: a concern or an entry
  point that keeps growing is usually doing two jobs.
- Comments explain why, not what.
- Next loads a module more than once, so state that must exist once per process (a registry, a
  pool, a write queue) goes through `processSingleton` or `runSerially` in
  `src/lib/process-state.ts`, never a module-level `let`. A file is replaced with
  `writeFileAtomic` from `src/lib/atomic-write.ts`.
- Helpers that tests import live in `testing.ts` in their folder; fixed test data is a
  `*.fixture.ts` or `*.fixture.json` file, or sits under a `fixtures/` folder.
- Guarantees are code, not prompt text: what the product promises belongs in
  `src/lib/policy/rules/` or a harness concern, where it can be tested and measured.
- Every tool declares its `ToolMeta`; `src/lib/tools/registry.test.ts` fails for one that does not.
- Secrets belong in `config.json` via Settings, never in the repo, `.env` or a log line.
- Nothing sensitive goes near the calculator runtime folder, and the Deno command line never
  gains a permission flag.

**Libraries and imports.** Framework-free logic goes in `src/lib` with a `.test.ts` beside it.
Import from the file that defines a name, never through a barrel: an `index.ts` exists only when it
holds logic of its own, and then it re-exports nothing. When a route and an agent tool do the same
thing, the workflow lives once in `src/lib` (as `src/lib/scheduled/tasks.ts` does for scheduling)
and both only translate to and from it.

**Routes.** Route handlers stay thin and run on the Node runtime, which is the default, so a
`route.ts` exports neither `runtime` nor `dynamic`.

Every route refuses with one envelope, `{ error, code? }`: `error` is a readable sentence, `code`
an optional stable machine code such as `run_in_progress`. Build it with
`jsonError(message, status, code?)` or `errorResponse(err)` from `src/app/api/http.ts`. A success
is a plain `Response.json(body)`; `NextResponse` adds nothing a route here uses, and lint refuses
it. The browser shows `error` and branches only on `code` (`HttpError.code`). A route that takes a
JSON body reads it with `readJson(request, schema)` from the same file, which refuses anything not
sent as `application/json` and parses it with the schema.

`src/proxy.ts` refuses a cross-site write to any API route before its handler runs; the hosts in
`OFA_DEV_ORIGINS` are let through.

**Components.** `src/components/ui/` holds the Shadcn primitives and `src/components/shared/` the
cross-feature pieces. Feature folders (`chat/`, `reports/`, etc.) may import components from other
features but never a module that exports a hook or creates a context.

**Enforced boundaries.** `src/architecture/architecture.test.ts` checks the component rule above;
that no module, whatever its file name, is a barrel that only passes on names defined elsewhere;
that browser code never reaches a Node built-in, a server package, a parser, a credential reader
or the tool registry; that `src/lib/evidence/` imports no provider; and that no modules import each
other in a cycle. A failure prints the file or the import path that breaks the rule.

## Commits

One logical change per commit, imperative subject under 72 characters, no trailing period:
`Add EDGAR full-text search tool`. Use the body for why when it is not obvious. Reference an issue
with `Fixes #12` when there is one.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE)
like the rest of the project.
