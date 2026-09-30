import { jsonError } from "@/app/api/http";

// The cross-site guard `src/proxy.ts` runs in front of every API route. Not a route: only a
// `route.ts` is served.

/** Methods that only read. Everything else can change state, spend a model run or plant a skill. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * `OFA_DEV_ORIGINS`, parsed the way `next.config.ts` parses it for `allowedDevOrigins`: hostnames,
 * comma-separated, where `*.example.ts.net` stands for any subdomain.
 */
export function devOrigins(value: string | undefined = process.env.OFA_DEV_ORIGINS): string[] {
  return (value ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function matchesHost(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) return hostname.endsWith(pattern.slice(1));
  return hostname === pattern;
}

/** The origin of the page that sent the request; null for `Origin: null` or anything unparseable. */
function parseOrigin(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

/**
 * Whether a request came from a page this app served. The app has no login: anything the browser
 * can reach on localhost, any site the user visits can target too, and a `text/plain` POST needs no
 * CORS preflight. So a write is accepted only from the app's own origin (the `Host` it was sent to,
 * or the one a reverse proxy forwarded), from a host in `OFA_DEV_ORIGINS`, or with no `Origin` at
 * all, which is what curl, scripts and the tests send and a browser never does for a POST.
 */
export function isSameOriginWrite(request: Request, allowed: readonly string[] = devOrigins()): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const origin = request.headers.get("origin");
  const url = origin === null ? null : parseOrigin(origin);
  if (url && allowed.some((pattern) => matchesHost(url.hostname.toLowerCase(), pattern))) return true;

  // A browser labels the request itself; a cross-site page cannot forge or drop this header.
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (origin === null) return true;
  if (!url) return false;

  const hosts = [request.headers.get("host"), request.headers.get("x-forwarded-host")]
    .flatMap((value) => (value ? value.split(",") : []))
    .map((value) => value.trim().toLowerCase());
  return hosts.includes(url.host.toLowerCase());
}

/** 403 for a write another site sent; null when the request may go on to its route. */
export function refuseCrossSite(request: Request, allowed?: readonly string[]): Response | null {
  if (isSameOriginWrite(request, allowed)) return null;
  return jsonError("This request came from another site and was refused.", 403, "cross_site");
}
