import type { McpServerClass } from "@/lib/config/schema";

/**
 * What an MCP server is to the harness. Only a server marked as a data connection is one; a
 * server with no class, or any other value, is a general tool. The agent and Settings both read
 * the class through here, so the default is one rule. Browser-safe.
 */
export function serverClass(server: { class?: unknown }): McpServerClass {
  return server.class === "data" ? "data" : "general";
}
