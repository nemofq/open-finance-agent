/**
 * A scripted OpenAI-compatible endpoint for the browser smoke test. The app talks to it as it
 * would to any `openai-compatible` provider, through the production agent loop, so the test
 * exercises the real HTTP, SSE and UI paths without a model or a network.
 *
 * On start it also writes the scratch data directory the app runs on: a config whose only
 * provider is this stub and whose data modules are off, so nothing reaches the internet.
 *
 * The script, by what the request looks like:
 * - the chat-naming prompt gets a title;
 * - a request carrying a tool result gets the closing answer;
 * - anything else streams a sentence and calls `create_report`.
 *
 * `GET /requests` returns every chat completion body received, so the test can check what the
 * model was sent.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

/** What the stub says, shared with the test that checks it was said. */
const script = JSON.parse(readFileSync(new URL("./script.json", import.meta.url), "utf8")) as {
  port: number;
  title: string;
  opening: string;
  closing: string;
  summary: string;
};
const { port } = script;
const home = process.env.OFA_HOME;
if (!home) throw new Error("OFA_HOME must name the scratch data directory");
// The directory is wiped below, so it must be a scratch directory under the system temp dir, never
// a real data directory an inherited or mistyped OFA_HOME might name.
const fromTmp = path.relative(path.resolve(tmpdir()), path.resolve(home));
if (fromTmp === "" || fromTmp.startsWith("..") || path.isAbsolute(fromTmp)) {
  throw new Error(`Refusing to delete OFA_HOME=${home}: the scratch data directory must be inside ${tmpdir()}`);
}

rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
writeFileSync(
  path.join(home, "config.json"),
  JSON.stringify(
    {
      version: 3,
      llm: {
        providers: [
          {
            id: "stub",
            name: "Stub",
            type: "openai-compatible",
            apiKey: "",
            baseUrl: `http://127.0.0.1:${port}/v1`,
            models: [{ id: "stub-model", name: "Stub model", contextWindow: 128_000, maxTokens: 8192 }],
          },
        ],
        defaultModel: { provider: "stub", model: "stub-model" },
        thinkingLevel: "off",
      },
      modules: {
        edgar: { enabled: false },
        alphavantage: { enabled: false },
        tavily: { enabled: false },
        quotes: { enabled: false },
        python: { enabled: false },
        mcp: { enabled: false },
        scheduled: { enabled: false },
      },
      mcp: { servers: [] },
    },
    null,
    2,
  ),
);

interface ChatRequest {
  messages?: { role: string; content?: unknown }[];
  tools?: { function?: { name?: string } }[];
}

const received: ChatRequest[] = [];
let calls = 0;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n");
}

function chunk(res: ServerResponse, id: string, delta: object, finish: string | null = null) {
  const body = { id, object: "chat.completion.chunk", created: 0, model: "stub-model", choices: [{ index: 0, delta, finish_reason: finish }] };
  res.write(`data: ${JSON.stringify(body)}\n\n`);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stream `text` a few words at a time, so the chat shows it arriving. */
async function streamText(res: ServerResponse, id: string, text: string) {
  const words = text.split(/(?<= )/);
  for (let i = 0; i < words.length; i += 3) {
    chunk(res, id, { content: words.slice(i, i + 3).join("") });
    await pause(40);
  }
}

async function reply(request: ChatRequest, res: ServerResponse) {
  const id = `stub-${++calls}`;
  const messages = request.messages ?? [];
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  chunk(res, id, { role: "assistant", content: "" });

  const system = textOf(messages.find((message) => message.role === "system")?.content);
  if (system.startsWith("You name chats")) {
    chunk(res, id, { content: "Smoke test note" });
    chunk(res, id, {}, "stop");
  } else if (messages.some((message) => message.role === "tool")) {
    await streamText(res, id, script.closing);
    chunk(res, id, {}, "stop");
  } else {
    await streamText(res, id, script.opening);
    const spec = {
      title: script.title,
      sections: [{ heading: "Summary", blocks: [{ type: "text", text: script.summary }] }],
    };
    chunk(res, id, {
      tool_calls: [{ index: 0, id: "call_report", type: "function", function: { name: "create_report", arguments: JSON.stringify(spec) } }],
    });
    chunk(res, id, {}, "tool_calls");
  }
  res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model: "stub-model", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
  res.end("data: [DONE]\n\n");
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/requests") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(received));
    return;
  }
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (part: string) => (raw += part));
  req.on("end", () => {
    const request = JSON.parse(raw) as ChatRequest;
    received.push(request);
    reply(request, res).catch((err: unknown) => res.destroy(err instanceof Error ? err : new Error(String(err))));
  });
}).listen(port, "127.0.0.1", () => console.log(`stub LLM on http://127.0.0.1:${port}/v1, data in ${home}`));
