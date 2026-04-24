'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { extractEmojis } from '@/lib/emoji';
import { summarizeAgent } from '@/lib/emojiSummary';
import { playFanfare, playSlideChime, playWompWomp } from '@/lib/sounds';

/**
 * "Hall of fame" takeover that runs every 10 minutes. Any TableWidget can
 * register its rows with us; we pick out agents with decorative emojis and
 * parade them one at a time with a firework of their emojis, then fade back
 * to the regular wallboard.
 *
 * TableWidget -> <CelebrationRegistrar rows={...} nameCol={...} stats={...} />
 *   (registers the widget's rows while the component is mounted)
 * KioskView   -> <CelebrationProvider><CelebrationTakeover />{children}</...>
 *   (provides context + renders the overlay)
 */

export interface HighlightRow {
  widgetId: string;
  name:     string;            // full first-column text with emojis
  emojis:   string[];          // unique decorative emojis only
  stats:    Array<{ label: string; value: string }>; // pulled from numeric cols
  /** Optional override for the banner at the top of this agent's slide. */
  banner?:  string;
  /** Leaderboard position (1-based). Shown as a large "#N" badge. */
  rank?:    number;
  /** Pre-computed celebration sentence. Overrides the emoji-template
   *  default — useful for bespoke slides (e.g. the Laziest Manager). */
  summary?: string;
}

interface Ctx {
  register:   (widgetId: string, rows: HighlightRow[]) => void;
  unregister: (widgetId: string) => void;
  snapshot:   () => HighlightRow[];
  trigger:    () => void;
  /** Unix ms when the next auto-celebration will fire, or null if disabled. */
  nextFireAt: number | null;
}

const CelebrationCtx = createContext<Ctx | null>(null);

// (Previously excluded 🥇🥈🥉 from celebration; now medals count too so
// position-based winners get their moment alongside achievement-based ones.)

