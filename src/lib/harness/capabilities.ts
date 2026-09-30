import { withArgumentSynonyms } from "@/lib/policy/args";
import type { CoverageDomain, FinanceTool, SourceTier } from "@/lib/tools/contracts";
import type { Concern, SessionCtx } from "./concern";

const tierShort: Record<SourceTier, string> = {
  1: "primary",
  2: "licensed vendor",
  3: "allowlisted press",
  4: "open web",
};

const domainNames: Record<CoverageDomain, string> = {
  filings: "filings",
  fundamentals: "fundamentals",
  earnings: "earnings (actuals and calendar)",
  estimates: "estimates",
  prices: "prices",
  options: "options",
  funds: "funds and ETFs",
  transcripts: "transcripts",
  news: "news",
  ownership: "ownership (insider and institutional)",
  macro: "macro (rates, inflation)",
};

const financeGuarantees: Record<string, string> = {
  financial_calculator:
    "runs the calculation itself and records the result, its formula and the evidence it used, so a derived figure is reproducible and carries its own tag",
};

function toolLine(tool: FinanceTool): string {
  return `  - \`${tool.name}\` — ${tool.label}`;
}

interface Connection {
  id: string;
  name: string;
  tier: SourceTier;
  coverage: CoverageDomain[];
  tools: FinanceTool[];
}

function connectionsOf(tools: FinanceTool[]): Connection[] {
  const byId = new Map<string, Connection>();
  for (const tool of tools) {
    const source = tool.meta.source;
    if (tool.meta.class !== "data" || !source) continue;
    const existing = byId.get(source.id);
    if (existing) {
      existing.tools.push(tool);
      for (const domain of source.coverage) {
        if (!existing.coverage.includes(domain)) existing.coverage.push(domain);
      }
      continue;
    }
    byId.set(source.id, {
      id: source.id,
      name: source.name,
      tier: source.tier,
      coverage: [...source.coverage],
      tools: [tool],
    });
  }
  return [...byId.values()].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

function connectionsSection(connections: Connection[]): string {
  const blocks = connections.map((connection) => {
    const coverage = connection.coverage.length
      ? connection.coverage.map((domain) => domainNames[domain]).join(", ")
      : "not declared";
    return [
      `- **${connection.name}** — tier ${connection.tier} (${tierShort[connection.tier]}); covers ${coverage}`,
      ...connection.tools.map(toolLine),
    ].join("\n");
  });
  return `## Data connections

The sources this session can query directly. They are the only data providers you may attribute a figure to; never cite a provider, wire service or dataset that is not listed here.

${blocks.join("\n")}`;
}

function financialToolsSection(tools: FinanceTool[]): string {
  return ["## Financial tools", "", "Deterministic tools that record what they produce.", "",
    ...tools.map((tool) => `- \`${tool.name}\` — ${financeGuarantees[tool.name] ?? tool.label}`)].join("\n");
}

function generalToolsSection(tools: FinanceTool[]): string {
  const lines = tools.map((tool) => `- \`${tool.name}\` — ${tool.label}`);
  return `## General tools

Everything else available to you. What they return is not a data connection's figure: a web result is only as good as the domain behind it.

${lines.join("\n")}`;
}

function tiersSection(connections: Connection[]): string {
  const covered = [...new Set(connections.flatMap((connection) => connection.coverage))];
  const coverageLine = covered.length
    ? `Your data connections cover ${covered.map((domain) => domainNames[domain]).join(", ")}. Use them before web search for anything in that list; a domain none of them covers is open to web search.`
    : "No data connection is enabled, so web search is all you have. Say so when a figure would normally come from a filing or a market-data provider.";
  return `## Source tiers

Every source has a tier, and a web result takes its tier from its domain: sec.gov and the company's own site are tier 1, allowlisted financial press is tier 3, everything else is tier 4.

- **Tier 1, primary** — regulatory filings and the company's or fund issuer's own releases.
- **Tier 2, licensed vendor** — market-data providers.
- **Tier 3, allowlisted press** — reputable financial press.
- **Tier 4, open web** — blogs, forums, aggregators. Treat a tier 4 figure as a claim, not a fact, and say where it came from.

${coverageLine}

Evidence tags:
- Each tool result opens with a tag such as \`[E7 · SEC EDGAR · tier 1 · as of 2026-08-01]\`. Quote that tag beside any figure you take from it.
- A figure the calculator produced carries its computed tag, e.g. \`[C3]\`; an assumption carries \`[A1]\`; a number the user gave you carries \`[U2]\`.
- A figure with no tag is unsourced, and an unsourced figure is a mistake.`;
}
function skillsSection(skills: SessionCtx["skillsIndex"]): string {
  const entries = skills
    .map(
      (skill) =>
        `  <skill>\n    <name>${skill.name}</name>\n    <description>${skill.description}</description>\n  </skill>`,
    )
    .join("\n");
  return `## Available skills

Skills are step-by-step playbooks for recurring analyses. When a request matches one, call \`read_skill\` with its name to load the full instructions before you start working, then follow them.

<available_skills>
${entries}
</available_skills>`;
}

/** Whether the sandbox runs is fixed when the agent is built, so the prompt says so once. */
export const capabilities = (calculatorAvailable: boolean): Concern => ({
  name: "capabilities",
  wrapTool: withArgumentSynonyms, // one argument vocabulary at the boundary every tool passes through
  promptSection: ({ tools, skillsIndex }) => {
    const connections = connectionsOf(tools);
    const finance = tools.filter((t) => t.meta.class === "finance");
    const general = tools.filter((t) => t.meta.class === "general");
    return [connections.length && connectionsSection(connections), finance.length && financialToolsSection(finance),
      !calculatorAvailable && "The financial calculator is unavailable: show every derived figure with its formula and input ids.",
      general.length && generalToolsSection(general), tools.length && tiersSection(connections),
      skillsIndex.length && skillsSection(skillsIndex)].filter(Boolean).join("\n\n");
  },
});
