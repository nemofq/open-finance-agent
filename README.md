# Open Finance Agent

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT" /></a>
  <a href="https://github.com/nemofq/open-finance-agent/actions/workflows/ci.yml"><img src="https://github.com/nemofq/open-finance-agent/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/node-24%2B-brightgreen.svg" alt="Node 24+" />
  <img src="https://img.shields.io/badge/pnpm-12-orange.svg" alt="pnpm" />
</p>

<p align="center">
  <a href="docs/images/screenshot.png"><img src="docs/images/screenshot.png" alt="Open Finance Agent answering an NVIDIA earnings preview: the tool trace with source tiers and evidence ids on the left, the generated report with sourced numbers on the right" width="100%" /></a>
</p>

**Open Finance Agent is a harness built for financial research and analysis**, similar to
[ChatGPT for Financial Services](https://openai.com/index/introducing-chatgpt-financial-services/)
and [Claude for Financial Services](https://www.anthropic.com/news/claude-for-financial-services),
but open source and running on your own machine. It supports BYOK, so you can use the AI
subscriptions you already have, and lets you add your own data sources and skills.

We believe what sets one harness apart from another is what it **ENFORCES** and what it
**PRIORITISES**. So we carefully crafted the loop, and everything around it, to make four things
hold:

- **Trusted sources come first.** Research draws on professional data such as SEC EDGAR filings,
  Alpha Vantage and any MCP server, and every source carries a trust tier, from 1 for filings to 4
  for the open web. The open web is only a fallback, and a number backed by the web alone is
  flagged as unverified.
- **The model does no mental math.** It writes Python against a purpose-built finance library, and
  an isolated sandbox runs it, so every derived number is computed, not predicted token by token.
- **Every number traces back to its source.** Each number in an answer or report is recorded in a
  ledger as retrieved, computed, given by you or explicitly assumed, with its source, tier and
  as-of date. The calculator reads its inputs from the ledger by id, and our context compaction
  keeps every number tied to its entry, so long-horizon research stays exact.
- **Reports are built for finance.** A dedicated report tool turns research into a clean document
  or slide deck in HTML. Hover over any number to see where it came from, and every report closes
  with its sources, assumptions and a disclaimer.

> Research tool, not investment advice. See the [disclaimer](#disclaimer).

## What it does

Ask the way you would ask an analyst. The agent plans the steps, gathers the data, computes, and
delivers a report.

- **Review an earnings print.** "NVIDIA beat, so why did the stock fall?" It reads the earnings
  release, compares results with estimates and the new guidance with the old, measures the market's
  reaction, and writes an earnings review.
- **Value a company.** "Is Intel cheap, or a value trap?" It builds the free cash flow history from
  filings, derives a discount rate from Treasury yields and the stock's beta, runs a DCF with a
  sensitivity grid and a multiples cross-check, and shows the growth the current price implies.
- **Build a thesis.** "Nuclear power for AI data centres: which stocks actually benefit?" It
  separates producers with signed data-centre power deals from uranium miners and pre-revenue
  reactor start-ups, weighs the evidence on each, and lays out a thesis with a stance and the risks
  that would break it.
- **Fact-check a claim.** "A post says Berkshire is dumping Apple. Is that true?" It checks the
  claim against Berkshire's own filings and separates what was reported from what is speculation.
- **Compare rivals.** "Compare NVIDIA, AMD and Intel over the last eight quarters." It lines up
  revenue, margins and EPS for each, and the numbers stay exact through every follow-up.
- **Know your portfolio.** Import holdings across accounts from a CSV, an `.xlsx` workbook or a
  pasted table, then ask "Am I too concentrated?" to have them checked against your investor
  profile.
- **Keep watch.** Schedule "Every Monday, brief me on my watchlist" to run on its own, continuing
  the same chat or starting a new one each time.

## Quick start

Requires Node 24+ and [pnpm](https://pnpm.io/installation) 12+. `pnpm install` also downloads the
calculator's Python packages (~30 MB, verified by SHA-256).

```bash
git clone https://github.com/nemofq/open-finance-agent.git
cd open-finance-agent
pnpm install
pnpm dev
```

Open http://localhost:3000 and:

1. **Settings › LLM.** Add a provider: sign in to a subscription, paste a key, or point at an
   endpoint. Validate, Test, Save, then choose a default model.
2. **Settings › Data connections.** Enable the connections you need and give each what it asks
   for. SEC EDGAR and Market Quotes are on by default; EDGAR needs a contact string, which the SEC
   requires, and Alpha Vantage needs an API key.
3. **Settings › General tools.** Optionally add a Tavily key for web search.

Then start a chat and ask your first question, or type `/` to pick a skill.

Settings, chats and holdings live in `~/.open-finance-agent`; set `OFA_HOME` to move them.
[docs/usage.md](docs/usage.md) covers every setting in detail.

### Connect Robinhood with your chosen model

Give a setup-capable agent this request:

> Follow [connect-robinhood](setup-skills/connect-robinhood/SKILL.md) to connect my Robinhood
> account to this checkout. Keep my current model, enable the read tools I need for research,
> and verify a quote through the actual harness.

To choose a different model, include its provider and model name in the request. This portable
[Agent Skills](https://agentskills.io/specification) folder also covers other MCP hosts: copy
`setup-skills/connect-robinhood/` into your agent's documented skill directory, or give it the
`SKILL.md` and its `references/` folder directly. The setup agent needs configuration access;
the app's research chat cannot install connections. Each user completes their own Robinhood
OAuth login. The skill contains no credentials or required model provider.

## Under the hood

### Concerns: the loop, organised by intent

Customising an agent loop means answering two questions at once. Product asks *what must hold*:
no figure reaches the user without a source. Engineering asks *where it happens*: before a tool
call, after it, or when the model wants to stop. Code organised around one question hides the other.

So every customisation is a **concern**: one file, one intent, implementing only the hook points
that intent needs out of the loop's fifteen. `compose()` weaves the concerns into a single loop in a
fixed order. Each file reads as an intent; the composition reads as the loop.

`policy` enforces the standards a careful analyst holds to: trusted sources before the open web,
no personal data sent out, no stale or future-dated data passing unnoticed, no figure without a
source. It spans five points, and the point sets how firmly it acts:

```ts
// src/lib/harness/policy.ts, bodies elided
export const policy = (rules: RuleContext): Concern => ({
  name: "policy",
  beforeTurn,    // Bind the turn, so every verdict lands in its check record
  toolIssued,    // Count each call the model issues, before any check
  beforeTool,    // Block: a web search a data connection covers, personal data leaving, a repeat call
  afterTool,     // Annotate: a stale quote, sources that disagree, data dated after the cutoff
  beforeRunEnd,  // Follow up or flag: unsourced figures, figures only the web backs, advice wording
});

// src/lib/agent/factory.ts, simplified: the loop is its concerns, in order
compose([execution, time, capabilities, user, attachments, conduct, evidence, delivery, policy, compaction, view]);
```

All fifteen hook points, and the rules that keep concerns small, are in
[docs/architecture.md](docs/architecture.md#the-concern-contract).

### A benchmark that favours quality over quantity

A good eval does more than rank. It separates a better model or harness from a worse one, and it
says clearly what to fix. Both come from the quality of the cases, not their number, so we
hand-crafted twelve, covering real 2024 retail-investor situations from earnings surprises and
value traps to leveraged proxies, auditor red flags and portfolio fit, with a pinned offline
dataset of the filings, prices and web pages that were public at each task's cutoff.

Every task runs through the same loop as a chat. Forty points come from deterministic integrity
checks on the trace and the evidence ledger: the required evidence read and used, figures backed by
evidence, and task-specific contracts such as an independently recomputed calculation or a cited
primary filing. Sixty come from an LLM judge that grades each task's rubric items as met, partial,
missed or contradicted, three times per answer, and a missed or contradicted critical item caps the
total at 69 or 49.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/benchmark-quality-cost-dark.svg" />
  <img src="docs/images/benchmark-quality-cost-light.svg" alt="Scatter of total benchmark score against the agent's average cost per run, log scale: Gemini 4 Neon medium 75.1 at $11.37, Claude Fable 5.2 medium 71.4 at $22.37, DeepSeek V4.1 Flash 1017 high 71.1 at $1.21, Gemini 4 Hydrogen medium 69.2 at $6.74, Claude Opus 5.5 medium 68.4 at $7.39, Tencent Hy4 Flash on 67.6 at $0.28, GPT-6.2 Astra medium 62.8 at $5.88, GPT-6.1 Terra medium 60.4 at $0.55, Claude Sonnet 5.5 medium 60.0 at $2.39, Inkling 2 Small medium 59.9 at $0.45, Claude Haiku 5.5 medium 57.9 at $0.19, GPT-6 Luna medium 49.6 at $0.04; a dotted Pareto line joins GPT-6 Luna, Claude Haiku 5.5, Tencent Hy4 Flash, DeepSeek V4.1 Flash 1017 and Gemini 4 Neon" width="100%" />
</picture>

| Model (avg@3) | Thinking effort | Total (/100) ↑ | Integrity (/40) ↑ | Judged (/60) ↑ | Avg. cost (run) ↓ | Avg. run time | Avg. output tokens (run) | Avg. tool calls (run) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Gemini 4 Neon | Medium | 75.1 | 35.6 | 39.5 | $11.37 | 2,399 s | 164,231 | 435 |
| Claude Fable 5.2 | Medium | 71.4 <sub>−1.1 capped</sub> | 33.3 | 39.3 | $22.37 | 1,163 s | 121,474 | 230 |
| DeepSeek V4.1 Flash 1017 | High | 71.1 <sub>−1.2 capped</sub> | 34.2 | 38.1 | $1.21 | 1,870 s | 327,566 | 380 |
| Gemini 4 Hydrogen | Medium | 69.2 <sub>−0.4 capped</sub> | 32.0 | 37.6 | $6.74 | 1,261 s | 201,689 | 460 |
| Claude Opus 5.5 | Medium | 68.4 <sub>−0.3 capped</sub> | 31.7 | 37.1 | $7.39 | 821 s | 83,651 | 160 |
| Tencent Hy4 Flash | On | 67.6 <sub>−1.6 capped</sub> | 34.8 | 34.4 | $0.28 | 1,967 s | 256,758 | 478 |
| GPT-6.2 Astra | Medium | 62.8 <sub>−0.5 capped</sub> | 29.1 | 34.2 | $5.88 | 645 s | 17,775 | 153 |
| GPT-6.1 Terra | Medium | 60.4 <sub>−0.2 capped</sub> | 29.6 | 31.0 | $0.55 | 383 s | 15,776 | 124 |
| Claude Sonnet 5.5 | Medium | 60.0 <sub>−0.3 capped</sub> | 25.7 | 34.6 | $2.39 | 455 s | 58,862 | 109 |
| Inkling 2 Small | Medium | 59.9 | 25.4 | 36.3 | $0.45 | 408 s | 68,769 | 185 |
| Claude Haiku 5.5 | Medium | 57.9 <sub>−0.1 capped</sub> | 26.8 | 31.3 | $0.19 | 577 s | 118,401 | 148 |
| GPT-6 Luna | Medium | 49.6 | 19.8 | 29.7 | $0.04 | 265 s | 10,452 | 74 |

↑ higher is better, ↓ lower is better. (run) is one run of the twelve tasks. Benchmark version 2;
every answer judged by GPT-6.2 Sol at medium thinking, judge prompt v10, three grades per answer;
policy enforced. `avg@3` is three runs of the twelve tasks. Total is the expected score: the
mean over tasks with a failed run counted as zero; Integrity and Judged average the completed
answers only. "−x capped" is what critical caps took off a Total: an answer that contradicts a
task's critical rubric item is capped at 49, one that misses it at 69. In the chart, the dotted
Pareto line joins the rows no other row beats on both cost and Total.

Every row was run on the same release of the app and its model library, with no model-specific
handling, and judged by the same model, so rows are directly comparable. Agents think at medium
unless the model has no medium level: DeepSeek V4.1 Flash 1017 ran at High, and Tencent Hy4 Flash,
which has no levels, with thinking on. Every run completed except one of Inkling 2 Small's 36,
which ended without an answer and counts as zero in its Total.

Cost is the agent's average per run (judging excluded) at each maker's standard list price on the
day the row was added, not any time-limited promotional price; run time counts the model's turns
only. Results published before 2026-11-21 used earlier code and another judge and are kept only in
git history. Per-task scores and the prices used are in
[evals/baselines/README.md](evals/baselines/README.md); the tasks, scoring and how to reproduce a
run are in [evals/README.md](evals/README.md).

## Features

| Area | In this version |
| :--- | :--- |
| **Models** | Anthropic (API key, or Claude Pro/Max sign-in, experimental), OpenAI (API key, or ChatGPT sign-in), GitHub Copilot, Google Gemini, xAI, DeepSeek, OpenRouter, OpenCode Zen and Go, any OpenAI-compatible endpoint; about 25 more from pi-ai under More providers, from Mistral and Groq to Bedrock, Vertex AI and Azure |
| **Data** | SEC EDGAR, Market Quotes, Alpha Vantage, any MCP server; Tavily web search as a fallback |
| **Calculator** | Python sandbox with numpy, pandas, scipy and a finance library (DCF, WACC, IRR, risk, options) |
| **Reports** | HTML documents and slide decks, eight finance templates |
| **Skills** | Eight bundled research workflows; add your own as a `SKILL.md` |
| **Attachments** | Send the model PDF, Word, PowerPoint, Excel, CSV and text files, and images on models that see them |
| **Portfolio** | Holdings across accounts, imported from CSV, `.xlsx` or a pasted table |
| **Also** | Investor profile, memory, scheduled tasks, context compaction |

How these fit together is in [docs/architecture.md](docs/architecture.md).

## Roadmap and contributing

What comes next, in rough order:

- More data connections.
- More skills for everyday research workflows.
- More high-quality benchmark cases, and self-improvement: the harness using the benchmark to
  improve itself.
- The tools users ask for.
- A desktop app.

Contributions are welcome through pull requests, and most of this list is a good place to start:
data connections, skills and tools each have a recipe in [docs/extending.md](docs/extending.md),
and a benchmark task starts as an issue. [CONTRIBUTING.md](CONTRIBUTING.md) covers the checks,
where each change goes and how to open a pull request.

## Security

Open Finance Agent is built for one user on their own machine, and its API has no login: its only
guard refuses writes that another website sends through your browser, so anyone who can reach the
port can run the agent on your keys and read your data. Do not expose it to a network. Keys and
sign-in tokens are stored in `config.json` and `auth.json`, readable only by you
([data folder](docs/usage.md#data-folder-and-privacy)). Report a vulnerability privately through
the repository's Security tab › Report a vulnerability, never in a public issue.

## Disclaimer

This is a research tool. It retrieves, summarises and analyses public financial data and relates
it to the profile you entered. It does not give investment advice, and nothing it produces is a
recommendation to buy or sell anything. Language models make mistakes, including confident ones,
and data providers have outages, delays and revisions. Every number carries its source: check the
ones that matter before you act on them.

## Acknowledgements

Built on these open-source projects:

- [pi-agent-core](https://github.com/earendil-works/pi/tree/main/packages/agent): the minimal
  agent loop our concerns hook into.
- [pi-ai](https://github.com/earendil-works/pi/tree/main/packages/ai): one API for every model
  provider.
- [Pyodide](https://github.com/pyodide/pyodide) and [Deno](https://github.com/denoland/deno): the
  calculator sandbox.
- [NumPy](https://github.com/numpy/numpy), [pandas](https://github.com/pandas-dev/pandas),
  [SciPy](https://github.com/scipy/scipy) and
  [statsmodels](https://github.com/statsmodels/statsmodels): the calculator's math.
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk): MCP servers.
- [PDF.js](https://github.com/mozilla/pdf.js), [mammoth](https://github.com/mwilliamson/mammoth.js)
  and [ExcelJS](https://github.com/exceljs/exceljs): attachments.

## License

MIT. See [LICENSE](LICENSE).
