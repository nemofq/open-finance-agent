import type { Context } from "@earendil-works/pi-ai";

/** The shortest request that proves a model answers: sent to validate a key and by the Settings Test. */
export function probeContext(): Context {
  return {
    systemPrompt: "You are checking a connection. Answer without calling tools.",
    messages: [{ role: "user", content: "Reply with the single word OK.", timestamp: Date.now() }],
  };
}
