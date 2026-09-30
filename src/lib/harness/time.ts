import { formatTimeNote } from "@/lib/time/format";
import type { Concern } from "./concern";

export const time: Concern = {
  name: "time",
  turnNote: (turn) => [formatTimeNote(turn.time),
    "Use only information published by this cutoff. Later announcements cannot explain an earlier event.", turn.time.market.session === "pre_market" &&
    `Before the open, distinguish pre-market activity from the last regular close (${turn.time.market.lastCompletedSession}). A period ending does not make its results public; verify the release time before treating earnings as known.`].filter(Boolean).join("\n"),
};
