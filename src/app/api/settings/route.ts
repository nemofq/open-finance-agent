import { z } from "zod";
import type { AppConfig } from "@/lib/config/schema";
import { maskSecrets } from "@/lib/config/secrets";
import { applySettingsUpdate } from "@/lib/config/settings-update";
import { readConfig, writeConfig } from "@/lib/config/store";
import { logoutProvider } from "@/lib/llm/oauth/status";
import { disconnect } from "@/lib/mcp/client";
import { isRecord } from "@/lib/utils";
import { BadRequest, errorResponse, readJson } from "@/app/api/http";
import { settingsSecretPaths } from "./secrets";

/** The whole config with every secret replaced by the mask sentinel. */
export async function GET(): Promise<Response> {
  try {
    return Response.json(maskSecrets(readConfig(), settingsSecretPaths));
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * A provider the user deleted must not leave its sign-in behind in `auth.json`, nor a sign-in
 * still in progress that would write one back. The config is already saved by then, so a
 * credential that cannot be dropped is logged, not raised.
 */
async function forgetRemovedProviders(before: AppConfig, after: AppConfig): Promise<void> {
  const kept = new Set(after.llm.providers.map((provider) => provider.id));
  for (const { id } of before.llm.providers.filter((provider) => !kept.has(provider.id))) {
    await logoutProvider(after, id).catch((err) => console.error(`[settings] could not forget the credentials of ${id}:`, err));
  }
}

/** A server the user removed or turned off must not keep its connection, or a stdio child, until restart. */
async function disconnectDroppedServers(before: AppConfig, after: AppConfig): Promise<void> {
  const live = new Set(after.mcp.servers.filter((server) => server.enabled).map((server) => server.id));
  await Promise.all(before.mcp.servers.filter((server) => server.enabled && !live.has(server.id)).map((server) => disconnect(server.id)));
}

/** Accepts a full or partial config; returns the saved config, masked. */
export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await readJson(request, z.unknown());
    if (!isRecord(body)) throw new BadRequest("Request body must be a JSON object");
    const existing = readConfig();
    const next = applySettingsUpdate(existing, body, settingsSecretPaths);
    writeConfig(next);
    await forgetRemovedProviders(existing, next);
    await disconnectDroppedServers(existing, next);
    return Response.json(maskSecrets(next, settingsSecretPaths));
  } catch (err) {
    return errorResponse(err);
  }
}
