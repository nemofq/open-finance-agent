/**
 * The MCP shapes the settings page and the server share. Types only, so browser code can import
 * them without pulling in the MCP SDK.
 */

/** JSON Schema an MCP server declares for a tool's arguments. */
export interface McpInputSchema {
  type: "object";
  properties?: Record<string, object>;
  required?: string[];
  [key: string]: unknown;
}

/** One tool a server lists, as the settings allowlist offers it (`GET /api/mcp/servers/[id]/tools`). */
export interface McpToolInfo {
  name: string;
  description: string;
}
