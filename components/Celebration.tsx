'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { extractEmojis } from '@/lib/emoji';

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

  const trigger = () => {
    const agents = snapshot();
    if (agents.length === 0) return;
    // De-dupe by name (same person may appear in multiple widgets)
    const seen = new Set<string>();
    const uniq = agents.filter(a => {
      const key = a.name.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Cap to 10 to keep the sequence around 30s
    setActiveAgents(uniq.slice(0, 10));
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

  // Keyboard shortcut for manual trigger (useful on admin TVs): press "c"
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
    const highlights: HighlightRow[] = rows.map(r => {
      const fullName = String(r[nameCol] ?? '');
      const emojis   = [...extractEmojis(fullName)];
      return {
        widgetId,
        name:   fullName,
        emojis,
        stats:  statCols.slice(0, 3).map(s => ({ label: s.label, value: s.format(r[s.col]) })),
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

const PER_AGENT_MS = 3200;

function CelebrationOverlay({ agents, onDone }: { agents: HighlightRow[]; onDone: () => void }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (idx >= agents.length) { onDone(); return; }
    const t = setTimeout(() => setIdx(i => i + 1), PER_AGENT_MS);
    return () => clearTimeout(t);
  }, [idx, agents.length, onDone]);

  if (idx >= agents.length) return null;

  const agent      = agents[idx];
  const isFirst    = idx === 0;
  const isLast     = idx === agents.length - 1;
  const nameClean  = agent.name.replace(/\p{Extended_Pictographic}(?:\uFE0F)?/gu, '').trim();

  // Spread emojis around a circle — randomise the radius slightly so it looks
  // less mechanical. Use a deterministic pseudo-random so the same agent
  // looks the same across re-renders during their 3.2s slot.
  const seed = hash(agent.name);
  const count = Math.max(agent.emojis.length, 1);

  return (
    <div
      role="dialog"
      aria-label={`Celebrating ${nameClean}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(4,6,14,0.78)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
        animation: (isFirst ? 'wb-celeb-backdrop-in 0.4s ease-out forwards'
                  : isLast  ? 'wb-celeb-backdrop-out 0.5s 2.7s ease-in forwards'
                  :           'none'),
      }}
    >
      {/* Banner */}
      <div style={{
        position: 'absolute', top: '8vh',
        fontSize: 'clamp(16px, 2vw, 28px)', fontWeight: 700,
        color: '#fbbf24', letterSpacing: '0.35em', textTransform: 'uppercase',
        textShadow: '0 0 24px rgba(251,191,36,0.6)',
        animation: 'wb-celeb-banner 3.2s ease-out forwards',
        whiteSpace: 'nowrap',
      }}>
        {agent.banner ? agent.banner : '⭐  Hall of Fame  ⭐'}
      </div>

      {/* Name */}
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
          animation: 'wb-celeb-name 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
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
            animation: 'wb-celeb-stats 3.2s ease-out forwards',
          }}>
            {agent.stats.map((s, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 'clamp(28px, 4.5vw, 72px)', fontWeight: 800, color: '#a5b4fc', fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                <div style={{ fontSize: 'clamp(11px, 1vw, 16px)', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Exploding emojis */}
        {agent.emojis.map((emoji, i) => {
          const angle = (seed + i * 360 / count) * (Math.PI / 180);
          const radius = 42 + ((seed * (i + 3)) % 18);      // vmin units
          const dx = Math.cos(angle) * radius;
          const dy = Math.sin(angle) * radius * 0.8;         // flatten a touch
          const spin = ((seed + i * 97) % 720) - 360;
          const delay = i * 0.08;
          return (
            <span key={i} aria-hidden style={{
              position: 'absolute', left: '50%', top: '50%',
              fontSize: 'clamp(48px, 7vw, 120px)',
              animation: `wb-celeb-emoji 2.6s ${delay}s cubic-bezier(0.22, 1, 0.36, 1) forwards`,
              // CSS custom props consumed by the keyframe
              ['--dx'  as any]: `${dx}vmin`,
              ['--dy'  as any]: `${dy}vmin`,
              ['--spin' as any]: `${spin}deg`,
              filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.5))',
              pointerEvents: 'none',
            }}>
              {emoji}
            </span>
          );
        })}
      </div>

      {/* Progress dots */}
      <div style={{
        position: 'absolute', bottom: '5vh',
        display: 'flex', gap: 8,
      }}>
        {agents.map((_, i) => (
          <span key={i} style={{
            width: i === idx ? 24 : 8, height: 8, borderRadius: 4,
            background: i === idx ? '#fbbf24' : i < idx ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.15)',
            transition: 'all 0.3s ease',
          }} />
        ))}
      </div>
    </div>
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
