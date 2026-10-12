# Open Finance Agent recipe

Run this setup from an agent or terminal that can configure the checkout. The application's
research chat has no shell/configuration tool; loading this as an in-chat research playbook
cannot install an MCP connection. Keep this setup skill separate from the bundled research
playbooks under `skills/`.

## Keep the user's model

Inspect Settings > LLM and the active configuration. Preserve `llm.providers`,
`llm.defaultModel`, and `llm.thinkingLevel` unless the user requests a model change. When a model
is requested, configure that provider through the existing LLM workflow and test it. The model
must support tools; subscription OAuth and API-key billing are different choices. Never copy the
skill author's credentials or assume the user wants the author's provider/model.

New chats use the configured default model. Existing chats retain their saved model. Use a new
chat to verify a changed default.

## Install and authorize the bridge

This checkout's `src/lib/mcp/client.ts` supports HTTP with static headers and local stdio, but
does not supply an HTTP `authProvider`. Use the [stdio bridge](stdio-bridge.md) for Robinhood
unless a newer checkout has implemented native OAuth.

Resolve the application's active data directory: `OFA_HOME` from the running app, or
`~/.open-finance-agent` by default. Normalize it to an absolute path on the user's machine. Do not
change `OFA_HOME` to make this recipe work. The install layout is:

```text
application data directory/
  config.json
  mcp-runtime/node_modules/mcp-remote/dist/proxy.js
  mcp-runtime/node_modules/mcp-remote/dist/client.js
  mcp-auth/
```

Install `mcp-remote@0.14.3` with `npm install --prefix` targeting the `mcp-runtime` directory.
Create `mcp-auth` with user-only permissions. Launch the installed `dist/client.js` with Node,
the official Robinhood endpoint, `--transport http-only --auth-timeout 600`, and
`MCP_REMOTE_CONFIG_DIR` set to the absolute `mcp-auth` path. The user completes browser login.
Use the same directory for the saved connection.

Preauthorization matters: the project's MCP initialization timeout is 20 seconds, while a human
login can take longer. Complete the standalone authorization before testing in Settings or
building the harness. A bridge timeout flag does not extend the project's timeout.

## Save the connection

Add or update this server by id in `config.mcp.servers`, adapting the absolute paths to the user.
The minimal test scope is one public quote tool:

```json
{
  "id": "robinhood",
  "name": "Robinhood",
  "enabled": true,
  "class": "data",
  "tier": 2,
  "coverage": ["prices"],
  "transport": "stdio",
  "command": "/absolute/path/to/node",
  "args": [
    "/absolute/app-data/mcp-runtime/node_modules/mcp-remote/dist/proxy.js",
    "https://agent.robinhood.com/mcp/trading",
    "--transport", "http-only",
    "--auth-timeout", "600"
  ],
  "env": {
    "MCP_REMOTE_CONFIG_DIR": "/absolute/app-data/mcp-auth"
  },
  "allowTools": ["get_equity_quotes"],
  "cacheTtlSeconds": 0
}
```

`allowTools` contains raw MCP names. **An absent or empty list exposes every advertised tool**;
keep it nonempty for research. Use the discovered catalog to add specific read tools needed for
the user's workflow. Update `coverage` only for domains those enabled tools actually cover.
The harness exposes names such as `robinhood__get_equity_quotes` and records a data connection's
results as evidence. Account reads still contain personal information; request them only when
the user's workflow needs them.

Save through Settings > Data connections > MCP servers, or use the existing
`readConfig()`/`writeConfig()` functions in `src/lib/config/store.ts` from a local setup script
run with the project's `tsx`. They validate the schema and write atomically with mode `0600`.
Back up the active file with the same permissions first. Merge the server entry; preserve other
servers and all unrelated fields. Ensure `modules.mcp.enabled` is true. Do not persist temporary
verification filters as the user's module settings.

## Verify from the project

1. **Test connection:** Settings lists the saved server's tools through
   `/api/mcp/servers/robinhood/tools`. Confirm the desired tools are checked in the allowlist.
2. **Direct execution:** `mcpServerTools(server)` in `src/lib/mcp/tools.ts` returns the filtered
   harness tools. Call the quote tool using its live `parameters` schema. For the currently
   advertised quote schema, `symbols` is an array, for example `{ "symbols": ["AAPL"] }`.
3. **Actual chat:** Use a fresh chat with the user's chosen model and the smoke-test prompt from
   the skill. Confirm the Robinhood execution event, a successful result, an evidence entry, and
   an answer matching the raw quote's price, timestamp, and regular/extended-hours session.

For a scripted harness check, use `buildAgent()` from `src/lib/agent/factory.ts` and the normal
`agent.prompt()` path. An isolated `withDataDir()` test folder keeps the test transcript out of
user chats. Keep the real model and the real connection; never replace a failed model with a
stub and label that an end-to-end pass. Disconnect the MCP test client and close any test-owned
model transport/process when the test ends.

If a stage fails, report it separately. A saved server or a successful direct quote is not proof
that the selected model answered correctly. Do not edit harness policy or source tiers to make
a connection check pass.
