import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { bundledSkillsDir, userSkillsDir } from "@/lib/paths";
import { MAX_DESCRIPTION_CHARS, NAME_RE, type Skill, type SkillMetadata, type SkillSource } from "./skill";

/** The recognised `metadata` fields, ignoring anything else a skill author put there. */
function skillMetadata(value: unknown): SkillMetadata | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const { output } = value as Record<string, unknown>;
  return typeof output === "string" ? { output } : undefined;
}

/**
 * Parses one `SKILL.md`. Returns null (and warns) when the frontmatter is unusable, including YAML
 * that does not parse: one broken file must not take the skills list, and every agent build that
 * reads it, down with it.
 */
export function parseSkill(
  raw: string,
  filePath: string,
  folder: string,
  source: SkillSource,
): Skill | null {
  const reject = (reason: string): null => {
    console.warn(`[skills] ignoring ${filePath}: ${reason}`);
    return null;
  };

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    return reject(`frontmatter is not valid YAML (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`);
  }
  const data = parsed.data as Record<string, unknown>;

  const { name, description } = data;
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return reject("frontmatter `name` must be 1-64 lowercase letters, digits or hyphens");
  }
  if (name !== folder) {
    return reject(`frontmatter \`name\` (${name}) must match the folder name (${folder})`);
  }
  if (typeof description !== "string" || description.trim() === "") {
    return reject("frontmatter `description` is required");
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return reject(
      `frontmatter \`description\` is ${description.length} chars, over the ${MAX_DESCRIPTION_CHARS} limit`,
    );
  }

  const metadata = skillMetadata(data.metadata);
  const disable = data["disable-model-invocation"];
  if (disable !== undefined && typeof disable !== "boolean") {
    return reject("frontmatter `disable-model-invocation` must be a boolean");
  }

  return {
    name,
    description,
    body: parsed.content.trim(),
    source,
    filePath,
    ...(disable === true ? { disableModelInvocation: true } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

/** Reads every `<dir>/<folder>/SKILL.md`. A missing directory yields no skills. */
async function loadFrom(dir: string, source: SkillSource): Promise<Skill[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(dir, entry.name, "SKILL.md");
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const skill = parseSkill(raw, filePath, entry.name, source);
    if (skill) skills.push(skill);
  }
  return skills;
}

/** Bundled skills first, then the user's; a user skill replaces a bundled one of the same name. */
export async function loadSkills(): Promise<Skill[]> {
  const [bundled, user] = await Promise.all([
    loadFrom(bundledSkillsDir(), "bundled"),
    loadFrom(userSkillsDir(), "user"),
  ]);

  const byName = new Map<string, Skill>();
  for (const skill of [...bundled, ...user]) byName.set(skill.name, skill);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSkill(name: string): Promise<Skill | undefined> {
  return (await loadSkills()).find((skill) => skill.name === name);
}

/** Skills the model may discover and read on its own. */
export function modelInvocableSkills(skills: Skill[]): Skill[] {
  return skills.filter((skill) => !skill.disableModelInvocation);
}

/**
 * The prompt sent when the user picks a skill in the composer: framing, full body, then their
 * request. A skill that declares a report template carries its contract twice — once under the
 * framing and once as the last line — because the end of the prompt is what the model acts on.
 */
export function applySkillInvocation(text: string, skill: Skill): string {
  const request = text.trim() || "Run this skill.";
  const template = skill.metadata?.output?.trim();
  const contract = template
    ? `This skill ends with a call to \`create_report\` using template \`${template}\`. Build the report before you write any analysis in chat; the chat reply after it is two or three lines.`
    : undefined;

  return [
    `The user invoked the \`${skill.name}\` skill. Follow its instructions for this request.`,
    ...(contract ? [contract] : []),
    "",
    `<skill name="${skill.name}">`,
    skill.body,
    "</skill>",
    "",
    `User request: ${request}`,
    ...(contract ? ["", contract] : []),
  ].join("\n");
}
