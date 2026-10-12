---
name: connect-robinhood
description: Connect a user's own Robinhood account to their chosen MCP client or agent harness, preserving their chosen model. Use for Robinhood MCP setup, OAuth authorization, and connection troubleshooting, including Open Finance Agent. This skill configures and verifies the connection; it does not execute trades.
license: MIT
---

# Connect Robinhood

Connect the official Robinhood Trading MCP endpoint to the user's chosen host:

```text
https://agent.robinhood.com/mcp/trading
```

The host runs MCP and executes tools; the model receives tool definitions and results through
that host. Keep these choices separate. A model API URL is not an MCP endpoint.

## Establish the target

Identify the host, its active configuration, and the requested provider/model from the user's
request or existing setup. Ask only for missing choices. Preserve the existing model unless the
user asks to change it. Model authentication and Robinhood OAuth are separate connections.

Use any model the host supports that can make structured tool calls. If the requested model
cannot use the host's tools, explain the incompatibility before substituting a model. Connecting
Robinhood in one app does not automatically connect another app or harness.

For Open Finance Agent, follow [the project recipe](references/open-finance-agent.md).
For another host, use its official MCP configuration and authorization documentation. If you
only have chat access, give the user the concrete UI steps; report completion after verification.

## Connect and authorize

Check [Robinhood's onboarding instructions](https://robinhood.com/us/en/support/articles/onboarding-an-external-agent/)
and the host's current documentation before changing its configuration.

- **Native OAuth:** Prefer the host's Streamable HTTP connection with OAuth. Add the endpoint
  above and run the host's connect/authenticate action.
- **Local stdio host without HTTP OAuth:** Use the documented
  [mcp-remote bridge](references/stdio-bridge.md). HTTP support with static headers alone cannot
  complete Robinhood's OAuth login.
- **Custom HTTP client:** Use the MCP SDK's `OAuthClientProvider` and persistent credential store,
  following its [client guide](https://ts.sdk.modelcontextprotocol.io/client) and the
  [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
  If neither native OAuth nor the stdio bridge is available, state the missing capability before
  implementing a client.

Merge the connection into the host's existing configuration. Preserve unrelated servers,
providers, keys, defaults, and saved conversations. Back up a file before editing it; use the
host's supported save path or an atomic, validated write.

The user completes Robinhood login and any onboarding on Robinhood's own page. Keep tokens in
the host's private credential store. Never ask for a brokerage password or paste tokens into
chat, source code, process arguments, or logs. Give each host its own authorization rather than
copying another app's rotating refresh tokens. Follow the official onboarding for account
eligibility; a research connection does not require placing a test trade.

## Select tools for the requested scope

Discover the live tool catalog and input schemas. Tool names and counts can change.

For research setup, start with a nonempty host-enforced allowlist of the required read tools;
`get_equity_quotes` is sufficient for the public-data smoke test. Add account, holdings, filing,
or other read tools when they are part of the user's requested workflow. Review each tool's
description/schema and annotations; do not infer permissions from its name alone.

Enforce the allowlist in the host's tool exposure/execution layer. A prompt saying "read only"
does not restrict access. The bridge's deny patterns are not a complete read-only allowlist.
If a host cannot enforce the requested scope, state that limitation before enabling broader
access. This setup request does not authorize orders, exercises, cancellations, alerts,
watchlist edits, or other account mutations.

## Verify the connection and the selected model

Verify these independently, in order:

1. **MCP:** Initialize the connection and list tools after authorization. Confirm the configured
   scope and use the returned schema to build arguments.
2. **Tool execution:** Call one public quote tool for a user-specified symbol, or AAPL as a
   smoke-test default. Avoid reading private account data solely to test connectivity.
3. **Model through the host:** Start a fresh chat with the user's selected model. Ask it to call
   that quote tool and report the returned price and timestamp. Inspect the execution trace;
   a plausible textual answer or a model's "connected" message is insufficient.

Example prompt (replace the tool name with the host's actual exposed name):

> Call the Robinhood equity quote tool for AAPL. Report the price and its timestamp from the
> returned data. Use the most recent available regular-session or extended-hours trade and
> identify the session. This is a connection test; do not take any account actions.

Check the model's answer against the raw result, including timestamps. A successful tool call
with a misread price is a data-interpretation failure, not a passed end-to-end test. In a harness
with evidence tracking, verify the quote also produced a source/evidence entry.

Report the host, provider/model, transport, credential storage location (no secret values),
enabled scope, and what each verification step actually proved. Saved configuration, authorized
MCP access, and a verified model-to-tool answer are distinct completion states.

## Resolve failures at their source

- For an authorization error, use the host's reconnect flow for this server and verify account
  eligibility. Do not erase other connections or credential stores.
- For a callback problem, check the documented loopback listener, port, and browser location.
  For a remote host, follow its documented device-code or callback-forwarding flow.
- For a tool argument error, read the live schema and correct the arguments. Do not guess a new
  API or silently drop the failed call.
- For a model outage (for example, its endpoint returns 503), report which model endpoint failed
  and whether MCP/tool execution already passed. Keep the requested model; request a working
  endpoint or wait for the user to restore service.

Stop after an actionable persistent failure. Include the failed operation, sanitized status/error,
and next step. Never claim the integration passed because an error was suppressed or a different
model answered.
