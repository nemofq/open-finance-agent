import type { z } from "zod";
import type {
  answerDepths,
  capacitiesForLoss,
  experienceLevels,
  horizons,
  instrumentClasses,
  investingApproaches,
  investorProfileSchema,
  investorRoles,
  liquidityNeeds,
  primaryObjectives,
  ProfileInput,
  riskTolerances,
} from "./schema";

/**
 * The investor profile: declared by the user in Settings, never written by
 * the model. It changes framing, emphasis and depth, never the evidence standard. The shapes are
 * inferred from `./schema.ts`, which checks them at runtime.
 */

export type ExperienceLevel = (typeof experienceLevels)[number];
export type InvestorRole = (typeof investorRoles)[number];
export type PrimaryObjective = (typeof primaryObjectives)[number];
export type Horizon = (typeof horizons)[number];
export type RiskTolerance = (typeof riskTolerances)[number];
export type CapacityForLoss = (typeof capacitiesForLoss)[number];
export type LiquidityNeeds = (typeof liquidityNeeds)[number];
export type InstrumentClass = (typeof instrumentClasses)[number];
export type InvestingApproach = (typeof investingApproaches)[number];
export type AnswerDepth = (typeof answerDepths)[number];

export type InvestorProfile = z.infer<typeof investorProfileSchema>;

export type ProfilePresetId = "index-investor" | "dividend-income" | "active-stock-picker" | "professional-analyst";

export interface ProfilePreset {
  id: ProfilePresetId;
  name: string;
  description: string;
  /** Only the fields the preset sets; applying it keeps every other field in the draft. */
  profile: ProfileInput;
}
