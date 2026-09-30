import { BadRequest } from "@/app/api/http";
import { isoDate } from "@/lib/portfolio/schema";
import { resolveTimeContext } from "@/lib/time";

// Shared by the portfolio routes. Not a route: only a `route.ts` is served.

/**
 * The user's own date, which the page sends as `?today=`: a trade it dates today must count today
 * wherever the server's clock is. A request without one gets the server's date.
 */
export function requestToday(request: Request): string {
  const today = new URL(request.url).searchParams.get("today");
  if (today === null) return resolveTimeContext().localDate;
  if (!isoDate.safeParse(today).success) throw new BadRequest("today must be a YYYY-MM-DD date");
  return today;
}
