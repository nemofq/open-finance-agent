import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmProviderConfig } from "@/lib/config/schema";
import { testModel } from "./test-model";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-llm-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const endpoint: LlmProviderConfig = {
  id: "lab-a1b2",
  type: "openai-compatible",
  name: "Lab",
  apiKey: "",
  baseUrl: "https://llm.example.com/v1/",
  models: [{ id: "qwen-27b", contextWindow: 32768, reasoning: true }],
};

describe("testModel", () => {
  const sse = (...chunks: unknown[]) =>
    new Response([...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join(""), {
      headers: { "content-type": "text/event-stream" },
    });
  const chunk = (delta: object, finish_reason: string | null = null) => ({
    id: "c1",
    object: "chat.completion.chunk",
    created: 0,
    model: "qwen-27b",
    choices: [{ index: 0, delta, finish_reason }],
  });

  /** Each call answers with the next responder, so a text request and an image probe can differ. */
  const stubReplies = (...responders: (() => Response)[]) => {
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => responders[Math.min(call++, responders.length - 1)]());
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("streams a one-shot reply through the endpoint's chat completions, shaped like an agent turn", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sse(chunk({ role: "assistant", content: " OK " }), chunk({}, "stop")));
    vi.stubGlobal("fetch", fetchMock);
    const result = await testModel(endpoint, "qwen-27b", "high");

    expect(result).toMatchObject({ ok: true, reply: "OK" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url instanceof Request ? url.url : url)).toBe("https://llm.example.com/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    // A model with no declared `thinking` gets plain OpenAI Chat Completions, whatever it is called.
    expect(body).toMatchObject({ model: "qwen-27b", max_completion_tokens: 16384, reasoning_effort: "high" });
    expect(body).not.toHaveProperty("chat_template_kwargs");
    expect(body.messages[0]).toMatchObject({ role: "developer" });
    expect(body.tools).toEqual([expect.objectContaining({ function: expect.objectContaining({ name: "ping" }) })]);
  });

  /** Reasoning tokens as a server reports them, in the usage chunk that ends the stream. */
  const usage = (reasoningTokens?: number) => ({
    id: "c1",
    object: "chat.completion.chunk",
    created: 0,
    model: "qwen-27b",
    choices: [],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 5 + (reasoningTokens ?? 0),
      ...(reasoningTokens === undefined ? {} : { completion_tokens_details: { reasoning_tokens: reasoningTokens } }),
    },
  });
  const thinks = (tokens?: number) => () =>
    sse(chunk({ role: "assistant", reasoning_content: "Let me think." }), chunk({ content: "OK" }), chunk({}, "stop"), usage(tokens));
  const answers = (tokens?: number) => () => sse(chunk({ role: "assistant", content: "OK" }), chunk({}, "stop"), usage(tokens));
  const switchable: LlmProviderConfig = {
    ...endpoint,
    models: [{ id: "qwen-27b", reasoning: true, thinking: { off: "chat-template" } }],
  };

  it("proves the thinking switch: no reasoning tokens at off, some at medium", async () => {
    const fetchMock = stubReplies(answers(0), thinks(12));
    const result = await testModel(switchable, "qwen-27b");

    expect(result).toMatchObject({
      ok: true,
      thinking: { ok: true, level: "medium", offReasoningTokens: 0, onReasoningTokens: 12 },
    });
    expect(result.thinking?.message).toContain("0 reasoning tokens at off, 12 at medium");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [off, on] = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(off.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(off).not.toHaveProperty("reasoning_effort");
    expect(on.reasoning_effort).toBe("medium");
    expect(on).not.toHaveProperty("chat_template_kwargs");
  });

  it("tests the configured level against off when the level is not off", async () => {
    const fetchMock = stubReplies(thinks(30), answers(0));
    const result = await testModel(switchable, "qwen-27b", "high");
    expect(result.thinking).toMatchObject({ ok: true, level: "high", offReasoningTokens: 0, onReasoningTokens: 30 });
    const [on, off] = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(on.reasoning_effort).toBe("high");
    expect(off.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("names the direction that failed when thinking cannot be switched off", async () => {
    stubReplies(thinks(7), thinks(12));
    const result = await testModel(endpoint, "qwen-27b");
    expect(result.ok).toBe(true);
    expect(result.thinking).toMatchObject({ ok: false, offReasoningTokens: 7 });
    expect(result.thinking?.message).toMatch(/thinking could not be switched off: 7 reasoning tokens at off/i);
  });

  it("names the direction that failed when thinking cannot be switched on", async () => {
    stubReplies(answers(0), answers(0));
    const result = await testModel(switchable, "qwen-27b");
    expect(result.thinking?.ok).toBe(false);
    expect(result.thinking?.message).toMatch(/thinking could not be switched on/i);
  });

  it("does not pass a switch the endpoint reports no reasoning tokens for", async () => {
    stubReplies(answers(), thinks());
    const result = await testModel(switchable, "qwen-27b");
    expect(result.thinking?.ok).toBe(false);
    expect(result.thinking?.message).toContain("could not be verified");
  });

  it("sends one request and no switch test for a model not marked for reasoning", async () => {
    const fetchMock = stubReplies(answers(0));
    const plain = { ...endpoint, models: [{ id: "qwen-27b" }] };
    const result = await testModel(plain, "qwen-27b", "high");
    expect(result.thinking).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).not.toHaveProperty("reasoning_effort");
  });

  it("reports a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({ error: { message: "bad key" } }, { status: 401 })));
    const result = await testModel(endpoint, "unlisted");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  const says = (text: string) => () => sse(chunk({ role: "assistant", content: text }), chunk({}, "stop"));
  const vision = { ...endpoint, models: [{ id: "qwen-vl", images: true }] };

  it("does not probe images for a model that does not accept them", async () => {
    const fetchMock = stubReplies(says("OK"));
    const result = await testModel({ ...endpoint, models: [{ id: "qwen-27b" }] }, "qwen-27b");
    expect(result).toMatchObject({ ok: true, reply: "OK" });
    expect(result.images).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks a model flagged for images to read the test image, and sends the image with the prompt", async () => {
    const fetchMock = stubReplies(says("OK"), says("OK."));
    const result = await testModel(vision, "qwen-vl");

    expect(result).toMatchObject({ ok: true, images: { ok: true, reply: "OK." } });
    expect(result.images?.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const probe = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(probe.messages[0].content).toContain("see images");
    const [prompt, image] = probe.messages[1].content;
    expect(prompt).toMatchObject({ type: "text", text: "What single word is written in this image? Reply with only that word." });
    expect(image.image_url.url).toContain("data:image/png;base64,");
    expect(probe.tools).toEqual([expect.objectContaining({ function: expect.objectContaining({ name: "ping" }) })]);
  });

  it("reads the word past case and trailing punctuation", async () => {
    stubReplies(says("OK"), says(" ok "));
    expect(await testModel(vision, "qwen-vl")).toMatchObject({ images: { ok: true, reply: "ok" } });
  });

  it("fails the probe when the model answers something other than the word, keeping what it said", async () => {
    stubReplies(says("OK"), says("I cannot see any image."));
    const result = await testModel(vision, "qwen-vl");
    expect(result.ok).toBe(true);
    expect(result.images).toMatchObject({
      ok: false,
      reply: "I cannot see any image.",
      error: "The model did not read the image",
    });
  });

  it("fails the probe when the endpoint refuses the image request", async () => {
    stubReplies(says("OK"), () => Response.json({ error: { message: "image input not supported" } }, { status: 400 }));
    const result = await testModel(vision, "qwen-vl");
    expect(result.ok).toBe(true);
    expect(result.images?.ok).toBe(false);
    expect(result.images?.error).toBeTruthy();
  });

  it("skips the probe when the text request already failed", async () => {
    const fetchMock = stubReplies(() => Response.json({ error: { message: "bad key" } }, { status: 401 }));
    const result = await testModel(vision, "qwen-vl");
    expect(result.ok).toBe(false);
    expect(result.images).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});
