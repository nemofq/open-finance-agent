import { z } from "zod";
import { errorResponse, jsonError, readJson } from "@/app/api/http";
import { maxMemoryChars, memoryRevision, readMemory, saveMemory } from "@/lib/memory/store";
import { memoryPath } from "@/lib/paths";

/** `revision` is the one GET returned: a save based on an older version is refused, not applied. */
const bodySchema = z.object({ content: z.string(), revision: z.string().min(1) });

export async function GET() {
  try {
    const content = await readMemory();
    return Response.json({ content, revision: memoryRevision(content), path: memoryPath(), maxChars: maxMemoryChars });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Replaces memory.md, which goes into every system prompt, unless it changed since it was read. */
export async function PUT(request: Request) {
  try {
    const { content, revision } = await readJson(request, bodySchema);
    const saved = await saveMemory(content, revision);
    if (!saved.ok) return jsonError(saved.message, saved.code === "memory_changed" ? 409 : 413, saved.code);
    return Response.json({ content: saved.content, revision: saved.revision, path: memoryPath(), maxChars: maxMemoryChars });
  } catch (err) {
    return errorResponse(err);
  }
}
