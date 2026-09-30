import { secretPaths } from "@/lib/config/secrets";
import { moduleSecretPaths } from "@/lib/tools/config";
import { builtinModules } from "@/lib/tools/registry";

// Which config values `/api/settings` masks and restores. Not a route: only a `route.ts` is served.

/**
 * The config's own secrets plus every registered module's `type: "secret"` settings, so a module
 * whose secret is called `token` is masked like one called `apiKey`. Built here, beside the
 * registry, because the config store must not import it.
 */
export const settingsSecretPaths: readonly string[] = [...secretPaths, ...moduleSecretPaths(builtinModules)];
