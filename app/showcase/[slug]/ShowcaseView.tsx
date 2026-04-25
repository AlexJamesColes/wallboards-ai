'use client';

import { useEffect, useRef, useState } from 'react';
import type { WbBoard } from '@/lib/db';
import { extractEmojis, tokenize } from '@/lib/emoji';
import { CelebrationProvider, CelebrationCountdown, CelebrationRegistrar } from '@/components/Celebration';

interface Props { board: WbBoard; widgetId: string; }

// ────────────────────────────────────────────────────────────────────────
//  Config + helpers
// ────────────────────────────────────────────────────────────────────────

// Default monthly income target when no ?target= query param is supplied.
// For London sales this is roughly half of the combined London + Guildford
// NB budget (~£2.59M); can always be overridden per-TV via the URL.
const DEFAULT_TEAM_TARGET = 1_300_000;
const POLL_MS             = 60_000;

/** Deterministic colour for an avatar based on name — same person always
 *  gets the same gradient, but faces around the board feel varied. */
function avatarColors(name: string): { from: string; to: string } {
  const palette = [
    { from: '#6366f1', to: '#a855f7' }, // indigo → violet
    { from: '#0ea5e9', to: '#14b8a6' }, // sky → teal
    { from: '#f97316', to: '#ef4444' }, // orange → red
    { from: '#22c55e', to: '#84cc16' }, // green → lime
    { from: '#ec4899', to: '#f43f5e' }, // pink → rose
    { from: '#a855f7', to: '#6366f1' }, // violet → indigo
    { from: '#f59e0b', to: '#f97316' }, // amber → orange
    { from: '#3b82f6', to: '#8b5cf6' }, // blue → violet
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

function initials(name: string): string {
  const clean = name.replace(/\p{Extended_Pictographic}(?:\uFE0F)?/gu, '').trim();
  const bits  = clean.split(/\s+/).filter(Boolean);
  const first = bits[0]?.[0] || '?';
  const last  = bits.length > 1 ? bits[bits.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function cleanName(raw: string): string {
  return raw.replace(/\p{Extended_Pictographic}(?:\uFE0F)?/gu, '').trim();
}

function parseMoney(v: any): number {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/[£$,\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1000)      return `£${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

// ────────────────────────────────────────────────────────────────────────
//  Data types + history tracking
// ────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;
interface WidgetData { columns: string[]; rows: Row[]; }

/** What we remember about an agent between refreshes so we can produce
 *  rank arrows, emoji pop-ins and ticker events. */
interface Snapshot {
  rank:   number;
  emojis: Set<string>;
  income: number;
  policies: number;
}

type TickerKind = 'climb' | 'drop' | 'emoji' | 'first-policy' | 'milestone' | 'alert';
interface TickerItem {
  id:    string;                // unique — dedupes repeats
  kind:  TickerKind;
  text:  string;
  emoji: string;                // leading icon
  at:    number;                // createdAt ms
  source?: string;              // for 'alert' items: which system posted it
}

// ────────────────────────────────────────────────────────────────────────
//  Hour-ticking clock
// ────────────────────────────────────────────────────────────────────────

// (useTimeTicker was used at the parent level which forced the ENTIRE
// showcase tree to re-render every second just for the clock + countdown.
// Now each clock-driven component has its own contained ticker — see
// <Clock /> and <DayCountdown /> — so the heavy bits (podium, agent grid,
// today strip) only re-render when their data actually changes.)

/**
 * "Laziest Manager" comedy slide — same endpoint the classic kiosk uses.
 * Returns a list with 0 or 1 agent depending on whether there's anything
 * worth mocking (both at zero early in the day = skipped).
 */
function useLaziestManagerSlide(): any[] {
  const [slide, setSlide] = useState<any | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fetchIt = async () => {
      try {
        const res  = await fetch('/api/laziest-manager', { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled && data?.agent) setSlide(data.agent);
      } catch { /* keep previous slide on hiccup */ }
    };
    fetchIt();
    const iv = setInterval(fetchIt, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);
  return slide ? [slide] : [];
}

/**
 * Per-TV zoom override. Some big TVs (e.g. Samsung Frame) report a small
 * viewport size to the browser so 1vw/1vh map to fewer real pixels than
 * the screen has — making everything look chunky and wasting space.
 * Append ?zoom=0.85 (or any positive number) to the URL on that TV and
 * the whole page scales down accordingly so more fits.
 *
 * Implemented via the CSS `zoom` property — well supported in Chromium
 * (which is what Samsung Tizen / smart TV browsers use).
 */
function useZoom() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('zoom');
    const z = q ? Number(q) : NaN;
    if (Number.isFinite(z) && z > 0 && z !== 1) {
      (document.documentElement.style as any).zoom = String(z);
      return () => { (document.documentElement.style as any).zoom = ''; };
    }
  }, []);
}

/**
 * Team income target — read from the URL's ?target= query param, otherwise
 * the compile-time default. Lets individual TVs show different targets
 * (e.g. the London wallboard shows the London-only split of the combined
 * L+G budget) without a redeploy.
 */
function useTeamTarget(): number {
  const [val, setVal] = useState<number>(DEFAULT_TEAM_TARGET);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('target');
    const n = q ? Number(q) : NaN;
    if (Number.isFinite(n) && n > 0) setVal(n);
  }, []);
  return val;
}

// ────────────────────────────────────────────────────────────────────────
//  Main view
// ────────────────────────────────────────────────────────────────────────

export default function ShowcaseView({ board, widgetId }: Props) {
  const [data, setData]       = useState<WidgetData | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const prevRef               = useRef<Map<string, Snapshot>>(new Map());
  const [tickerItems, setTicker] = useState<TickerItem[]>([]);
  const teamTarget            = useTeamTarget();
  const laziestSlide          = useLaziestManagerSlide();
  useZoom();
  useAutoReloadOnDeploy();

  // Poll /api/alerts for anything IT has pushed (Teams webhook forwards etc.)
  // and prepend them to the ticker as they arrive. Much shorter interval
  // than the widget data so new alerts show up within ~10 seconds.
  useEffect(() => {
    let since = Date.now() - 5 * 60 * 1000; // start 5 min back — catches recent
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/alerts?since=${since}`, { cache: 'no-store' });
        const d   = await res.json();
        if (cancelled) return;
        if (Array.isArray(d.alerts) && d.alerts.length) {
          const fresh: TickerItem[] = d.alerts.map((a: any) => ({
            id:     `alert-${a.id}`,
            kind:   'alert' as const,
            text:   a.text,
            emoji:  a.emoji || '📣',
            at:     a.at,
            source: a.source,
          }));
          setTicker(items => {
            const seen = new Set(items.map(i => i.id));
            const add  = fresh.filter(f => !seen.has(f.id));
            return [...items, ...add].slice(-30);
          });
          since = Math.max(since, d.now || Date.now());
        } else if (d.now) {
          since = d.now;
        }
      } catch { /* ignore hiccups */ }
      finally { if (!cancelled) timer = setTimeout(poll, 10_000); }
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // Poll the widget's existing data endpoint — same contract as the kiosk
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const fetchIt = async () => {
      try {
        const res = await fetch(`/api/widgets/${widgetId}/data`, { cache: 'no-store' });
        const d   = await res.json();
        if (cancelled) return;
        if (d?.error) setError(d.error);
        else          { setData({ columns: d.columns || [], rows: d.rows || [] }); setError(null); }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Fetch failed');
      } finally {
        if (!cancelled) timer = setTimeout(fetchIt, POLL_MS);
      }
    };
    fetchIt();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [widgetId]);

  // Detect changes between renders → ticker events
  useEffect(() => {
    if (!data) return;

    const cols       = data.columns;
    const nameCol    = cols[0] || 'name';
    const incomeCol  = cols.find(c => /income.*mtd|mtd.*income/i.test(c)) || cols.find(c => /income/i.test(c)) || '';
    const polCol     = cols.find(c => /policies.*today|today.*policies/i.test(c)) || cols.find(c => /policies/i.test(c)) || '';

    const current = new Map<string, Snapshot>();
    data.rows.forEach((r, i) => {
      const key = String(r[nameCol] ?? '').toLowerCase().replace(/\p{Extended_Pictographic}(?:\uFE0F)?/gu, '').trim();
      if (!key) return;
      current.set(key, {
        rank:     i + 1,
        emojis:   extractEmojis(String(r[nameCol] ?? '')),
        income:   parseMoney(r[incomeCol]),
        policies: parseMoney(r[polCol]),
      });
    });

    const prev = prevRef.current;
    if (prev.size > 0) {
      const newItems: TickerItem[] = [];
      const now = Date.now();
      for (const [key, cur] of current) {
        const was = prev.get(key);
        if (!was) continue;
        const displayName = cleanName(String(data.rows[cur.rank - 1]?.[nameCol] ?? key));

        // Rank moves
        if (was.rank !== cur.rank) {
          const diff = was.rank - cur.rank;
          newItems.push({
            id: `${key}-rank-${cur.rank}-${now}`,
            kind: diff > 0 ? 'climb' : 'drop',
            emoji: diff > 0 ? '⬆️' : '⬇️',
            text: `${displayName} ${diff > 0 ? 'climbed' : 'dropped'} ${Math.abs(diff)} position${Math.abs(diff) === 1 ? '' : 's'}`,
            at: now,
          });
        }
        // New emojis
        for (const e of cur.emojis) {
          if (!was.emojis.has(e)) {
            newItems.push({
              id: `${key}-emoji-${e}-${now}`,
              kind: 'emoji',
              emoji: e,
              text: `${displayName} just earned ${e}`,
              at: now,
            });
          }
        }
        // First deal of the day
        if (was.policies === 0 && cur.policies > 0) {
          newItems.push({
            id: `${key}-first-${now}`,
            kind: 'first-policy',
            emoji: '🎊',
            text: `${displayName} opened today — first policy!`,
            at: now,
          });
        }
        // Big income jump (£1k+)
        if (cur.income - was.income >= 1000) {
          newItems.push({
            id: `${key}-jump-${cur.income}-${now}`,
            kind: 'milestone',
            emoji: '💰',
            text: `${displayName} just added ${formatMoney(cur.income - was.income)}`,
            at: now,
          });
        }
      }
      if (newItems.length) {
        setTicker(items => [...items, ...newItems].slice(-30)); // keep last 30
      }
    }
    prevRef.current = current;
  }, [data]);

  if (error)  return <BrandedSplash boardName={board.name} state="error" detail={error} />;
  if (!data)  return <BrandedSplash boardName={board.name} state="loading" />;

  // Decode columns for this board
  const cols         = data.columns;
  const nameCol      = cols[0] || 'name';
  const incomeMtdCol = cols.find(c => /^income$|income.*mtd|mtd.*income/i.test(c)) || cols.find(c => /income/i.test(c) && !/today/i.test(c)) || '';
  const polMtdCol    = cols.find(c => /^policies.*mtd|mtd.*polic/i.test(c))        || cols.find(c => /^polic/i.test(c) && !/today/i.test(c)) || '';
  const polTodayCol  = cols.find(c => /polic.*today|today.*polic/i.test(c))        || '';
  const incomeTodayCol = cols.find(c => /income.*today|today.*income/i.test(c))    || '';
  const ippCol       = cols.find(c => /^ipp$/i.test(c) || /ipp/i.test(c))           || '';
  const gwpCol       = cols.find(c => /^gwp$/i.test(c) || /gwp/i.test(c))           || '';
  const addonsCol    = cols.find(c => /^add[- ]?ons?$/i.test(c) || /addon/i.test(c)) || '';

  // ── De-duplicate tied accolade emojis ────────────────────────────────
  // Each decorative emoji should mark a single winner. If the SQL gave 🎉
  // (most policies today) to multiple agents because they tied, strip it
  // from all of them so no false bragging rights show up on the podium,
  // grid, today strip, or celebrations. Same rule the TableWidget applies
  // — replicated here because the showcase doesn't render through it.
  const dupedEmojis = (() => {
    const counts = new Map<string, number>();
    for (const r of data.rows) {
      const seen = new Set<string>();
      for (const e of extractEmojis(String(r[nameCol] ?? ''))) {
        if (seen.has(e)) continue;
        seen.add(e);
        counts.set(e, (counts.get(e) || 0) + 1);
      }
    }
    const dup = new Set<string>();
    counts.forEach((n, e) => { if (n > 1) dup.add(e); });
    return dup;
  })();

  const dedupedRows = dupedEmojis.size === 0 ? data.rows : data.rows.map(r => {
    const raw = String(r[nameCol] ?? '');
    let cleaned = raw;
    dupedEmojis.forEach(e => { cleaned = cleaned.split(e).join(''); });
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return { ...r, [nameCol]: cleaned };
  });

  // Sort by income MTD desc (same order as the SQL sent us, but enforce it)
  const sortedRows = [...dedupedRows].sort((a, b) => parseMoney(b[incomeMtdCol]) - parseMoney(a[incomeMtdCol]));

  const teamTotal   = sortedRows.reduce((s, r) => s + parseMoney(r[incomeMtdCol]), 0);
  const targetPct   = Math.min(100, Math.round((teamTotal / teamTarget) * 100));

  const top3 = sortedRows.slice(0, 3);
  const rest = sortedRows.slice(3);

  return (
    <CelebrationProvider intervalMs={300_000} extraAgents={laziestSlide}>
      {/* Push the showcase agents into the celebration context so the Hall
          of Fame has real candidates (the bespoke showcase doesn't render a
          TableWidget, so without this only Hugo would ever appear). */}
      <CelebrationRegistrar
        widgetId={widgetId}
        rows={sortedRows}
        nameCol={nameCol}
        statCols={[
          { col: incomeMtdCol,   label: 'Income MTD',    format: (v: any) => formatMoney(parseMoney(v)) },
          { col: polMtdCol,      label: 'Policies MTD',  format: (v: any) => String(Math.round(parseMoney(v))) },
          { col: incomeTodayCol, label: 'Income Today',  format: (v: any) => formatMoney(parseMoney(v)) },
        ].filter(s => s.col)}
      />
      <div style={{
        width: '100vw', height: '100vh',
        background: 'radial-gradient(ellipse at 20% 10%, #1a1f3a 0%, #0a0f1c 60%, #050813 100%)',
        color: '#f1f5f9', overflow: 'hidden',
        fontFamily: 'var(--font-raleway, sans-serif)',
        display: 'flex', flexDirection: 'column', position: 'relative',
      }}>
        {/* Ambient glows in the background */}
        <div aria-hidden style={{ position: 'absolute', top: '-10%', left: '-5%', width: '40vw', height: '40vw', background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 60%)', pointerEvents: 'none' }} />
        <div aria-hidden style={{ position: 'absolute', bottom: '-20%', right: '-10%', width: '50vw', height: '50vw', background: 'radial-gradient(circle, rgba(168,85,247,0.10) 0%, transparent 60%)', pointerEvents: 'none' }} />

        {/* ── Header ───────────────────────────────────────────────── */}
        <Header boardName={board.name} teamTotal={teamTotal} target={teamTarget} targetPct={targetPct} />

        {/* ── Today's leaderboard strip — fast-moving daily race ────── */}
        <TodayStrip
          rows={sortedRows}
          cols={{ nameCol, incomeTodayCol, polTodayCol }}
        />

        {/* ── Podium (MTD position) ────────────────────────────────── */}
        <Podium
          rows={top3}
          cols={{ nameCol, incomeMtdCol, polMtdCol, polTodayCol, incomeTodayCol, ippCol, gwpCol, addonsCol }}
        />

        {/* ── Rest of the pack ────────────────────────────────────── */}
        <AgentGrid
          rows={rest}
          startIndex={4}
          cols={{ nameCol, incomeMtdCol, polMtdCol, polTodayCol, incomeTodayCol, ippCol, gwpCol, addonsCol }}
          teamLeaderIncome={parseMoney(top3[0]?.[incomeMtdCol]) || 1}
        />

        {/* ── Activity ticker ─────────────────────────────────────── */}
        <ActivityTicker items={tickerItems} />
      </div>
    </CelebrationProvider>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Header with team target + countdown
// ────────────────────────────────────────────────────────────────────────

function Header({ boardName, teamTotal, target, targetPct }: {
  boardName: string; teamTotal: number; target: number; targetPct: number;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 18,
      padding: 'clamp(6px, 0.8vh, 12px) clamp(16px, 1.8vw, 32px)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(10,15,28,0.5)', backdropFilter: 'blur(12px)',
      flexShrink: 0, zIndex: 2,
    }}>
      {/* Board name — compact one-line */}
      <div style={{ flexShrink: 0, lineHeight: 1.2 }}>
        <div style={{ fontSize: 'clamp(15px, 1.4vw, 22px)', fontWeight: 800, color: '#f1f5f9' }}>
          {boardName}
        </div>
      </div>

      {/* Team target progress bar — slimmer */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 'clamp(10px, 0.9vw, 13px)', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Team · MTD</span>
          <span style={{ fontSize: 'clamp(15px, 1.6vw, 24px)', fontWeight: 900, color: '#fde68a', fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(teamTotal)}
          </span>
          <span style={{ fontSize: 'clamp(11px, 1vw, 14px)', color: '#64748b' }}>of {formatMoney(target)}</span>
          <span style={{ marginLeft: 'auto', fontSize: 'clamp(12px, 1.2vw, 18px)', fontWeight: 800, color: targetPct >= 100 ? '#10b981' : '#a5b4fc' }}>
            {targetPct}%
          </span>
        </div>
        <div style={{
          height: 'clamp(6px, 0.8vh, 11px)', borderRadius: 99,
          background: 'rgba(255,255,255,0.06)', overflow: 'hidden', position: 'relative',
        }}>
          <div style={{
            width: `${targetPct}%`, height: '100%',
            background: targetPct >= 100
              ? 'linear-gradient(90deg, #10b981 0%, #34d399 50%, #fbbf24 100%)'
              : 'linear-gradient(90deg, #6366f1 0%, #a855f7 50%, #fbbf24 100%)',
            boxShadow: '0 0 16px rgba(251,191,36,0.3)',
            transition: 'width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }} />
        </div>
      </div>

      {/* Countdown + clock — own internal tick. */}
      <DayCountdown />
    </div>
  );
}

/** Sales floor opening hours by day of week. People do trade outside
 *  these (early starts / overtime), so the wallboard still works — it
 *  just shifts to a "Closed · opens X" state. */
function openingHoursFor(day: number): { openH: number; openM: number; closeH: number; closeM: number } {
  // 0=Sun, 1=Mon, …, 6=Sat
  if (day === 0)            return { openH: 10, openM: 0,  closeH: 17, closeM: 0 };
  if (day === 6)            return { openH:  9, openM: 0,  closeH: 17, closeM: 0 };
  /* Mon–Fri */              return { openH:  8, openM: 30, closeH: 20, closeM: 0 };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtTime(h: number, m: number): string {
  // 8:30am / 5pm — drop minutes when 0 for readability
  const period = h >= 12 ? 'pm' : 'am';
  const hh     = ((h + 11) % 12) + 1;
  return m === 0 ? `${hh}${period}` : `${hh}:${String(m).padStart(2, '0')}${period}`;
}

/** Find the next opening window strictly after `from`. Returns the open
 *  Date plus the day name for display ("Mon"), or null if (impossibly)
 *  no future window exists. */
function nextOpening(from: Date): { at: Date; dayLabel: string } | null {
  for (let i = 0; i < 8; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, 0, 0, 0);
    const { openH, openM } = openingHoursFor(d.getDay());
    const open = new Date(d.getFullYear(), d.getMonth(), d.getDate(), openH, openM, 0);
    if (open > from) {
      const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      const isTomorrow = i === 1 || (i === 0 && open > from);
      const sameDay    = open.toDateString() === today.toDateString();
      const dayLabel   = sameDay ? 'today' : isTomorrow ? 'tomorrow' : DAY_NAMES[d.getDay()];
      return { at: open, dayLabel };
    }
  }
  return null;
}

/** Self-contained countdown — clock + celebration timer + per-day
 *  opening-hours aware "time left today". Owns its own setInterval so
 *  the parent ShowcaseView only re-renders when actual data changes. */
function DayCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);

  const date  = new Date(now);
  const day   = date.getDay();
  const hours = openingHoursFor(day);
  const open  = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours.openH,  hours.openM,  0);
  const close = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours.closeH, hours.closeM, 0);

  // ── State machine ──────────────────────────────────────────────
  // pre-open  → counting down to today's opening
  // open      → counting down to today's closing
  // closed    → showing the next opening window
  let label: string;
  let value: string;
  let tone: 'normal' | 'urgent' | 'closed' | 'preopen' = 'normal';

  if (date < open) {
    const ms = open.getTime() - date.getTime();
    const h  = Math.floor(ms / 3_600_000);
    const m  = Math.floor((ms % 3_600_000) / 60_000);
    label = `Opens at ${fmtTime(hours.openH, hours.openM)}`;
    value = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
    tone  = 'preopen';
  } else if (date < close) {
    const ms = close.getTime() - date.getTime();
    const h  = Math.floor(ms / 3_600_000);
    const m  = Math.floor((ms % 3_600_000) / 60_000);
    label = `Time left today`;
    value = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
    tone  = ms < 3_600_000 ? 'urgent' : 'normal';
  } else {
    const next = nextOpening(date);
    label = next ? `Closed · opens ${next.dayLabel} ${fmtTime(openingHoursFor(next.at.getDay()).openH, openingHoursFor(next.at.getDay()).openM)}` : 'Closed';
    value = '🎉';
    tone  = 'closed';
  }

  const labelColor = tone === 'closed'  ? '#10b981'
                   : tone === 'urgent'  ? '#fbbf24'
                   : tone === 'preopen' ? '#a5b4fc'
                   :                       '#64748b';
  const valueColor = tone === 'closed'  ? '#10b981'
                   : tone === 'urgent'  ? '#fbbf24'
                   : tone === 'preopen' ? '#a5b4fc'
                   :                       '#f1f5f9';
  const animation  = tone === 'urgent'  ? 'wb-celeb-banner 1.2s ease-in-out infinite' : undefined;

  return (
    <div style={{ textAlign: 'right', flexShrink: 0 }}>
      <div style={{
        fontSize: 'clamp(10px, 0.9vw, 14px)', fontWeight: 700,
        color: labelColor, letterSpacing: '0.2em', textTransform: 'uppercase',
        animation,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 'clamp(18px, 1.8vw, 28px)', fontWeight: 900,
        color: valueColor, fontVariantNumeric: 'tabular-nums', marginTop: 2,
      }}>
        {value}
      </div>
      <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <CelebrationCountdown />
        <Clock />
      </div>
    </div>
  );
}

/**
 * Branded full-screen state — used for both initial load and any data
 * fetch error. Shows the InsureTec wordmark + the board name + a status
 * line so a TV that's slow to load doesn't read as "broken" to anyone
 * walking past during a presentation.
 */
function BrandedSplash({ boardName, state, detail }: {
  boardName: string;
  state: 'loading' | 'error';
  detail?: string;
}) {
  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'radial-gradient(ellipse at 20% 10%, #1a1f3a 0%, #0a0f1c 60%, #050813 100%)',
      color: '#f1f5f9', fontFamily: 'var(--font-raleway, sans-serif)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 24, position: 'relative', overflow: 'hidden',
    }}>
      {/* Ambient glow */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at 50% 50%, rgba(99,102,241,0.18) 0%, transparent 60%)',
        animation: 'wb-celeb-burst 4s ease-out infinite',
      }} />

      {/* InsureTec wordmark */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: 'rgba(99,102,241,0.18)',
          border: '1.5px solid rgba(99,102,241,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="30" height="30" viewBox="0 0 28 28" fill="none">
            <rect x="2" y="4" width="24" height="16" rx="2.5" stroke="#a5b4fc" strokeWidth="1.8" fill="none" />
            <rect x="9.5" y="12" width="2.5" height="6" rx="0.5" fill="#a5b4fc" opacity="0.8" />
            <rect x="13.5" y="9"  width="2.5" height="9" rx="0.5" fill="#a5b4fc" />
            <rect x="17.5" y="11" width="2.5" height="7" rx="0.5" fill="#a5b4fc" opacity="0.8" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#64748b', letterSpacing: '0.25em', textTransform: 'uppercase' }}>InsureTec</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f1f5f9', marginTop: 2 }}>Wallboards</div>
        </div>
      </div>

      {/* Board name */}
      <div style={{ fontSize: 'clamp(18px, 1.6vw, 26px)', fontWeight: 600, color: '#94a3b8', position: 'relative', textAlign: 'center', padding: '0 24px' }}>
        {boardName}
      </div>

      {/* Status line */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        {state === 'loading' ? (
          <>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: '#a5b4fc',
              boxShadow: '0 0 12px rgba(99,102,241,0.7)',
              animation: 'wb-celeb-banner 1.4s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              Connecting to live data…
            </span>
          </>
        ) : (
          <div style={{ textAlign: 'center', maxWidth: 600, padding: '0 24px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              Couldn't reach the data source
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 8 }}>
              {detail || 'Retrying automatically — keep this screen on.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Clock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);
  return <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{time}</span>;
}

// ────────────────────────────────────────────────────────────────────────
//  Today strip — fast-moving daily race ranked by Income Today
// ────────────────────────────────────────────────────────────────────────

function TodayStrip({ rows, cols }: {
  rows: Row[];
  cols: { nameCol: string; incomeTodayCol: string; polTodayCol: string };
}) {
  // Track each booked agent's previous rank so we can flag climbers / droppers.
  const prevRef = useRef<Map<string, number>>(new Map());

  if (!cols.incomeTodayCol) return null;

  // Everyone on the board — booked today first (ranked by income), then
  // agents still at £0 so they can see themselves on the challenge and
  // know they need to get on the board.
  const allAgents = rows.map(r => ({
    name:     cleanName(String(r[cols.nameCol] ?? '')),
    income:   parseMoney(r[cols.incomeTodayCol]),
    policies: parseMoney(r[cols.polTodayCol]),
  })).filter(a => a.name);

  const booked = allAgents.filter(a => a.income > 0).sort((a, b) => b.income - a.income);
  const zeros  = allAgents.filter(a => a.income === 0).sort((a, b) => a.name.localeCompare(b.name));

  // Determine the unique "most units today" winner. If two or more
  // agents tie on the highest policy count, nobody is awarded — same
  // rule as the de-duplicated emoji accolades.
  const unitsLeaderName: string | null = (() => {
    let best = 0;
    let bestCount = 0;
    let bestName  = '';
    for (const a of booked) {
      if (a.policies > best) { best = a.policies; bestCount = 1; bestName = a.name; }
      else if (a.policies === best) bestCount++;
    }
    return best > 0 && bestCount === 1 ? bestName.toLowerCase() : null;
  })();

  // Snapshot ranks for booked agents so we can animate position changes
  const newPrev = new Map<string, number>();
  booked.forEach((a, i) => newPrev.set(a.name.toLowerCase(), i + 1));
  const oldRanks = prevRef.current;
  // Use a layout-effect-equivalent trick — we set after build so the
  // next render sees the snapshot we just produced.
  setTimeout(() => { prevRef.current = newPrev; }, 0);

  const headline = booked.length === 0
    ? 'No bookings yet today — first deal wins the spot'
    : `${booked.length} on the board · ${zeros.length} still to open`;

  return (
    <div style={{
      flexShrink: 0, padding: 'clamp(6px, 0.7vh, 10px) clamp(16px, 2.2vw, 36px) clamp(8px, 0.9vh, 12px)',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      background: 'rgba(10,15,28,0.55)', backdropFilter: 'blur(10px)',
      display: 'flex', flexDirection: 'column', gap: 'clamp(4px, 0.5vh, 8px)',
      position: 'relative', zIndex: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 'clamp(10px, 0.95vw, 14px)', fontWeight: 800,
          color: '#fbbf24', letterSpacing: '0.22em', textTransform: 'uppercase',
          flexShrink: 0,
        }}>🔥 Today's Earn &amp; Units</span>
        <span style={{ fontSize: 'clamp(10px, 0.85vw, 13px)', color: '#64748b', fontWeight: 600 }}>
          {headline}
        </span>
      </div>

      {/* Booked agents first — own wrapping row so they read as the
          "race in progress" group without being mixed in with zeros. */}
      <div style={{
        display: 'flex', flexWrap: 'wrap',
        gap: 'clamp(4px, 0.5vw, 8px) clamp(5px, 0.6vw, 10px)',
      }}>
        {booked.map((a, i) => {
          const rank = i + 1;
          const was  = oldRanks.get(a.name.toLowerCase());
          const climbed = was !== undefined && was > rank;
          const dropped = was !== undefined && was < rank;
          const isNew   = was === undefined;
          const isIncomeLeader = rank === 1;
          const isUnitsLeader  = unitsLeaderName === a.name.toLowerCase();
          // Income leader = gold tint (the prestige money slot)
          // Units leader  = teal/cyan tint (a distinct second crown so a
          // "high-volume seller" can stand out even when not on top of
          // the £ board). Skipped entirely if multiple agents tie on units.
          const tint = isIncomeLeader
            ? { bg: 'linear-gradient(90deg, rgba(251,191,36,0.22) 0%, rgba(251,191,36,0.08) 100%)',
                border: 'rgba(251,191,36,0.45)', glow: '0 0 14px rgba(251,191,36,0.28)',
                rankColor: '#fde68a', moneyColor: '#fde68a' }
            : isUnitsLeader
            ? { bg: 'linear-gradient(90deg, rgba(45,212,191,0.22) 0%, rgba(45,212,191,0.08) 100%)',
                border: 'rgba(45,212,191,0.5)', glow: '0 0 14px rgba(45,212,191,0.3)',
                rankColor: '#5eead4', moneyColor: '#a7f3d0' }
            : { bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.3)', glow: undefined,
                rankColor: '#a5b4fc', moneyColor: '#e2e8f0' };
          return (
            <div key={'b|' + a.name} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: 'clamp(3px, 0.4vh, 6px) clamp(7px, 0.8vw, 11px)',
              borderRadius: 99, flexShrink: 0,
              background: tint.bg,
              border: `1px solid ${tint.border}`,
              animation: climbed ? 'wb-row-up 1.2s ease-out' : dropped ? 'wb-row-down 1.2s ease-out' : undefined,
              boxShadow: tint.glow,
            }}>
              <span style={{ fontSize: 'clamp(10px, 0.9vw, 13px)', fontWeight: 800, color: tint.rankColor, fontVariantNumeric: 'tabular-nums' }}>
                #{rank}
              </span>
              <span style={{ fontSize: 'clamp(10px, 0.9vw, 14px)', fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap' }}>
                {a.name}
              </span>
              <span style={{ fontSize: 'clamp(10px, 0.95vw, 14px)', fontWeight: 800, color: tint.moneyColor, fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(a.income)}
              </span>
              {a.policies > 0 && (
                <span style={{
                  fontSize: 'clamp(9px, 0.75vw, 11px)', fontWeight: 700,
                  color: isUnitsLeader ? '#5eead4' : '#94a3b8',
                }}>
                  · {a.policies}{isUnitsLeader ? '★' : ''}
                </span>
              )}
              {climbed && was !== undefined && <span aria-hidden style={{ fontSize: 10, color: '#10b981', fontWeight: 800 }}>▲{was - rank}</span>}
              {dropped && was !== undefined && <span aria-hidden style={{ fontSize: 10, color: '#f87171', fontWeight: 800 }}>▼{rank - was}</span>}
              {isNew && <span aria-hidden style={{ fontSize: 10, color: '#fbbf24', fontWeight: 800 }}>NEW</span>}
            </div>
          );
        })}
      </div>

      {/* The headline above already says "X on the board · Y still to
          open" — the count is enough motivation, no need to list every
          £0 agent individually (saves vertical space for the actual
          race up top). */}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Podium — top 3 hero cards
// ────────────────────────────────────────────────────────────────────────

interface ColMap {
  nameCol: string;
  incomeMtdCol: string;
  polMtdCol: string;
  polTodayCol: string;
  incomeTodayCol: string;
  ippCol: string;
  gwpCol: string;
  addonsCol: string;
}

// Medal emojis associated with each rank — filtered out of the agent's own
// emoji shelf because the rank label "🥇 1st" already shows them and
// duplicating looked silly on the podium.
const RANK_MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

// Commission brackets — mirrors the Commission Tracker board's SQL. An
// agent's earn-MTD determines their current bracket; the card's progress
// bar shows how close they are to the next one.
const BRACKETS: Array<{ min: number; rate: number }> = [
  { min:     0, rate:  0 },
  { min: 25000, rate:  3 },
  { min: 30000, rate:  4 },
  { min: 35000, rate:  5 },
  { min: 40000, rate:  7 },
  { min: 50000, rate:  8 },
  { min: 60000, rate: 10 },
];

interface BracketState {
  current: { min: number; rate: number };
  next:    { min: number; rate: number } | null;
  /** 0–100 percent between current.min and next.min */
  pct:     number;
  /** £ remaining to hit the next threshold (0 when maxed) */
  toNext:  number;
}

function bracketFor(income: number): BracketState {
  // Find the highest bracket whose min <= income
  let idx = 0;
  for (let i = BRACKETS.length - 1; i >= 0; i--) {
    if (income >= BRACKETS[i].min) { idx = i; break; }
  }
  const current = BRACKETS[idx];
  const next    = BRACKETS[idx + 1] || null;
  if (!next) return { current, next: null, pct: 100, toNext: 0 };
  const span  = next.min - current.min;
  const pct   = Math.min(100, Math.max(0, ((income - current.min) / span) * 100));
  const toNext = Math.max(0, next.min - income);
  return { current, next, pct, toNext };
}

function Podium({ rows, cols }: { rows: Row[]; cols: ColMap }) {
  if (rows.length === 0) return null;

  // Re-arrange so #2 is left, #1 centre, #3 right. The leader is now
  // properly taller (1.0 vs 0.78/0.7) so a glance from across the room
  // reads "who's #1" without needing to compare numbers.
  const arranged: Array<{ row: Row; rank: number; height: number }> = [];
  if (rows[1]) arranged.push({ row: rows[1], rank: 2, height: 0.78 });
  if (rows[0]) arranged.push({ row: rows[0], rank: 1, height: 1.00 });
  if (rows[2]) arranged.push({ row: rows[2], rank: 3, height: 0.70 });

  return (
    <div style={{
      flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      gap: 'clamp(14px, 1.6vw, 32px)', padding: 'clamp(12px, 1.6vh, 22px) clamp(20px, 3vw, 60px) 0',
      position: 'relative', zIndex: 1, minHeight: '30vh', maxHeight: '34vh',
    }}>
      {arranged.map(({ row, rank, height }) => (
        <PodiumCard key={String(row[cols.nameCol])} row={row} rank={rank} heightPct={height} cols={cols} />
      ))}
    </div>
  );
}

function PodiumCard({ row, rank, heightPct, cols }: { row: Row; rank: number; heightPct: number; cols: ColMap }) {
  const rawName = String(row[cols.nameCol] ?? '');
  const name    = cleanName(rawName);
  // Filter the rank's own medal out of the shelf — the tier label up top
  // already shows it.
  const myMedal = RANK_MEDALS[rank];
  const emojis  = [...extractEmojis(rawName)].filter(e => e !== myMedal);
  const grad    = avatarColors(name);

  const incomeMtd = parseMoney(row[cols.incomeMtdCol]);
  const polMtd    = parseMoney(row[cols.polMtdCol]);
  const ipp       = parseMoney(row[cols.ippCol]);
  const gwp       = parseMoney(row[cols.gwpCol]);
  // addons currently unused on the trimmed podium — leave the column
  // detection in place so we can re-introduce the stat without rewiring.
  void cols.addonsCol;

  const tier = rank === 1 ? { ring: '#fde68a', ringGlow: 'rgba(251,191,36,0.6)', label: '🥇 1st', labelColor: '#fde68a' }
             : rank === 2 ? { ring: '#e5e7eb', ringGlow: 'rgba(229,231,235,0.45)', label: '🥈 2nd', labelColor: '#e5e7eb' }
             :              { ring: '#fdba74', ringGlow: 'rgba(253,186,116,0.45)', label: '🥉 3rd', labelColor: '#fdba74' };

  return (
    <div style={{
      flex: `1 1 0`, maxWidth: '24vw',
      height: `${heightPct * 100}%`,
      background: 'linear-gradient(180deg, rgba(26,33,54,0.85) 0%, rgba(14,20,39,0.85) 100%)',
      border: `2px solid ${tier.ring}`,
      borderRadius: 18, padding: 'clamp(10px, 1.1vh, 16px) clamp(12px, 1.4vw, 22px)',
      boxShadow: `0 0 60px ${tier.ringGlow}, 0 14px 40px rgba(0,0,0,0.55)`,
      backdropFilter: 'blur(14px)',
      display: 'grid',
      // Header row (tier label + avatar + name) | primary metric | stats | emojis
      gridTemplateColumns: '1fr',
      gridAutoRows: 'auto',
      alignContent: 'space-between',
      justifyItems: 'center',
      textAlign: 'center', position: 'relative', overflow: 'hidden',
      animation: rank === 1 ? 'wb-leader-pulse 3.2s ease-in-out infinite' : undefined,
    }}>
      {/* Tier label + avatar inline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={name} size={rank === 1 ? 'clamp(48px, 5vw, 78px)' : 'clamp(42px, 4.4vw, 66px)'} gradient={grad} />
        <div style={{
          fontSize: 'clamp(11px, 1vw, 18px)', fontWeight: 900,
          letterSpacing: '0.3em', color: tier.labelColor,
          textShadow: `0 0 18px ${tier.ringGlow}`,
          whiteSpace: 'nowrap',
        }}>{tier.label}</div>
      </div>

      {/* Name — never collapses */}
      <div style={{
        fontSize: rank === 1 ? 'clamp(20px, 2.1vw, 34px)' : 'clamp(17px, 1.8vw, 28px)',
        fontWeight: 900, color: '#f1f5f9',
        textShadow: '0 4px 20px rgba(0,0,0,0.5)', lineHeight: 1.1,
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flexShrink: 0, width: '100%',
      }}>{name}</div>

      {/* Primary metric */}
      <div>
        <div style={{
          fontSize: rank === 1 ? 'clamp(28px, 3.4vw, 60px)' : 'clamp(24px, 2.8vw, 44px)',
          fontWeight: 900, color: '#fde68a',
          textShadow: '0 0 30px rgba(251,191,36,0.35)',
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}>{formatMoney(incomeMtd)}</div>
        <div style={{ fontSize: 'clamp(8px, 0.75vw, 11px)', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: 3 }}>Income MTD</div>
      </div>

      {/* Compact stat row — MTD only. Today's leaderboard up top covers
          the daily race; the podium is about the month-long position. */}
      {(() => {
        const stats: Array<{ label: string; value: string }> = [];
        if (cols.polMtdCol)            stats.push({ label: 'Pols MTD', value: String(Math.round(polMtd)) });
        if (cols.ippCol  && ipp > 0)   stats.push({ label: 'IPP',      value: formatMoney(ipp) });
        if (cols.gwpCol  && gwp > 0)   stats.push({ label: 'GWP MTD',  value: formatMoney(gwp) });
        if (stats.length === 0) return null;
        return (
          <div style={{ display: 'flex', gap: 'clamp(10px, 1.2vw, 22px)', justifyContent: 'center', flexWrap: 'wrap' }}>
            {stats.map((s, i) => <Stat key={i} label={s.label} value={s.value} />)}
          </div>
        );
      })()}

      {/* Emoji shelf — compact */}
      {emojis.length > 0 && (
        <div style={{
          display: 'flex', gap: 3,
          fontSize: 'clamp(16px, 1.7vw, 28px)', flexWrap: 'wrap', justifyContent: 'center',
        }}>
          {emojis.map((e, i) => <span key={i}>{e}</span>)}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 'clamp(14px, 1.4vw, 22px)', fontWeight: 800, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 'clamp(9px, 0.8vw, 12px)', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
    </div>
  );
}

function Avatar({ name, size, gradient }: { name: string; size: string; gradient: { from: string; to: string } }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`,
      color: '#fff', fontWeight: 900,
      fontSize: `calc(${size} * 0.36)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 10px 30px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.2)',
      letterSpacing: '-0.04em', flexShrink: 0,
    }}>{initials(name)}</div>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Agent grid — rank 4+
// ────────────────────────────────────────────────────────────────────────

function AgentGrid({ rows, startIndex, cols, teamLeaderIncome }: {
  rows: Row[]; startIndex: number; cols: ColMap; teamLeaderIncome: number;
}) {
  // Give cards a firm minimum height so they can actually breathe — content
  // (avatar + big number + progress bar + emoji shelf) needs ~110px. The
  // inner grid scrolls when there are more agents than fit on the viewport,
  // but in practice we never scroll on a TV because the outer page hides
  // overflow; the important bit is that cards always render at the right
  // size rather than getting crushed to pill shapes.
  return (
    <div style={{
      flex: 1, minHeight: 0,
      padding: 'clamp(16px, 2vh, 28px) clamp(20px, 3vw, 60px) 0',
      overflowY: 'auto',
      position: 'relative', zIndex: 1,
      // Hide the scrollbar — TVs can't scroll anyway, this just prevents a
      // visible track.
      scrollbarWidth: 'none',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(200px, 19vw, 300px), 1fr))',
        gridAutoRows: 'minmax(clamp(104px, 13vh, 140px), auto)',
        gap: 'clamp(10px, 1.2vh, 16px)',
      }}>
        {rows.map((row, i) => (
          <AgentCard key={String(row[cols.nameCol])} row={row} rank={startIndex + i} cols={cols} leaderIncome={teamLeaderIncome} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ row, rank, cols, leaderIncome }: { row: Row; rank: number; cols: ColMap; leaderIncome: number }) {
  const rawName = String(row[cols.nameCol] ?? '');
  const name    = cleanName(rawName);
  const emojis  = [...extractEmojis(rawName)];
  const grad    = avatarColors(name);

  const incomeMtd     = parseMoney(row[cols.incomeMtdCol]);
  const polMtd        = parseMoney(row[cols.polMtdCol]);
  const ipp           = parseMoney(row[cols.ippCol]);
  const gwp           = parseMoney(row[cols.gwpCol]);
  const bracket       = bracketFor(incomeMtd);
  const progressPct   = bracket.pct;
  const maxed         = !bracket.next;

  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(26,33,54,0.55) 0%, rgba(14,20,39,0.55) 100%)',
      border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14,
      padding: 'clamp(8px, 1vh, 14px) clamp(10px, 1.1vw, 16px)',
      display: 'flex', flexDirection: 'column', gap: 5,
      overflow: 'hidden', position: 'relative',
      backdropFilter: 'blur(8px)',
    }}>
      {/* Top row: avatar + name + rank chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={name} size="clamp(30px, 2.8vw, 44px)" gradient={grad} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 'clamp(13px, 1.1vw, 18px)', fontWeight: 700, color: '#f1f5f9',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.15,
          }}>{name}</div>
          <div style={{ fontSize: 'clamp(9px, 0.75vw, 12px)', color: '#64748b', fontWeight: 700, letterSpacing: '0.08em' }}>#{rank}</div>
        </div>
      </div>

      {/* MTD-only main tile. Today's stats live in the linear leaderboard
          strip up top where their constant up/down movement makes more
          sense than crowding every card. */}
      <div>
        <div style={{ fontSize: 'clamp(20px, 2vw, 32px)', fontWeight: 900, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {formatMoney(incomeMtd)}
        </div>
        <div style={{ fontSize: 'clamp(8px, 0.7vw, 11px)', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 2 }}>
          Income MTD
        </div>
      </div>

      {/* Mini-stat row — pure cumulative breakdown */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 4,
        fontSize: 'clamp(9px, 0.85vw, 12px)', color: '#94a3b8',
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, flexWrap: 'wrap',
      }}>
        {cols.polMtdCol && <span><strong style={{ color: '#cbd5e1' }}>{Math.round(polMtd)}</strong> pols MTD</span>}
        {cols.ippCol    && ipp > 0 && <span><strong style={{ color: '#cbd5e1' }}>{formatMoney(ipp)}</strong> IPP</span>}
        {cols.gwpCol    && gwp > 0 && <span><strong style={{ color: '#cbd5e1' }}>{formatMoney(gwp)}</strong> GWP MTD</span>}
      </div>

      {/* Commission bracket progress — shows how close this agent is to the
          next rate tier. Maxed agents get a solid gold bar. */}
      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          fontSize: 'clamp(9px, 0.85vw, 12px)', fontWeight: 800,
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
          marginBottom: 3,
        }}>
          <span style={{ color: bracket.current.rate > 0 ? '#a5b4fc' : '#64748b' }}>
            {bracket.current.rate}%
          </span>
          <span style={{ color: '#64748b', fontWeight: 500, fontSize: '0.92em' }}>
            {maxed ? 'Max tier' : `${formatMoney(bracket.toNext)} to go`}
          </span>
          <span style={{ color: '#fde68a' }}>
            {maxed ? '🏆' : `${bracket.next!.rate}%`}
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden', position: 'relative' }}>
          <div style={{
            width: `${progressPct}%`, height: '100%',
            background: maxed
              ? 'linear-gradient(90deg, #fbbf24 0%, #fde68a 100%)'
              : 'linear-gradient(90deg, #6366f1 0%, #a855f7 55%, #fbbf24 100%)',
            boxShadow: maxed ? '0 0 14px rgba(251,191,36,0.55)' : undefined,
            transition: 'width 1s ease-out',
          }} />
        </div>
      </div>

      {/* Emoji shelf */}
      {emojis.length > 0 && (
        <div style={{
          display: 'flex', gap: 4, marginTop: 'auto',
          fontSize: 'clamp(14px, 1.3vw, 20px)',
          filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))',
        }}>
          {emojis.slice(0, 6).map((e, i) => <span key={i}>{e}</span>)}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Activity ticker — scrolls recent events at the bottom
// ────────────────────────────────────────────────────────────────────────

function ActivityTicker({ items }: { items: TickerItem[] }) {
  // When new items arrive, pin to the newest — gives live alerts an instant
  // moment on screen. Otherwise rotate through recent items every 5s.
  const [idx, setIdx] = useState(0);
  const len = items.length;
  const lastLen = useRef(0);
  useEffect(() => {
    if (len > lastLen.current && len > 0) setIdx(len - 1);   // snap to newest
    lastLen.current = len;
  }, [len]);
  useEffect(() => {
    if (len === 0) return;
    const iv = setInterval(() => setIdx(i => (i + 1) % Math.max(1, len)), 5_000);
    return () => clearInterval(iv);
  }, [len]);
  if (len === 0) {
    return (
      <div style={{
        flexShrink: 0, padding: 'clamp(10px, 1.2vh, 16px) clamp(20px, 3vw, 60px)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(10,15,28,0.6)', backdropFilter: 'blur(10px)',
        fontSize: 'clamp(12px, 1.1vw, 15px)', color: '#475569', fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase',
      }}>
        🛰️ Live · waiting for the next big move
      </div>
    );
  }
  const item = items[idx % len];
  return (
    <div style={{
      flexShrink: 0, padding: 'clamp(10px, 1.2vh, 16px) clamp(20px, 3vw, 60px)',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(10,15,28,0.7)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', gap: 14, overflow: 'hidden', position: 'relative', zIndex: 2,
    }}>
      <span style={{ fontSize: 'clamp(10px, 0.9vw, 13px)', fontWeight: 800, color: '#fbbf24', letterSpacing: '0.25em', textTransform: 'uppercase', flexShrink: 0 }}>
        Live
      </span>
      <span aria-hidden style={{
        width: 8, height: 8, borderRadius: '50%', background: '#ef4444',
        boxShadow: '0 0 12px rgba(239,68,68,0.8)', flexShrink: 0,
        animation: 'wb-celeb-banner 1.4s ease-in-out infinite',
      }} />
      <div key={item.id} style={{
        display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
        fontSize: 'clamp(14px, 1.4vw, 22px)', fontWeight: 600, color: '#e2e8f0',
        animation: 'wb-celeb-banner 5s ease-out',
      }}>
        <span style={{ fontSize: 'clamp(20px, 1.8vw, 28px)' }}>{item.emoji}</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.text}</span>
        {item.kind === 'alert' && item.source && (
          <span style={{
            marginLeft: 6, padding: '2px 8px', borderRadius: 99,
            background: 'rgba(99,102,241,0.22)', color: '#a5b4fc',
            fontSize: 'clamp(9px, 0.8vw, 12px)', fontWeight: 800, letterSpacing: '0.15em',
            textTransform: 'uppercase', flexShrink: 0,
          }}>{item.source}</span>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Auto-reload — same trick the kiosk uses
// ────────────────────────────────────────────────────────────────────────

function useAutoReloadOnDeploy() {
  useEffect(() => {
    let firstId: string | null = null;
    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        const { id } = await res.json();
        if (!id) return;
        if (firstId === null) { firstId = id; return; }
        if (id !== firstId) window.location.reload();
      } catch { /* ignore */ }
    };
    check();
    const iv = setInterval(check, 120_000);
    return () => clearInterval(iv);
  }, []);
}
