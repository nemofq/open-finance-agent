import { afterAll, describe, expect, it } from "vitest";
import type { McpServerConfig } from "@/lib/config/schema";
import { disconnect, listServerTools } from "./client";

/**
 * Proves the Streamable HTTP path against a real, keyless public server. Off by default so
 * CI and offline checkouts stay green; run with `OFA_LIVE_TESTS=1 pnpm test`.
 */
const live = process.env.OFA_LIVE_TESTS ? describe : describe.skip;

const deepwiki: McpServerConfig = {
  id: "deepwiki-live-test",
  name: "DeepWiki",
  enabled: true,
  transport: "http",
  url: "https://mcp.deepwiki.com/mcp",
};

afterAll(async () => {
  await disconnect(deepwiki.id);
});

live("listServerTools against a public MCP server", () => {
  it("connects over Streamable HTTP and lists tools", async () => {
    const tools = await listServerTools(deepwiki);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBeTruthy();
    expect(typeof tools[0].description).toBe("string");
  }, 30_000);
});
