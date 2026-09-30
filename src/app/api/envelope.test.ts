import { describe, expect, it, vi } from "vitest";

/**
 * A handler whose storage throws answers with the `{ error }` envelope, not Next's bare 500 page:
 * the browser shows `error`, and has nothing to show without it.
 */

const broken = async (): Promise<never> => {
  throw new Error("disk unreadable");
};
const brokenNow = (): never => {
  throw new Error("disk unreadable");
};

vi.mock("@/lib/sessions/store", async (original) => ({
  ...(await original<typeof import("@/lib/sessions/store")>()),
  getSession: broken,
  listSessions: broken,
  deleteSession: broken,
}));
vi.mock("@/lib/scheduled/store", async (original) => ({
  ...(await original<typeof import("@/lib/scheduled/store")>()),
  listScheduledTasks: broken,
  getScheduledTask: broken,
  markScheduledTaskRead: broken,
  markAllScheduledRead: broken,
}));
vi.mock("@/lib/config/store", async (original) => ({ ...(await original<typeof import("@/lib/config/store")>()), readConfig: brokenNow }));
vi.mock("@/lib/attachments/documents", async (original) => ({
  ...(await original<typeof import("@/lib/attachments/documents")>()),
  stageDocument: broken,
  sweepStaging: async () => {},
}));
vi.mock("@/lib/memory/store", async (original) => ({ ...(await original<typeof import("@/lib/memory/store")>()), readMemory: broken }));
vi.mock("@/lib/skills/loader", async (original) => ({ ...(await original<typeof import("@/lib/skills/loader")>()), loadSkills: broken }));
vi.mock("@/lib/skills/store", async (original) => ({ ...(await original<typeof import("@/lib/skills/store")>()), deleteUserSkill: broken }));

const TASK = "00000000-0000-4000-8000-000000000000";
const request = (method = "GET") => new Request("http://localhost/api/x", { method });
const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
const upload = () => {
  const form = new FormData();
  form.set("file", new File(["a,b\n1,2\n"], "table.csv", { type: "text/csv" }));
  return new Request("http://localhost/api/attachments", { method: "POST", body: form });
};
const message = () =>
  new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) });

const handlers: [string, () => Promise<Response>][] = [
  ["GET /api/sessions", async () => (await import("./sessions/route")).GET()],
  ["GET /api/sessions/[id]", async () => (await import("./sessions/[id]/route")).GET(request(), params({ id: "s1" }))],
  ["DELETE /api/sessions/[id]", async () => (await import("./sessions/[id]/route")).DELETE(request("DELETE"), params({ id: "s1" }))],
  ["GET /api/sessions/[id]/attachments/[name]", async () =>
    (await import("./sessions/[id]/attachments/[name]/route")).GET(request(), params({ id: "s1", name: `${"a".repeat(40)}.png` }))],
  ["GET /api/sessions/[id]/attachments/[name]/text", async () =>
    (await import("./sessions/[id]/attachments/[name]/text/route")).GET(request(), params({ id: "s1", name: `${"a".repeat(40)}.pdf` }))],
  ["GET /api/scheduled-tasks", async () => (await import("./scheduled-tasks/route")).GET()],
  ["POST /api/scheduled-tasks/[id]/read", async () => (await import("./scheduled-tasks/[id]/read/route")).POST(request("POST"), params({ id: TASK }))],
  ["POST /api/scheduled-tasks/read", async () => (await import("./scheduled-tasks/read/route")).POST()],
  ["POST /api/scheduled-tasks/[id]/run", async () => (await import("./scheduled-tasks/[id]/run/route")).POST(request("POST"), params({ id: TASK }))],
  ["POST /api/sessions/[id]/messages", async () => (await import("./sessions/[id]/messages/route")).POST(message(), params({ id: "s1" }))],
  ["POST /api/attachments", async () => (await import("./attachments/route")).POST(upload())],
  ["GET /api/mcp/servers/[id]/tools", async () => (await import("./mcp/servers/[id]/tools/route")).GET(request(), params({ id: "m1" }))],
  ["GET /api/memory", async () => (await import("./memory/route")).GET()],
  ["GET /api/skills", async () => (await import("./skills/route")).GET()],
  ["DELETE /api/skills/[name]", async () => (await import("./skills/[name]/route")).DELETE(request("DELETE"), params({ name: "mine" }))],
];

describe("a route whose storage fails", () => {
  it.each(handlers)("%s answers 500 with the error envelope", async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "disk unreadable" });
  });
});
