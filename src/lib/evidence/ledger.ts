/**
 * The per-session evidence ledger: entry ids and exact values in memory, full
 * payloads on disk (or in memory, for a ledger with no data folder). Nothing here talks to the
 * model or to pi; `register.ts` wires it into `afterToolCall` and the tools reach it through
 * `ModuleContext.evidence`.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { holdsValue } from "./figures";
import { canonicalMetric } from "./metrics";
import { compareIds, evidenceOf, isEvidenceId, parseId } from "./ids";
import { diskPayloads, memoryPayloads } from "./store";
import type {
  EvidenceEntity,
  EvidenceEntry,
  EvidenceFact,
  EvidenceId,
  EvidenceKind,
  EvidenceLedger,
  FactQuery,
} from "./types";

function digitsOnly(cik: string): string {
  return cik.replace(/\D/g, "").replace(/^0+/, "");
}

/** A query names the entity by ticker or CIK; an empty query matches everything. */
function entityMatches(entry: EvidenceEntity | undefined, query: EvidenceEntity): boolean {
  if (query.ticker) {
    if (entry?.ticker?.toUpperCase() !== query.ticker.toUpperCase()) return false;
  }
  if (query.cik) {
    if (!entry?.cik || digitsOnly(entry.cik) !== digitsOnly(query.cik)) return false;
  }
  return true;
}

export interface CreateLedgerOptions {
  sessionId: string;
  /**
   * Root of the user's data folder; payloads go under `sessions/<id>/evidence`. Without one they
   * live only as long as the ledger: a tool built outside a turn, and the tests.
   */
  dataDir?: string;
  /** Transcript to rebuild from when a chat is reopened. */
  messages?: AgentMessage[];
}

/**
 * Build a ledger for one chat. Entries already recorded on the transcript's tool results are
 * restored with their original ids, and the per-kind counters continue from the highest one
 * seen, so a reopened chat never reuses `E7` for something else.
 */
export function createLedger({ sessionId, dataDir, messages }: CreateLedgerOptions): EvidenceLedger {
  const entries = new Map<EvidenceId, EvidenceEntry>();
  const counters = new Map<EvidenceKind, number>();
  const pending = new Set<Promise<void>>();
  const payloads = dataDir === undefined ? memoryPayloads() : diskPayloads(dataDir, sessionId);

  const restore = (entry: EvidenceEntry): void => {
    const parsed = parseId(entry.id);
    if (!parsed) return;
    entries.set(entry.id, entry);
    counters.set(parsed.kind, Math.max(counters.get(parsed.kind) ?? 0, parsed.index));
  };

  for (const message of messages ?? []) {
    if (message.role !== "toolResult") continue;
    for (const entry of evidenceOf(message.details)) restore(entry);
  }

  const ordered = (kind?: EvidenceKind): EvidenceEntry[] =>
    [...entries.values()]
      .filter((entry) => kind === undefined || entry.kind === kind)
      .sort((a, b) => compareIds(a.id, b.id));

  return {
    sessionId,

    list: (kind) => ordered(kind),

    get: (id) => entries.get(id),

    add(entry) {
      const next = (counters.get(entry.kind) ?? 0) + 1;
      counters.set(entry.kind, next);
      const created: EvidenceEntry = {
        ...entry,
        id: `${entry.kind}${next}`,
        fetchedAt: entry.fetchedAt ?? new Date().toISOString(),
      };
      if (created.inputs?.some((id) => entries.get(id)?.lookAhead)) created.lookAhead = true;
      entries.set(created.id, created);
      return created;
    },

    savePayload(id, payload, options) {
      const work = (async () => {
        if (!isEvidenceId(id)) throw new Error(`"${id}" is not an evidence id.`);
        try {
          if (options?.onlyIfMissing && (await payloads.exists(id))) {
            const stored = entries.get(id);
            if (stored) stored.hasPayload = true;
            return;
          }
          await payloads.write(id, payload);
          const entry = entries.get(id);
          if (entry) entry.hasPayload = true;
        } catch (error) {
          // A disk problem must cost the turn its payload, not the turn itself.
          console.error(`[evidence] could not store ${id}:`, error);
        }
      })();
      // `flush` waits for the write, never for the rejection an unusable id raises.
      const tracked = work.catch(() => undefined);
      pending.add(tracked);
      void tracked.finally(() => pending.delete(tracked));
      return work;
    },

    loadPayload<T>(id: EvidenceId): Promise<T | undefined> {
      if (!isEvidenceId(id)) return Promise.resolve(undefined);
      return payloads.read<T>(id);
    },

    findFacts(query: FactQuery): { entry: EvidenceEntry; fact: EvidenceFact }[] {
      const wanted = query.metric ? canonicalMetric(query.metric) : undefined;
      const hits: { entry: EvidenceEntry; fact: EvidenceFact }[] = [];
      for (const entry of ordered("E")) {
        if (query.entity && !entityMatches(entry.entity, query.entity)) continue;
        for (const fact of entry.facts ?? []) {
          if (wanted && canonicalMetric(fact.metric) !== wanted) continue;
          if (query.period && fact.period !== query.period) continue;
          hits.push({ entry, fact });
        }
      }
      return hits.sort(
        (a, b) => b.entry.fetchedAt.localeCompare(a.entry.fetchedAt) || compareIds(b.entry.id, a.entry.id),
      );
    },

    matchValue: (figure) => ordered().filter((entry) => holdsValue(entry, figure)).map((entry) => entry.id),

    async flush() {
      await Promise.all([...pending]);
    },
  };
}
