import type { NextRequest } from "next/server";
import { refuseCrossSite } from "@/app/api/origin";

/**
 * One guard in front of every API route, so a write another site sends from the user's browser is
 * refused before any handler runs, whether or not that handler reads a body.
 */
export function proxy(request: NextRequest): Response | undefined {
  return refuseCrossSite(request) ?? undefined;
}

export const config = {
  matcher: "/api/:path*",
};
