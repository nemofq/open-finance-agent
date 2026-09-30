/**
 * The run registry: which sessions have a run reserved or in flight.
 *
 * Deployment model: one Node process per data folder. The registry lives in process memory, so it
 * only serialises runs within this process; two processes sharing a data folder can both run the
 * same session.
 */
import type { Agent } from "@earendil-works/pi-agent-core";
import type { SseEvent } from "@/lib/agent/events";
import { processSingleton } from "@/lib/process-state";

/**
 * How many events a run buffers for a reader that has not attached yet. Past the cap only text
 * and thinking deltas are dropped: what remains is the handful of structural events a re-attached
 * client rebuilds its state from, and the next `message_end` clears the lot anyway.
 */
const PENDING_CAP = 20_000;

export interface ActiveRun {
  agent: Agent;
  sessionId: string;
  startedAt: number;
  /**
   * Wire events sent since the last `message_end`. Everything before that boundary is already on
   * `agent.state.messages` (and on disk), which is what a re-attaching client takes as its snapshot.
   */
  pending: SseEvent[];
  subscribers: Set<(event: SseEvent) => void>;
  /** Record one event for a reader yet to attach, and fan it out to the ones already attached. */
  publish(event: SseEvent): void;
}

/** Both halves of a session's run lifecycle: claimed before the agent exists, then running. */
interface RunRegistry {
  reservations: Map<string, symbol>;
  runs: Map<string, ActiveRun>;
}

/**
 * The process's one registry, so reservations and runs survive Next's dev-mode module reloads
 * together.
 */
const { runs, reservations } = processSingleton<RunRegistry>("agent.runs", () => ({ reservations: new Map(), runs: new Map() }));

export interface RunReservation {
  sessionId: string;
  token: symbol;
}

/** Thrown when a session already has a run in flight. The route turns this into a 409. */
export class RunInProgressError extends Error {
  constructor(sessionId: string) {
    super(`A run is already in progress for session ${sessionId}`);
    this.name = "RunInProgressError";
  }
}

/** Claim a session before constructing an agent, closing the build-time race between requests. */
export function reserveRun(sessionId: string): RunReservation {
  if (runs.has(sessionId) || reservations.has(sessionId)) throw new RunInProgressError(sessionId);
  const reservation = { sessionId, token: Symbol(sessionId) };
  reservations.set(sessionId, reservation.token);
  return reservation;
}

export function bindRun(reservation: RunReservation, agent: Agent): ActiveRun {
  if (reservations.get(reservation.sessionId) !== reservation.token) throw new RunInProgressError(reservation.sessionId);
  reservations.delete(reservation.sessionId);
  return startRun(reservation.sessionId, agent);
}

export function releaseRun(reservation: RunReservation): void {
  if (reservations.get(reservation.sessionId) === reservation.token) reservations.delete(reservation.sessionId);
}

const isDelta = (event: SseEvent) => event.type === "text_delta" || event.type === "thinking_delta";

export function startRun(sessionId: string, agent: Agent): ActiveRun {
  if (runs.has(sessionId)) throw new RunInProgressError(sessionId);
  const run: ActiveRun = {
    agent,
    sessionId,
    startedAt: Date.now(),
    pending: [],
    subscribers: new Set(),
    publish(event) {
      // A finished message is on the transcript, so the replay can start over from there.
      if (event.type === "message_end") run.pending = [];
      else if (run.pending.length < PENDING_CAP || !isDelta(event)) run.pending.push(event);
      for (const subscriber of run.subscribers) subscriber(event);
    },
  };
  runs.set(sessionId, run);
  return run;
}

export function getRun(sessionId: string): ActiveRun | undefined {
  return runs.get(sessionId);
}

export function endRun(sessionId: string): void {
  const run = runs.get(sessionId);
  runs.delete(sessionId);
  // The terminal event has already been published; nothing more will reach these readers.
  run?.subscribers.clear();
}

/**
 * Stop the session's run, if there is one: the agent is aborted, readers are told the run is
 * done, and the session is free for the next message at once. Returns whether a run was stopped.
 */
export function abortRun(sessionId: string): boolean {
  const run = runs.get(sessionId);
  if (!run) return false;
  run.agent.abort();
  run.publish({ type: "done" });
  endRun(sessionId);
  return true;
}
