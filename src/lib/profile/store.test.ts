import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { profilePath } from "@/lib/paths";
import { deleteProfile, readProfile, writeProfile } from "./store";

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-profile-store-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

beforeEach(async () => {
  await deleteProfile();
  for (const name of setAside()) rmSync(path.join(home, name));
});

/** The bad files the store moved out of the way, oldest first. */
function setAside(): string[] {
  return readdirSync(home).filter((name) => name.startsWith("profile.json.invalid-")).sort();
}

describe("profile store", () => {
  it("reads null when there is no profile, and again after a delete", async () => {
    expect(await readProfile()).toBeNull();
    await writeProfile({ experience: { level: "beginner" } });
    expect(await readProfile()).not.toBeNull();
    expect(await deleteProfile()).toBe(true);
    expect(await deleteProfile()).toBe(false);
    expect(await readProfile()).toBeNull();
  });

  it("round-trips a profile and stamps each save", async () => {
    const first = await writeProfile({
      experience: { level: "intermediate", role: "individual" },
      objectives: { primary: "income", horizon: "3_10y" },
      constraints: { allowedInstruments: ["stocks", "etfs"], exclusions: ["tobacco"] },
      jurisdiction: { baseCurrency: "USD" },
      style: { approach: "dividend", depth: "standard", preferredMetrics: ["payout ratio"] },
    });
    expect(new Date(first.updatedAt).toISOString()).toBe(first.updatedAt);
    expect(await readProfile()).toEqual(first);

    // The whole profile is the body, so a save replaces it rather than merging into it.
    const second = await writeProfile({ ...first, risk: { tolerance: "moderate" } });
    expect(second.risk).toEqual({ tolerance: "moderate" });
    expect(second.constraints).toEqual(first.constraints);
  });

  it("stores an empty list as absent, so it never reads as allow nothing", async () => {
    const saved = await writeProfile({
      constraints: { allowedInstruments: [], exclusions: ["tobacco"] },
      jurisdiction: { accountTypes: [] },
      style: { depth: "brief", preferredMetrics: [] },
    });
    expect(saved).toEqual({ constraints: { exclusions: ["tobacco"] }, style: { depth: "brief" }, updatedAt: saved.updatedAt });
    expect(JSON.parse(readFileSync(profilePath(), "utf8"))).toEqual(saved);

    // A file written before this rule reads the same way.
    writeFileSync(profilePath(), JSON.stringify({ updatedAt: saved.updatedAt, constraints: { allowedInstruments: [] } }));
    expect(await readProfile()).toEqual({ updatedAt: saved.updatedAt });
  });

  it("reads a file with fields the profile no longer has, ignoring them", async () => {
    const updatedAt = "2026-09-01T00:00:00.000Z";
    writeFileSync(
      profilePath(),
      JSON.stringify({ version: 4, updatedAt, style: { depth: "deep", defaultReportFormat: "slides" } }),
    );
    expect(await readProfile()).toEqual({ updatedAt, style: { depth: "deep" } });
    expect(setAside()).toEqual([]);
  });

  it("writes the file with owner-only permissions", async () => {
    await writeProfile({ risk: { tolerance: "low" } });
    expect(statSync(profilePath()).mode & 0o777).toBe(0o600);

    // A second save goes through a temp file and a rename, which must not widen the mode.
    await writeProfile({ risk: { tolerance: "high" } });
    expect(statSync(profilePath()).mode & 0o777).toBe(0o600);
  });

  it("serializes overlapping saves instead of interleaving them", async () => {
    const saves = await Promise.all([
      writeProfile({ risk: { tolerance: "low" } }),
      writeProfile({ risk: { tolerance: "moderate" } }),
      writeProfile({ risk: { tolerance: "high" } }),
    ]);
    expect(saves.map((profile) => profile.risk?.tolerance)).toEqual(["low", "moderate", "high"]);
    expect((await readProfile())?.risk).toEqual({ tolerance: "high" });
  });

  it("serializes saves made through another copy of the module", async () => {
    vi.resetModules();
    const copy = await import("./store");
    await Promise.all([
      writeProfile({ risk: { tolerance: "low" } }),
      copy.writeProfile({ risk: { tolerance: "moderate" } }),
      writeProfile({ risk: { tolerance: "high" } }),
    ]);
    expect((await readProfile())?.risk).toEqual({ tolerance: "high" });
  });

  it("rejects a value the schema does not accept", async () => {
    await expect(writeProfile({ style: { answerLanguage: "" } })).rejects.toThrow();
    expect(await readProfile()).toBeNull();
  });

  it("sets a corrupt or invalid file aside instead of letting a save overwrite it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      writeFileSync(profilePath(), "{ not json");
      expect(await readProfile()).toBeNull();
      expect(setAside()).toHaveLength(1);
      expect(readFileSync(path.join(home, setAside()[0]), "utf8")).toBe("{ not json");

      const invalid = JSON.stringify({ updatedAt: "yesterday", risk: { tolerance: "extreme" } });
      writeFileSync(profilePath(), invalid);
      // A save with no read before it keeps the bad file too.
      expect((await writeProfile({ risk: { tolerance: "low" } })).risk).toEqual({ tolerance: "low" });
      expect(setAside()).toHaveLength(2);
      expect(setAside().map((name) => readFileSync(path.join(home, name), "utf8"))).toContain(invalid);
      expect(warn).toHaveBeenCalledTimes(2);

      // A missing file is simply no profile, with nothing to set aside.
      await deleteProfile();
      expect(await readProfile()).toBeNull();
      expect(setAside()).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });
});
