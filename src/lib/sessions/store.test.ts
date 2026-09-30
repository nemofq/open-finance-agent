import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSession,
} from "./store";

let home: string;

const model = { provider: "openrouter", model: "openai/gpt-4o-mini" };

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-sessions-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("session store", () => {
  it("creates a session that reloads from disk", async () => {
    const created = await createSession({ model });
    expect(created.title).toBe("New chat");
    expect(await getSession(created.id)).toEqual(created);
  });

  it("returns null for an unknown or malformed id", async () => {
    expect(await getSession("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await getSession("../escape")).toBeNull();
  });

  it("patches a session and bumps updatedAt", async () => {
    const created = await createSession({ model });
    const updated = await updateSession(created.id, { title: "Earnings", tickers: ["AAPL"] });
    expect(updated?.title).toBe("Earnings");
    expect(updated?.tickers).toEqual(["AAPL"]);
    expect(updated?.createdAt).toBe(created.createdAt);
  });

  it("derives the tickers whenever the messages are saved", async () => {
    const created = await createSession({ model });
    await updateSession(created.id, { messages: [{ role: "user", content: "Is $NVDA dear next to $AMD?", timestamp: 0 }] });
    expect((await getSession(created.id))?.tickers).toEqual(["NVDA", "AMD"]);
    await updateSession(created.id, { title: "Chips" });
    expect((await getSession(created.id))?.tickers).toEqual(["NVDA", "AMD"]);
  });

  it("keeps where a title came from, on the file and in the header", async () => {
    const created = await createSession({ model });
    await updateSession(created.id, { title: "Rate cut odds", titleSource: "generated" });
    expect((await getSession(created.id))?.titleSource).toBe("generated");

    const [header] = await listSessions();
    expect(header.titleSource).toBe("generated");
  });

  it("lists headers without messages, newest first", async () => {
    const older = await createSession({ model });
    const newer = await createSession({ model });
    // updateSession stamps its own updatedAt, so make sure the clock has moved past `older`.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await updateSession(newer.id, { messages: [{ role: "user", content: "hi", timestamp: 0 }] });

    const headers = await listSessions();
    expect(headers.map((header) => header.id)).toEqual([newer.id, older.id]);
    expect(headers[0].messageCount).toBe(1);
    expect(headers[0]).not.toHaveProperty("messages");
  });

  it("flags a running chat from the caller's predicate, and none without one", async () => {
    const running = await createSession({ model });
    const idle = await createSession({ model });

    const flagged = await listSessions((id) => id === running.id);
    expect(flagged.find((header) => header.id === running.id)?.running).toBe(true);
    expect(flagged.find((header) => header.id === idle.id)?.running).toBe(false);
    expect((await listSessions()).every((header) => !header.running)).toBe(true);
  });

  it("lists an unchanged chat without reading it again, and follows every change to it", async () => {
    const created = await createSession({ model });
    const file = path.join(home, "sessions", `${created.id}.json`);
    // Old enough that its time is settled, so an unchanged file is served from the cache.
    const past = new Date(Date.now() - 60_000);
    utimesSync(file, past, past);
    expect((await listSessions())[0].title).toBe("New chat");

    // Rewritten behind the store's back, same size and time: the list does not open it again.
    writeFileSync(file, readFileSync(file, "utf8").replace('"New chat"', '"Old chat"'));
    utimesSync(file, past, past);
    const cached = await listSessions((id) => id === created.id);
    expect(cached[0]).toMatchObject({ title: "New chat", running: true });
    expect((await listSessions())[0].running).toBe(false);

    const later = new Date(past.getTime() + 1_000);
    utimesSync(file, later, later);
    expect((await listSessions())[0].title).toBe("Old chat");

    await updateSession(created.id, { messages: [{ role: "user", content: "How is $AAPL doing?", timestamp: 0 }] });
    expect((await listSessions())[0]).toMatchObject({ messageCount: 1, tickers: ["AAPL"] });

    await deleteSession(created.id);
    expect(await listSessions()).toEqual([]);
  });

  it("does not keep a header read while its file's time may still move", async () => {
    const created = await createSession({ model });
    const file = path.join(home, "sessions", `${created.id}.json`);
    // A whole second, so the same time can be set again exactly.
    const recent = new Date(Math.floor(Date.now() / 1_000) * 1_000);
    utimesSync(file, recent, recent);
    expect((await listSessions())[0].title).toBe("New chat");

    // A second write in the same tick: same size, same time.
    writeFileSync(file, readFileSync(file, "utf8").replace('"New chat"', '"Old chat"'));
    utimesSync(file, recent, recent);
    const later = Date.now() + 10_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      expect((await listSessions())[0].title).toBe("Old chat");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("deletes a session", async () => {
    const created = await createSession({ model });
    expect(await deleteSession(created.id)).toBe(true);
    expect(await getSession(created.id)).toBeNull();
    expect(await listSessions()).toEqual([]);
  });
});
