import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * The browser smoke test, run by `pnpm test:browser` after `pnpm build`; `pnpm test` never runs
 * it. It starts the production server (`next start`) on a scratch data directory whose only model
 * is `stub-llm.ts`, a scripted OpenAI-compatible endpoint, so it needs no LLM, no key and no
 * network beyond localhost.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const script = JSON.parse(readFileSync(path.join(here, "script.json"), "utf8")) as { port: number };
const appPort = 4010;
const home = path.join(tmpdir(), "ofa-browser-smoke");

if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
  throw new Error("The browser smoke test runs the production build: run `pnpm build` first.");
}

export default defineConfig({
  testDir: here,
  outputDir: path.join(here, "test-results"),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    // Wide enough for the chat and the report column side by side.
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    // Playwright's own Chromium (`pnpm exec playwright install chromium`) unless the machine
    // already has one it would rather use.
    launchOptions: { executablePath: process.env.OFA_BROWSER_EXECUTABLE || undefined },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      // Writes the scratch config before it listens, so the app starts on it.
      command: "node e2e/stub-llm.ts",
      cwd: root,
      url: `http://127.0.0.1:${script.port}/v1/models`,
      env: { OFA_HOME: home },
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec next start --hostname 127.0.0.1 --port ${appPort}`,
      cwd: root,
      url: `http://127.0.0.1:${appPort}/chat/new`,
      env: { OFA_HOME: home },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
