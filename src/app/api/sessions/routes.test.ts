import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SseEvent } from "@/lib/agent/events";
import { getRun } from "@/lib/agent/runs";
import { stageDocument } from "@/lib/attachments/documents";
import { writeAttachments } from "@/lib/attachments/images";
import { readAttachment } from "@/lib/attachments/store";
import { type AppConfig, defaultConfig } from "@/lib/config/schema";
import { withModulesOff } from "@/lib/tools/testing";
import { writeConfig } from "@/lib/config/store";
import { stagingDir } from "@/lib/paths";
import { createSession, getSession, updateSession } from "@/lib/sessions/store";
import type { SessionFile } from "@/lib/sessions/types";

let home: string;
let server: Server;
let baseUrl: string;
let cutOffReplies = 0;
/** While set, the endpoint holds every reply back, so a turn stays in flight until `releaseReplies`. */
let holdReplies = false;
const heldReplies: (() => void)[] = [];

function releaseReplies() {
  holdReplies = false;
  for (const reply of heldReplies.splice(0)) reply();
}

/** One streamed chat-completion chunk, as an OpenAI-compatible endpoint sends it. */
function chunk(delta: object, finish: string | null) {
  const body = { id: "c1", object: "chat.completion.chunk", created: 0, model: "qwen3" };
  return `data: ${JSON.stringify({ ...body, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

beforeAll(async () => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-sessions-api-"));
  process.env.OFA_HOME = home;
  // A local endpoint that replies "OK", so a whole turn runs without the network. A request whose
  // last user text says "burn the budget" is answered like a reasoning model that spent its whole
  // output cap thinking; the harness's nudge then gets the normal reply.
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (part: Buffer) => {
      body += part.toString("utf8");
    });
    request.on("end", () => {
      // The harness appends a per-turn note after the question, so match the whole request body.
      const cutOff = body.includes("burn the budget") && cutOffReplies++ === 0;
      const reply = () => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          cutOff
            ? `${chunk({ role: "assistant", reasoning_content: "hmm" }, null)}${chunk({}, "length")}data: [DONE]\n\n`
            : `${chunk({ role: "assistant", content: "OK" }, null)}${chunk({}, "stop")}data: [DONE]\n\n`,
        );
      };
      if (holdReplies) heldReplies.push(reply);
      else reply();
    });
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
      models: [{ id: "qwen3" }, { id: "mistral" }, { id: "qwen3-vl", images: true }],
    },
  ];
  config.llm.defaultModel = { provider: "lab", model: "qwen3" };
  edit(config);
  writeConfig(config);
}

beforeEach(() => { cutOffReplies = 0; saveConfig(); });

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const createChat = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(post("http://localhost/api/sessions", body));
};

const sendMessage = async (id: string, text?: string, skill?: string, images?: unknown) => {
  const { POST } = await import("./[id]/messages/route");
  return POST(post(`http://localhost/api/sessions/${id}/messages`, { text, skill, images }), { params: Promise.resolve({ id }) });
};

