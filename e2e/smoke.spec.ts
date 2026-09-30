import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/** What the stub model says; see `stub-llm.ts`. */
const script = JSON.parse(readFileSync(new URL("./script.json", import.meta.url), "utf8")) as {
  port: number;
  title: string;
  opening: string;
  closing: string;
  summary: string;
};

const NOTE = "Quarterly note: the company opened a new plant and kept its guidance.";

test("a chat streams an answer over an uploaded document and opens the report it made", async ({ page, request }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));

  await page.goto("/chat/new");
  const composer = page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();

  // The document goes up and is parsed before the message is sent.
  await page.locator('input[type="file"]').setInputFiles({
    name: "note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(NOTE),
  });
  await expect(page.getByText("note.txt")).toBeVisible();
  await expect(page.getByText("Parsing…")).toHaveCount(0);

  await composer.fill("Write up the attached note as a report.");
  const turn = page.waitForResponse((res) => res.request().method() === "POST" && /\/api\/sessions\/[^/]+\/messages$/.test(res.url()));
  await page.getByRole("button", { name: "Send message" }).click();

  // The turn is an event stream, and its text arrives on screen as it streams.
  expect((await turn).headers()["content-type"]).toContain("text/event-stream");
  await expect(page.getByText(script.opening)).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);

  // The report the model made opens beside the chat, then the answer closes the turn.
  const panel = page.getByRole("region", { name: "Report" });
  await expect(panel).toBeVisible();
  await expect(page.getByText(script.closing)).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);

  // Hidden, it comes back from its card in the transcript.
  await panel.getByRole("button", { name: "Hide reports" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: `View report: ${script.title}` }).click();
  await expect(panel).toBeVisible();
  await expect(panel.frameLocator(`iframe[title="${script.title}"]`).getByText(script.summary)).toBeVisible();

  // The model was sent the document's text alongside the message.
  const sent = await (await request.get(`http://127.0.0.1:${script.port}/requests`)).text();
  expect(sent).toContain(NOTE);
  expect(failures).toEqual([]);
});

test("the sidebar reports a failed delete on a page without a chat", async ({ page }) => {
  const now = new Date().toISOString();
  const session = { id: "3f2c9d4e-0000-4000-8000-000000000001", title: "Undeletable chat", createdAt: now, updatedAt: now, tickers: [], messageCount: 2, reports: [], running: false };
  await page.route("**/api/sessions", (route) => route.fulfill({ json: { sessions: [session], dataDir: "/tmp/ofa" } }));
  await page.route(`**/api/sessions/${session.id}`, (route) => route.fulfill({ status: 500, json: { error: "The disk is full." } }));

  await page.goto("/portfolio");
  await page.getByRole("link", { name: session.title }).hover();
  await page.getByRole("button", { name: `Delete ${session.title}` }).click();
  await expect(page.getByText("Could not delete the chat: The disk is full.")).toBeVisible();
});
