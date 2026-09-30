import { errorResponse, jsonError, readJson } from "@/app/api/http";
import { skillDraftSchema, skillFailure } from "@/app/api/skills/request";
import { loadSkills } from "@/lib/skills/loader";
import { saveUserSkill, userSkillExists } from "@/lib/skills/store";
import { userSkillsDir } from "@/lib/paths";

export async function GET() {
  try {
    return Response.json({
      skills: await loadSkills(),
      userSkillsDir: userSkillsDir(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Adds a user skill. Shadowing a bundled skill is allowed — that is how one is customised. */
export async function POST(request: Request) {
  try {
    // A skill is read by the agent, so a planted one would be a standing prompt injection.
    const draft = await readJson(request, skillDraftSchema);
    if (await userSkillExists(draft.name)) {
      return jsonError(`A user skill named ${draft.name} already exists; edit it instead.`, 409);
    }
    return Response.json({ skill: await saveUserSkill(draft) }, { status: 201 });
  } catch (err) {
    return skillFailure(err);
  }
}
