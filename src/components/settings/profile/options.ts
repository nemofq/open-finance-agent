/**
 * The one place the investor profile's vocabulary is spelled out for the UI. Every list is
 * typed against a union in the contracts, so renaming a member there breaks this build instead of
 * silently leaving a dead option behind.
 */
import type {
  AnswerDepth,
  CapacityForLoss,
  ExperienceLevel,
  Horizon,
  InstrumentClass,
  InvestingApproach,
  InvestorRole,
  LiquidityNeeds,
  PrimaryObjective,
  RiskTolerance,
} from "@/lib/profile/types";
import type { Option } from "@/components/shared/field-row";

export const experienceLevels: Option<ExperienceLevel>[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
  { value: "professional", label: "Professional" },
];

export const investorRoles: Option<InvestorRole>[] = [
  { value: "individual", label: "Individual investor" },
  { value: "advisor", label: "Financial advisor" },
  { value: "analyst", label: "Analyst" },
  { value: "portfolio_manager", label: "Portfolio manager" },
];

export const primaryObjectives: Option<PrimaryObjective>[] = [
  { value: "growth", label: "Growth" },
  { value: "income", label: "Income" },
  { value: "preservation", label: "Capital preservation" },
  { value: "balanced", label: "Balanced" },
  { value: "speculation", label: "Speculation" },
];

export const horizons: Option<Horizon>[] = [
  { value: "under_1y", label: "Under 1 year" },
  { value: "1_3y", label: "1 to 3 years" },
  { value: "3_10y", label: "3 to 10 years" },
  { value: "over_10y", label: "Over 10 years" },
];

export const riskTolerances: Option<RiskTolerance>[] = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very high" },
];

export const capacitiesForLoss: Option<CapacityForLoss>[] = [
  { value: "low", label: "Low — a loss would hurt" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High — a loss is absorbable" },
];

export const liquidityLevels: Option<LiquidityNeeds>[] = [
  { value: "low", label: "Low — the money can stay invested" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High — I may need it soon" },
];

export const instrumentClasses: Option<InstrumentClass>[] = [
  { value: "stocks", label: "Stocks" },
  { value: "etfs", label: "ETFs" },
  { value: "funds", label: "Funds" },
  { value: "bonds", label: "Bonds" },
  { value: "options", label: "Options" },
  { value: "leverage", label: "Leverage" },
  { value: "crypto", label: "Crypto" },
];

export const investingApproaches: Option<InvestingApproach>[] = [
  { value: "value", label: "Value" },
  { value: "growth", label: "Growth" },
  { value: "dividend", label: "Dividend" },
  { value: "index", label: "Index" },
  { value: "quant", label: "Quantitative" },
  { value: "momentum", label: "Momentum" },
];

export const answerDepths: Option<AnswerDepth>[] = [
  { value: "brief", label: "Brief" },
  { value: "standard", label: "Standard" },
  { value: "deep", label: "Deep" },
];
