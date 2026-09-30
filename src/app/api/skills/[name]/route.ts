import { errorResponse, jsonError, readJson } from "@/app/api/http";
import { skillEditSchema, skillFailure } from "@/app/api/skills/request";
import { deleteUserSkill, saveUserSkill, userSkillExists } from "@/lib/skills/store";

type Context = { params: Promise<{ name: string }> };

const notFound = (name: string) => jsonError(`No user skill named ${name}.`, 404);

/** Rewrites a user skill. The name comes from the path and cannot be changed here. */
export async function PUT(request: Request, { params }: Context) {
  const { name } = await params;
  try {
    if (!(await userSkillExists(name))) return notFound(name);
    const body = await readJson(request, skillEditSchema);
    return Response.json({ skill: await saveUserSkill({ ...body, name }) });
  } catch (err) {
    return skillFailure(err);
  }
}

/** Deletes a user skill; a bundled skill of the same name becomes visible again. */
export async function DELETE(_request: Request, { params }: Context) {
  const { name } = await params;
  try {
    if (!(await deleteUserSkill(name))) return notFound(name);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
