/**
 * What a skill is and the rules its name and description follow, shared by the loader, the skill
 * store and the settings page. No Node imports, so the browser checks a draft by the same rules the
 * server will.
 */

export type SkillSource = "bundled" | "user";

/**
 * What the app reads of a skill's `metadata`. Other keys (`inputs`, `requires`, `profile`,
 * `holdings`) document the skill and stay in its frontmatter; nothing reads them.
 */
export interface SkillMetadata {
  /** The report template the skill produces, if any. */
  output?: string;
}

/** One `SKILL.md` in the agentskills.io format: frontmatter metadata plus a markdown body. */
export interface Skill {
  name: string;
  description: string;
  metadata?: SkillMetadata;
  /** Markdown after the frontmatter — the instructions handed to the model. */
  body: string;
  source: SkillSource;
  filePath: string;
  /** Hidden from the skills index and from `read_skill`; still runnable from the composer. */
  disableModelInvocation?: boolean;
}

/** A skill name is also its folder name, so keep it to a safe, portable shape. */
export const NAME_RE = /^[a-z0-9-]{1,64}$/;
export const MAX_DESCRIPTION_CHARS = 1024;

/** A skill as a list shows it: the `/` picker and its built-in commands. */
export type SkillSummary = Pick<Skill, "name" | "description">;
