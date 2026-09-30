import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@/lib/atomic-write";
import matter from "gray-matter";
import { userSkillsDir } from "@/lib/paths";
import { getSkill, parseSkill } from "./loader";
import { MAX_DESCRIPTION_CHARS, NAME_RE, type Skill } from "./skill";

/** What the settings UI sends when a user adds or edits one of their own skills. */
export interface SkillDraft {
  name: string;
  description: string;
  body: string;
  disableModelInvocation?: boolean;
}

/** A draft the UI can fix. The message is written for the user and shown verbatim. */
export class SkillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillValidationError";
  }
}

/** The folder holding one user skill. `name` must already have passed NAME_RE. */
function skillDir(name: string): string {
  return path.join(userSkillsDir(), name);
}

function skillPath(name: string): string {
  return path.join(skillDir(name), "SKILL.md");
}

/** Strips YAML frontmatter from skill markdown body if present. */
function stripFrontmatter(body: string): string {
  if (!body.trimStart().startsWith("---")) return body;
  try {
    const parsed = matter(body);
    // An unterminated `---` parses as frontmatter with no keys and eats the whole body, so
    // only strip when real keys came back — a leading horizontal rule stays part of the text.
    return Object.keys(parsed.data).length > 0 ? parsed.content : body;
  } catch {
    // Not parseable as YAML — keep the text as the user wrote it.
    return body;
  }
}

interface ValidDraft {
  name: string;
  description: string;
  body: string;
  disableModelInvocation: boolean;
}

/** Drafts arrive as untrusted JSON, so check the types as well as the values. */
function validate(draft: SkillDraft): ValidDraft {
  const name = typeof draft.name === "string" ? draft.name.trim() : "";
  if (!NAME_RE.test(name)) {
    throw new SkillValidationError(
      "Name must be 1-64 characters using only lowercase letters, digits and hyphens.",
    );
  }

  const description = typeof draft.description === "string" ? draft.description.trim() : "";
  if (description === "") throw new SkillValidationError("Description is required.");
  if (description.length > MAX_DESCRIPTION_CHARS) {
    throw new SkillValidationError(
      `Description is ${description.length} characters, over the ${MAX_DESCRIPTION_CHARS} limit.`,
    );
  }

  const body = stripFrontmatter(typeof draft.body === "string" ? draft.body : "").trim();
  if (body === "") throw new SkillValidationError("Instructions are required.");

  return { name, description, body, disableModelInvocation: draft.disableModelInvocation === true };
}

/** The frontmatter keys the Settings form edits; every other key belongs to the file. */
const FORM_KEYS = new Set(["name", "description", "disable-model-invocation"]);

/**
 * The frontmatter of the skill a save replaces: the user's own file, else the bundled skill it
 * customises, which is the one the loader resolves the name to. The form edits only name,
 * description and the invocation flag, so everything else, `metadata.output` (the report the
 * harness enforces) included, is carried over from here.
 */
async function carriedFrontmatter(name: string): Promise<Record<string, unknown>> {
  const current = await getSkill(name);
  if (!current) return {};
  try {
    // A copy: gray-matter caches what it parsed and hands the same object to the next reader.
    const { data } = matter(await readFile(current.filePath, "utf8"));
    return Object.fromEntries(Object.entries(data).filter(([key]) => !FORM_KEYS.has(key)));
  } catch {
    // Gone or rewritten since it was listed: there is nothing left to carry over.
    return {};
  }
}

/**
 * Creates or overwrites `<user skills>/<name>/SKILL.md` and returns the skill as the app will
 * load it — the file is re-read through the loader's parser rather than echoed back.
 */
export async function saveUserSkill(draft: SkillDraft): Promise<Skill> {
  const { name, description, body, disableModelInvocation } = validate(draft);

  const data: Record<string, unknown> = {
    name,
    description,
    ...(disableModelInvocation ? { "disable-model-invocation": true } : {}),
    ...(await carriedFrontmatter(name)),
  };
  // Pass the body as a file object: `matter.stringify` re-parses a plain string and would eat a
  // body that itself starts with `---`.
  const contents = matter.stringify({ content: `\n${body}\n` }, data);

  const dir = skillDir(name);
  const filePath = skillPath(name);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  // Atomic, so a reader never sees a half-written skill.
  await writeFileAtomic(filePath, contents, { mode: 0o600 });

  const saved = parseSkill(await readFile(filePath, "utf8"), filePath, name, "user");
  if (!saved) throw new SkillValidationError("The skill could not be read back after saving.");
  return saved;
}

/** True when the user has their own skill of this name, bundled skills aside. */
export async function userSkillExists(name: string): Promise<boolean> {
  if (!NAME_RE.test(name)) return false;
  try {
    await access(skillPath(name));
    return true;
  } catch {
    return false;
  }
}

/** Removes the skill folder. False when there is no user skill of that name to remove. */
export async function deleteUserSkill(name: string): Promise<boolean> {
  if (!(await userSkillExists(name))) return false;
  await rm(skillDir(name), { recursive: true, force: true });
  return true;
}
