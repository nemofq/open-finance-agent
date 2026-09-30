import { describe, expect, it } from "vitest";
import type { SessionFile } from "@/lib/sessions/types";
import type { SseEvent } from "./events";
import { writeGeneratedTitle } from "./title";
import type { TurnStore } from "./turn-types";

function fakeStore(session: Partial<SessionFile>) {
  const patches: Partial<SessionFile>[] = [];
  const store: TurnStore = {
    update: async (_id, patch) => {
      patches.push(patch);
      Object.assign(session, patch);
      return session as SessionFile;
    },
  };
  return { store, patches, session };
}

/** The turn's queue, reduced to what the title task needs: run the write. */
const now = <T>(job: () => Promise<T>) => job();

describe("writeGeneratedTitle", () => {
  it("saves the title as generated and announces it", async () => {
    const { store, patches } = fakeStore({ title: "What is $MSFT worth?", titleSource: "heuristic" });
    const events: SseEvent[] = [];
    await writeGeneratedTitle({
      store,
      sessionId: "s1",
      generate: async () => "Microsoft valuation check",
      sink: (event) => events.push(event),
      queue: now,
    });
    expect(patches).toEqual([{ title: "Microsoft valuation check", titleSource: "generated" }]);
    expect(events).toEqual([{ type: "title", title: "Microsoft valuation check" }]);
  });

  it("writes nothing when the model had no title to give", async () => {
    const { store, patches } = fakeStore({ title: "What is $MSFT worth?", titleSource: "heuristic" });
    const events: SseEvent[] = [];
    await writeGeneratedTitle({ store, sessionId: "s1", generate: async () => null, sink: (event) => events.push(event), queue: now });
    expect(patches).toEqual([]);
    expect(events).toEqual([]);
  });
});
