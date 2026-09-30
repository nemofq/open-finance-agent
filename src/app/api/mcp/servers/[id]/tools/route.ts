import { errorResponse, jsonError } from "@/app/api/http";
import { readConfig } from "@/lib/config/store";
import { listServerTools } from "@/lib/mcp/client";
import { errorMessage } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

/**
 * Lists a saved MCP server's tools so the settings UI can offer a tool allowlist. Only a saved
 * server: the dialog saves before it tests, so the stored secrets, never the masks the page holds,
 * are what the server is sent.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const server = readConfig().mcp.servers.find((s) => s.id === id);
    if (!server) return jsonError("Unknown MCP server", 404);
    try {
      const tools = await listServerTools(server);
      return Response.json({ tools: tools.map(({ name, description }) => ({ name, description })) });
    } catch (err) {
      // The server could not be reached or refused the call: its failure, told as a bad gateway.
      return jsonError(errorMessage(err), 502);
    }
  } catch (err) {
    return errorResponse(err);
  }
}
