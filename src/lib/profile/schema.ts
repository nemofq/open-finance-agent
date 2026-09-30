import { z } from "zod";

/**
 * Compile-time guard for a tuple: it must list every member of the union and nothing else, so a
 * union defined elsewhere cannot gain or rename a member without failing here.
 */
function members<Union extends string>() {
  return <const T extends readonly Union[]>(tuple: T & ([Union] extends [T[number]] ? unknown : never)): T => tuple;
}

export const experienceLevels = ["beginner", "intermediate", "advanced", "professional"] as const;
export const investorRoles = ["individual", "advisor", "analyst", "portfolio_manager"] as const;
export const primaryObjectives = ["growth", "income", "preservation", "balanced", "speculation"] as const;
export const horizons = ["under_1y", "1_3y", "3_10y", "over_10y"] as const;
export const riskTolerances = ["low", "moderate", "high", "very_high"] as const;
export const capacitiesForLoss = ["low", "medium", "high"] as const;
export const liquidityNeeds = ["low", "medium", "high"] as const;
export const instrumentClasses = ["stocks", "etfs", "funds", "bonds", "options", "leverage", "crypto"] as const;
export const investingApproaches = ["value", "growth", "dividend", "index", "quant", "momentum"] as const;
export const answerDepths = ["brief", "standard", "deep"] as const;

/**
 * Every dotted path into the profile, derived from the schema so a renamed field breaks the build.
 * A skill's `profile:` frontmatter names the fields it reads by these paths.
 */
export type ProfileFieldPath = {
  [Group in keyof ProfileInput & string]: `${Group}.${keyof NonNullable<ProfileInput[Group]> & string}`;
}[keyof ProfileInput & string];

export const profileFieldPaths = members<ProfileFieldPath>()([
  "experience.level",
  "experience.role",
  "objectives.primary",
  "objectives.horizon",
  "risk.tolerance",
  "risk.capacityForLoss",
  "risk.liquidityNeeds",
  "constraints.allowedInstruments",
  "constraints.exclusions",
  "jurisdiction.country",
  "jurisdiction.taxResidency",
  "jurisdiction.baseCurrency",
  "jurisdiction.accountTypes",
  "style.approach",
  "style.preferredMetrics",
  "style.depth",
  "style.answerLanguage",
]);

export function isProfileFieldPath(path: string): path is ProfileFieldPath {
  return (profileFieldPaths as readonly string[]).includes(path);
}

/** One free-text entry (a sector to exclude, a metric, an account type). */
const entry = z.string().trim().min(1).max(64);

/** Bounded so the profile stays small enough to sit in every system prompt. */
const entries = z.array(entry).max(32);

const shortText = z.string().trim().min(1).max(64);

export const profileInputSchema = z.object({
  experience: z
    .object({ level: z.enum(experienceLevels).optional(), role: z.enum(investorRoles).optional() })
    .optional(),
  objectives: z
    .object({ primary: z.enum(primaryObjectives).optional(), horizon: z.enum(horizons).optional() })
    .optional(),
  risk: z
    .object({
      tolerance: z.enum(riskTolerances).optional(),
      capacityForLoss: z.enum(capacitiesForLoss).optional(),
      liquidityNeeds: z.enum(liquidityNeeds).optional(),
    })
    .optional(),
  constraints: z
    .object({
      allowedInstruments: z.array(z.enum(instrumentClasses)).max(32).optional(),
      /** Sectors or themes to exclude, free text, e.g. "tobacco", "weapons". */
      exclusions: entries.optional(),
    })
    .optional(),
  jurisdiction: z
    .object({
      country: shortText.optional(),
      taxResidency: shortText.optional(),
      /** An ISO 4217 code such as `USD`; kept as free text so unusual units still round-trip. */
      baseCurrency: z.string().trim().min(1).max(8).optional(),
      accountTypes: entries.optional(),
    })
    .optional(),
  style: z
    .object({
      approach: z.enum(investingApproaches).optional(),
      preferredMetrics: entries.optional(),
      depth: z.enum(answerDepths).optional(),
      answerLanguage: shortText.optional(),
    })
    .optional(),
});

/** The profile as the user edits it; `updatedAt` is set by the store on save. */
export type ProfileInput = z.infer<typeof profileInputSchema>;

/**
 * The profile as stored. Fields the schema no longer has, such as the `version` counter and the
 * report format older files carry, are stripped on read rather than failing it.
 */
export const investorProfileSchema = profileInputSchema.extend({
  updatedAt: z.iso.datetime(),
});

/**
 * Drops empty lists, and then empty groups, so an empty list is stored as absent. A list is a
 * constraint only when it names something: an empty allowed-instruments list means "no
 * constraint", never "allow nothing".
 */
export function withoutEmptyFields(input: ProfileInput): ProfileInput {
  const groups = Object.entries(input).flatMap(([name, group]) => {
    if (!group) return [];
    const fields = Object.entries(group).filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0));
    return fields.length > 0 ? [[name, Object.fromEntries(fields)]] : [];
  });
  return Object.fromEntries(groups) as ProfileInput;
}
