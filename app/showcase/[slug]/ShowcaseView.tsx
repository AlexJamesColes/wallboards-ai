'use client';

import { useEffect, useRef, useState } from 'react';
import type { WbBoard } from '@/lib/db';
import { extractEmojis, tokenize } from '@/lib/emoji';
import { CelebrationProvider, CelebrationCountdown } from '@/components/Celebration';

interface Props { board: WbBoard; widgetId: string; }

// ────────────────────────────────────────────────────────────────────────
//  Config + helpers
// ────────────────────────────────────────────────────────────────────────

const TEAM_TARGET_MTD = 500_000;     // £ target for the header banner
const POLL_MS         = 60_000;      // same cadence as widgets

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

function useTimeTicker(periodMs: number): number {
  const [, setT] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setT(t => t + 1), periodMs);
    return () => clearInterval(iv);
  }, [periodMs]);
  return 0;
}

// ────────────────────────────────────────────────────────────────────────
//  Main view
// ────────────────────────────────────────────────────────────────────────

export default function ShowcaseView({ board, widgetId }: Props) {
  const [data, setData]       = useState<WidgetData | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const prevRef               = useRef<Map<string, Snapshot>>(new Map());
  const [tickerItems, setTicker] = useState<TickerItem[]>([]);
  useTimeTicker(1000);                // drive the countdown re-render
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

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0f1c', color: '#f87171',
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        Could not load wallboard data: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0f1c', color: '#94a3b8',
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        Loading…
      </div>
    );
  }

  // Decode columns for this board
  const cols         = data.columns;
  const nameCol      = cols[0] || 'name';
  const incomeMtdCol = cols.find(c => /^income$|income.*mtd|mtd.*income/i.test(c)) || cols.find(c => /income/i.test(c)) || '';
  const polMtdCol    = cols.find(c => /^policies.*mtd|mtd.*polic/i.test(c))        || '';
  const polTodayCol  = cols.find(c => /polic.*today|today.*polic/i.test(c))         || '';
  const incomeTodayCol = cols.find(c => /income.*today|today.*income/i.test(c))     || '';

  // Sort by income MTD desc (same order as the SQL sent us, but enforce it)
  const sortedRows = [...data.rows].sort((a, b) => parseMoney(b[incomeMtdCol]) - parseMoney(a[incomeMtdCol]));

  const teamTotal   = sortedRows.reduce((s, r) => s + parseMoney(r[incomeMtdCol]), 0);
  const targetPct   = Math.min(100, Math.round((teamTotal / TEAM_TARGET_MTD) * 100));

  const top3 = sortedRows.slice(0, 3);
  const rest = sortedRows.slice(3);

  return (
    <CelebrationProvider intervalMs={300_000}>
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
        <Header boardName={board.name} teamTotal={teamTotal} targetPct={targetPct} />

        {/* ── Podium ───────────────────────────────────────────────── */}
        <Podium
          rows={top3}
          cols={{ nameCol, incomeMtdCol, polMtdCol, polTodayCol, incomeTodayCol }}
        />

        {/* ── Rest of the pack ────────────────────────────────────── */}
        <AgentGrid
          rows={rest}
          startIndex={4}
          cols={{ nameCol, incomeMtdCol, polMtdCol, polTodayCol, incomeTodayCol }}
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

function Header({ boardName, teamTotal, targetPct }: {
  boardName: string; teamTotal: number; targetPct: number;
}) {
  const now       = new Date();
  const endOfDay  = new Date(now);
  endOfDay.setHours(18, 0, 0, 0);                                // 6 PM close
  const msLeft    = Math.max(0, endOfDay.getTime() - now.getTime());
  const hrsLeft   = Math.floor(msLeft / 3_600_000);
  const minsLeft  = Math.floor((msLeft % 3_600_000) / 60_000);
  const isUrgent  = msLeft > 0 && msLeft < 3_600_000;            // under an hour

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 24,
      padding: 'clamp(12px, 1.6vh, 22px) clamp(20px, 2vw, 40px)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(10,15,28,0.5)', backdropFilter: 'blur(12px)',
      flexShrink: 0, zIndex: 2,
    }}>
      {/* Board name */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 'clamp(10px, 0.9vw, 14px)', fontWeight: 700, color: '#64748b', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Live Wallboard
        </div>
        <div style={{ fontSize: 'clamp(18px, 1.8vw, 28px)', fontWeight: 800, color: '#f1f5f9', marginTop: 2 }}>
          {boardName}
        </div>
      </div>

      {/* Team target progress bar */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 'clamp(11px, 1vw, 15px)', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Team · this month</span>
          <span style={{ fontSize: 'clamp(18px, 2vw, 32px)', fontWeight: 900, color: '#fde68a', fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(teamTotal)}
          </span>
          <span style={{ fontSize: 'clamp(12px, 1.1vw, 16px)', color: '#64748b' }}>of {formatMoney(TEAM_TARGET_MTD)}</span>
          <span style={{ marginLeft: 'auto', fontSize: 'clamp(14px, 1.5vw, 22px)', fontWeight: 800, color: targetPct >= 100 ? '#10b981' : '#a5b4fc' }}>
            {targetPct}%
          </span>
        </div>
        <div style={{
          height: 'clamp(10px, 1.3vh, 18px)', borderRadius: 99,
          background: 'rgba(255,255,255,0.06)', overflow: 'hidden', position: 'relative',
        }}>
          <div style={{
            width: `${targetPct}%`, height: '100%',
            background: targetPct >= 100
              ? 'linear-gradient(90deg, #10b981 0%, #34d399 50%, #fbbf24 100%)'
              : 'linear-gradient(90deg, #6366f1 0%, #a855f7 50%, #fbbf24 100%)',
            boxShadow: '0 0 20px rgba(251,191,36,0.35)',
            transition: 'width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }} />
        </div>
      </div>

      {/* Countdown + clock */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{
          fontSize: 'clamp(10px, 0.9vw, 14px)', fontWeight: 700,
          color: isUrgent ? '#fbbf24' : '#64748b', letterSpacing: '0.2em', textTransform: 'uppercase',
          animation: isUrgent ? 'wb-celeb-banner 1.2s ease-in-out infinite' : undefined,
        }}>
          {msLeft === 0 ? 'Closed' : 'Time left today'}
        </div>
        <div style={{ fontSize: 'clamp(18px, 1.8vw, 28px)', fontWeight: 900, color: isUrgent ? '#fbbf24' : '#f1f5f9', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
          {msLeft === 0 ? '—' : `${hrsLeft}h ${String(minsLeft).padStart(2, '0')}m`}
        </div>
        <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <CelebrationCountdown />
          <Clock />
        </div>
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
//  Podium — top 3 hero cards
// ────────────────────────────────────────────────────────────────────────

interface ColMap {
  nameCol: string;
  incomeMtdCol: string;
  polMtdCol: string;
  polTodayCol: string;
  incomeTodayCol: string;
}

function Podium({ rows, cols }: { rows: Row[]; cols: ColMap }) {
  if (rows.length === 0) return null;

  // Re-arrange so #2 is left, #1 centre, #3 right
  const arranged: Array<{ row: Row; rank: number; height: number }> = [];
  if (rows[1]) arranged.push({ row: rows[1], rank: 2, height: 0.82 });
  if (rows[0]) arranged.push({ row: rows[0], rank: 1, height: 1.00 });
  if (rows[2]) arranged.push({ row: rows[2], rank: 3, height: 0.70 });

  return (
    <div style={{
      flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      gap: 'clamp(16px, 2vw, 40px)', padding: 'clamp(16px, 2.5vh, 32px) clamp(20px, 3vw, 60px) 0',
      position: 'relative', zIndex: 1, minHeight: '42vh',
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
  const emojis  = [...extractEmojis(rawName)];
  const grad    = avatarColors(name);

  const incomeMtd  = parseMoney(row[cols.incomeMtdCol]);
  const polMtd     = parseMoney(row[cols.polMtdCol]);
  const incomeTodayV = parseMoney(row[cols.incomeTodayCol]);

  const tier = rank === 1 ? { ring: '#fde68a', ringGlow: 'rgba(251,191,36,0.6)', label: '🥇 1st', labelColor: '#fde68a' }
             : rank === 2 ? { ring: '#e5e7eb', ringGlow: 'rgba(229,231,235,0.45)', label: '🥈 2nd', labelColor: '#e5e7eb' }
             :              { ring: '#fdba74', ringGlow: 'rgba(253,186,116,0.45)', label: '🥉 3rd', labelColor: '#fdba74' };

  return (
    <div style={{
      flex: `1 1 0`, maxWidth: '28vw',
      height: `${heightPct * 100}%`,
      background: 'linear-gradient(180deg, rgba(26,33,54,0.85) 0%, rgba(14,20,39,0.85) 100%)',
      border: `2px solid ${tier.ring}`,
      borderRadius: 22, padding: 'clamp(14px, 1.8vh, 22px) clamp(14px, 1.6vw, 26px)',
      boxShadow: `0 0 60px ${tier.ringGlow}, 0 20px 60px rgba(0,0,0,0.55)`,
      backdropFilter: 'blur(14px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      textAlign: 'center', position: 'relative', overflow: 'hidden',
      animation: rank === 1 ? 'wb-leader-pulse 3.2s ease-in-out infinite' : undefined,
    }}>
      {/* Tier label */}
      <div style={{
        fontSize: 'clamp(14px, 1.3vw, 22px)', fontWeight: 900,
        letterSpacing: '0.3em', color: tier.labelColor,
        textShadow: `0 0 18px ${tier.ringGlow}`,
        marginBottom: 'clamp(8px, 1.2vh, 18px)', whiteSpace: 'nowrap',
      }}>{tier.label}</div>

      {/* Avatar */}
      <Avatar name={name} size={rank === 1 ? 'clamp(80px, 9vw, 148px)' : 'clamp(62px, 7vw, 116px)'} gradient={grad} />

      {/* Name */}
      <div style={{
        fontSize: rank === 1 ? 'clamp(22px, 2.4vw, 40px)' : 'clamp(18px, 2vw, 32px)',
        fontWeight: 900, color: '#f1f5f9', marginTop: 'clamp(10px, 1.4vh, 18px)',
        textShadow: '0 4px 20px rgba(0,0,0,0.5)', lineHeight: 1.1,
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{name}</div>

      {/* Primary metric */}
      <div style={{
        fontSize: rank === 1 ? 'clamp(36px, 4.5vw, 80px)' : 'clamp(28px, 3.6vw, 56px)',
        fontWeight: 900, color: '#fde68a',
        textShadow: '0 0 30px rgba(251,191,36,0.35)',
        fontVariantNumeric: 'tabular-nums', lineHeight: 1, marginTop: 'clamp(6px, 1vh, 14px)',
      }}>{formatMoney(incomeMtd)}</div>
      <div style={{ fontSize: 'clamp(10px, 0.95vw, 14px)', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 2 }}>Income this month</div>

      {/* Secondary stats */}
      <div style={{
        display: 'flex', gap: 'clamp(12px, 1.4vw, 24px)', marginTop: 'clamp(8px, 1.2vh, 14px)',
        opacity: 0.85,
      }}>
        <Stat label="Policies MTD" value={String(Math.round(polMtd))} />
        <Stat label="Income Today" value={formatMoney(incomeTodayV)} />
      </div>

      {/* Emoji shelf */}
      {emojis.length > 0 && (
        <div style={{
          display: 'flex', gap: 6, marginTop: 'auto',
          paddingTop: 'clamp(8px, 1.2vh, 14px)',
          fontSize: 'clamp(24px, 2.6vw, 44px)', flexWrap: 'wrap', justifyContent: 'center',
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
  return (
    <div style={{
      flex: 1, minHeight: 0, padding: 'clamp(16px, 2vh, 28px) clamp(20px, 3vw, 60px) 0',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(200px, 19vw, 300px), 1fr))',
      gridAutoRows: 'minmax(0, 1fr)',
      gap: 'clamp(10px, 1.2vh, 16px)',
      overflow: 'hidden', position: 'relative', zIndex: 1,
    }}>
      {rows.map((row, i) => (
        <AgentCard key={String(row[cols.nameCol])} row={row} rank={startIndex + i} cols={cols} leaderIncome={teamLeaderIncome} />
      ))}
    </div>
  );
}

function AgentCard({ row, rank, cols, leaderIncome }: { row: Row; rank: number; cols: ColMap; leaderIncome: number }) {
  const rawName = String(row[cols.nameCol] ?? '');
  const name    = cleanName(rawName);
  const emojis  = [...extractEmojis(rawName)];
  const grad    = avatarColors(name);

  const incomeMtd   = parseMoney(row[cols.incomeMtdCol]);
  const polToday    = parseMoney(row[cols.polTodayCol]);
  const progressPct = Math.min(100, Math.round((incomeMtd / leaderIncome) * 100));

  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(26,33,54,0.55) 0%, rgba(14,20,39,0.55) 100%)',
      border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14,
      padding: 'clamp(10px, 1.2vh, 16px) clamp(12px, 1.2vw, 18px)',
      display: 'flex', flexDirection: 'column', gap: 6,
      overflow: 'hidden', position: 'relative',
      backdropFilter: 'blur(8px)',
    }}>
      {/* Top row: avatar + name + rank chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={name} size="clamp(32px, 3vw, 46px)" gradient={grad} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 'clamp(13px, 1.1vw, 18px)', fontWeight: 700, color: '#f1f5f9',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.15,
          }}>{name}</div>
          <div style={{ fontSize: 'clamp(9px, 0.75vw, 12px)', color: '#64748b', fontWeight: 700, letterSpacing: '0.08em' }}>#{rank}</div>
        </div>
      </div>

      {/* Primary number */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 'clamp(20px, 2vw, 32px)', fontWeight: 900, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {formatMoney(incomeMtd)}
        </span>
        <span style={{ fontSize: 'clamp(11px, 1vw, 15px)', color: polToday > 0 ? '#a5b4fc' : '#64748b', fontWeight: 700 }}>
          {polToday > 0 ? `+${polToday} today` : '—'}
        </span>
      </div>

      {/* Progress bar vs leader */}
      <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
        <div style={{
          width: `${progressPct}%`, height: '100%',
          background: 'linear-gradient(90deg, #6366f1 0%, #a855f7 100%)',
          transition: 'width 1s ease-out',
        }} />
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
        🛰️ Watching the floor…
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
