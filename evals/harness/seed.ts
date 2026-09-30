import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { portfolioDir } from "@/lib/paths";
import { addManualPosition } from "@/lib/portfolio/manual";
import { createPortfolioStore } from "@/lib/portfolio/store";
import type { Account } from "@/lib/portfolio/types";
import { writeProfile } from "@/lib/profile/store";
import type { EvalTask } from "../types";

/** Positions need an account to sit in; a task lists only the positions, so the runner adds one. */
function benchmarkAccount(id: string, baseCurrency: string): Account {
  return {
    id,
    name: "Benchmark brokerage",
    type: "taxable",
    baseCurrency,
    costBasisMethod: "fifo",
    source: { kind: "manual" },
  };
}

/** One account per distinct `accountId` the task's positions name, in the order they first appear. */
function accountsFor(task: EvalTask): Account[] {
  const accounts = new Map<string, Account>();
  const holdings = task.holdings ?? [];
  for (const position of holdings) {
    if (!accounts.has(position.accountId)) {
      accounts.set(position.accountId, benchmarkAccount(position.accountId, position.currency));
    }
  }
  return [...accounts.values()];
}

/**
 * The declared user a task runs as: the profile P12 checks requests against (and the system
 * prompt renders, unless the task freezes its text) and the holdings `portfolio_get` reads. Both
 * land in the task's own data folder, which starts empty.
 */
export async function seedUserData(task: EvalTask): Promise<void> {
  if (task.profile) await writeProfile(task.profile);
  if (!task.holdings || task.holdings.length === 0) return;

  const store = createPortfolioStore(portfolioDir());
  for (const account of accountsFor(task)) await store.saveAccount(account);
  for (const position of task.holdings) await addManualPosition(store, position);
}

/** Where the frozen profile texts live, beside the dataset they belong to. */
export const PROFILE_PROMPTS_DIR = fileURLToPath(new URL("../dataset/profiles/", import.meta.url));

/**
 * The frozen profile text a task's system prompt carries, or `undefined` when it declares none and
 * the app renders its seeded profile as usual. The file's trailing newline is not part of the block.
 */
export function profilePromptFor(task: EvalTask, dir: string = PROFILE_PROMPTS_DIR): string | undefined {
  if (!task.profilePrompt) return undefined;
  return readFileSync(path.join(dir, task.profilePrompt), "utf8").replace(/\n$/, "");
}
