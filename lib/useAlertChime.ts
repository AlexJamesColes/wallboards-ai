'use client';

import { useEffect, useRef } from 'react';

/**
 * Audio chime + once-per-cross detection for agent threshold alerts.
 *
 * Callers pass an array of unique alert keys (e.g. "Daniel Smith·Lunch")
 * computed each tick. The hook plays a two-tone bell sound whenever a
 * key appears that wasn't in the previous tick — i.e. the moment an
 * agent first crosses their alert threshold. Subsequent ticks where
 * the same agent stays in alert state stay silent. When they leave
 * alert state and re-enter later, the chime fires again.
 *
 * Audio is synthesised via the Web Audio API rather than a static
 * file — keeps the bundle lean and the chime tone consistent across
 * deploys. The first user gesture (click or keypress) unlocks the
 * AudioContext on browsers that gate it; on a kiosk TV the operator's
 * tap-to-fullscreen click gets us across that line. Boards rendered
 * on a TV that's never received a gesture stay silent — visual alert
 * still fires, so the floor isn't blind, just quiet.
 */
export function useAlertChime(activeAlertKeys: readonly string[]): void {
  // Track which keys were active last tick so we can detect new
  // arrivals. Use a Ref so the comparison survives re-renders without
  // forcing one.
  const prevRef = useRef<Set<string>>(new Set());

  // Lazily-built AudioContext — only constructed on the first chime so
  // SSR / non-audio paths don't pay the setup cost. Suspended contexts
  // are resumed on the first chime attempt; if that resume rejects
  // (no user gesture yet on this page) we just skip — visual alert
  // still fires from the caller.
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const next = new Set(activeAlertKeys);
    const prev = prevRef.current;
    const newcomers: string[] = [];
    for (const k of next) if (!prev.has(k)) newcomers.push(k);
    prevRef.current = next;

    if (newcomers.length === 0) return;

    // Bell — two oscillators stacked into a soft attack + decay
    // envelope. Roughly 0.6s, enough to draw the ear without being
    // sharp. Played once per call to playChime regardless of how many
    // newcomers landed in this tick — multiple alerts arriving at
    // once shouldn't sound like a slot machine.
    void playChime(audioCtxRef);
  }, [activeAlertKeys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
}

async function playChime(ctxRef: React.MutableRefObject<AudioContext | null>): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      // Will reject on browsers that haven't seen a gesture yet —
      // caller swallows.
      try { await ctx.resume(); } catch { return; }
    }

    const now = ctx.currentTime;
    chimeTone(ctx, now,        880, 0.6);  // A5 — opening bell
    chimeTone(ctx, now + 0.18, 587, 0.55); // D5 — softer second note
  } catch { /* swallow — visual alert still fires regardless */ }
}

function chimeTone(ctx: AudioContext, when: number, hz: number, peakGain: number): void {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = hz;
  osc.connect(gain);
  gain.connect(ctx.destination);
  // ADSR-ish envelope: quick rise, ~600ms decay. Exponential ramps
  // give a warmer-sounding fade than linear.
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peakGain, when + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.6);
  osc.start(when);
  osc.stop(when + 0.65);
}
