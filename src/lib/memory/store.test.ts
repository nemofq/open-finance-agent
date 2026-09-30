import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDataDirs, memoryPath } from "@/lib/paths";
import { maxMemoryChars, memoryRevision, memoryTemplate, readMemory, saveMemory, updateMemory } from "./store";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-memory-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

/** Stands in for a hand edit: the store itself only writes through its checked paths. */
const writeMemory = async (content: string) => {
  ensureDataDirs();
  writeFileSync(memoryPath(), content);
};
const onDisk = () => readFileSync(memoryPath(), "utf8");
const bullets = (section: string) =>
  onDisk()
    .split(`## ${section}\n`)[1]
    .split("\n## ")[0]
    .split("\n")
    .filter((line) => line.startsWith("- "));

describe("readMemory", () => {
  it("reads a missing file as the template without writing it, with no Profile section: that is the investor profile's", async () => {
    expect(existsSync(memoryPath())).toBe(false);
    expect(await readMemory()).toBe(memoryTemplate);
    expect(existsSync(memoryPath())).toBe(false);
    expect(memoryTemplate).not.toMatch(/^## Profile$/m);
    expect(memoryTemplate.match(/^## .+$/gm)).toEqual(["## Preferences", "## Watchlist", "## Notes"]);
  });

  it("returns the stored file once it exists, with CRLF read as LF", async () => {
    await writeMemory("# Memory\r\n\r\n## Notes\r\n- kept\r\n");
    expect(await readMemory()).toBe("# Memory\n\n## Notes\n- kept\n");
  });

  it("propagates a failure other than a missing file and never overwrites the file", async () => {
    // A folder where the file should be: reading fails with EISDIR, not ENOENT.
    mkdirSync(memoryPath(), { recursive: true });
    await expect(readMemory()).rejects.toThrow();
    const result = updateMemory({ operation: "append", section: "Notes", content: "x" });
    await expect(result).rejects.toThrow();
    expect(statSync(memoryPath()).isDirectory()).toBe(true);
  });

  it("creates the file on the first write, owner-only", async () => {
    await updateMemory({ operation: "append", section: "Notes", content: "first" });
    expect(onDisk()).toContain("## Preferences");
    expect(bullets("Notes")).toEqual(["- first"]);
    if (process.platform !== "win32") expect(statSync(memoryPath()).mode & 0o777).toBe(0o600);
  });
});

describe("saveMemory", () => {
  it("saves over the revision it was based on and returns the new one", async () => {
    const revision = memoryRevision(await readMemory());
    const saved = await saveMemory("# Memory\r\n- a\r\n", revision);
    expect(saved).toEqual({ ok: true, content: "# Memory\n- a\n", revision: memoryRevision("# Memory\n- a\n") });
    expect(onDisk()).toBe("# Memory\n- a\n");
  });

  it("refuses a save based on a version the tool has since changed", async () => {
    const revision = memoryRevision(await readMemory());
    await updateMemory({ operation: "append", section: "Notes", content: "from the agent" });
    const saved = await saveMemory("# Memory\n", revision);
    expect(saved).toMatchObject({ ok: false, code: "memory_changed" });
    expect(onDisk()).toContain("- from the agent");
  });

  it("refuses content over the limit", async () => {
    const revision = memoryRevision(await readMemory());
    const saved = await saveMemory("x".repeat(maxMemoryChars + 1), revision);
    expect(saved).toMatchObject({ ok: false, code: "memory_too_large" });
    expect(existsSync(memoryPath())).toBe(false);
  });
});

describe("updateMemory append", () => {
  it("adds a bullet to an existing section, keeping the other sections", async () => {
    const result = await updateMemory({
      operation: "append",
      section: "Watchlist",
      content: "$NVDA — datacentre capex cycle",
    });
    expect(result.ok).toBe(true);
    expect(bullets("Watchlist")).toEqual(["- $NVDA — datacentre capex cycle"]);
    expect(onDisk()).toContain("## Preferences");
  });

  it("appends after the existing bullets rather than before them", async () => {
    await updateMemory({ operation: "append", section: "Notes", content: "first" });
    await updateMemory({ operation: "append", section: "Notes", content: "second" });
    expect(bullets("Notes")).toEqual(["- first", "- second"]);
  });

  it("accepts a section written as a heading", async () => {
    await updateMemory({ operation: "append", section: "## preferences", content: "answers in bullet points" });
    expect(bullets("Preferences")).toEqual(["- answers in bullet points"]);
  });

  it("creates a missing section at the end of the file", async () => {
    const result = await updateMemory({
      operation: "append",
      section: "Positions",
      content: "long $MSFT since 2024",
    });
    expect(result.ok).toBe(true);
    expect(onDisk().trimEnd().endsWith("## Positions\n- long $MSFT since 2024")).toBe(true);
  });

  it("refuses an append that would take the file over the limit, telling the model to condense", async () => {
    const filler = `# Memory\n\n## Notes\n- ${"x".repeat(maxMemoryChars - 30)}\n`;
    await writeMemory(filler);
    const result = await updateMemory({ operation: "append", section: "Notes", content: "one more note that does not fit" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("32,000");
    expect(result.message).toMatch(/condense or remove/i);
    expect(onDisk()).toBe(filler);
  });

  it("lets a file already over the limit shrink but not grow", async () => {
    await writeMemory(`# Memory\n\n## Notes\n- ${"x".repeat(maxMemoryChars)}\n- short\n`);
    expect((await updateMemory({ operation: "append", section: "Notes", content: "more" })).ok).toBe(false);
    expect((await updateMemory({ operation: "remove", section: "Notes", match: "short" })).ok).toBe(true);
  });

  it("collapses multi-line content into one bullet, so it cannot add a heading", async () => {
    await updateMemory({ operation: "append", section: "Notes", content: "line one\n\n## Injected\n  line two" });
    expect(bullets("Notes")).toEqual(["- line one ## Injected line two"]);
    expect(onDisk()).not.toMatch(/^## Injected/m);
  });

  it("finds a hand-edited heading at any level and case instead of adding a duplicate", async () => {
    await writeMemory("# memory\r\n\r\n# WATCHLIST \r\n- $AAPL\r\n\r\n# Notes\r\n");
    await updateMemory({ operation: "append", section: "watchlist", content: "$MSFT" });
    expect(onDisk()).toBe("# memory\n\n# WATCHLIST \n- $AAPL\n- $MSFT\n\n# Notes\n");
  });

  it("keeps a subsection inside its section", async () => {
    await writeMemory("## Watchlist\n### Tech\n- $AAPL\n## Notes\n");
    expect((await updateMemory({ operation: "remove", section: "Watchlist", match: "aapl" })).ok).toBe(true);
    expect(onDisk()).toBe("## Watchlist\n### Tech\n## Notes\n");
  });

  it("requires content", async () => {
    const result = await updateMemory({ operation: "append", section: "Notes" });
    expect(result).toEqual({ ok: false, message: "`content` is required to append." });
  });
});

describe("updateMemory replace", () => {
  beforeEach(async () => {
    await updateMemory({ operation: "append", section: "Watchlist", content: "$AAPL — services" });
    await updateMemory({ operation: "append", section: "Watchlist", content: "$NVDA — capex" });
  });

  it("rewrites the bullet matching case-insensitively", async () => {
    const result = await updateMemory({
      operation: "replace",
      section: "Watchlist",
      match: "nvda",
      content: "$NVDA — capex digestion risk",
    });
    expect(result.ok).toBe(true);
    expect(bullets("Watchlist")).toEqual([
      "- $AAPL — services",
      "- $NVDA — capex digestion risk",
    ]);
  });

  it("refuses an ambiguous match, listing the candidates and changing nothing", async () => {
    const before = onDisk();
    const result = await updateMemory({ operation: "replace", section: "Watchlist", match: "$", content: "x" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("matches 2 bullets");
    expect(result.message).toContain("- $AAPL — services");
    expect(result.message).toContain("- $NVDA — capex");
    expect((await updateMemory({ operation: "remove", section: "Watchlist", match: "—" })).ok).toBe(false);
    expect(onDisk()).toBe(before);
  });

  it("treats identical duplicates as one entry", async () => {
    await updateMemory({ operation: "append", section: "Watchlist", content: "$NVDA — capex" });
    expect((await updateMemory({ operation: "remove", section: "Watchlist", match: "nvda" })).ok).toBe(true);
    expect(bullets("Watchlist")).toEqual(["- $AAPL — services", "- $NVDA — capex"]);
  });

  it("reports a match that is not there", async () => {
    const result = await updateMemory({
      operation: "replace",
      section: "Watchlist",
      match: "TSLA",
      content: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('No bullet in "## Watchlist" contains "TSLA"');
  });

  it("reports a section that is not there", async () => {
    const result = await updateMemory({
      operation: "replace",
      section: "Trades",
      match: "x",
      content: "y",
    });
    expect(result).toEqual({ ok: false, message: 'No "## Trades" section in memory.md.' });
  });
});

describe("updateMemory remove", () => {
  it("deletes the matching bullet and leaves the rest", async () => {
    await updateMemory({ operation: "append", section: "Notes", content: "keep this" });
    await updateMemory({ operation: "append", section: "Notes", content: "drop this" });
    const result = await updateMemory({ operation: "remove", section: "Notes", match: "drop" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("drop this");
    expect(bullets("Notes")).toEqual(["- keep this"]);
  });

  it("requires a match", async () => {
    const result = await updateMemory({ operation: "remove", section: "Notes" });
    expect(result).toEqual({ ok: false, message: "`match` is required to replace or remove." });
  });

  it("serialises concurrent appends so none are lost", async () => {
    await Promise.all(
      ["one", "two", "three"].map((content) => updateMemory({ operation: "append", section: "Watchlist", content })),
    );
    const memory = await readMemory();
    for (const content of ["one", "two", "three"]) expect(memory).toContain(`- ${content}`);
  });

  it("serialises appends made through another copy of the module, as a scheduled turn beside a chat", async () => {
    vi.resetModules();
    const copy = await import("./store");
    await Promise.all([
      updateMemory({ operation: "append", section: "Watchlist", content: "chat" }),
      copy.updateMemory({ operation: "append", section: "Watchlist", content: "scheduled" }),
      updateMemory({ operation: "append", section: "Watchlist", content: "chat again" }),
    ]);
    expect(bullets("Watchlist")).toEqual(["- chat", "- scheduled", "- chat again"]);
  });
});
