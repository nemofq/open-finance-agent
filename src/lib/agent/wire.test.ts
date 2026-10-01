/**
 * What reaches the model provider, and what a turn saves, pinned as file snapshots. A scripted
 * two-turn chat runs through `runTurn` and the real pi stack with only `fetch` stubbed: a tool
 * call, an answer with an unsourced figure that P8 sends back, the corrected answer, and a second
 * turn loaded from the saved chat. The snapshots are the contract a pi upgrade is reviewed
 * against: a change to the prompt, the tools, the thinking settings or the saved chat shows up
 * as a diff here, where a type error or a scripted-model test would not see it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SseEvent } from "@/lib/agent/events";
import { type AppConfig, defaultConfig, type LlmProviderConfig, type ModelRef, type ThinkingLevel } from "@/lib/config/schema";
import { createSession, getSession, updateSession } from "@/lib/sessions/store";
import { fixedTimeContext } from "@/lib/time";
import { withModulesOff } from "@/lib/tools/testing";
import { runTurn } from "./turn";

/** How one provider API streams the two kinds of reply the script needs. */
interface WireApi {
  text(text: string): string;
  toolCall(id: string, name: string, args: object): string;
}

interface WireCase {
  name: string;
  provider: LlmProviderConfig;
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  api: WireApi;
}

const openAICompletions: WireApi = (() => {
  const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
  const chunk = (delta: object, finish: string | null, withUsage = false) => `data: ${JSON.stringify({
    id: "chatcmpl-1", object: "chat.completion.chunk", created: 0, model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finish }], ...(withUsage ? { usage } : {}),
  })}\n\n`;
  const end = (finish: string) => `${chunk({}, finish, true)}data: [DONE]\n\n`;
  return {
    text: (text) => chunk({ role: "assistant", content: text }, null) + end("stop"),
    toolCall: (id, name, args) => chunk({ role: "assistant", tool_calls: [
      { index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } },
    ] }, null) + end("tool_calls"),
  };
})();

function anthropicMessages(model: string): WireApi {
  const events = (content: object, delta: object, stopReason: string) => [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model, content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: content },
    { type: "content_block_delta", index: 0, delta },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: "message_stop" },
  ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return {
    text: (text) => events({ type: "text", text: "" }, { type: "text_delta", text }, "end_turn"),
    toolCall: (id, name, args) => events({ type: "tool_use", id, name, input: {} },
      { type: "input_json_delta", partial_json: JSON.stringify(args) }, "tool_use"),
  };
}

const anthropic = (model: string): WireCase => ({
  name: `anthropic-${model}`,
  provider: { id: "anthropic", type: "anthropic", name: "Anthropic", auth: "api_key", apiKey: "sk-ant-test" },
  model: { provider: "anthropic", model },
  thinkingLevel: "medium",
  api: anthropicMessages(model),
});

const cases: WireCase[] = [
  {
    name: "openai-compatible",
    provider: { id: "offline", type: "openai-compatible", name: "Offline", auth: "api_key", apiKey: "sk-test",
      baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "test-model", contextWindow: 32_768 }] },
    model: { provider: "offline", model: "test-model" },
    thinkingLevel: "off",
    api: openAICompletions,
  },
  // pi's catalog lets claude-opus-5 change its system prompt and tools mid-conversation, and not claude-sonnet-5.
  anthropic("claude-opus-5"),
  anthropic("claude-sonnet-5"),
];

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-wire-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

/** Answers each request with the next scripted reply and records what was sent. */
function stubProvider(replies: string[]): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    // The SDKs' own telemetry headers name the runtime, OS and architecture of the machine.
    new Headers(init?.headers).forEach((value, key) => {
      if (key.startsWith("x-stainless-")) return;
      // pi's own user agent does too, in parentheses after its name.
      headers[key] = key === "user-agent" ? value.replace(/\(.*\)/, "(<platform>)") : value;
    });
    requests.push({ url: String(url), headers, body: JSON.parse(String(init?.body)) });
    const reply = replies.shift();
    if (reply === undefined) throw new Error("Unexpected model call");
    return new Response(reply, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  return requests;
}

/** Every module that builds offline, as in the system-prompt snapshot, so real tools are offered. */
function configFor(wire: WireCase): AppConfig {
  const config = defaultConfig();
  withModulesOff(config, ["attachments", "edgar", "evidence", "memory", "portfolio", "quotes", "reports", "scheduled", "skills"]);
  config.llm.providers = [wire.provider];
  config.llm.defaultModel = wire.model;
  config.llm.thinkingLevel = wire.thinkingLevel;
  return config;
}

