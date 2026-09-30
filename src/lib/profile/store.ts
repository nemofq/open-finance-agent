import { randomUUID } from "node:crypto";
import { readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { isMissingFile, writeJsonFile } from "@/lib/atomic-write";
import { errorMessage } from "@/lib/utils";
import { ensureDataDirs, profilePath } from "@/lib/paths";
import { runSerially } from "@/lib/process-state";
import { investorProfileSchema, type ProfileInput, profileInputSchema, withoutEmptyFields } from "./schema";
import type { InvestorProfile } from "./types";

/**
 * Saves, deletes and the setting aside of a bad file run one at a time: two settings saves can
 * overlap, and a reader must never move away a file a save has just replaced.
 */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  return runSerially(path.resolve(profilePath()), task);
}

type Read = { profile: InvestorProfile | null } | { invalid: string };

/** One read of the file: a profile, no file at all, or the reason the file cannot be used. */
async function readOnce(): Promise<Read> {
  let text: string;
  try {
    text = await readFile(profilePath(), "utf8");
  } catch (err) {
    if (isMissingFile(err)) return { profile: null };
    return { invalid: errorMessage(err) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { invalid: `not JSON: ${errorMessage(err)}` };
  }
  const parsed = investorProfileSchema.safeParse(raw);
  if (!parsed.success) return { invalid: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  return { profile: { ...withoutEmptyFields(parsed.data), updatedAt: parsed.data.updatedAt } };
}

/**
 * Reads the file and, when it exists but cannot be used, renames it to
 * `profile.json.invalid-<time>-<id>` and reads as no profile. The file is the user's own declaration,
 * so it is kept for them to repair rather than left for the next save to overwrite. Runs inside
 * `serialize`, so it re-reads and only moves a file that is still bad.
 */
async function readOrSetAside(): Promise<InvestorProfile | null> {
  const read = await readOnce();
  if ("profile" in read) return read.profile;
  // The id keeps two bad files set aside in the same millisecond from renaming over each other.
  const aside = `${profilePath()}.invalid-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  try {
    await rename(profilePath(), aside);
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw err;
  }
  console.warn(`[profile] ${profilePath()} could not be used (${read.invalid}); moved it to ${aside} and read no profile.`);
  return null;
}

/**
 * The saved profile, or null when there is none. A file that is unreadable or fails the schema is
 * set aside first (see `readOrSetAside`); the common valid or missing case takes no lock.
 */
export async function readProfile(): Promise<InvestorProfile | null> {
  const read = await readOnce();
  return "profile" in read ? read.profile : serialize(readOrSetAside);
}

/** Validate and save the whole profile. Empty lists and groups are stored as absent. */
export function writeProfile(input: ProfileInput): Promise<InvestorProfile> {
  return serialize(async () => {
    ensureDataDirs();
    // A bad file on disk is kept aside rather than silently replaced by this save.
    await readOrSetAside();
    const profile = investorProfileSchema.parse({
      ...withoutEmptyFields(profileInputSchema.parse(input)),
      updatedAt: new Date().toISOString(),
    });
    await writeJsonFile(profilePath(), profile);
    return profile;
  });
}

/** Remove the profile. False when there was none to remove. */
export function deleteProfile(): Promise<boolean> {
  return serialize(async () => {
    try {
      await unlink(profilePath());
      return true;
    } catch (err) {
      if (isMissingFile(err)) return false;
      throw err;
    }
  });
}
