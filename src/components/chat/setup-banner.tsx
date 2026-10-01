"use client";

import { XIcon } from "lucide-react";
import Link from "next/link";
import { createStoredValue, useStoredValue } from "@/components/shared/stored-value";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ModelRef } from "@/lib/config/schema";
import { REAUTH_REQUIRED } from "@/lib/llm/catalog";
import type { ProviderModels } from "@/lib/llm/types";
import type { ModuleLabel } from "@/lib/tools/config";

/**
 * What the chat is missing before it can run: any provider at all, a model to run on, or a
 * sign-in that has lapsed.
 */
export type SetupNeed = "provider" | "default" | "reauth";

/** What a refused turn means for the banner, or null when the failure belongs on the error line. */
export function setupNeedFor(code: string | undefined): SetupNeed | null {
  if (code === "llm_not_configured") return "default";
  return code === REAUTH_REQUIRED ? "reauth" : null;
}

/** Whether the provider behind `ref` is configured but signed out, so no turn on it can run. */
function needsReconnect(providers: ProviderModels[], ref: ModelRef | null): boolean {
  if (!ref) return false;
  return providers.find((provider) => provider.provider === ref.provider)?.authGap === REAUTH_REQUIRED;
}

export interface SetupInput {
  providers: ProviderModels[];
  /** Whether the model lists have been read; nothing is missing until they have. */
  loaded: boolean;
  /** The model this turn would run on, which is the one a lapsed sign-in blocks. */
  turnModel: ModelRef | null;
  /**
   * The chat has started, so it is fixed to its model: a model it cannot use is answered with its
   * error line (which says to start a new chat) rather than the add-a-provider banner.
   */
  started: boolean;
  /** A model chosen for this chat, standing in for a missing default. */
  picked: boolean;
  defaultAvailable: boolean;
  /** What a refused turn reported, if any. */
  refused: SetupNeed | null;
}

/**
 * Which banner the chat shows, if any. A lapsed sign-in comes first and applies to a started chat
 * too: reconnecting is what lets that very chat carry on, unlike a model that is simply gone.
 */
export function setupNeed({
  providers,
  loaded,
  turnModel,
  started,
  picked,
  defaultAvailable,
  refused,
}: SetupInput): SetupNeed | null {
  if (refused === "reauth" || needsReconnect(providers, turnModel)) return "reauth";
  if (!started && loaded && providers.length === 0) return "provider";
  if (refused !== null || (loaded && !started && !picked && !defaultAvailable)) return "default";
  return null;
}

const TITLES: Record<SetupNeed, string> = {
  provider: "Connect a model",
  default: "Choose a model",
  reauth: "Sign in again",
};

export interface SetupBannerProps {
  need: SetupNeed;
  /** The chat has not started, so the composer's model picker can fill in for a missing default. */
  canPickBelow?: boolean;
}

/** Shown when no LLM provider is added yet, no usable default model is set, or a sign-in has lapsed. */
export function SetupBanner({ need, canPickBelow }: SetupBannerProps) {
  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader>
        <CardTitle>{TITLES[need]}</CardTitle>
        <CardDescription>
          {need === "provider"
            ? "Add an LLM provider — sign in with a subscription, add an API key, or point at your own OpenAI-compatible endpoint — then pick a default model. Keys and sign-ins are stored on this machine."
            : need === "reauth"
              ? "This chat's provider is no longer signed in. Reconnect it in LLM settings, then send the message again."
              : canPickBelow
                ? "No default model is set, or it is no longer available. Pick a default in LLM settings, or choose a model below for this chat."
                : "No default model is set, or it is no longer available. Pick a default in LLM settings."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button nativeButton={false} render={<Link href="/settings/llm" />}>
          {need === "reauth" ? "Reconnect in LLM settings" : "Open LLM settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Whether the data connection hint was dismissed. The server renders it hidden, since dismissal is
 * only readable in the browser, to keep hydration quiet.
 */
const hintDismissed = createStoredValue("ofa:data-provider-hint", (raw) => raw === "dismissed", false, {
  serialize: (dismissed) => (dismissed ? "dismissed" : ""),
  serverValue: true,
});

/** The one suggested connection that asks for more than switching on. */
const EDGAR_ID = "edgar";

/**
 * What to turn on, with a note on cost: "Market Quotes (free)", or "Market Quotes and SEC EDGAR
 * (both free; EDGAR needs a contact name and email)". EDGAR's contact is mentioned only when it is listed.
 */
export function dataHintSuggestion(missing: readonly ModuleLabel[]): string {
  const labels = missing.map((module) => module.name);
  const names = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : (labels[0] ?? "");
  const free = missing.length > 1 ? "both free" : "free";
  if (!missing.some((module) => module.id === EDGAR_ID)) return `${names} (${free})`;
  return `${names} (${free}; ${missing.length > 1 ? "EDGAR" : "it"} needs a contact name and email)`;
}

export interface DataProviderHintProps {
  /** The suggested data connections that are off or missing a required field; never empty. */
  missing: readonly ModuleLabel[];
}

/** Shown on a new chat while a suggested data connection is not ready, until the user dismisses it. */
export function DataProviderHint({ missing }: DataProviderHintProps) {
  const hidden = useStoredValue(hintDismissed);

  if (hidden) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
      <p className="min-w-0 flex-1 text-muted-foreground">
        For grounded research, turn on {dataHintSuggestion(missing)} in{" "}
        <Link href="/settings/providers" className="text-foreground underline underline-offset-2">
          Settings › Data connections
        </Link>
        .
      </p>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss data connection hint"
        onClick={() => hintDismissed.set(true)}
      >
        <XIcon />
      </Button>
    </div>
  );
}
