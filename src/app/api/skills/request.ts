import { z } from "zod";
import { errorResponse, jsonError } from "@/app/api/http";
import { SkillValidationError } from "@/lib/skills/store";

// What the skill routes accept and how they refuse, shared by the collection and the item route.
// Not a route: only a `route.ts` is served.

/** The shape of a draft; the store checks the values (name pattern, lengths) with its own sentences. */
export const skillDraftSchema = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  disableModelInvocation: z.boolean().optional(),
});

/** An edit names the skill in the path, never in the body. */
export const skillEditSchema = skillDraftSchema.omit({ name: true });

/** A draft the user can fix is a 400 with the store's sentence; anything else goes through `errorResponse`. */
export function skillFailure(err: unknown): Response {
  if (err instanceof SkillValidationError) return jsonError(err.message, 400);
  return errorResponse(err);
}
