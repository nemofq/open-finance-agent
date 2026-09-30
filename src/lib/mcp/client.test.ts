import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "@/lib/config/schema";

/** What a fake transport was built with, so a test can tell which connection a call reached. */
interface FakeTransport {
  kind: "http" | "sse" | "stdio";
  target: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

const fakes = vi.hoisted(() => ({ clients: [] as { transport?: FakeTransport; closed: boolean }[] }));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    transport?: FakeTransport;
    closed = false;
    onclose?: () => void;
    onerror?: () => void;
    constructor() { fakes.clients.push(this); }
    async connect(transport: FakeTransport) { this.transport = transport; }
    async close() { this.closed = true; this.onclose?.(); }
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    kind = "http"; target: string; headers?: Record<string, string>;
    constructor(url: URL, options?: { requestInit?: { headers?: Record<string, string> } }) { this.target = url.href; this.headers = options?.requestInit?.headers; }
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({ SSEClientTransport: class {} }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    kind = "stdio"; target: string; env?: Record<string, string>;
    constructor(options: { command: string; args: string[]; env: Record<string, string> }) { this.target = [options.command, ...options.args].join(" "); this.env = options.env; }
  },
}));

const { connect, disconnect } = await import("./client");

const http: McpServerConfig = { id: "fmp", name: "FMP", enabled: true, transport: "http", url: "https://mcp.example/a", headers: { Authorization: "Bearer one" } };
const stdio: McpServerConfig = { id: "local", name: "Local", enabled: true, transport: "stdio", command: "server", args: ["--x"], env: { TOKEN: "one" } };

afterEach(async () => {
  await Promise.all([disconnect(http.id), disconnect(stdio.id), disconnect("alphavantage")]);
  fakes.clients.length = 0;
});

describe("the MCP connection pool", () => {
  it("reuses a connection while the server is unchanged, whatever else is edited", async () => {
    const first = await connect(http);
    expect(await connect({ ...http, name: "Renamed", allowTools: ["quote"], cacheTtlSeconds: 60 })).toBe(first);
    expect(await connect({ ...http, headers: { ...http.headers } })).toBe(first);
    expect(fakes.clients).toHaveLength(1);
  });

  it.each<[string, Partial<McpServerConfig>]>([
    ["a rotated token", { headers: { Authorization: "Bearer two" } }],
    ["a new URL", { url: "https://mcp.example/b" }],
  ])("reconnects after %s and closes the superseded connection", async (_label, edit) => {
    const before = await connect(http);
    const after = await connect({ ...http, ...edit });
    expect(after).not.toBe(before);
    expect(fakes.clients.map((client) => client.closed)).toEqual([true, false]);
    expect((after as unknown as { transport: FakeTransport }).transport).toMatchObject({ kind: "http", target: edit.url ?? http.url, headers: edit.headers ?? http.headers });
    expect(await connect({ ...http, ...edit })).toBe(after);
  });

  it.each<[string, Partial<McpServerConfig>]>([
    ["command", { command: "other" }],
    ["args", { args: ["--y"] }],
    ["env", { env: { TOKEN: "two" } }],
  ])("reconnects a stdio server after its %s change", async (_label, edit) => {
    const before = await connect(stdio);
    expect(await connect({ ...stdio, ...edit })).not.toBe(before);
    expect(fakes.clients.map((client) => client.closed)).toEqual([true, false]);
  });

  it("does not hand a user server the preset's connection that shares its id", async () => {
    const preset = await connect({ ...http, id: "alphavantage", url: "https://mcp.alphavantage.co/mcp?apikey=old" });
    const rekeyed = await connect({ ...http, id: "alphavantage", url: "https://mcp.alphavantage.co/mcp?apikey=new" });
    expect(rekeyed).not.toBe(preset);
    expect((rekeyed as unknown as { transport: FakeTransport }).transport.target).toBe("https://mcp.alphavantage.co/mcp?apikey=new");
  });

  it("forgets a connection whose transport closed, and disconnect closes by id", async () => {
    const first = await connect(http);
    await first.close();
    const second = await connect(http);
    expect(second).not.toBe(first);
    await disconnect(http.id);
    expect(fakes.clients.map((client) => client.closed)).toEqual([true, true]);
    expect(await connect(http)).not.toBe(second);
  });
});
