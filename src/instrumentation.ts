import type { AppConfig } from "@/lib/config/schema";

/**
 * Runs once per Next.js server start, and finishes before the server handles a request. The
 * calculator sandbox takes a few seconds to assemble, self-test and boot, so it is warmed here in
 * the background rather than on the first chat turn. Failures are logged and leave the calculator
 * disabled; nothing else waits.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Before anything that loads a provider, so no SDK reads a variable the app does not honour.
  const { clearProviderEnv } = await import("@/lib/llm/ambient-env");
  clearProviderEnv();
  const [{ readConfig }, { isEnabled }, { ensureSandbox }, { statusLine }, { startScheduler }, { sweepStaging }, { rewriteRenamedModels }] =
    await Promise.all([
      import("@/lib/config/store"),
      import("@/lib/agent/modules"),
      import("@/lib/sandbox"),
      import("@/lib/calculator/description"),
      import("@/lib/scheduled/runner"),
      import("@/lib/attachments/documents"),
      import("@/lib/llm/model-rewrite"),
    ]);
  // Documents uploaded into a chat that was never sent have no other end of life.
  void sweepStaging().catch((err: unknown) => console.error("[attachments] sweeping staging failed:", err));
  // A config.json that is not valid JSON is refused by every route that reads it, with the reason;
  // the server still starts.
  let config: AppConfig | undefined;
  try {
    config = readConfig();
  } catch (err) {
    console.error("[config]", err instanceof Error ? err.message : err);
  }
  // Before the scheduler catches up, so a task saved on a model pi renamed runs on its successor.
  if (config) {
    await rewriteRenamedModels(config).catch((err: unknown) => console.error("[llm] moving saved models to their successors failed:", err));
  }
  await startScheduler();
  if (!config || !isEnabled(config, "python")) return;
  void ensureSandbox()
    .then((status) => console.log(`[sandbox] ${statusLine(status)}`))
    .catch((err: unknown) => console.error("[sandbox] warm start failed:", err));
}
