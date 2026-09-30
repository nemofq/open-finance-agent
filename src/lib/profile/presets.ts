import type { ProfilePreset } from "./types";

/**
 * Starting points for a 30-second setup. Applying one fills in only the fields it sets and keeps
 * the rest of the form, so jurisdiction, exclusions and anything else the user typed survive.
 * Jurisdiction is never part of a preset: country, tax residency and currency are personal and must
 * be typed by the user.
 */
export const profilePresets: ProfilePreset[] = [
  {
    id: "index-investor",
    name: "Index investor",
    description: "Broad market funds held for decades, with few decisions and low costs.",
    profile: {
      experience: { level: "beginner", role: "individual" },
      objectives: { primary: "balanced", horizon: "over_10y" },
      risk: { tolerance: "moderate", capacityForLoss: "medium", liquidityNeeds: "low" },
      constraints: { allowedInstruments: ["stocks", "etfs", "funds"] },
      style: {
        approach: "index",
        preferredMetrics: ["total expense ratio", "tracking error", "diversification"],
        depth: "standard",
      },
    },
  },
  {
    id: "dividend-income",
    name: "Dividend income",
    description: "Income now from durable payers, with dividend safety ahead of headline yield.",
    profile: {
      experience: { level: "intermediate", role: "individual" },
      objectives: { primary: "income", horizon: "3_10y" },
      risk: { tolerance: "moderate", capacityForLoss: "medium", liquidityNeeds: "medium" },
      constraints: { allowedInstruments: ["stocks", "etfs", "funds", "bonds"] },
      style: {
        approach: "dividend",
        preferredMetrics: ["dividend yield", "payout ratio", "free cash flow", "dividend growth"],
        depth: "standard",
      },
    },
  },
  {
    id: "active-stock-picker",
    name: "Active stock picker",
    description: "Concentrated single-company research, accepting volatility for higher returns.",
    profile: {
      experience: { level: "advanced", role: "individual" },
      objectives: { primary: "growth", horizon: "3_10y" },
      risk: { tolerance: "high", capacityForLoss: "high", liquidityNeeds: "low" },
      constraints: { allowedInstruments: ["stocks", "etfs", "options"] },
      style: {
        approach: "value",
        preferredMetrics: ["return on invested capital", "free cash flow yield", "revenue growth", "net debt to EBITDA"],
        depth: "deep",
      },
    },
  },
  {
    id: "professional-analyst",
    name: "Professional analyst",
    description: "Research for other people: full depth, with objectives and instruments left to the mandate.",
    profile: {
      experience: { level: "professional", role: "analyst" },
      style: {
        preferredMetrics: ["segment revenue", "operating margin", "guidance versus consensus", "free cash flow"],
        depth: "deep",
      },
    },
  },
];
