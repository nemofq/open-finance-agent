import type { AppConfig, ModelNotice, ModelRef } from "@/lib/config/schema";
import { writeConfig } from "@/lib/config/store";
import { listScheduledTasks, updateScheduledTask } from "@/lib/scheduled/store";
import { findProvider } from "./index";
import { modelAlias } from "./model-aliases";
import { catalogModel } from "./providers/pi-backed";

/**
 * Move the refs that pick a model for work not started yet, the default model and each standalone
 * scheduled task, off a model pi renamed and onto its successor, and note each move for Settings ›
 * LLM. Run once at startup, before the scheduler, so a due task already runs on the successor. A
 * started chat keeps its model and is never rewritten; a retired model has no alias and stays put.
 */
export async function rewriteRenamedModels(config: AppConfig): Promise<void> {
  const notices: ModelNotice[] = [];

  function successor(ref: ModelRef, use: string): ModelRef | undefined {
    const provider = findProvider(config, ref.provider);
    const alias = provider && modelAlias(provider.type, ref.model);
    const to = alias && catalogModel(alias.type, alias.to);
    if (!provider || !alias || !to) return undefined;
    const notice = notices.find((seen) => seen.provider === provider.name && seen.from.name === alias.name && seen.to.name === to.name);
    if (notice) notice.uses.push(use);
    else {
      notices.push({
        provider: provider.name,
        from: { name: alias.name, pricing: alias.pricing },
        to: { name: to.name, pricing: to.pricing },
        uses: [use],
      });
    }
    return { provider: ref.provider, model: alias.to };
  }

  const moves: { id: string; model: ModelRef }[] = [];
  for (const task of (await listScheduledTasks()).tasks) {
    if (task.destination.type !== "standalone") continue;
    const model = successor(task.destination.model, `the scheduled task “${task.title}”`);
    if (model) moves.push({ id: task.id, model });
  }
  const { defaultModel, modelNotices = [] } = config.llm;
  const newDefault = defaultModel ? successor(defaultModel, "the default model") : undefined;
  if (notices.length === 0) return;
  // The notices are saved before any task moves: a task on the successor finds nothing to move at
  // the next start, so a notice lost after its move would never be written. A task left behind
  // by a failed write moves at the next start, and its notice is not repeated.
  writeConfig({ ...config, llm: { ...config.llm, defaultModel: newDefault ?? defaultModel, modelNotices: merged(modelNotices, notices) } });
  for (const { id, model } of moves) await updateScheduledTask(id, { destination: { type: "standalone", model } });
}

/** `saved` with each of `found` added, a use already listed under the same move not repeated. */
function merged(saved: ModelNotice[], found: ModelNotice[]): ModelNotice[] {
  const same = (a: ModelNotice, b: ModelNotice) => a.provider === b.provider && a.from.name === b.from.name && a.to.name === b.to.name;
  const out = [...saved];
  for (const notice of found) {
    const at = out.findIndex((seen) => same(seen, notice));
    if (at < 0) out.push(notice);
    else out[at] = { ...out[at], uses: [...new Set([...out[at].uses, ...notice.uses])] };
  }
  return out;
}