/** A PNG header, which is as much of one as the attachment store reads. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const asImage = (bytes: Buffer) => ({ data: bytes.toString("base64"), mimeType: "image/png" });

const getAttachment = async (id: string, name: string) => {
  const { GET } = await import("./[id]/attachments/[name]/route");
  return GET(new Request(`http://localhost/api/sessions/${id}/attachments/${name}`), { params: Promise.resolve({ id, name }) });
};

describe("POST /api/sessions", () => {
  it("starts a chat on the default model", async () => {
    const res = await createChat({});
    expect(res.status).toBe(201);
    expect(((await res.json()) as SessionFile).model).toEqual({ provider: "lab", model: "qwen3" });
  });

  it("stores a per-chat model override", async () => {
    const res = await createChat({ model: { provider: "lab", model: "mistral" } });
    expect(res.status).toBe(201);
    const session = (await res.json()) as SessionFile;
    expect((await getSession(session.id))?.model).toEqual({ provider: "lab", model: "mistral" });
  });

  it("asks for setup when there is no provider", async () => {
    saveConfig((config) => {
      config.llm.providers = [];
      config.llm.defaultModel = null;
    });
    const res = await createChat({});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "llm_not_configured" });
  });

  it("asks to reconnect a provider whose sign-in has lapsed", async () => {
    saveConfig((config) => {
      config.llm.providers.push({ id: "openai-codex", type: "openai-codex", name: "ChatGPT (Codex)", apiKey: "", auth: "oauth" });
    });
    const res = await createChat({ model: { provider: "openai-codex", model: "gpt-5.1-codex" } });
    expect(res.status).toBe(400);
    // The chat shows the Reconnect banner for this code, not an error line.
    expect(await res.json()).toMatchObject({ code: "reauth_required", error: expect.stringContaining("Reconnect") });
  });

  it("rejects a model whose provider does not exist", async () => {
    const res = await createChat({ model: { provider: "gone", model: "qwen3" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "model_unavailable", error: expect.any(String) });
  });

  it("rejects a malformed model", async () => {
    expect((await createChat({ model: "lab/qwen3" })).status).toBe(400);
  });

  it("refuses a body that is not declared JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/sessions", { method: "POST", body: "{}" }));
    expect(res.status).toBe(415);
  });
});

describe("POST /api/sessions/[id]/messages", () => {
  it("answers with the session's error code when its model is gone", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
    saveConfig((config) => {
      config.llm.providers = [];
      config.llm.defaultModel = null;
    });
    const res = await sendMessage(session.id, "hi");
    expect(res.status).toBe(400);
    // Its model is fixed, so a new default cannot help: the way on is a new chat.
    expect(await res.json()).toMatchObject({ code: "model_unavailable", error: expect.stringContaining("start a new chat") });
  });

  it("refuses a message that is not declared JSON", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const { POST } = await import("./[id]/messages/route");
    const res = await POST(
      new Request(`http://localhost/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ text: "hi" }),
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(res.status).toBe(415);
    expect((await getSession(session.id))?.messages).toEqual([]);
  });

  it("nudges once when the reply ran out of output before any answer", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
    await updateSession(session.id, { title: "Budget recovery", titleSource: "generated" });
    const res = await sendMessage(session.id, "please burn the budget");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('"rule":"H1"');
    expect(body).toContain('"type":"done"');
    const saved = await getSession(session.id);
    const roles = saved?.messages.map((message) => message.role) ?? [];
    // the cut-off reply, the nudge as a check message, then the real answer
    expect(roles).toEqual(["user", "assistant", "check", "assistant"]);
    expect(saved?.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
  });

  it("keeps running and saving after the client disconnects", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const res = await sendMessage(session.id, "hi");
    expect(res.status).toBe(200);
    await res.body!.cancel();
    // The run leaves the registry only once the turn, and its last write, are over.
    const { getRun } = await import("@/lib/agent/runs");
    for (let waited = 0; getRun(session.id) && waited < 5_000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getRun(session.id)).toBeUndefined();
    const saved = await getSession(session.id);
    expect(saved?.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "OK" }] });
  });

  it("rejects a message without text or skill", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const res = await sendMessage(session.id, "");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "text or skill is required" });
  });

  it("allows sending a skill invocation with empty text", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const res = await sendMessage(session.id, "", "portfolio-check");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"type":"done"');
    const saved = await getSession(session.id);
    expect(saved?.messages.at(0)).toMatchObject({ role: "skill", skill: "portfolio-check", request: "" });
  });
});

describe("image attachments", () => {
  const visionSession = () => createSession({ model: { provider: "lab", model: "qwen3-vl" } });

  it("stores the image on disk and keeps the payload out of the transcript", async () => {
    const session = await visionSession();
    const res = await sendMessage(session.id, "what is this?", undefined, [asImage(png(640, 480))]);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"type":"done"');

    const saved = await getSession(session.id);
    const first = saved?.messages.at(0);
    expect(first).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "what is this?" },
        { type: "image", data: "", mimeType: "image/png", width: 640, height: 480, bytes: 33 },
      ],
    });
    const name = (first as { content: { attachment?: string }[] }).content[1].attachment;
    expect(name).toMatch(/^[0-9a-f]{40}\.png$/);
    expect(await readAttachment(session.id, name as string)).toEqual(png(640, 480));
  });

  it("takes an image with no words as a message of its own", async () => {
    const session = await visionSession();
    const res = await sendMessage(session.id, "", undefined, [asImage(png(8, 8))]);
    expect(res.status).toBe(200);
    // Draining the stream waits for the turn, and with it the persist that writes the message.
    expect(await res.text()).toContain('"type":"done"');

    const saved = await getSession(session.id);
    expect(saved?.messages.at(0)).toMatchObject({ role: "user", content: [{ type: "image" }] });
    // The chat is named, rather than left on the default a message with nothing in it would get.
    expect(saved?.title).not.toBe("New chat");
  });

  it("puts a skill turn's images on the skill message", async () => {
    const session = await visionSession();
    const res = await sendMessage(session.id, "", "portfolio-check", [asImage(png(16, 16))]);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"type":"done"');
    expect(await getSession(session.id).then((saved) => saved?.messages.at(0))).toMatchObject({
      role: "skill",
      skill: "portfolio-check",
      images: [{ type: "image", data: "", mimeType: "image/png", width: 16, height: 16 }],
    });
  });

  it("refuses a file type it will not store, and starts no run", async () => {
    const session = await visionSession();
    const res = await sendMessage(session.id, "read this", undefined, [{ data: "AAAA", mimeType: "application/pdf" }]);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_images", error: expect.stringContaining("image/png") });
    expect((await getSession(session.id))?.messages).toEqual([]);
  });

  it("refuses images that did not arrive as a list of data and type", async () => {
    const session = await visionSession();
    expect((await sendMessage(session.id, "hi", undefined, "not-a-list")).status).toBe(400);
    expect((await sendMessage(session.id, "hi", undefined, [{ mimeType: "image/png" }])).status).toBe(400);
  });

  it("refuses the turn when the chat's model cannot see images, leaving no file behind", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const bytes = png(32, 32);
    const res = await sendMessage(session.id, "what is this?", undefined, [asImage(bytes)]);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "images_unsupported", error: expect.stringContaining("qwen3") });
    expect((await getSession(session.id))?.messages).toEqual([]);
    const name = `${createHash("sha1").update(bytes).digest("hex")}.png`;
    expect(await readAttachment(session.id, name)).toBeNull();
  });
});

describe("run acceptance", () => {
  const send = async (id: string, body: object) => {
    const { POST } = await import("./[id]/messages/route");
    return POST(post(`http://localhost/api/sessions/${id}/messages`, body), { params: Promise.resolve({ id }) });
  };
  const stage = async (text: string, name: string) => (await stageDocument(new TextEncoder().encode(text), name)).stored.attachment;
  const imageName = (bytes: Buffer) => `${createHash("sha1").update(bytes).digest("hex")}.png`;
  const staged = async (attachment: string) => {
    const names = await readdir(stagingDir());
    return names.includes(attachment) && names.includes(`${attachment.slice(0, 40)}.json`);
  };

  it("refuses a second send while a turn runs, before it moves any attachment", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3-vl" } });
    holdReplies = true;
    try {
      const first = await sendMessage(session.id, "take your time");
      expect(first.status).toBe(200);

      const document = await stage("# Q3 memo\n\nRevenue rose 4%.\n", "memo.md");
      const bytes = png(24, 24);
      const second = await send(session.id, { text: "and these?", images: [asImage(bytes)], documents: [document] });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: "run_in_progress" });
      // The composer can still send the document by name, and no image was written for a turn that never ran.
      expect(await staged(document)).toBe(true);
      expect(await readAttachment(session.id, document)).toBeNull();
      expect(await readAttachment(session.id, imageName(bytes))).toBeNull();

      releaseReplies();
      expect(await first.text()).toContain('"type":"done"');
    } finally {
      releaseReplies();
    }
  });

  it("undoes a turn refused after the slot was taken, and frees the slot for the next send", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const document = await stage("# Notes\n\nCash is up.\n", "notes.md");
    const bytes = png(40, 40);
    const refused = await send(session.id, { text: "what is this?", images: [asImage(bytes)], documents: [document] });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "images_unsupported" });
    expect(await staged(document)).toBe(true);
    expect(await readAttachment(session.id, document)).toBeNull();
    expect(await readAttachment(session.id, imageName(bytes))).toBeNull();

    const retried = await send(session.id, { text: "then just the notes", documents: [document] });
    expect(retried.status).toBe(200);
    expect(await retried.text()).toContain('"type":"done"');
    expect(await staged(document)).toBe(false);
    expect(await readAttachment(session.id, document)).not.toBeNull();
  });
});

describe("GET /api/sessions/[id]/stream", () => {
  const reattach = async (id: string) => {
    const { GET } = await import("./[id]/stream/route");
    return GET(new Request(`http://localhost/api/sessions/${id}/stream`), { params: Promise.resolve({ id }) });
  };

  it("re-attaches with the transcript the server holds, never pi's system messages", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
    holdReplies = true;
    try {
      const turn = await sendMessage(session.id, "take your time");
      expect(turn.status).toBe(200);
      const held = () => getRun(session.id)?.agent.state.messages ?? [];
      for (let waited = 0; !held().some((message) => message.role === "user") && waited < 5_000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
      // The run holds pi's leading message, the prompt and every tool schema; the browser gets none of it.
      expect(held().map((message) => message.role)).toEqual(["system", "user"]);

      const reader = (await reattach(session.id)).body?.getReader();
      if (!reader) throw new Error("the re-attach stream has no body");
      const { value } = await reader.read();
      const snapshot = JSON.parse(new TextDecoder().decode(value).slice("data: ".length)) as SseEvent;
      expect(snapshot.type === "snapshot" && snapshot.messages.map((message) => message.role)).toEqual(["user"]);
      await reader.cancel();

      releaseReplies();
      expect(await turn.text()).toContain('"type":"done"');
    } finally {
      releaseReplies();
    }
  });
});

describe("GET /api/sessions/[id]/attachments/[name]", () => {
  it("serves the bytes with their type and an immutable cache", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3-vl" } });
    const bytes = png(120, 90);
    const [image] = await writeAttachments(session.id, [asImage(bytes)]);

    const res = await getAttachment(session.id, image.attachment);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it("answers 404 for a name, a file or a chat that is not there", async () => {
    const session = await createSession({ model: { provider: "lab", model: "qwen3-vl" } });
    const [image] = await writeAttachments(session.id, [asImage(png(4, 4))]);

    expect((await getAttachment(session.id, "../../../config.json")).status).toBe(404);
    expect((await getAttachment(session.id, `${"c".repeat(40)}.png`)).status).toBe(404);
    expect((await getAttachment(randomUUID(), image.attachment)).status).toBe(404);
  });
});
