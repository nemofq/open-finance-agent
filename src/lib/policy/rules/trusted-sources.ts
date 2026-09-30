import type { CoverageDomain, FinanceTool, ToolSource } from "@/lib/tools/contracts";
import { argsText, companyKey, dataSourceOf, isExternalGeneralTool, NO_COMPANY } from "../args";
import { classifyQuery, DOMAIN_LABELS, extractCompany, knownEntities } from "../domains";
import type { BeforeToolRule } from "../events";

/**
 * P1 — trusted sources first. A web search or fetch for a domain an enabled data connection
 * covers is blocked until that connection has been tried for this company in this chat. The
 * block lifts once the connection errored, returned nothing, or does not cover the domain, and
 * becomes an annotation once any covering connection was attempted this turn.
 */

/**
 * Which connections count as already tried for this query. A query that names no company is
 * satisfied by the connection having been used for anything in this chat: the model has been
 * through the front door, and a macro search must not be blocked on a company's behalf.
 */
function sourcesFor(index: Map<string, Set<string>>, key: string): Set<string> {
  if (key !== NO_COMPANY) return index.get(key) ?? new Set();
  return new Set([...index.values()].flatMap((ids) => [...ids]));
}

/** Lowest tier first, then by name, so the same query always names the same tool. */
function preferred(a: { source: ToolSource; tool: FinanceTool }, b: { source: ToolSource; tool: FinanceTool }): number {
  return a.source.tier - b.source.tier || a.tool.name.localeCompare(b.tool.name);
}

export const p1TrustedSourcesFirst: BeforeToolRule = (event, context) => {
  if (!isExternalGeneralTool(event.tool)) return undefined;

  const query = argsText(event.args);
  const domains = classifyQuery(query);
  if (domains.length === 0) return undefined;

  const company = extractCompany(query, knownEntities(context.ledger, context.tickers));
  const key = companyKey(company);
  const tried = sourcesFor(context.state.connectionsTried, key);
  const failed = sourcesFor(context.state.connectionsFailed, key);

  const candidates = context.tools.flatMap((tool) => {
    const source = dataSourceOf(tool);
    if (!source || tried.has(source.id) || failed.has(source.id)) return [];
    const covered = source.coverage.filter((domain) => domains.includes(domain));
    return covered.length > 0 ? [{ tool, source, domain: covered[0] }] : [];
  });
  if (candidates.length === 0) return undefined;

  const best = [...candidates].sort(preferred)[0];
  const subject = subjectOf(best.domain, key);
  const reason =
    `Use ${best.tool.name} (${best.source.name}, tier ${best.source.tier}) for ${DOMAIN_LABELS[best.domain]} data ` +
    `${subject} before searching the web. Search the web only once that connection has been tried.`;

  return { rule: "P1", kind: "block", reason, requires: candidates.map((candidate) => candidate.tool.name) };
};

function subjectOf(domain: CoverageDomain, key: string): string {
  return key === NO_COMPANY ? `on ${DOMAIN_LABELS[domain]} questions` : `on $${key}`;
}
