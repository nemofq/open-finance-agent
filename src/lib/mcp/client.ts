import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createHash } from "node:crypto";
import type { McpServerConfig } from "@/lib/config/schema";
import { processSingleton } from "@/lib/process-state";
import type { McpToolInfo } from "./types";

const CONNECT_TIMEOUT_MS = 20_000;
const CLIENT_INFO = { name: "open-finance-agent", version: "0.1.0" };

/* ------------------------------------------------------------------- pool */

interface PoolEntry {
  id: string;
  client: Promise<Client>;
}

/**
 * One pool per process, so Next's dev-mode module reloads do not leak child processes. The key is
 * renamed with the entry shape, so a dev-mode reload never reads the old shape.
 */
function pool(): Map<string, PoolEntry> {
  return processSingleton("mcp.pool-by-connection", () => new Map<string, PoolEntry>());
}

/** Object keys in a fixed order, so the same headers or env always hash the same. */
const sorted = (record: Record<string, string> | undefined): [string, string][] =>
  Object.entries(record ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * The pool key: the server id and a hash of every field that shapes the connection. An edited
 * URL, a rotated token in a header or the URL, or a changed command is a different connection,
 * and a user server that reuses a preset's id never gets the preset's. Hashed, so no header or
 * env secret sits in the key.
 */
function poolKey(server: McpServerConfig): string {
  const shape = [server.transport, server.url ?? null, sorted(server.headers), server.command ?? null, server.args ?? [], sorted(server.env)];
  return `${server.id}#${createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 16)}`;
}

function close(entry: PoolEntry): Promise<void> {
  return entry.client.then((client) => client.close()).catch(() => undefined);
}

/** Forget a pooled connection once its transport is gone, so the next call reconnects. */
function evict(key: string, client: Client): void {
  const entry = pool().get(key);
  if (!entry) return;
  void entry.client.then(
    (pooled) => {
      if (pooled === client && pool().get(key) === entry) pool().delete(key);
    },
    () => {
      if (pool().get(key) === entry) pool().delete(key);
    },
  );
}

/** Close and forget every connection of one server. */
function closeAll(id: string): Promise<void>[] {
  const closing: Promise<void>[] = [];
  for (const [key, entry] of pool()) {
    if (entry.id !== id) continue;
    pool().delete(key);
    closing.push(close(entry));
  }
  return closing;
}

/** Close and forget the connection to one server. */
export async function disconnect(id: string): Promise<void> {
  await Promise.all(closeAll(id));
}

/* --------------------------------------------------------------- connect */

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

/** A Streamable HTTP endpoint that is absent or rejects the POST: worth retrying over SSE. */
function isHttpClientError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" && code >= 400 && code < 500;
}

function requireUrl(server: McpServerConfig): URL {
  if (!server.url) throw new Error(`MCP server "${server.id}" has no URL`);
  return new URL(server.url);
}

function stdioTransport(server: McpServerConfig): Transport {
  if (!server.command) throw new Error(`MCP server "${server.id}" has no command`);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: { ...inherited, ...server.env },
    stderr: "inherit",
  });
}

async function connectWith(server: McpServerConfig, key: string, transport: Transport): Promise<Client> {
  const client = new Client(CLIENT_INFO);
  client.onclose = () => evict(key, client);
  client.onerror = () => evict(key, client);
  try {
    await withTimeout(
      client.connect(transport, { timeout: CONNECT_TIMEOUT_MS }),
      CONNECT_TIMEOUT_MS,
      `MCP server "${server.id}" did not respond within ${CONNECT_TIMEOUT_MS / 1000}s`,
    );
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  return client;
}

async function open(server: McpServerConfig, key: string): Promise<Client> {
  if (server.transport === "stdio") return connectWith(server, key, stdioTransport(server));

  const url = requireUrl(server);
  const requestInit = server.headers ? { headers: server.headers } : undefined;
  try {
    return await connectWith(server, key, new StreamableHTTPClientTransport(url, { requestInit }));
  } catch (error) {
    if (!isHttpClientError(error)) throw error;
    // Servers predating Streamable HTTP answer the POST with 4xx; they still speak the older SSE transport.
    return await connectWith(server, key, new SSEClientTransport(url, { requestInit }));
  }
}

/**
 * Connect to a server, reusing the pooled connection when one is alive and was made from the
 * same definition. A connection made from an older definition of the server is closed.
 */
export function connect(server: McpServerConfig): Promise<Client> {
  const key = poolKey(server);
  const existing = pool().get(key);
  if (existing) return existing.client;

  // Only one definition of a server is current; the connection made from the last one goes.
  void Promise.all(closeAll(server.id));
  const entry: PoolEntry = {
    id: server.id,
    client: open(server, key).catch((error: unknown) => {
      if (pool().get(key) === entry) pool().delete(key);
      throw error;
    }),
  };
  pool().set(key, entry);
  return entry.client;
}

/** The tools a server advertises. Used by the settings UI to build a tool allowlist. */
export async function listServerTools(server: McpServerConfig): Promise<McpToolInfo[]> {
  const client = await connect(server);
  const { tools } = await client.listTools();
  return tools.map((tool) => ({ name: tool.name, description: tool.description ?? "" }));
}
