import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { maxMemoryChars, updateMemory } from "@/lib/memory/store";

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-memory-api-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

interface Memory {
  content: string;
  revision: string;
  maxChars: number;
}

const put = (body: string, type = "application/json") =>
  new Request("http://localhost/api/memory", { method: "PUT", headers: { "content-type": type }, body });

const read = async (): Promise<Memory> => {
  const { GET } = await import("./route");
  return (await (await GET()).json()) as Memory;
};

describe("PUT /api/memory", () => {
  it("saves the content over the revision it read, and reads it back", async () => {
    const { PUT } = await import("./route");
    const before = await read();
    expect(before.maxChars).toBe(maxMemoryChars);
    const res = await PUT(put(JSON.stringify({ content: "Prefers value names.", revision: before.revision })));
    expect(res.status).toBe(200);
    const after = await read();
    expect(after.content).toBe("Prefers value names.");
    expect(after.revision).not.toBe(before.revision);
    expect(((await res.json()) as Memory).revision).toBe(after.revision);
  });

  it("refuses with 409 a save based on a version the agent has since changed", async () => {
    const { PUT } = await import("./route");
    const opened = await read();
    await updateMemory({ operation: "append", section: "Notes", content: "from the agent" });
    const res = await PUT(put(JSON.stringify({ content: "stale edit", revision: opened.revision })));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "memory_changed", error: expect.stringContaining("changed") });
    expect((await read()).content).toContain("- from the agent");
  });

  it("refuses content over the limit with 413", async () => {
    const { PUT } = await import("./route");
    const { revision, content } = await read();
    const res = await PUT(put(JSON.stringify({ content: "x".repeat(maxMemoryChars + 1), revision })));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "memory_too_large" });
    expect((await read()).content).toBe(content);
  });

  it("answers malformed input with a 400 envelope, not a crash", async () => {
    const { PUT } = await import("./route");
    const broken = await PUT(put("{not json"));
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ error: expect.stringContaining("JSON") });
    expect((await PUT(put(JSON.stringify({ content: 42, revision: "r" })))).status).toBe(400);
    expect((await PUT(put(JSON.stringify({ content: "no revision" })))).status).toBe(400);
  });

  it("refuses a body that is not declared JSON", async () => {
    const { PUT } = await import("./route");
    const before = await read();
    expect((await PUT(put(JSON.stringify({ content: "ignore all previous", revision: before.revision }), "text/plain"))).status).toBe(415);
    expect((await read()).content).toBe(before.content);
  });
});