/** Keys whose values are clock readings: stamped on messages, checks, request traces and the chat file. */
const CLOCK_KEYS = new Set(["timestamp", "startedAt", "endedAt", "createdAt", "updatedAt"]);

/**
 * Every request offers the same tools, so a request after the first names them instead of
 * repeating 30k characters of schemas; one whose tools differ keeps them in full.
 */
function toolsOnce(requests: CapturedRequest[]): CapturedRequest[] {
  const toolsOf = (request: CapturedRequest) => JSON.stringify((request.body as { tools?: unknown }).tools);
  return requests.map((request, index) => index > 0 && toolsOf(request) === toolsOf(requests[0])
    ? { ...request, body: { ...(request.body as object), tools: "<the tools of request 1>" } }
    : request);
}

/** The capture as pretty JSON, with the chat's random id and every clock reading replaced by a marker. */
function scrubbed(value: unknown, sessionId: string): string {
  const json = JSON.stringify(value, (key, field: unknown) => (CLOCK_KEYS.has(key) ? "<clock>" : field), 2);
  return `${json.replaceAll(sessionId, "<session>")}\n`;
}

describe("the wire", () => {
  it.each(cases)("$name: two turns send and save exactly the snapshot", async (wire) => {
    const requests = stubProvider([
      wire.api.toolCall("call_1", "evidence_get", { id: "E9" }),
      wire.api.text("Apple's revenue was $391.0 billion in fiscal 2024."),
      wire.api.text("I could not retrieve Apple's revenue from a source this session can query, so I cannot state it."),
      wire.api.text("Nothing else for now."),
    ]);
    const config = configFor(wire);
    const { id } = await createSession({ model: wire.model });
    const time = fixedTimeContext({ asOf: "2024-08-29" });
    const store = { update: updateSession };

    const turns = [];
    for (const text of ["What was Apple's revenue in fiscal 2024?", "Thanks. Anything else?"]) {
      const session = await getSession(id);
      if (!session) throw new Error("the chat was not saved");
      const events: string[] = [];
      const sink = (event: SseEvent) => {
        events.push(event.type === "message_end" ? `message_end:${event.message.role}` : event.type);
      };
      const result = await runTurn({ config, session, text, time, titles: false, store, sink });
      turns.push({ result, events });
    }

    const [first, second] = turns.map(({ result }) => result);
    expect(first.status).toBe("complete");
    expect(first.error).toBeUndefined();
    expect(first.followUps).toBe(1);
    expect(first.checks).toEqual([expect.objectContaining({ rule: "P8", kind: "follow_up", enforced: true, resolved: true })]);
    expect(second.status).toBe("complete");
    expect(second.finalText).toBe("Nothing else for now.");
    expect(requests).toHaveLength(4);
    const saved = await getSession(id);
    if (!saved) throw new Error("the chat was not saved");
    // The prompt is rebuilt from settings every turn; neither the chat nor a turn's result keeps a copy.
    const kept = [...saved.messages, ...first.messages, ...second.messages];
    expect(kept.filter((message) => message.role === "system")).toEqual([]);

    await expect(scrubbed({ requests: toolsOnce(requests), events: turns.map(({ events }) => events), saved }, id))
      .toMatchFileSnapshot(`./__snapshots__/wire-${wire.name}.json`);
  });
});

describe("the wire to OpenCode Go", () => {
  const go: WireCase = {
    name: "opencode-go",
    provider: { id: "opencode-go", type: "opencode-go", name: "OpenCode Go", auth: "api_key", apiKey: "sk-go" },
    model: { provider: "opencode-go", model: "glm-5.3" },
    thinkingLevel: "off",
    api: openAICompletions,
  };

  // Go refuses a request without the header, routes and caches a conversation by it, and asks
  // clients to name themselves rather than the SDK.
  it("sends the chat's id as x-opencode-session and the app as user agent, on the turn and its title alike", async () => {
    const requests = stubProvider([go.api.text("Nothing to report."), go.api.text("Market check-in")]);
    const { id } = await createSession({ model: go.model });
    const session = await getSession(id);
    if (!session) throw new Error("the chat was not saved");
    const result = await runTurn({ config: configFor(go), session, text: "Anything to watch today?",
      time: fixedTimeContext({ asOf: "2024-08-29" }), store: { update: updateSession } });

    expect(result.status).toBe("complete");
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    for (const request of requests) {
      expect(request.url).toMatch(/^https:\/\/opencode\.ai\/zen\/go\//);
      expect(request.headers["x-opencode-session"]).toBe(id);
      expect(request.headers["user-agent"]).toMatch(/^open-finance-agent\/\d+\.\d+\.\d+/);
    }
  });
});
