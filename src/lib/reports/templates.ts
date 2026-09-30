import type { ReportTemplate } from "./spec";

/**
 * The report shapes the default skills produce. A template declares only the
 * sections a reader must find; everything else about the layout is the renderer's business.
 * Sections are matched case-insensitively, so `Risks to the view` satisfies `Risks`.
 */
export const reportTemplates: ReportTemplate[] = [
  {
    id: "earnings-preview",
    name: "Earnings preview",
    requiredSections: ["Setup", "Expectations", "What matters this quarter", "Scenarios", "Risks", "Stance"],
  },
  {
    id: "earnings-review",
    name: "Earnings review",
    requiredSections: ["Results vs expectations", "Guidance", "Drivers", "Reaction", "Stance"],
  },
  {
    id: "stock-brief",
    name: "Stock brief",
    requiredSections: ["Business", "Key metrics", "Valuation", "Recent developments", "Risks"],
  },
  {
    id: "valuation",
    name: "Valuation",
    requiredSections: ["Approach", "Inputs", "Valuation", "Sensitivity", "Stance"],
  },
  {
    id: "peer-comps",
    name: "Peer comparison",
    requiredSections: ["Peer set", "Comparison", "Read-through"],
  },
  {
    id: "filing-changes",
    name: "Filing changes",
    requiredSections: ["Filing", "What changed", "Why it matters"],
  },
  {
    id: "portfolio-check",
    name: "Portfolio check",
    requiredSections: ["Holdings", "Concentration", "Fit with profile"],
  },
  {
    id: "thesis-check",
    name: "Thesis check",
    requiredSections: ["Thesis", "Evidence since", "Verdict"],
  },
];

const BY_ID = new Map(reportTemplates.map((template) => [template.id, template]));

/** The template a spec asked for, or `undefined` for a free-form report. */
export function templateById(id?: string): ReportTemplate | undefined {
  return id === undefined ? undefined : BY_ID.get(id);
}

/** Every template id, for the error the model gets when it names one that does not exist. */
export function templateIds(): string[] {
  return reportTemplates.map((template) => template.id);
}
