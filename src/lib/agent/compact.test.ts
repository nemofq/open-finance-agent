import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "@/lib/config/schema";
import { writeConfig } from "@/lib/config/store";
import { assistant, user } from "@/lib/context/testing";
import { createSession, getSession, updateSession } from "@/lib/sessions/store";
import { withModulesOff } from "@/lib/tools/testing";

/** What the chat's model is asked, and what it answers: a checkpoint of "OK", or a failure. */
const calls: Context[] = [];
/** The chat each call said it belonged to. */
const conversations: (string | undefined)[] = [];
let reply: Pick<AssistantMessage, "content" | "stopReason" | "errorMessage"> = { content: [{ type: "text", text: "OK" }], stopReason: "stop" };

vi.mock("@/lib/llm/stream", () => ({
  streamModel: (_config: unknown, _model: unknown, context: Context, options?: { conversationId?: string }) => {
    calls.push(context);
    conversations.push(options?.conversationId);
    return { result: async () => reply };
  },
}));

const { compactChat } = await import("./compact");
const { endRun, startRun } = await import("./runs");

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-compact-chat-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

beforeEach(() => {
  calls.length = 0;
  conversations.length = 0;
  reply = { content: [{ type: "text", text: "OK" }], stopReason: "stop" };
  const config = defaultConfig();
  withModulesOff(config);
  // Models listed by hand, so resolving one needs no network.
  config.llm.providers = [
    { id: "lab", type: "openai-compatible", name: "Lab", apiKey: "", baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "qwen3" }] },
  ];
  config.llm.defaultModel = { provider: "lab", model: "qwen3" };
  writeConfig(config);
});

function history(): AgentMessage[] {
  return [user("What was $NVDA revenue in FY26 Q2?"), assistant({ text: "$30,040M." }), user("And the gross margin?"), assistant({ text: "74.9%." })];
}

async function seed(messages: AgentMessage[] = history()): Promise<string> {
  const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
  await updateSession(session.id, { messages });
  return session.id;
}

describe("compactChat", () => {
  it("writes the checkpoint in front of the latest turn with the focus it was given", async () => {
    const id = await seed();
    const result = await compactChat(id, { focus: "margins only" });

    expect(result).toMatchObject({ ok: true, compaction: { role: "compaction", summary: "OK", focus: "margins only" } });
    expect(calls).toHaveLength(1);
    // The summary is asked in the chat's own name, which OpenCode routes the request by.
    expect(conversations).toEqual([id]);
    const saved = await getSession(id);
    expect(saved?.messages.map((entry) => entry.role)).toEqual(["user", "assistant", "compaction", "user", "assistant"]);
  });

  it("keeps the figures the user gave, as a turn's compaction does", async () => {
    reply = { content: [{ type: "text", text: "The user bought at $412.37 [U2]." }], stopReason: "stop" };
    const id = await seed([user("I bought 137 shares at $412.37 each."), assistant({ text: "Noted." }), user("And now?"), assistant({ text: "Up 3%." })]);
    const result = await compactChat(id);
    expect(result).toMatchObject({ ok: true, compaction: { summary: "The user bought at $412.37 [U2]." } });
    expect(result.ok && result.compaction.stripped).toBeUndefined();
  });

  it("leaves the transcript alone when the model call fails", async () => {
    reply = { content: [], stopReason: "error", errorMessage: "provider down" };
    const id = await seed();
    await expect(compactChat(id)).rejects.toThrow("provider down");
    expect((await getSession(id))?.messages).toHaveLength(4);
  });

  it("refuses, without a model call, a chat it cannot compact", async () => {
    expect(await compactChat("00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false, reason: "session_not_found" });
    expect(await compactChat(await seed([]))).toMatchObject({ ok: false, reason: "nothing_to_compact" });

    const running = await seed();
    startRun(running, {} as unknown as Agent);
    try {
      expect(await compactChat(running)).toMatchObject({ ok: false, reason: "run_in_progress" });
    } finally {
      endRun(running);
    }

    const orphaned = await seed();
    await updateSession(orphaned, { model: { provider: "gone", model: "qwen3" } });
    expect(await compactChat(orphaned)).toMatchObject({ ok: false, reason: "model_unavailable", code: "model_unavailable" });
    expect(calls).toHaveLength(0);
  });
});
