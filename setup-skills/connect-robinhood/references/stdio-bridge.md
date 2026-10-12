# OAuth bridge for local stdio hosts

Use this recipe when the host can launch a local MCP process but cannot perform HTTP OAuth.
For native OAuth support, use the direct endpoint instead. See the
[bridge documentation for the pinned release](https://github.com/punkpeye/mcp-remote/blob/v0.14.3/README.md).

Install a pinned `mcp-remote` release in a user-owned runtime directory, or use `npx` with the
same version. The example below uses `0.14.3`; check its official documentation when upgrading.
The bridge handles OAuth and token refresh independently of the model provider.

For a host whose documented schema uses `mcpServers`, the connection shape is:

```json
{
  "mcpServers": {
    "robinhood": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@0.14.3",
        "https://agent.robinhood.com/mcp/trading",
        "--transport", "http-only",
        "--auth-timeout", "600"
      ]
    }
  }
}
```

Adapt this shape to the actual host's schema; do not overwrite the whole configuration with it.
This defines a transport, not a tool permission policy. Configure the host's explicit tool
allowlist before exposing the connection to the model. If the host has no allowlist, resolve that
limitation as described in the skill. Do not claim a list of excluded write names will cover
future tools.

Use absolute executable paths if the host does not inherit the terminal's PATH. Some hosts also
need a restart or reload to launch a changed stdio command.

The bridge stores authorization under `~/.mcp-auth` by default. A private, absolute
`MCP_REMOTE_CONFIG_DIR` in the process environment selects a different store. Keep the same
store for preauthorization and normal host launches. On POSIX systems, keep credential
directories mode `0700` and token files mode `0600`; on Windows, use equivalent user-only ACLs.

If the host's connection timeout is too short for interactive login, complete authorization first
with the package's diagnostic client. For example, with the default credential store:

```bash
npx -y --package=mcp-remote@0.14.3 mcp-remote-client \
  https://agent.robinhood.com/mcp/trading --transport http-only --auth-timeout 600
```

The diagnostic client opens the authorization page and lists the server's tools. Let the user
finish the browser flow, then close the diagnostic client and test from the actual host. Listing
tools does not prove that the host's model can call them. For a custom credential directory, set
`MCP_REMOTE_CONFIG_DIR` for both this command and the configured MCP process.

When installing once instead of using `npx`, launch `node` with the absolute path to the installed
`mcp-remote/dist/proxy.js` for normal use, and `dist/client.js` for preauthorization. Keep the
runtime and credentials outside the repository and outside any calculator/code sandbox.
