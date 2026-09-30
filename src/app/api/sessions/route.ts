import { errorResponse, jsonError, readJson } from "@/app/api/http";
import { getRun } from "@/lib/agent/runs";
import { z } from "zod";
import { modelRefSchema } from "@/lib/config/schema";
import { readConfig } from "@/lib/config/store";
import { resolutionCode, resolveModel } from "@/lib/llm";
import { dataDir } from "@/lib/paths";
import { createSession, listSessions } from "@/lib/sessions/store";

const createBodySchema = z.object({
  model: modelRefSchema.optional(),
  skill: z.string().optional(),
});

/** Session headers plus the data folder path the sidebar footer shows. */
export async function GET() {
  try {
    const sessions = await listSessions((id) => getRun(id) !== undefined);
    return Response.json({ sessions, dataDir: dataDir() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Create a session on the requested model, or the default; either must resolve before the chat starts. */
export async function POST(request: Request) {
  try {
    const body = createBodySchema.safeParse(await readJson(request, z.unknown()));
    if (!body.success) {
      return jsonError("model must be { provider, model }", 400);
    }

    const config = readConfig();
    const ref = body.data.model ?? config.llm.defaultModel;
    const resolved = await resolveModel(config, ref);
    if (!resolved.ok) return jsonError(resolved.message, 400, resolutionCode(resolved.reason));

    const model = { provider: resolved.provider.id, model: resolved.info.id };
    const session = await createSession({ model, skill: body.data.skill });
    return Response.json(session, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
