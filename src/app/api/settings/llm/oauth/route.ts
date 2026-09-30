import { z } from "zod";
import { readConfig } from "@/lib/config/store";
import { findProvider } from "@/lib/llm";
import { getModels } from "@/lib/llm/models";
import { LoginInProgressError, loginSessions } from "@/lib/llm/oauth/sessions";
import type { OAuthStartResponse } from "@/lib/llm/oauth/types";
import { errorResponse, jsonError, readJson } from "@/app/api/http";

const bodySchema = z.object({ provider: z.string().trim().min(1) });

/**
 * Start a sign-in for one saved provider. The flow itself runs on the server for as long as the
 * user needs; this returns only the id the dialog streams, answers and aborts it by.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { provider: providerId } = await readJson(request, bodySchema);

    const config = readConfig();
    const provider = findProvider(config, providerId);
    if (!provider) return jsonError(`No provider “${providerId}” is configured`, 404);

    const models = getModels(config);
    if (!models.getProvider(providerId)?.auth.oauth) {
      return jsonError(`${provider.name} does not support signing in`, 400);
    }

    const { id } = loginSessions().start(providerId, (interaction) => models.login(providerId, "oauth", interaction));
    return Response.json({ id } satisfies OAuthStartResponse);
  } catch (err) {
    if (err instanceof LoginInProgressError) return jsonError(err.message, 409);
    return errorResponse(err);
  }
}
