import { errorResponse, readJson } from "@/app/api/http";
import { profilePath } from "@/lib/paths";
import { profileInputSchema } from "@/lib/profile/schema";
import { deleteProfile, readProfile, writeProfile } from "@/lib/profile/store";

/** The saved profile, or null when the user has not filled one in. */
export async function GET(): Promise<Response> {
  try {
    return Response.json({ profile: await readProfile(), path: profilePath() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Replace the profile. The body is the whole profile; the store owns updatedAt. */
export async function PUT(request: Request): Promise<Response> {
  try {
    const input = await readJson(request, profileInputSchema);
    return Response.json({ profile: await writeProfile(input) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(): Promise<Response> {
  try {
    await deleteProfile();
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
