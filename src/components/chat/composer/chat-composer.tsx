"use client";

import { SparklesIcon } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { COMMANDS, isCommand } from "./commands";
import { Composer, type ComposerTurnProps } from "./composer";
import { ComposerMenu, type Suggestion } from "./composer-menu";
import { pickerItems, skillFragment, useSkills } from "./skill-picker";
import { tickerFragment, useTickerSuggestions } from "./ticker-autocomplete";
import type { ComposerState } from "./use-composer";

export interface ChatComposerProps extends ComposerTurnProps {
  /** `useComposer`'s state: the draft, the skill, the attachments and how to send them. */
  composer: ComposerState;
}

/** Composer plus its two in-place menus: `$` ticker autocomplete and `/` skill picker. */
export function ChatComposer({ composer, ...turn }: ChatComposerProps) {
  const { draft: value, setDraft: onValueChange, skill, setSkill: onSkillChange, textareaRef } = composer;
  const listId = useId();
  const [caret, setCaret] = useState(0);
  /** Value at the moment Escape was pressed; the menu stays shut until the text changes. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [active, setActive] = useState<{ key: string; index: number }>({ key: "", index: 0 });

  const typedSkill = skill === undefined && value !== dismissed ? skillFragment(value) : null;
  /** `typed` groups commands with skills; `button` is the Skills menu, which lists skills only. */
  const skillMode: "typed" | "button" | null =
    typedSkill !== null ? "typed" : skillsOpen ? "button" : null;
  const fragment = skillMode || value === dismissed ? null : tickerFragment(value, caret);

  const skills = useSkills(skillMode !== null);
  const tickers = useTickerSuggestions(fragment === null ? null : fragment.query);

  const items: Suggestion[] = skillMode
    ? pickerItems(skills.items, COMMANDS, typedSkill)
    : tickers.items.map((hit) => ({ id: hit.ticker, primary: `$${hit.ticker}`, secondary: hit.name }));

  const open = skillMode !== null || fragment !== null;
  const menuKey = skillMode ? `skill:${skillMode}:${typedSkill ?? ""}` : `ticker:${fragment?.query ?? ""}`;
  const activeIndex = active.key === menuKey ? Math.min(active.index, Math.max(items.length - 1, 0)) : 0;

  function focusInput(position?: number) {
    requestAnimationFrame(() => {
      const input = textareaRef.current;
      if (!input) return;
      input.focus();
      if (position !== undefined) input.setSelectionRange(position, position);
    });
  }

  function close() {
    setDismissed(value);
    setSkillsOpen(false);
  }

  function select(index: number) {
    const item = items[index];
    if (!item) return;

    if (skillMode) {
      // A command is typed into the draft and sent like a message; only a skill gets a chip.
      if (skillMode === "typed" && isCommand(item.id)) {
        onValueChange(`/${item.id} `);
        setSkillsOpen(false);
        focusInput();
        return;
      }
      onSkillChange(item.id);
      if (typedSkill !== null) onValueChange("");
      setSkillsOpen(false);
      focusInput();
      return;
    }
    if (!fragment) return;

    const token = `$${item.id} `;
    const next = `${value.slice(0, fragment.start)}${token}${value.slice(caret)}`;
    const position = fragment.start + token.length;
    onValueChange(next);
    setCaret(position);
    focusInput(position);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, current: string): boolean {
    if (open && items.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : items.length - 1;
        setActive({ key: menuKey, index: (activeIndex + step) % items.length });
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        select(activeIndex);
        return true;
      }
    }
    if (open && event.key === "Escape") {
      event.preventDefault();
      close();
      return true;
    }
    if (event.key === "Backspace" && current === "" && skill) {
      event.preventDefault();
      onSkillChange(undefined);
      return true;
    }
    return false;
  }

  const status = skillMode
    ? skills.loading
      ? "Loading skills…"
      : skillMode === "typed"
        ? "No command or skill matches"
        : "No skill matches"
    : tickers.loading
      ? "Searching…"
      : fragment?.query
        ? "No ticker matches"
        : "Type a ticker, e.g. $AAPL";

  return (
    <Composer
      {...turn}
      composer={composer}
      onValueChange={(next, position) => {
        // Ordinary text dismisses the button-opened menu; a `/` fragment keeps it open and filters.
        if (skillsOpen && next !== "" && skillFragment(next) === null) setSkillsOpen(false);
        onValueChange(next);
        setCaret(position);
      }}
      onKeyDownCapture={handleKeyDown}
      inputAria={{
        "aria-expanded": open,
        "aria-controls": open && items.length > 0 ? listId : undefined,
        "aria-activedescendant": open && items.length > 0 ? `${listId}-${activeIndex}` : undefined,
      }}
      onDismiss={open ? close : undefined}
      slot={
        open && (
          <ComposerMenu
            id={listId}
            label={skillMode === "typed" ? "Commands and skills" : skillMode ? "Skills" : "Tickers"}
            items={items}
            activeIndex={activeIndex}
            status={status}
            onSelect={select}
            onHighlight={(index) => setActive({ key: menuKey, index })}
          />
        )
      }
      footerActions={
        <Button
          variant="ghost"
          size="xs"
          // The ghost variant draws the pressed look from `aria-expanded`; the outside-click
          // listener leaves this button alone so its own toggle can close the menu.
          data-composer-toggle
          aria-pressed={skillsOpen}
          aria-expanded={skillsOpen}
          onClick={() => {
            setSkillsOpen((wasOpen) => !wasOpen);
            setDismissed(null);
            focusInput();
          }}
        >
          <SparklesIcon data-icon="inline-start" />
          Skills
        </Button>
      }
    />
  );
}
