import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coverageDomains } from "@/lib/config/schema";
import { userSkillsDir } from "@/lib/paths";
import { isProfileFieldPath } from "@/lib/profile/schema";
import { templateIds } from "@/lib/reports/templates";
import { applySkillInvocation, getSkill, loadSkills } from "./loader";
import type { Skill } from "./skill";

let home: string;

/** Every skill shipped in `skills/`, in the order the loader returns them. */
const BUNDLED = [
  "earnings-preview",
  "earnings-review",
  "filing-changes",
  "peer-comps",
  "portfolio-check",
  "stock-brief",
  "thesis-check",
  "valuation",
];

/** Writes `<user skills>/<folder>/SKILL.md`. */
function writeUserSkill(folder: string, contents: string): void {
  const dir = path.join(userSkillsDir(), folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), contents);
}

function frontmatter(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-skills-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("loadSkills", () => {
  it("loads the bundled default pack from the repo", async () => {
    const skills = await loadSkills();
    expect(skills.map((s) => s.name)).toEqual(BUNDLED);
    for (const skill of skills) {
      expect(skill.source).toBe("bundled");
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeLessThanOrEqual(1024);
      expect(skill.filePath).toContain(path.join("skills", skill.name, "SKILL.md"));
      expect(skill.body).toContain("## Process");
      expect(skill.body.startsWith("---")).toBe(false);
    }
  });

  it("lets a user skill override a bundled one of the same name", async () => {
    writeUserSkill("earnings-preview", frontmatter("earnings-preview", "Mine.", "# Mine"));
    const skills = await loadSkills();
    const preview = skills.find((s) => s.name === "earnings-preview");
    expect(preview).toMatchObject({ source: "user", description: "Mine.", body: "# Mine" });
    expect(skills.filter((s) => s.name === "earnings-preview")).toHaveLength(1);
    expect(skills.find((s) => s.name === "earnings-review")?.source).toBe("bundled");
  });

  it("adds user skills alongside the bundled ones", async () => {
    writeUserSkill("my-screen", frontmatter("my-screen", "Screen for value names.", "# Screen"));
    const skill = await getSkill("my-screen");
    expect(skill).toMatchObject({ source: "user", name: "my-screen" });
    expect(skill?.filePath).toBe(path.join(home, "skills", "my-screen", "SKILL.md"));
  });

  it("skips skills with invalid frontmatter and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeUserSkill("Bad Name", frontmatter("Bad Name", "Uppercase and spaces.", "# x"));
    writeUserSkill("mismatched", frontmatter("other-name", "Name is not the folder.", "# x"));
    writeUserSkill("no-description", "---\nname: no-description\n---\n\n# x\n");
    writeUserSkill("too-long", frontmatter("too-long", "d".repeat(1025), "# x"));
    writeUserSkill(
      "bad-flag",
      `---\nname: bad-flag\ndescription: d\ndisable-model-invocation: yes please\n---\n\n# x\n`,
    );
    mkdirSync(path.join(userSkillsDir(), "empty-folder"), { recursive: true });

    const skills = await loadSkills();
    expect(skills.map((s) => s.name)).toEqual(BUNDLED);
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it("skips a skill whose frontmatter is not valid YAML, and loads the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeUserSkill("broken-yaml", "---\nname: broken-yaml\ndescription: [unclosed\n---\n\n# x\n");
    writeUserSkill("my-screen", frontmatter("my-screen", "Screen for value names.", "# Screen"));

    const skills = await loadSkills();
    expect(skills.map((s) => s.name)).toEqual([...BUNDLED, "my-screen"].sort());
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/broken-yaml.*not valid YAML/));
    expect(await getSkill("my-screen")).toBeDefined();
  });

  it("reads the disable-model-invocation flag", async () => {
    writeUserSkill(
      "hidden",
      `---\nname: hidden\ndescription: Only from the composer.\ndisable-model-invocation: true\n---\n\n# Hidden\n`,
    );
    expect((await getSkill("hidden"))?.disableModelInvocation).toBe(true);
    expect((await getSkill("earnings-preview"))?.disableModelInvocation).toBeUndefined();
    expect(await getSkill("nope")).toBeUndefined();
  });
});

