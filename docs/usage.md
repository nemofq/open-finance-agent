# Usage reference

This page is for when you are already running the agent and something needs explaining: a setting
you are unsure of, an answer you want to check, or a file that did not import the way you expected.
To get it running, start with the [README](../README.md#quick-start)'s quick start.

## LLM providers

**Settings › LLM** holds the providers the agent can use and the default model for new chats. A
model is always shown as "Provider · Model name".

The **Add provider** dialog shows the providers most people come for first:

| Sign in | API key | Custom endpoint |
| :--- | :--- | :--- |
| Claude (Pro/Max), experimental | OpenRouter | OpenAI-compatible endpoint |
| ChatGPT (Codex) | Anthropic | |
| GitHub Copilot | OpenAI | |
| | Google Gemini | |
| | xAI | |
| | DeepSeek | |
| | OpenCode Zen, OpenCode Go | |

**More providers** opens the rest of what pi-ai supports, by kind, and the search box looks
through all of them by name, company or region:

| Kind | Providers |
| :--- | :--- |
| Sign in | SuperGrok / X Premium (xAI), Meta (Muse, experimental), Kimi Code |
| Model makers | Mistral, Meta, Moonshot AI (global or China), Kimi For Coding, Z.AI GLM Coding Plan (global or China), MiniMax (global or China), Xiaomi MiMo (by token or on a token plan), Qwen Token Plan, Ant Ling |
| Open-model hosts | Groq, Cerebras, Together AI, Fireworks AI, Baseten, NVIDIA, Hugging Face, Cloudflare Workers AI |
| Gateways | Vercel AI Gateway, Cloudflare AI Gateway |
| Cloud platforms | Amazon Bedrock, Google Vertex AI, Azure OpenAI |

A company with regional editions or plans is one row; choosing it asks which edition your account
is on, since each has its own keys. Some providers ask for more than a key, on their card:

| Provider | Asks for |
| :--- | :--- |
| Cloudflare Workers AI | Account ID |
| Cloudflare AI Gateway | Account ID and gateway ID |
| Amazon Bedrock | A Bedrock API key, access keys or an AWS profile on this machine; the region |
| Google Vertex AI | An API key, or the project and location with a gcloud sign-in or a service account file on this machine |
| Azure OpenAI | The resource's endpoint; deployment names only where they differ from the model's |

1. **Add** a provider. Hosted types are added once (Anthropic and xAI appear twice, as a
   subscription and as a key, but only one of each can be added); an endpoint asks for a name, a
   base URL and an optional key and can be added as often as you have endpoints.
2. **Connect.** A key provider takes its key, and anything else it needs, on the card. Values
   marked secret are masked like the key. A sign-in provider opens a dialog that
   shows whatever the flow asks for: a page to open, a device code, a URL to paste back. The
   token is kept in `auth.json` and refreshed automatically.
3. **Validate** checks the provider will answer. A hosted key costs one short request on the
   cheapest model; an OpenRouter key is checked by its credit balance, an endpoint by its model
   list, and a sign-in by its stored token. Bedrock, Vertex AI and Azure are only checked for
   complete settings, since no catalog says which models an account has enabled or deployed;
   **Test** a model to check the account.
4. **Choose a default model** under Defaults, then **Save** that section. Each card and section
   saves only its own edits.
5. **Test** sends "Reply with the single word OK." through the real agent path, with a system
   prompt, a tool and the thinking level, and reports latency and the reply. A model that claims
   image input is asked to read a word off a test picture.

**Signing in from another machine.** The Claude and ChatGPT browser flows redirect to fixed
loopback ports (53692 and 1455); if remote, paste the error page URL into the dialog. GitHub
Copilot, Meta and the ChatGPT device-code option need no port. A sign-in attempt is cancelled when
its dialog closes. The Claude and Meta subscriptions are marked Experimental: Anthropic and Meta
may limit sign-in from other apps, so an API key is the dependable route. Meta's one-day API key is
minted again from the sign-in as it expires, but the sign-in itself cannot be renewed, so once
Meta ends the session, Reconnect signs in again.

**Thinking level** sets reasoning effort for every chat on pi-ai's own scale: Off, Minimal, Low,
Medium, High, Extra high and Max. Each model accepts its own set, from pi-ai's catalog, and the
picker lists the default model's; any other model runs the level pi-ai clamps it to, the nearest
it accepts, and Settings says when the default model does that. Off sends no level: most APIs then
send their own switch to turn thinking off, and a model sent none, or one that cannot turn thinking
off (Off is missing from its list), runs at the provider's default effort, or on Gemini at its
lowest level. Max can use many tokens and hit the per-turn limits. A model that reasons by default
spends its reasoning inside the same output cap as its answer, so give it a generous max tokens.

**Context window matters.** Every budget is a fraction of it: result shrinking, stubbing,
compaction and how much of an attachment is inlined ([context](architecture.md#context),
[attachments](architecture.md#attachments)). A model with no reported window shows a badge asking
for the real value; until then the budgets fall back to fixed defaults.

**OpenRouter** lists only tool-capable models, from a catalog cached for six hours.
**OpenAI-compatible endpoints** (vLLM, LiteLLM, Ollama, LM Studio, a gateway) take a base URL up
to and including the version segment, such as `http://localhost:8000/v1`, and the models you
list, each with a context window, max output tokens (16,384 when empty), image support and a
reasoning flag. Listed models must support tool calling, so enable it on the server (on vLLM,
`--enable-auto-tool-choice` with a `--tool-call-parser`). For a reasoning model, declare what the
server calls each level (sent as `reasoning_effort`; Minimal to High default to their own name,
and Extra high and Max are offered only once named) and how it turns thinking off: `omit` (send
nothing), `none` (`reasoning_effort: "none"`) or `chat-template`
(`chat_template_kwargs.enable_thinking: false`, as vLLM and SGLang serving Qwen expect). Test then
checks that the endpoint reports no reasoning tokens at Off and some at the level.

**Deleting a provider** signs it out. Chats that used its models can still be read, but not
continued. A lapsed sign-in shows a **Reconnect** banner in the chat instead of failing silently.

**A model the provider stops offering.** When an update drops a model that has a successor under a
new name, the default model and standalone scheduled tasks move to the successor at the next
start, and Settings › LLM names the old and new model, with the price change, until you dismiss
it. A model dropped without a successor is flagged under Defaults and never replaced for you, and
a scheduled task on one is paused. A chat keeps the model it started with either way; start a new
chat to use another.

## Data connections

**Settings › Data connections** holds the sources the agent researches with. Each one you enable
is a module the agent can call; each one you leave off makes no calls. Saving a key or contact
into a connection that is off turns it on, here and for Tavily under General tools.

- **SEC EDGAR** (on by default, no key). Enter a contact string such as
  `Jane Doe jane@example.com`; the SEC requires it. Five tools: company lookup, recent filings,
  as-reported XBRL statements, full-text search, and a filing reader that resolves an index down
  to an exhibit. Dated tools honour a point-in-time cutoff.
- **Market Quotes** (on by default, no key): live quotes, daily changes and sector profiles from
  Yahoo Finance as the `market_quotes` tool. While it is on, the portfolio page values holdings
  with it, and it prices the ticker hover card.
- **Alpha Vantage** (optional key) through its official MCP server: quotes, price history,
  fundamentals, earnings history and calendar, transcripts, news sentiment, rates, CPI and ETF
  profiles, behind a tool allowlist you control, with identical calls cached for 15 minutes by
  default (the Cache TTL setting). It also adds its company names to the `$` autocomplete.
- **Any MCP server**, added here as a data connection or under General tools as a general tool;
  see [extending.md](extending.md#mcp-server) for the difference.

## General tools

**Settings › General tools** holds everything else the agent can call.

- **Tavily** (optional key) for `web_search`, with time ranges and domain filters, and
  `web_fetch`, which extracts a page to markdown.
- **Memory**, **skills**, **evidence**, **holdings**, **investor profile**, **scheduled tasks**
  and **attached files** tools are on by default.

## Other settings

| Tab | What it holds |
| :--- | :--- |
| **Financial tools** | The calculator's status and timeout (10 seconds by default), and the default report format. If `pnpm install` could not download the calculator's packages, for example offline, it warns and the calculator stays disabled until `pnpm sandbox:fetch` succeeds. |
| **Skills** | The bundled skills and yours; adds, edits or deletes your own. **Customise** copies a bundled skill, metadata included, into your data folder to edit. |
| **Investor profile** | Experience and role, objective and horizon, risk tolerance, capacity for loss and liquidity needs, allowed instruments and exclusions, jurisdiction and style, with four presets. Applying a preset fills in only the fields it sets. It changes framing and depth, never the evidence standard, and only you write it; the agent reads it but cannot change it. |
| **Memory** | `memory.md`, one document with one Save and a count against the 32,000-character cap. If the agent changed the file after you opened it, Save is refused rather than overwriting it; copy your text, reload and reapply. |

## Using the agent

**Chats.** Each chat is saved in the [data folder](#data-folder-and-privacy). The model titles
the chat during the first turn. The sidebar lists chats by date or by ticker. Ctrl/Cmd+K starts a
chat, Ctrl/Cmd+B collapses the sidebar.

**Model per chat.** The composer footer picks the model for a new chat; after the first message
it is locked, and changing the default later does not move existing chats.

**Attachments.** The paperclip, a drop or a paste takes up to five files per message, 20 MB each,
and up to four images on a model that accepts them. A file is read when you pick it, so its chip
shows the pages, slides or sheets it holds. A file is
[data, never instructions](architecture.md#attachments).

| What you attach | How it reaches the model |
| :--- | :--- |
| Prose: `.md`, `.txt`, `.html`, `.htm`, `.docx`, `.doc`, `.pptx`, `.pdf` | As Markdown: whole if it fits the window, otherwise as an outline and a digest the agent reads back with `read_attachment` |
| A scanned PDF page | Rendered as an image, on a model that accepts images |
| A spreadsheet: `.csv`, `.xlsx` | As its columns and first rows; the whole table is registered as evidence and computed on through the calculator |
| An image: PNG, JPEG, WebP, GIF | As an image, on a model that accepts them |
| `.ppt`, `.xls`, or a `.csv` or `.xlsx` that is really a web page or XML export | Refused, with the fix: save as `.pptx`, or as `.xlsx` or `.csv` |

**Context.** The composer shows how full the context is. Near the limit the chat is
[compacted](architecture.md#context) into a research checkpoint, shown under a divider with the
history still above it. `/compact` does it on demand.

**Memory.** `memory_update` appends, replaces or removes single-line bullets under Preferences,
Watchlist and Notes in `memory.md`, for things that stay true beyond the chat; a replace or remove
whose `match` fits more than one bullet is refused. Edit the file in Settings or any editor. It is
re-read at the start of every turn and goes into the system prompt inside a `<memory>` block,
without its HTML comments; the untouched template adds nothing. The file is capped at 32,000
characters: the agent and Settings are refused a save that would go past it.

**Scheduled tasks.** `/scheduled` stores one-time and RFC 5545 recurring tasks; a time is read in
the task's own time zone. A chat's **Schedule** button opens the same editor, set to continue that
chat. The agent can create, update or pause them, and delete one only when you ask; a scheduled run
can pause its own task when its instructions say to stop. A task continues a linked chat or creates
one per run, and leaves unread results in the app. A task whose linked chat, model or provider is
gone is paused, with the reason on its card. The server must be running; after a restart
only the latest missed run of a recurring task is caught up. There are no external notifications.

## Reading an answer

Every number is retrieved (E), computed (C), assumed (A) or given by you (U), and every source has
a tier from 1, filings, to 4, the open web and your attachments
([precise definitions](architecture.md#evidence)).

**Tool cards** show each call's class, source tier, as-of date, a summary of its arguments and its
status; expand one to check the agent's arithmetic against what the source returned.

**The answer footer** always shows figures, retrieved, computed and unsourced, and adds assumed,
conflicts, unverified and flags when there are any. Numbers you gave count in the total and are
tagged "from you" in the expanded list.

**Drafts.** When a rule sends an answer back, the model revises it in the same turn. The revision
is the answer; the first attempt collapses into a "Draft answer, revised" line and is hidden from
the model on later turns.

**`$TICKER` chips** render everywhere with a hover card (company and CIK from EDGAR, a quote from
Market Quotes, a link to filings). `$` in the composer autocompletes.

**Number markers.** In a report every number carries a marker such as `C4`; hover it to see the
value, the formula and its inputs, or the source and its as-of date. A number the evidence could
not confirm is listed under Verification notes rather than silently kept.

## Skills and reports

**Skills.** `/` lists the skills; picking one prepends its instructions. The model can also load a
skill itself through `read_skill`, so asking in plain words works too. Substantive analysis goes
to `create_report` by default and the chat reply is a short conclusion; ask for it "in chat",
"briefly" or with "no report" and the answer stays in the chat.

| Skill | Ask like | Delivers |
| :--- | :--- | :--- |
| `stock-brief` | "Tell me about $CEG. What does it actually do?" | Business, key metrics, valuation, recent developments, risks |
| `earnings-preview` | "Microsoft reports next week. What is priced in?" | Setup, expectations, what matters this quarter, scenarios, risks, stance |
| `earnings-review` | "NVIDIA beat, so why did the stock fall?" | Results vs expectations, guidance, drivers, reaction, stance |
| `valuation` | "Is Intel cheap, or a value trap?" | DCF with a multiples cross-check: approach, inputs, valuation, sensitivity, stance |
| `peer-comps` | "Compare NVIDIA, AMD and Intel over the last eight quarters." | Peer set, comparison, read-through |
| `filing-changes` | "What changed in Tesla's risk factors in the latest 10-K?" | Filing, what changed, why it matters |
| `portfolio-check` | "Am I too concentrated?" | Holdings, concentration, fit with profile, in chat |
| `thesis-check` | "I bought into nuclear power for AI data centres. Does my thesis still hold?" | Thesis, evidence since, verdict |

A report renders as a document or a deck; **Open in new tab** gives a printable view and
**Download HTML** saves it; its numbers read as [above](#reading-an-answer). The closing sections
and the disclaimer are [generated](architecture.md#reports). The reports column shows the chat's
reports, with a gallery when there are several, and can be resized or hidden. To write your own
skill, see [extending.md](extending.md#skill).

## Portfolio and holdings import

`/portfolio` tracks holdings across accounts on an append-only transaction ledger, and is the one
place they are edited: add, edit and delete accounts; add, change or remove a position, each change
recorded as a ledger adjustment; record a buy, sell or dividend; and import positions from a CSV
file, an `.xlsx` workbook (pick the worksheet) or a pasted table. Settings › Investor profile
links to it. Headers are matched ignoring case, with `_ ( ) / -` read as spaces, and can be
corrected in the preview; **Assist mapping** asks your default model to suggest the mapping
instead.

| Field | Recognised headers | Required |
| :--- | :--- | :--- |
| `symbol` | symbol, ticker, security, cusip, isin | Unless `name` is given |
| `name` | name, description, security name, asset, holding | Unless `symbol` is given |
| `quantity` | quantity, qty, shares, units, position | Unless `marketValue` is given |
| `price` | price, last price, market price, unit price | Optional |
| `marketValue` | market value, value, current value, mv, total value | Unless `quantity` is given |
| `costBasis` | cost basis, cost, book value, total cost, average cost, avg cost | Optional |

Every position is imported in USD; a currency column is not read. A row with a symbol is a
security; a row with only a name is a custom asset such as cash. Market value is computed from
quantity and price when omitted. The **Cost basis type** select reads the column as Total cost
(the default) or Per-unit cost. Currency symbols, commas, percentages and accounting negatives are
cleaned; blanks such as `-`, `n/a` and `none` are empty. Rows with neither quantity nor value, or
with a number that cannot be read, are flagged and can be excluded. Zero and negative quantities
are kept as records; a short position is not counted as a holding.

A table is imported whole or not at all: a file over 20 MB, 50,000 rows or 200 columns is refused
with a message naming the limit, so split it and import each part.
[`src/lib/portfolio/fixtures/portfolio-import-usd-only.csv`](../src/lib/portfolio/fixtures/portfolio-import-usd-only.csv)
is a complete example you can copy, with `Ticker`, `Description`, `Quantity`, `Last Price`,
`Market Value` and `Cost Basis`, plus `Currency`, `Scenario` and `Notes` columns that are not
read. Its rows cover a value-only row, name-only assets, a derived market value, a missing cost
basis, a short and a zero position, a duplicate ticker, a summary row and an invalid number;
`src/lib/portfolio/fixture.test.ts` checks the import.

## Data folder and privacy

Everything lives in `~/.open-finance-agent`, or in `OFA_HOME`:

```
config.json                 settings, providers and API keys, mode 0600
auth.json                   sign-in tokens, mode 0600
memory.md                   durable facts the agent keeps across chats
profile.json                your investor profile; only Settings writes it. A file that cannot be
                            read is renamed profile.json.invalid-<time>, not overwritten
portfolio/                  accounts, instruments, transactions, imports
sessions/<id>.json          one file per chat, atomic writes
sessions/<id>/evidence/     full payloads behind that chat's numbers; deleted with the chat
sessions/<id>/attachments/  what you attached, with the text read out of each file
staging/                    uploads waiting for a chat to claim them; swept after a day
scheduled-tasks/            scheduled tasks
scheduled-runs/<task>/      the record of each scheduled run
skills/<name>/              your own skills, overriding bundled ones by name
runtime/calc-*/             the calculator runtime, one folder per version of its sources, with no
                            config, chats or holdings in it; delete old ones while the app is stopped
cache/                      TTL cache for provider responses
```

The tree is created with mode 0700. There is no telemetry, no analytics and no backend of ours.

### What leaves your machine

**Only what a chat needs, and only to the services you chose.**

- **At install**, the calculator's Python packages are downloaded from jsDelivr, once per version,
  each verified against a pinned SHA-256.
- **During a chat**, calls go to the LLM provider you chose and the data providers you enabled;
  disable a module and it makes no calls.
- **Opening Portfolio** sends the symbols you hold, not quantities or costs, to Yahoo Finance for
  live prices while Market Quotes is on; with it off, holdings are shown without them.
- **Your holdings** reach the LLM only when the agent calls `portfolio_get`, which shows as a tool
  card, and the [privacy rule (P3)](architecture.md#the-rules) keeps them out of web and general
  MCP calls.
- **Assist mapping** in the import dialog sends the table's headers and first three rows to your
  default model.
- **Attached files** are parsed locally; their text reaches the LLM like the rest of the chat, but
  of a spreadsheet only its columns and first rows do; the full table goes to the local
  calculator.
- **Your profile** is a small block in the system prompt.

Nothing from the calculator leaves: it
[has no network](architecture.md#the-calculator-is-a-process-boundary). The date, time zone and
market calendar are computed locally.

Secrets are masked as `••••` when config is sent to the browser; saving a masked value means
"unchanged", so a key never travels back out of the process that holds it.

## Environment variables

| Variable | Purpose |
| :--- | :--- |
| `OFA_HOME` | The data folder; defaults to `~/.open-finance-agent` |
| `OFA_DEV_ORIGINS` | Hostnames, comma-separated, allowed to reach `next dev` from another machine. The API's cross-site guard also accepts writes from them, under `next start` too |
| `OFA_POLICY_OBSERVE=1` | Run every rule in observe mode: recorded, never enforced. A development switch |
| `OFA_PYODIDE_CDN` | A mirror for the calculator's Python package download, which otherwise comes from jsDelivr |
| `OFA_PARSE_WORKER` | The path of the attachment parse worker, for a deployment that moves the sources out of `src/` |

The variables that only tests read are in [CONTRIBUTING.md](../CONTRIBUTING.md#checks).
