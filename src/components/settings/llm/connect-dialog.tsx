"use client";

import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { FieldHelp, StatusLine } from "@/components/shared/field-row";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LlmProviderConfig } from "@/lib/config/schema";
import type { OAuthPrompt } from "@/lib/llm/oauth/types";
import {
  allowsBlank,
  formatCountdown,
  type LoginDeviceCode,
  type LoginNotice,
  type LoginState,
  preferredOption,
  showsPasteField,
} from "./login-session";
import { useLoginSession } from "./use-login-session";

/** A link that looks like a button; every sign-in page opens in a tab of its own. */
function LinkButton({
  href,
  variant = "default",
  children,
}: {
  href: string;
  variant?: "default" | "outline";
  children: React.ReactNode;
}) {
  return (
    <Button
      nativeButton={false}
      variant={variant}
      render={<a href={href} target="_blank" rel="noreferrer" />}
    >
      {children}
      <ExternalLinkIcon />
    </Button>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={copied ? "Code copied" : "Copy code"}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => {
            // A browser that refuses the clipboard leaves the code on screen to copy by hand.
          },
        );
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

/** How long a device code still works. Providers give a few minutes and stop polling afterwards. */
function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const left = (expiresAt - now) / 1000;
  return left > 0 ? (
    <FieldHelp help={`The code expires in ${formatCountdown(left)}.`} />
  ) : (
    <StatusLine ok={false}>The code has expired. Cancel and start again.</StatusLine>
  );
}

function DeviceCodePanel({ code }: { code: LoginDeviceCode }) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Enter this code on the provider&apos;s page:</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate font-mono text-lg tracking-[0.2em]">{code.userCode}</code>
          <CopyButton value={code.userCode} />
        </div>
      </div>
      <LinkButton href={code.verificationUri} variant="outline">
        Open verification page
      </LinkButton>
      {code.expiresAt ? <Countdown expiresAt={code.expiresAt} /> : null}
    </div>
  );
}

function Notice({ notice }: { notice: LoginNotice }) {
  return (
    <div className="space-y-1">
      <StatusLine ok>{notice.message}</StatusLine>
      {notice.links.map((link) => (
        <FieldHelp key={link.url} helpUrl={link.url} linkLabel={link.label ?? link.url} />
      ))}
    </div>
  );
}

/** A `text`, `secret` or `manual_code` step: one field and the button that answers it. */
function EntryPrompt({
  message,
  placeholder,
  help,
  secret,
  allowBlank,
  disabled,
  onAnswer,
}: {
  message: string;
  placeholder?: string;
  help?: string;
  secret?: boolean;
  /** Whether an empty answer is an answer; see `allowsBlank`. */
  allowBlank?: boolean;
  /** True before the flow has asked, when the field is offered ahead of the prompt. */
  disabled?: boolean;
  onAnswer: (value: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const answer = value.trim();

  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (answer || allowBlank) onAnswer(answer);
      }}
    >
      <Label htmlFor={id}>{message}</Label>
      <div className="flex gap-1.5">
        <Input
          id={id}
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          type={secret ? "password" : "text"}
          className="font-mono"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={disabled || (!answer && !allowBlank)}>
          Continue
        </Button>
      </div>
      <FieldHelp help={help} />
    </form>
  );
}

/** A `select` step, as a radio list so the options and their descriptions are all visible. */
function SelectPrompt({
  prompt,
  onAnswer,
}: {
  prompt: Extract<OAuthPrompt, { type: "select" }>;
  onAnswer: (value: string) => void;
}) {
  const name = useId();
  const [value, setValue] = useState(() => preferredOption(prompt.options));

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (value) onAnswer(value);
      }}
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{prompt.message}</legend>
        {prompt.options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors has-checked:bg-muted hover:bg-muted"
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => setValue(option.id)}
              className="mt-0.5 size-4 accent-foreground"
            />
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="block font-medium">{option.label}</span>
              {option.description ? (
                <span className="block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
      <Button type="submit" variant="outline" disabled={!value}>
        Continue
      </Button>
    </form>
  );
}

