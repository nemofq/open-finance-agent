import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { StoredAttachment } from "@/lib/attachments/types";
import type { AppConfig } from "@/lib/config/schema";
import { readConfig } from "@/lib/config/store";
import { serverClass } from "@/lib/mcp/server-class";
import { readMemory } from "@/lib/memory/store";
import { portfolioPrivacySummary, type PrivacySummary } from "@/lib/portfolio/privacy";
import { createPortfolioStore } from "@/lib/portfolio/store";
import { loadSkills, modelInvocableSkills } from "@/lib/skills/loader";
import { portfolioDir } from "@/lib/paths";
import { moduleConfig, moduleEnabled } from "@/lib/tools/config";
import type { FinanceTool, Module, ModuleContext } from "@/lib/tools/contracts";
import { builtinModules } from "@/lib/tools/registry";
import { messageDocuments } from "./messages";

export function enabledModules(config: AppConfig): Module[] {
  return builtinModules.filter((module) => moduleEnabled(config.modules, module));
}

/**
 * Whether the agent can reach any data at all: an enabled data-class MCP server or data provider
 * module. `undefined` when config.json cannot be read, so the chat hides its hint rather than
 * failing to open.
 */
export function hasDataConnection(): boolean | undefined {
  let config: AppConfig;
  try {
    config = readConfig();
  } catch {
    return undefined;
  }
  return (
    config.mcp.servers.some((server) => server.enabled && serverClass(server) === "data") ||
    enabledModules(config).some((module) => module.kind === "data-provider")
  );
}

/** An id no built-in module has is off. */
export function isEnabled(config: AppConfig, moduleId: string): boolean {
  const found = builtinModules.find((candidate) => candidate.id === moduleId);
  return found ? moduleEnabled(config.modules, found) : false;
}

export async function memoryForPrompt(config: AppConfig): Promise<string | undefined> {
  return isEnabled(config, "memory") ? readMemory() : undefined;
}

export async function skillsForPrompt(config: AppConfig): Promise<{ name: string; description: string }[]> {
  if (!isEnabled(config, "skills")) return [];
  return modelInvocableSkills(await loadSkills()).map(({ name, description }) => ({ name, description }));
}

/** Collect the tools of every enabled module; a failing module must not break the chat. */
export async function collectTools(config: AppConfig, modules: Module[], ctx: ModuleContext): Promise<FinanceTool[]> {
  const lists = await Promise.all(
    modules.map(async (module) => {
      try {
        return await module.createTools(moduleConfig(config, module), ctx);
      } catch (err) {
        console.error(`[module:${module.id}] createTools failed:`, err);
        return [];
      }
    }),
  );
  return lists.flat();
}

/** Summarizes sensitive portfolio holdings to prevent data leakage to external tools. */
export async function privacySummary(config: AppConfig, today: string): Promise<PrivacySummary | undefined> {
  if (!isEnabled(config, "portfolio")) return undefined;
  try {
    return await portfolioPrivacySummary(createPortfolioStore(portfolioDir()), today);
  } catch (err) {
    console.error("[portfolio] privacy summary failed:", err);
    return undefined;
  }
}

export function sessionDocuments(messages: AgentMessage[], current: StoredAttachment[] = []): StoredAttachment[] {
  const byName = new Map<string, StoredAttachment>();
  for (const document of [...messages.flatMap(messageDocuments), ...current]) {
    if (!byName.has(document.attachment)) byName.set(document.attachment, document);
  }
  return [...byName.values()];
}