describe("skill metadata", () => {
  const withMetadata = (body: string): string =>
    `---\nname: meta\ndescription: A skill with metadata.\nmetadata:\n${body}---\n\n# Meta\n`;

  it("keeps the fields it knows and ignores the rest", async () => {
    writeUserSkill(
      "meta",
      withMetadata(['  version: "3.0"', "  requires: [filings]", "  output: valuation", "  holdings: true", ""].join("\n")),
    );
    expect((await getSkill("meta"))?.metadata).toEqual({ output: "valuation" });
  });

  it("drops fields of the wrong type rather than failing the skill", async () => {
    writeUserSkill(
      "meta",
      withMetadata(["  inputs: ticker", "  output: [stock-brief]", "  holdings: yes please", ""].join("\n")),
    );
    expect((await getSkill("meta"))?.metadata).toBeUndefined();
  });

  it("is undefined when a skill declares none", async () => {
    writeUserSkill("plain", frontmatter("plain", "No metadata at all.", "# Plain"));
    expect((await getSkill("plain"))?.metadata).toBeUndefined();
  });

  it("has every bundled skill with an output declaring a known template", async () => {
    const skills = (await loadSkills()).filter((s) => s.source === "bundled");
    expect(skills).toHaveLength(BUNDLED.length);
    for (const skill of skills) {
      if (skill.metadata?.output !== undefined) {
        expect(templateIds(), `${skill.name} output is a known template`).toContain(skill.metadata.output);
      }
      // The documenting keys the app does not parse are checked against the frontmatter itself.
      const metadata = matter(readFileSync(skill.filePath, "utf8")).data.metadata as { holdings?: unknown; requires?: string[]; profile?: string[] };
      expect(metadata.holdings, `${skill.name} declares metadata.holdings`).toBeTypeOf("boolean");
      expect(metadata.requires?.length, `${skill.name} declares the data it needs`).toBeGreaterThan(0);
      for (const domain of metadata.requires ?? []) {
        expect(coverageDomains, `${skill.name} requires a real coverage domain`).toContain(domain);
      }
      for (const field of metadata.profile ?? []) {
        expect(isProfileFieldPath(field), `${skill.name} reads the real profile field ${field}`).toBe(true);
      }
    }
  });

  it("portfolio-check delivers in chat without a report contract", async () => {
    const portfolio = await getSkill("portfolio-check");
    expect(portfolio?.metadata?.output).toBeUndefined();
    expect(applySkillInvocation("check my holdings", portfolio!)).not.toContain("create_report");
  });
});

const skill = (over: Partial<Skill> = {}): Skill => ({
  name: "earnings-preview",
  description: "Preview a report.",
  body: "# Earnings Preview\n\nDo the work.",
  source: "bundled",
  filePath: "/repo/skills/earnings-preview/SKILL.md",
  ...over,
});

describe("applySkillInvocation", () => {
  it("wraps the body and carries the user's request", () => {
    expect(applySkillInvocation("  $AAPL  ", skill())).toBe(
      [
        "The user invoked the `earnings-preview` skill. Follow its instructions for this request.",
        "",
        '<skill name="earnings-preview">',
        "# Earnings Preview",
        "",
        "Do the work.",
        "</skill>",
        "",
        "User request: $AAPL",
      ].join("\n"),
    );
  });

  it("falls back to a default request when the composer text is empty", () => {
    expect(applySkillInvocation("   ", skill())).toContain("User request: Run this skill.");
  });

  it("states the report contract under the framing and again as the last line", () => {
    const contract =
      "This skill ends with a call to `create_report` using template `earnings-preview`. " +
      "Build the report before you write any analysis in chat; the chat reply after it is two or three lines.";

    expect(applySkillInvocation("$AAPL", skill({ metadata: { output: "earnings-preview" } }))).toBe(
      [
        "The user invoked the `earnings-preview` skill. Follow its instructions for this request.",
        contract,
        "",
        '<skill name="earnings-preview">',
        "# Earnings Preview",
        "",
        "Do the work.",
        "</skill>",
        "",
        "User request: $AAPL",
        "",
        contract,
      ].join("\n"),
    );
  });

  it("says nothing about a report for a skill that declares no output template", () => {
    expect(applySkillInvocation("$AAPL", skill({ metadata: {} }))).not.toContain("create_report");
  });
});
