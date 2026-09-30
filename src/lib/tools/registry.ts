import type { Module, ModuleSummary } from "@/lib/tools/contracts";
import { alphaVantageModule } from "@/lib/providers/alphavantage/module";
import { attachmentsModule } from "@/lib/attachments/tool";
import { edgarModule } from "@/lib/providers/edgar/module";
import { evidenceModule } from "@/lib/evidence/tool";
import { mcpModule } from "@/lib/providers/mcp/module";
import { memoryModule } from "@/lib/memory/tool";
import { portfolioModule } from "@/lib/portfolio/tool";
import { pythonModule } from "@/lib/calculator/tool";
import { quotesModule } from "@/lib/quotes/tool";
import { reportsModule } from "@/lib/reports/tool";
import { skillsModule } from "@/lib/skills/tool";
import { scheduledModule } from "@/lib/scheduled/tool";
import { tavilyModule } from "@/lib/providers/tavily/module";

/**
 * The extension point of the app. To add a data provider or tool:
 *   1. create `src/lib/providers/<name>/module.ts` (a data provider) or
 *      `src/lib/<capability>/tool.ts` (a capability's tool) exporting a `Module`, whose
 *      `defaultConfig` is the only copy of its defaults (`src/lib/tools/config.ts` applies them);
 *   2. import it here and add it to the array below.
 * Settings pages, the system prompt and the tool list are all derived from this array, in its
 * order. So are the ticker hover card and the `$` autocomplete: the first module to name a ticker
 * describes it, and the first that quotes prices it, which is why EDGAR leads.
 */
export const builtinModules: Module[] = [
  edgarModule,
  alphaVantageModule,
  tavilyModule,
  quotesModule,
  pythonModule,
  portfolioModule,
  mcpModule,
  memoryModule,
  reportsModule,
  skillsModule,
  scheduledModule,
  evidenceModule,
  attachmentsModule,
];

export function toModuleSummary(module: Module): ModuleSummary {
  const { id, name, kind, description, settings, defaultConfig } = module;
  return { id, name, kind, description, settings, defaultConfig, hasValidate: typeof module.validate === "function" };
}
