"use client";

import { useEffect, useRef } from "react";

/**
 * What the chat is doing right now. One value, updated from the turn's own event stream, so the
 * indicator never has to guess from several booleans which of them wins.
 */
export type WorkPhase =
  | { kind: "working" | "thinking" | "writing" | "revising" | "drafting" | "compacting" }
  | { kind: "calling" | "running"; tool: string };

/** Between phases: a turn is always doing something, even when the wire has gone quiet. */
export const WORKING: WorkPhase = { kind: "working" };
export const COMPACTING: WorkPhase = { kind: "compacting" };

function phaseLabel(phase: WorkPhase): string {
  switch (phase.kind) {
    case "thinking":
      return "Thinking…";
    case "writing":
      return "Writing…";
    case "calling":
      return `Calling ${phase.tool}…`;
    case "running":
      return `Running ${phase.tool}…`;
    case "drafting":
      return "Drafting report…";
    case "revising":
      return "Revising…";
    case "compacting":
      return "Compacting context…";
    default:
      return "Working…";
  }
}

/*
 * Three dots sit 120° apart on a ring we watch almost edge-on, so they slide along one line and
 * keep overtaking each other. The ring is projected with a real camera distance rather than
 * flattened, which is what makes the near dot both wider and further out than the far one.
 */
const RADIUS = 12;
const DEPTH = 3.4 * RADIUS;
const DOT = 5;
/** How far the ring's plane tips out of edge-on at the top of a wobble, as a share of its radius. */
const TILT = 0.5 * RADIUS;
/** Seconds between wobbles. The tilt alternates direction, so the whole thing repeats in twice that. */
const CYCLE = 1.83;
const WOBBLE = Math.PI / CYCLE;
/** Radians per second at the flat part of a cycle, and how much faster the ring turns at full tilt. */
const SLOW = 1.83;
const RUSH = 2.44;
const NEAR = DEPTH / (DEPTH - RADIUS);
const FAR = DEPTH / (DEPTH + RADIUS);

/**
 * Where one dot sits `t` seconds in. Turning faster while the plane is tilted is what gives the
 * motion its easing: the dots drift through the flat stretches and hurry through each wobble.
 * Integrating that speed in closed form keeps this a pure function of the clock, so a dropped or
 * late frame never leaves the animation behind where it should be.
 */
function place(t: number, index: number) {
  const wobble = WOBBLE * t;
  const angle =
    Math.PI / 2 +
    SLOW * t +
    RUSH * (t / 2 - Math.sin(2 * wobble) / (4 * WOBBLE)) +
    (index * 2 * Math.PI) / 3;
  const depth = Math.sin(angle);
  const scale = DEPTH / (DEPTH + RADIUS * depth);
  return {
    x: RADIUS * Math.cos(angle) * scale,
    y: TILT * Math.sin(wobble) ** 3 * depth * scale,
    scale,
    // The near dot reads as the solid one and the far dot sits back a little behind it.
    opacity: 0.65 + (0.35 * (scale - FAR)) / (NEAR - FAR),
  };
}

/** Server render and the reduced-motion fallback share this, so neither one flashes on hydration. */
const REST = [0, 1, 2].map((index) => place(0, index));

/** Three dots orbiting an edge-on ring, with what the turn is currently doing. */
export function WorkingIndicator({ phase }: { phase: WorkPhase }) {
  const label = phaseLabel(phase);
  // The live reasoning block already says "Thinking…" right above this, so showing it again only
  // repeats the word; screen readers still get it, because the dots alone say nothing.
  const silent = phase.kind === "thinking";
  const dots = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    // The clock is banked when we pause, so a backgrounded tab resumes where it left off.
    let banked = 0;
    let since = 0;

    const paint = (t: number) => {
      dots.current.forEach((dot, index) => {
        if (!dot) return;
        const { x, y, scale, opacity } = place(t, index);
        dot.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(3)})`;
        dot.style.opacity = opacity.toFixed(3);
      });
    };
    const draw = (now: number) => {
      paint(banked + (now - since) / 1000);
      frame = requestAnimationFrame(draw);
    };
    const sync = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        banked += (performance.now() - since) / 1000;
        frame = 0;
      }
      if (motion.matches) {
        banked = 0;
        paint(0);
        return;
      }
      if (document.hidden) return;
      since = performance.now();
      frame = requestAnimationFrame(draw);
    };

    sync();
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div role="status" className="flex items-center gap-2 text-muted-foreground">
      {/* Fixed box so the orbit, which overflows it while the plane is tilted, never moves the row. */}
      <span aria-hidden className="relative block h-4 w-[34px]">
        {REST.map((rest, index) => (
          <span
            key={index}
            ref={(node) => {
              dots.current[index] = node;
            }}
            className="absolute top-1/2 left-1/2 rounded-full bg-muted-foreground"
            style={{
              width: DOT,
              height: DOT,
              marginLeft: -DOT / 2,
              marginTop: -DOT / 2,
              transform: `translate(${rest.x.toFixed(2)}px, ${rest.y.toFixed(2)}px) scale(${rest.scale.toFixed(3)})`,
              opacity: rest.opacity.toFixed(3),
            }}
          />
        ))}
      </span>
      <span className={silent ? "sr-only" : "text-[13px]"}>{label}</span>
    </div>
  );
}
