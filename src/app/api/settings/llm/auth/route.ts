import { readConfig } from "@/lib/config/store";
import { logoutProvider, readAuthStatus } from "@/lib/llm/oauth/status";
import type { ProviderAuthStatus } from "@/lib/llm/oauth/types";
import { errorResponse, jsonError } from "@/app/api/http";

/** Which providers are connected, and how. Never a key and never a token. */
export async function GET(): Promise<Response> {
  try {
    const body: ProviderAuthStatus[] = await readAuthStatus(readConfig());
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Sign out of `?provider=`. Deleting the provider in Settings (`PUT /api/settings`) goes through
 * `logoutProvider` too.
 * A DELETE carries no body and is never a simple cross-site request, so `requireJson` has nothing
 * to guard here.
 */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const provider = new URL(request.url).searchParams.get("provider")?.trim();
    if (!provider) return jsonError("provider is required", 400);
    await logoutProvider(readConfig(), provider);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
