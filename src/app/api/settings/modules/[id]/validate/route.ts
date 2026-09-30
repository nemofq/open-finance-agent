import { z } from "zod";
import { restoreSecrets } from "@/lib/config/secrets";
import { readConfig } from "@/lib/config/store";
import { moduleSettings } from "@/lib/tools/config";
import { builtinModules } from "@/lib/tools/registry";
import { errorResponse, jsonError, readJson } from "@/app/api/http";

const bodySchema = z.object({ config: z.record(z.string(), z.unknown()).optional() });

/** Validate a module's credentials against the config in the form, falling back to stored secrets. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const mod = builtinModules.find((m) => m.id === id);
    if (!mod) return jsonError(`Unknown module: ${id}`, 404);
    if (!mod.validate) return Response.json({ ok: true, message: "No validation available" });

    // The form's config is sent on to the module's provider along with the stored secrets.
    const { config: incoming } = await readJson(request, bodySchema);
    const saved = readConfig().modules;
    const stored = saved[id] ?? {};
    const secretKeys = mod.settings.filter((field) => field.type === "secret").map((field) => field.key);
    const merged = restoreSecrets({ ...moduleSettings(saved, mod), ...incoming }, stored, secretKeys);
    return Response.json(await mod.validate(merged));
  } catch (err) {
    return errorResponse(err);
  }
}
