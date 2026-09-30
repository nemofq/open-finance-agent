import type { McpServerConfig } from "@/lib/config/schema";
import type { FinanceTool, Module, ModuleContext } from "@/lib/tools/contracts";
import { errorMessage } from "@/lib/utils";
import { mcpServerTools } from "@/lib/mcp/tools";

/**
 * User-added MCP servers. Unlike every other module its tools come from `config.mcp.servers`
 * rather than `config.modules.mcp`, which `extraConfig` hands to `createTools` as `servers`.
 */
export const mcpModule: Module = {
  id: "mcp",
  name: "MCP servers",
  kind: "tool",
  description:
    "Connect any Model Context Protocol server (remote HTTP or local stdio) and expose its tools to the agent.",
  settings: [],
  defaultConfig: { enabled: true },
  extraConfig: (config) => ({ servers: config.mcp.servers }),

  async createTools(cfg, ctx: ModuleContext): Promise<FinanceTool[]> {
    const servers = (Array.isArray(cfg.servers) ? cfg.servers : []) as McpServerConfig[];
    const lists = await Promise.all(
      servers
        .filter((server) => server.enabled)
        .map(async (server) => {
          try {
            return await mcpServerTools(server);
          } catch (error) {
            // One unreachable server must not take the whole agent down.
            ctx.log(`MCP server "${server.id}" unavailable: ${errorMessage(error)}`);
            return [];
          }
        }),
    );
    return lists.flat();
  },
};
