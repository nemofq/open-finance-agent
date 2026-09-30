import type { AppConfig } from "@/lib/config/schema";
import { credentialStore } from "../credentials";
import { getModels } from "../models";
import { loginSessions } from "./sessions";
import type { ProviderAuthStatus } from "./types";

/**
 * What the browser is allowed to know about stored credentials: whether a provider is
 * connected, by which method, and when its token expires. The key and the token stay here.
 */
export async function readAuthStatus(config: AppConfig): Promise<ProviderAuthStatus[]> {
  const models = getModels(config);
  const store = credentialStore();
  return Promise.all(
    config.llm.providers.map(async (provider): Promise<ProviderAuthStatus> => {
      // A stored OAuth credential wins over a key, which is the order pi resolves auth in.
      const check = await models.checkAuth(provider.id).catch(() => undefined);
      const stored = await store.read(provider.id).catch(() => undefined);
      return {
        provider: provider.id,
        connected: !!check,
        ...(check ? { type: check.type } : {}),
        ...(stored?.type === "oauth" ? { expires: stored.expires } : {}),
      };
    }),
  );
}

/**
 * Sign out of one provider: drop its token and stop a login still walking through the dialog, which
 * would otherwise write a fresh one back. The Disconnect button calls this, and so does
 * `PUT /api/settings` for every provider a save deletes.
 */
export async function logoutProvider(config: AppConfig, providerId: string): Promise<void> {
  loginSessions().abortProvider(providerId);
  await getModels(config).logout(providerId);
}