export function CelebrationProvider({
  children,
  intervalMs   = 600_000,
  extraAgents  = [],
}: {
  children:    ReactNode;
  intervalMs?: number;
  /** Always appended to each celebration cycle (e.g. running jokes). */
  extraAgents?: HighlightRow[];
}) {
  const registry = useRef<Map<string, HighlightRow[]>>(new Map());
  const [activeAgents, setActiveAgents] = useState<HighlightRow[] | null>(null);
  const [nextFireAt,   setNextFireAt]   = useState<number | null>(null);

  const snapshot = (): HighlightRow[] => {
    const all: HighlightRow[] = [];
    for (const rows of registry.current.values()) all.push(...rows);
    all.push(...extraAgents);
    return all.filter(r => r.emojis.length > 0);
  };

  // Normalise a name for dedup (same person across widgets / emoji variants)
  const dedupKey = (n: string) => n.toLowerCase().replace(/\p{Extended_Pictographic}(?:\uFE0F)?/gu, '').replace(/\s+/g, ' ').trim();

  const trigger = () => {
    // Main pool (registered widget rows) — sorted so the celebration
    // starts with the most-decorated agents and works down. Ties are
    // broken by leaderboard position (rank 1 before rank 2, etc.).
    const main: HighlightRow[] = [];
    for (const rows of registry.current.values()) main.push(...rows);
    const mainFiltered = main.filter(r => r.emojis.length > 0);

    const seen = new Set<string>();
    const uniqMain = mainFiltered.filter(a => {
      const key = dedupKey(a.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    uniqMain.sort((a, b) => {
      const ec = b.emojis.length - a.emojis.length;         // most emojis first
      if (ec !== 0) return ec;
      return (a.rank ?? Infinity) - (b.rank ?? Infinity);   // then leaderboard order
    });

    // Extras (Laziest Manager etc.) always close the sequence.
    const extras = extraAgents.filter(r => r.emojis.length > 0);
    const uniqExtras = extras.filter(e => !seen.has(dedupKey(e.name)));

    // Cap to 10 slides total, reserving space for the extras at the end.
    const maxMain = Math.max(0, 10 - uniqExtras.length);
    const final   = [...uniqMain.slice(0, maxMain), ...uniqExtras];

    if (final.length === 0) return;
    setActiveAgents(final);
  };

  const ctx: Ctx = {
    register:   (id, rows) => { registry.current.set(id, rows); },
    unregister: (id)       => { registry.current.delete(id); },
    snapshot,
    trigger,
    nextFireAt,
  };

  // Auto-trigger on a timer. Fire the first celebration ~90s after load
  // (so data has time to settle) then repeat every `intervalMs`. We use a
  // chained setTimeout (rather than setInterval) so we know exactly when
  // the next fire is scheduled — needed for the countdown indicator.
  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) { setNextFireAt(null); return; }
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (ms: number) => {
      setNextFireAt(Date.now() + ms);
      timer = setTimeout(() => {
        trigger();
        schedule(intervalMs);
      }, ms);
    };
    schedule(90_000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  // Keyboard shortcut for manual trigger (useful on admin TVs): press "c".
  // Any keypress also counts as the user gesture that unlocks Web Audio —
  // we import + call it lazily so SSR doesn't choke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      import('@/lib/sounds').then(m => m.unlockAudio()).catch(() => {});
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) trigger();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CelebrationCtx.Provider value={ctx}>
      {children}
      {activeAgents && <CelebrationOverlay agents={activeAgents} onDone={() => setActiveAgents(null)} />}
    </CelebrationCtx.Provider>
  );
}

/** Registers a widget's rows with the celebration provider for its lifetime. */
export function CelebrationRegistrar({
  widgetId, rows, nameCol, statCols,
}: {
  widgetId: string;
  rows:     any[];
  nameCol:  string;
  statCols: Array<{ col: string; label: string; format: (v: any) => string }>;
}) {
  const ctx = useContext(CelebrationCtx);
  useEffect(() => {
    if (!ctx) return;
    const highlights: HighlightRow[] = rows.map((r, idx) => {
      const fullName = String(r[nameCol] ?? '');
      const emojis   = [...extractEmojis(fullName)];
      return {
        widgetId,
        name:   fullName,
        emojis,
        stats:  statCols.slice(0, 3).map(s => ({ label: s.label, value: s.format(r[s.col]) })),
        rank:   idx + 1,
      };
    });
    ctx.register(widgetId, highlights);
    return () => ctx.unregister(widgetId);
  }, [ctx, widgetId, rows, nameCol, statCols]);
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Overlay — sequences through agents, 3.2s per agent
// ────────────────────────────────────────────────────────────────────────

const PER_AGENT_MS = 7000;

/** Heuristic for "is this a comedy/joke slide?" — trigger womp-womp instead
 *  of the triumphant chime. */
function isComedySlide(agent: HighlightRow): boolean {
  const banner = (agent.banner || '').toLowerCase();
  if (/lazy|laziest|worst|slowest|sleeper|snooz/.test(banner)) return true;
  // 💤 / 😴 / 🦥 / 🛌 in the name also signal a joke
  return /[\u{1F4A4}\u{1F634}\u{1F9A5}\u{1F6CF}]/u.test(agent.name);
}

function CelebrationOverlay({ agents, onDone }: { agents: HighlightRow[]; onDone: () => void }) {
  const [idx, setIdx] = useState(0);

  // Opening fanfare on mount
  useEffect(() => { playFanfare(); }, []);

  // Stash onDone in a ref so the slide-advance timer doesn't get cleared and
  // restarted every time the parent provider re-renders (which happens once
  // a second courtesy of the showcase's countdown ticker — without this the
  // 7s setTimeout never completes 7s of uninterrupted ticking and the
  // overlay sits stuck on slide 0 with the animation already faded to 0,
  // looking like a black screen).
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });

  useEffect(() => {
    if (idx >= agents.length) { onDoneRef.current(); return; }
    const t = setTimeout(() => setIdx(i => i + 1), PER_AGENT_MS);
    return () => clearTimeout(t);
  }, [idx, agents.length]);

  if (idx >= agents.length) return null;

  const agent   = agents[idx];
  // Summary: use a pre-baked one if the row provides it (e.g. Laziest
  // Manager's bespoke quip), otherwise derive from the emoji set via the
  // static template. No AI, no network — deterministic per combo.
  const summary = agent.summary ?? summarizeAgent(agent.emojis) ?? '';
  const isFirst = idx === 0;
  const isLast  = idx === agents.length - 1;

  return (
    <div
      role="dialog"
      aria-label={`Celebrating ${agent.name}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        // Dim + blur the wallboard so the pop-up has full focus without
        // a chaotic field of leaderboard text fighting for attention.
        background: 'rgba(4,6,14,0.55)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
        animation: (isFirst ? 'wb-celeb-backdrop-in 0.4s ease-out forwards'
                  : isLast  ? 'wb-celeb-backdrop-out 0.5s 6.4s ease-in forwards'
                  :           'none'),
      }}
    >
      {/* The pop-up card itself — sized so the animations have room to
          breathe but the wallboard underneath stays visible around it. */}
      <div style={{
        position: 'relative',
        width:  'min(78vw, 1300px)',
        height: 'min(64vh, 720px)',
        background: 'linear-gradient(180deg, rgba(20,26,42,0.97) 0%, rgba(10,15,28,0.97) 100%)',
        border: '2px solid rgba(99,102,241,0.45)',
        borderRadius: 28,
        boxShadow: '0 30px 90px rgba(0,0,0,0.7), 0 0 80px rgba(251,191,36,0.18), inset 0 1px 0 rgba(255,255,255,0.08)',
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* Key-on-idx forces a fresh mount per slide so every keyframe
            animation restarts — otherwise `forwards` fill keeps the
            previous agent's end-state and subsequent slides appear frozen. */}
        <AgentSlide key={idx} agent={agent} isFirst={isFirst} summary={summary} />

        {/* Progress dots — pinned to the bottom of the card */}
        <div style={{
          position: 'absolute', bottom: 18,
          display: 'flex', gap: 7,
        }}>
          {agents.map((_, i) => (
            <span key={i} style={{
              width: i === idx ? 22 : 7, height: 7, borderRadius: 4,
              background: i === idx ? '#fbbf24' : i < idx ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.15)',
              transition: 'all 0.3s ease',
            }} />
          ))}
        </div>
      </div>

      {/* Emoji explosion — rendered at the dialog level (sibling to the
          card) so it can fly OUT past the card edges and over the blurred
          backdrop without being clipped. Keyed on idx so each new slide
          gets a fresh burst. */}
      <EmojiBurst key={`emoji-${idx}`} agent={agent} />
    </div>
  );
}

/** Standalone emoji firework burst, full-viewport so emojis can fly past
 *  the card boundary into the dimmed backdrop. */
function EmojiBurst({ agent }: { agent: HighlightRow }) {
  if (agent.emojis.length === 0) return null;
  const seed  = hash(agent.name);
  const count = Math.max(agent.emojis.length, 1);
  // Smaller font when many emojis stack so they don't crowd the text
  const fontSize = count >= 7 ? 'clamp(34px, 4.5vw, 78px)' : 'clamp(42px, 5.5vw, 100px)';

  return (
    <div aria-hidden style={{
      position: 'absolute', inset: 0,
      pointerEvents: 'none',
      // Don't clip — let emojis fly anywhere on the screen.
      overflow: 'visible',
    }}>
      {agent.emojis.map((emoji, i) => {
        const angle  = (seed + i * 360 / count) * (Math.PI / 180);
        // Bigger radius now (50-65vmin) so emojis clear the card and
        // don't crowd the agent's name in the centre.
        const radius = 50 + ((seed * (i + 3)) % 16);
        const dx     = Math.cos(angle) * radius;
        const dy     = Math.sin(angle) * radius * 0.7;
        const spin   = ((seed + i * 97) % 720) - 360;
        const delay  = i * 0.08;
        return (
          <span key={i} style={{
            position: 'absolute', left: '50%', top: '50%',
            fontSize,
            animation: `wb-celeb-emoji 2.6s ${delay}s cubic-bezier(0.22, 1, 0.36, 1) forwards`,
            ['--dx'   as any]: `${dx}vmin`,
            ['--dy'   as any]: `${dy}vmin`,
            ['--spin' as any]: `${spin}deg`,
            filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.5))',
          }}>
            {emoji}
          </span>
        );
      })}
    </div>
  );
}

function AgentSlide({ agent, isFirst, summary }: { agent: HighlightRow; isFirst: boolean; summary?: string | null }) {
  const nameClean = agent.name.replace(/\p{Extended_Pictographic}(?:\uFE0F)?/gu, '').trim();
  const seed      = hash(agent.name);
  const count     = Math.max(agent.emojis.length, 1);

  // Per-slide sound effect (skip the first because the fanfare already fired)
  useEffect(() => {
    if (isFirst) return; // fanfare handled it
    if (isComedySlide(agent)) playWompWomp();
    else                       playSlideChime();
  }, [agent, isFirst]);

  return (
    <>
      {/* Banner — pinned to the top of the pop-up card */}
      <div style={{
        position: 'absolute', top: 'clamp(14px, 3vh, 32px)', left: 0, right: 0, textAlign: 'center',
        fontSize: 'clamp(14px, 1.6vw, 24px)', fontWeight: 700,
        color: '#fbbf24', letterSpacing: '0.3em', textTransform: 'uppercase',
        textShadow: '0 0 24px rgba(251,191,36,0.6)',
        animation: 'wb-celeb-banner 7s ease-out forwards',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {agent.banner ? agent.banner : '⭐  Hall of Fame  ⭐'}
      </div>

      {/* Name + stats + emojis */}
      <div style={{ position: 'relative', textAlign: 'center' }}>
        {/* Radial burst behind the name */}
        <div aria-hidden style={{
          position: 'absolute', left: '50%', top: '50%',
          width: '60vmin', height: '60vmin',
          background: 'radial-gradient(circle, rgba(251,191,36,0.35) 0%, rgba(251,191,36,0) 65%)',
          animation: 'wb-celeb-burst 2s ease-out forwards',
        }} />

        <div style={{
          position: 'relative',
          fontSize: 'clamp(48px, 8vw, 140px)',
          fontWeight: 900,
          color: '#f1f5f9',
          textShadow: '0 6px 40px rgba(99,102,241,0.55)',
          animation: 'wb-celeb-name 7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          padding: '0 4vw',
        }}>
          {nameClean || 'Unknown agent'}
        </div>

        {/* Stats row */}
        {agent.stats.length > 0 && (
          <div style={{
            marginTop: 'clamp(16px, 2vh, 28px)',
            display: 'flex', gap: 'clamp(24px, 4vw, 60px)',
            justifyContent: 'center',
            animation: 'wb-celeb-stats 7s ease-out forwards',
          }}>
            {agent.stats.map((s, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 'clamp(28px, 4.5vw, 72px)', fontWeight: 800, color: '#a5b4fc', fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                <div style={{ fontSize: 'clamp(11px, 1vw, 16px)', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* AI-generated celebratory sentence. Fades in whenever the API
            responds — no summary = no slot (avoids an empty placeholder). */}
        {summary && (
          <div style={{
            marginTop: 'clamp(18px, 2.4vh, 34px)',
            padding: '0 min(8vw, 140px)',
            fontSize: 'clamp(16px, 1.9vw, 32px)',
            fontStyle: 'italic',
            fontWeight: 500,
            color: '#cbd5e1',
            lineHeight: 1.35,
            textShadow: '0 2px 12px rgba(0,0,0,0.4)',
            maxWidth: '80vw',
            margin: 'clamp(18px, 2.4vh, 34px) auto 0',
            textWrap: 'balance',
            animation: 'wb-celeb-stats 7s 0.3s ease-out both',
          }}>
            “{summary}”
          </div>
        )}

        {/* Exploding emojis — radius tuned so the burst stays largely
            inside the pop-up card while still feeling explosive. The
            card's overflow:hidden trims any that go a fraction past the
            edge for the "bursting out" feel. */}
        {agent.emojis.map((emoji, i) => {
          const angle  = (seed + i * 360 / count) * (Math.PI / 180);
          const radius = 24 + ((seed * (i + 3)) % 10);  // 24-34 vmin
          const dx     = Math.cos(angle) * radius;
          const dy     = Math.sin(angle) * radius * 0.75;
          const spin   = ((seed + i * 97) % 720) - 360;
          const delay  = i * 0.08;
          return (
            <span key={i} aria-hidden style={{
              position: 'absolute', left: '50%', top: '50%',
              fontSize: 'clamp(40px, 5.5vw, 96px)',
              animation: `wb-celeb-emoji 2.6s ${delay}s cubic-bezier(0.22, 1, 0.36, 1) forwards`,
              ['--dx'   as any]: `${dx}vmin`,
              ['--dy'   as any]: `${dy}vmin`,
              ['--spin' as any]: `${spin}deg`,
              filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.5))',
              pointerEvents: 'none',
            }}>
              {emoji}
            </span>
          );
        })}
      </div>
    </>
  );
}

// Tiny deterministic hash → 0–359 for emoji angle seeding
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

export function useCelebration() {
  return useContext(CelebrationCtx);
}

/**
 * Small countdown indicator — shows time remaining until the next auto
 * celebration. Renders nothing if celebrations are disabled or the timer
 * hasn't been set yet. Pulses on the final 10 seconds to tee up the moment.
 */
export function CelebrationCountdown({ style }: { style?: React.CSSProperties } = {}) {
  const ctx = useCelebration();
  const [, tick] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  if (!ctx?.nextFireAt) return null;
  const remaining = Math.max(0, ctx.nextFireAt - Date.now());
  if (remaining <= 0) return null;

  const totalSec = Math.ceil(remaining / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const imminent = totalSec <= 10;

  return (
    <span
      title="Time until the next Hall of Fame celebration"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 12, fontWeight: 600,
        color: imminent ? '#fbbf24' : '#475569',
        fontVariantNumeric: 'tabular-nums',
        animation: imminent ? 'wb-celeb-banner 1s ease-in-out infinite' : undefined,
        ...style,
      }}
    >
      <span aria-hidden>⭐</span>
      {mm}:{String(ss).padStart(2, '0')}
    </span>
  );
}
