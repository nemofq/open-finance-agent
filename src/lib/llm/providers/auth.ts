import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ApiKeyAuth, ApiKeyCredential, AuthContext } from "@earendil-works/pi-ai";

/**
 * Key auth for a provider instance whose key lives in `config.json`. The key is closed
 * over rather than looked up, so pi resolves nothing of its own: no environment variable, no
 * credentials file, no ambient profile can stand in for a key the user did not save.
 */
export function configKeyAuth(name: string, apiKey: string): ApiKeyAuth {
  return {
    name,
    resolve: async () => (apiKey ? { auth: { apiKey }, source: "config.json" } : undefined),
  };
}

/** Whether a file the user named exists, as pi asks before trusting a gcloud or service account file. */
async function fileExists(file: string): Promise<boolean> {
  const resolved = file === "~" || file.startsWith("~/") ? path.join(homedir(), file.slice(1)) : file;
  try {
    await access(resolved);
    return true;
  } catch {
    return false;
  }
}

/**
 * Key auth for a pi provider whose key and settings live in `config.json`. pi's own resolution
 * still runs, because it is what turns them into a request (a Cloudflare gateway takes its token in
 * a header of its own; Bedrock takes a bearer token, access keys or a profile), but it is handed a
 * credential built from the config and an environment holding only the saved settings, so nothing
 * on the machine can stand in for a value the user did not save. The one thing read from the
 * machine is whether a file exists, which Vertex checks for its gcloud or service account file.
 *
 * The settings travel with every request, whatever pi's resolution returns, since they are also
 * what the wire API reads: Bedrock's region, Azure's endpoint, Cloudflare's account.
 */
export function configCredentialAuth(own: ApiKeyAuth, apiKey: string, settings: Record<string, string>): ApiKeyAuth {
  const hasSettings = Object.keys(settings).length > 0;
  const credential: ApiKeyCredential = {
    type: "api_key",
    ...(apiKey ? { key: apiKey } : {}),
    ...(hasSettings ? { env: settings } : {}),
  };
  const ctx: AuthContext = { env: async (name) => settings[name], fileExists };
  return {
    name: own.name,
    resolve: async ({ signal }) => {
      const resolved = await own.resolve({ ctx, credential, signal });
      if (!resolved) return undefined;
      const env = hasSettings || resolved.env ? { ...settings, ...resolved.env } : undefined;
      return { ...resolved, ...(env ? { env } : {}), source: "config.json" };
    },
  };
}
