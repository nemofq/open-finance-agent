import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundledSkillsDir, userSkillsDir } from "@/lib/paths";
import { getSkill, loadSkills } from "./loader";
import { deleteUserSkill, saveUserSkill, SkillValidationError, userSkillExists } from "./store";

/** Every bundled skill loads alongside the user's; the pack grows, so the count is read, not pinned. */
const bundledCount = readdirSync(bundledSkillsDir(), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-skill-store-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

const draft = {
  name: "my-screen",
  description: "Screen for value names.",
  body: "# Screen\n\nDo the work.",
};

const onDisk = (name: string) =>
  readFileSync(path.join(userSkillsDir(), name, "SKILL.md"), "utf8");

describe("saveUserSkill", () => {
  it("writes a skill the loader then reads back as the user's", async () => {
    const saved = await saveUserSkill(draft);
    expect(saved).toEqual({
      name: "my-screen",
      description: "Screen for value names.",
      body: "# Screen\n\nDo the work.",
      source: "user",
      filePath: path.join(home, "skills", "my-screen", "SKILL.md"),
    });

    const skills = await loadSkills();
    expect(skills.find((skill) => skill.name === "my-screen")).toEqual(saved);
    expect(await userSkillExists("my-screen")).toBe(true);
  });

  it("overrides a bundled skill of the same name", async () => {
    await saveUserSkill({ ...draft, name: "earnings-preview", description: "Mine." });
    const skills = await loadSkills();
    expect(skills.filter((skill) => skill.name === "earnings-preview")).toHaveLength(1);
    expect(await getSkill("earnings-preview")).toMatchObject({
      source: "user",
      description: "Mine.",
    });
  });

  it("overwrites an existing user skill in place", async () => {
    await saveUserSkill(draft);
    const updated = await saveUserSkill({ ...draft, description: "Now for growth.", body: "# v2" });
    expect(updated).toMatchObject({ description: "Now for growth.", body: "# v2" });
    expect(onDisk("my-screen")).not.toContain("Screen for value names.");
    // The temp file used for the atomic write must not linger.
    expect((await loadSkills()).filter((skill) => skill.name === "my-screen")).toHaveLength(1);
  });

  it("round-trips disableModelInvocation", async () => {
    const hidden = await saveUserSkill({ ...draft, disableModelInvocation: true });
    expect(hidden.disableModelInvocation).toBe(true);
    expect(onDisk("my-screen")).toContain("disable-model-invocation: true");

    const shown = await saveUserSkill(draft);
    expect(shown.disableModelInvocation).toBeUndefined();
    expect(onDisk("my-screen")).not.toContain("disable-model-invocation");
  });

  it("keeps the metadata and any other frontmatter the form does not edit", async () => {
    const dir = path.join(userSkillsDir(), "my-screen");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "SKILL.md"),
      [
        "---",
        "name: my-screen",
        "description: Screen for value names.",
        "disable-model-invocation: true",
        "license: MIT",
        "metadata:",
        "  output: stock-brief",
        "  inputs: [ticker]",
        "---",
        "",
        "# Screen",
        "",
      ].join("\n"),
    );

    const saved = await saveUserSkill({ ...draft, description: "Now for growth.", body: "# v2" });
    expect(saved).toMatchObject({ description: "Now for growth.", body: "# v2", metadata: { output: "stock-brief" } });
    // The flag is the form's to set, so unticking it removes it.
    expect(saved.disableModelInvocation).toBeUndefined();
    expect(onDisk("my-screen")).toContain("license: MIT");
    expect(onDisk("my-screen")).toMatch(/inputs:\s+- ticker/);
  });

  it("keeps a bundled skill's metadata in the copy that customises it", async () => {
    const bundled = await getSkill("earnings-preview");
    expect(bundled?.metadata?.output).toBeDefined();
    const saved = await saveUserSkill({ ...draft, name: "earnings-preview", description: "Mine." });
    expect(saved).toMatchObject({ source: "user", description: "Mine.", metadata: bundled?.metadata });
  });

  it("drops frontmatter the user pasted along with the body", async () => {
    const saved = await saveUserSkill({
      ...draft,
      body: "---\nname: other-name\ndescription: Pasted.\n---\n\n# Screen\n",
    });
    expect(saved).toMatchObject({
      name: "my-screen",
      description: "Screen for value names.",
      body: "# Screen",
    });
    expect(onDisk("my-screen")).not.toContain("other-name");
    expect(onDisk("my-screen")).not.toContain("Pasted.");
  });

  it("keeps a leading horizontal rule that is not really frontmatter", async () => {
    const saved = await saveUserSkill({ ...draft, body: "---\n\n# Screen" });
    expect(saved.body).toBe("---\n\n# Screen");
    expect(await getSkill("my-screen")).toMatchObject({ body: "---\n\n# Screen" });
  });

  it("rejects a bad name, an empty body and an over-long description", async () => {
    const reject = (over: Partial<typeof draft>) =>
      expect(saveUserSkill({ ...draft, ...over })).rejects.toBeInstanceOf(SkillValidationError);

    await reject({ name: "My Screen" });
    await reject({ name: "../escape" });
    await reject({ name: "nested/name" });
    await reject({ name: "" });
    await reject({ body: "   \n  " });
    await reject({ body: "---\nname: x\ndescription: y\n---\n" });
    await reject({ description: "  " });
    await reject({ description: "d".repeat(1025) });

    expect(await loadSkills()).toHaveLength(bundledCount);
  });

  it("explains what to fix in the message the UI shows", async () => {
    await expect(saveUserSkill({ ...draft, name: "Bad Name" })).rejects.toThrow(
      /lowercase letters, digits and hyphens/,
    );
    await expect(saveUserSkill({ ...draft, description: "d".repeat(1025) })).rejects.toThrow(
      /over the 1024 limit/,
    );
  });
});

describe("deleteUserSkill", () => {
  it("removes the folder and stops the skill loading", async () => {
    await saveUserSkill(draft);
    expect(await deleteUserSkill("my-screen")).toBe(true);
    expect(await userSkillExists("my-screen")).toBe(false);
    expect(await getSkill("my-screen")).toBeUndefined();
  });

  it("restores the bundled skill it was overriding", async () => {
    await saveUserSkill({ ...draft, name: "earnings-preview" });
    expect(await deleteUserSkill("earnings-preview")).toBe(true);
    expect(await getSkill("earnings-preview")).toMatchObject({ source: "bundled" });
  });

  it("reports an unknown, bundled-only or unsafe name as not deleted", async () => {
    expect(await deleteUserSkill("never-existed")).toBe(false);
    expect(await deleteUserSkill("earnings-preview")).toBe(false);
    expect(await deleteUserSkill("../escape")).toBe(false);
    expect(await userSkillExists("../escape")).toBe(false);
  });
});
