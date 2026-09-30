import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FinanceTool, ModuleContext } from "@/lib/tools/contracts";
import { builtinModules } from "@/lib/tools/registry";
import { moduleProblems, offlineConfig, offlineContext, toolProblems } from "@/lib/tools/testing";
import { getSandboxStatus } from "@/lib/sandbox";

/**
 * Every built-in module meets the contract in `testing.ts`, and a unit test fails for any that does
 * not. The loop runs over `builtinModules` as it stands at run time, so a module added later is
 * covered the moment it is registered.
 */

/** These reach their tools only through a live MCP connection, which offline tests cannot open. */
const needsNetwork = new Set(["mcp", "alphavantage"]);

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-meta-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

/**
 * A chat with one document in it, so the modules that register a tool only when they have
 * something to work on — `read_attachment` — build theirs here too.
 */
function context(): ModuleContext {
  return offlineContext({
    session: { id: "00000000-0000-4000-8000-000000000000" },
    documents: [{ attachment: `${"a".repeat(40)}.docx`, name: "memo.docx", kind: "document", bytes: 1_024, tokens: 200, parts: 1 }],
  });
}

const offlineModules = builtinModules.filter((entry) => !needsNetwork.has(entry.id));

describe("built-in tool metadata", () => {
  const built = new Map<string, FinanceTool[]>();

  // The calculator boots the real sandbox on its first `createTools`; that takes seconds under load.
  beforeAll(async () => {
    for (const entry of offlineModules) {
      built.set(entry.id, await entry.createTools(offlineConfig(entry), context()));
    }
  }, 120_000);

  it.each(builtinModules.map((entry) => entry.id))("%s declares its settings and defaults", (id) => {
    const entry = builtinModules.find((candidate) => candidate.id === id);
    expect(entry && moduleProblems(entry)).toEqual([]);
  });

  it.each(offlineModules.map((entry) => entry.id))("%s declares a class, an effect and a source per tool", (id) => {
    const tools = built.get(id) ?? [];
    // The calculator is deliberately disabled when the optional Pyodide bundle is unavailable or
    // its isolation probes cannot run (for example on an offline developer machine). In that case
    // there is no tool to inspect; a sandbox-enabled CI run still exercises the metadata below.
    if (id === "python" && tools.length === 0) {
      expect(getSandboxStatus().state).not.toBe("ready");
      return;
    }
    expect(tools.length).toBeGreaterThan(0);
    expect(toolProblems(tools)).toEqual([]);
  });

  it("keeps tool names unique across modules", () => {
    const names = [...built.values()].flat().map((tool) => tool.name);
    expect(names).toEqual([...new Set(names)]);
  });
});
