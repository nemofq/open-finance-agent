import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { endRun, startRun } from "@/lib/agent/runs";
import { type AppConfig, defaultConfig } from "@/lib/config/schema";
import { withModulesOff } from "@/lib/tools/testing";
import { writeConfig } from "@/lib/config/store";
import { assistant, user } from "@/lib/context/testing";
import type { CompactionMessage } from "@/lib/context/types";
import { createSession, getSession, updateSession } from "@/lib/sessions/store";

let home: string;
let server: Server;
let baseUrl: string;

/** One streamed chat-completion chunk, as an OpenAI-compatible endpoint sends it. */
function chunk(delta: object, finish: string | null) {
  const body = { id: "c1", object: "chat.completion.chunk", created: 0, model: "qwen3" };
  return `data: ${JSON.stringify({ ...body, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

beforeAll(async () => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-compact-api-"));
  process.env.OFA_HOME = home;
  // A local endpoint whose every reply is "OK", so the checkpoint call runs without the network.
  server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`${chunk({ role: "assistant", content: "OK" }, null)}${chunk({}, "stop")}data: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

/** A saved config with one hand-listed endpoint and no module tools. */
function saveConfig(edit: (config: AppConfig) => void = () => {}) {
  const config = defaultConfig();
  withModulesOff(config);
  config.llm.providers = [
    {
      id: "lab",
      type: "openai-compatible",
      name: "Lab",
      apiKey: "",
      baseUrl,
      models: [{ id: "qwen3" }],
    },
  ];
  config.llm.defaultModel = { provider: "lab", model: "qwen3" };
  edit(config);
  writeConfig(config);
}

beforeEach(() => saveConfig());

/** Two finished question-and-answer rounds: enough history for a cut point to exist. */
function history(): AgentMessage[] {
  return [
    user("What was $NVDA revenue in FY26 Q2?"),
    assistant({ text: "$30,040M." }),
    user("And the gross margin?"),
    assistant({ text: "74.9%." }),
  ];
}

async function seedSession(messages: AgentMessage[] = history()) {
  const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
  if (messages.length > 0) await updateSession(session.id, { messages });
  return session.id;
}

const compact = async (id: string, body: unknown = {}, contentType = "application/json") => {
  const { POST } = await import("./[id]/compact/route");
  const request = new Request(`http://localhost/api/sessions/${id}/compact`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id }) });
};

describe("POST /api/sessions/[id]/compact", () => {
  it("writes a checkpoint at the cut point and keeps the whole history", async () => {
    const id = await seedSession();

    const res = await compact(id);
    expect(res.status).toBe(200);
    const compaction = (await res.json()) as CompactionMessage;
    expect(compaction).toMatchObject({ role: "compaction", summary: "OK", evidenceIds: [] });

    const saved = await getSession(id);
    // The latest turn stays in full; the checkpoint sits in front of it and nothing is dropped.
    expect(saved?.messages.map((entry) => entry.role)).toEqual(["user", "assistant", "compaction", "user", "assistant"]);
    expect(saved?.messages[2]).toMatchObject({ role: "compaction", summary: "OK" });
  });

  it("records the focus the user typed after /compact", async () => {
    const id = await seedSession();

    const res = await compact(id, { focus: "margins only" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ focus: "margins only" });
    const saved = await getSession(id);
    expect(saved?.messages.find((entry) => entry.role === "compaction")).toMatchObject({ focus: "margins only" });
  });

  it("answers 404 for a session that does not exist", async () => {
    const res = await compact("00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "Session not found" });
  });

  it("refuses to spend a model call on a chat with no history", async () => {
    const id = await seedSession([]);
    const res = await compact(id);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "nothing_to_compact", error: expect.any(String) });
    expect((await getSession(id))?.messages).toEqual([]);
  });

  it("refuses to compact while the chat is still answering", async () => {
    const id = await seedSession();
    // The registry only ever calls `abort` on this; the route just checks that a run exists.
    startRun(id, {} as unknown as Agent);
    try {
      const res = await compact(id);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "run_in_progress", error: expect.any(String) });
    } finally {
      // The registry lives on `globalThis`, so a leaked run would fail every later test.
      endRun(id);
    }
    expect((await getSession(id))?.messages).toHaveLength(4);
  });

  it("asks to reconnect when the chat's provider has lost its sign-in", async () => {
    saveConfig((config) => {
      config.llm.providers.push({ id: "openai-codex", type: "openai-codex", name: "ChatGPT (Codex)", apiKey: "", auth: "oauth" });
    });
    const session = await createSession({ model: { provider: "openai-codex", model: "gpt-5.1-codex" } });
    await updateSession(session.id, { messages: history() });
    const res = await compact(session.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "reauth_required" });
  });

  it("refuses a body that is not declared JSON", async () => {
    const id = await seedSession();
    const res = await compact(id, {}, "text/plain");
    expect(res.status).toBe(415);
    expect((await getSession(id))?.messages).toHaveLength(4);
  });
});