/** Everything the flow has said so far, and the one step it is waiting on. */
function LoginBody({ state, onAnswer }: { state: LoginState; onAnswer: (value: string) => void }) {
  const { prompt } = state;
  const pasting = showsPasteField(state);
  // A `manual_code` prompt is answered by the paste field below, next to the sign-in link it belongs to.
  const stepPrompt = prompt && prompt.type !== "manual_code" ? prompt : null;

  return (
    <div className="space-y-4">
      {state.notice ? <Notice notice={state.notice} /> : null}

      {state.authUrl ? (
        <div className="space-y-2">
          <LinkButton href={state.authUrl.url}>Open sign-in page</LinkButton>
          {state.authUrl.instructions ? <FieldHelp help={state.authUrl.instructions} /> : null}
        </div>
      ) : null}

      {state.deviceCode ? <DeviceCodePanel code={state.deviceCode} /> : null}

      {pasting ? (
        <EntryPrompt
          // One field across the whole flow, so text pasted before pi asks for it survives the ask.
          key="paste"
          message="Paste the redirect URL or code"
          placeholder={(prompt?.type === "manual_code" ? prompt.placeholder : undefined) ?? "https://…/callback?code=…"}
          help="The sign-in page redirects to a local address this app may not be able to reach. If the page fails to load, copy its URL from the address bar and paste it here."
          disabled={prompt?.type !== "manual_code"}
          onAnswer={onAnswer}
        />
      ) : null}

      {stepPrompt?.type === "select" ? (
        <SelectPrompt key={stepPrompt.id} prompt={stepPrompt} onAnswer={onAnswer} />
      ) : stepPrompt ? (
        <EntryPrompt
          key={stepPrompt.id}
          message={stepPrompt.message}
          placeholder={stepPrompt.placeholder}
          secret={stepPrompt.type === "secret"}
          allowBlank={allowsBlank(stepPrompt.type)}
          onAnswer={onAnswer}
        />
      ) : null}

      {state.phase === "starting" || (state.phase === "running" && !prompt && !state.notice) ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          {state.phase === "starting" ? "Starting sign-in…" : "Waiting for the provider…"}
        </p>
      ) : null}

      {state.phase === "error" ? (
        <StatusLine ok={false}>{state.error ?? "Sign-in failed."}</StatusLine>
      ) : state.error !== null ? (
        // A refused answer, usually because the callback won the race: the flow runs on, so this
        // is not a failure and is not dressed as one.
        <StatusLine ok>
          {state.error}. The sign-in is still running — cancel and start again if nothing happens.
        </StatusLine>
      ) : null}
    </div>
  );
}

/** How long a finished sign-in stays on screen before the dialog closes itself. */
export const CONNECTED_CLOSE_SECONDS = 3;

/** The finished sign-in, in place of the steps that led to it, counting down to closing the dialog. */
export function Connected({ name, onClose }: { name: string; onClose: () => void }) {
  const [left, setLeft] = useState(CONNECTED_CLOSE_SECONDS);
  // Held in a ref: the page re-reads auth status on connect, and a new callback must not restart the count.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (left <= 0) {
      close.current();
      return;
    }
    const timer = setTimeout(() => setLeft((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 py-6 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <CheckIcon className="size-6" strokeWidth={2.5} />
      </span>
      <div className="space-y-1">
        <p className="text-base font-medium">Connected to {name}</p>
        <p className="text-sm text-muted-foreground">
          Its models are ready to use. Closing in {Math.max(left, 0)}s…
        </p>
      </div>
    </div>
  );
}

/** One login, from its first message to its last. Unmounting aborts it on the server. */
function LoginRun({
  provider,
  name,
  onClose,
  onConnected,
}: {
  provider: string;
  name: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { state, answer, retry } = useLoginSession(provider, onConnected);
  const running = state.phase === "starting" || state.phase === "running";
  const done = state.phase === "done";

  return (
    <>
      {done ? <Connected name={name} onClose={onClose} /> : <LoginBody state={state} onAnswer={answer} />}
      <DialogFooter>
        {state.phase === "error" ? (
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        ) : null}
        <Button variant={running ? "outline" : "default"} onClick={onClose}>
          {running ? "Cancel" : done ? "Done" : "Close"}
        </Button>
      </DialogFooter>
    </>
  );
}

export interface ConnectDialogProps {
  /** The provider being connected; the dialog is closed while null. */
  provider: LlmProviderConfig | null;
  onClose: () => void;
  /** A finished sign-in, so the page can re-read the auth status. */
  onConnected: () => void;
}

/**
 * Signs in to one provider, drawing whichever steps pi sends: a sign-in page, a device code, a
 * question, or the paste field that stands in for an unreachable callback. Closing it aborts the
 * login on the server.
 */
export function ConnectDialog({ provider, onClose, onConnected }: ConnectDialogProps) {
  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {provider?.name}</DialogTitle>
          <DialogDescription>
            Sign in with the provider. The token is stored on this machine and never reaches the browser.
          </DialogDescription>
        </DialogHeader>
        {provider ? (
          <LoginRun
            key={provider.id}
            provider={provider.id}
            name={provider.name}
            onClose={onClose}
            onConnected={onConnected}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
