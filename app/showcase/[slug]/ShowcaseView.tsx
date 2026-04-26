'use client';

import { useEffect, useRef, useState } from 'react';
import type { WbBoard } from '@/lib/db';
import { extractEmojis, tokenize } from '@/lib/emoji';
import { CelebrationProvider, CelebrationCountdown, CelebrationRegistrar } from '@/components/Celebration';
import { openingHoursFor as openingHoursForLib } from '@/lib/tradingHours';

interface Props {
  board:          WbBoard;
  /** Showcase slug — drives /api/board-data/<slug> and /api/baselines/<slug>.
   *  Same value as board.slug for widget-backed boards; for synthetic
   *  combined boards (e.g. sales-group) it's the only routing key. */
  slug:           string;
  /** Optional per-board target override (combined boards have a much
   *  bigger one). Falls through to DEFAULT_TEAM_TARGET. URL `?target=`
   *  still wins above either. */
  defaultTarget?: number;
}

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
  // Exact pounds with thousands separators — no k/M abbreviation. The
  // sales floor wants to see what they've actually written, not a rounded
  // headline (£49,512 reads very differently from £49.5k when you're 12
  // quid off a milestone).
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
  /** Latest policy reference issued by this agent (e.g. 'D12345-1').
   *  Optional — only populated if the source SQL exposes the column.
   *  When the value differs from the prior snapshot, we treat that as
   *  the ref for the deal that landed in this poll window. */
  latestPolicyRef?: string;
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

/** Ephemeral "agent's income just changed by £X" event. Pushed into state
 *  whenever the data poll detects a non-zero diff and consumed by the
 *  agent's card to render a floating +£X / −£X badge. Auto-cleaned after
 *  the animation finishes so old events don't pile up. */
interface CardDelta {
  id:        string;            // unique per event
  agentKey:  string;            // normalised agent name → matches a card
  amount:    number;            // signed £ delta (positive = earn, negative = drop)
  at:        number;            // createdAt ms
  /** Latest policy reference at the moment the delta fired (optional).
   *  When the source SQL exposes a `latest_policy_ref` column we tag the
   *  chip with the actual ref so the floor sees "+£300 D12345-1" instead
   *  of an anonymous amount. */
  policyRef?: string;
}

/** How long a delta badge / glow stays on screen. Match wb-delta-rise +
 *  wb-card-pulse-* durations in globals.css. */
const DELTA_TTL_MS = 4_000;

/** Same name normalisation used for the snapshot map and delta lookups —
 *  emoji-stripped, lowercase, single-space trimmed so "Joe Bloggs 🍪"
 *  and "joe  bloggs" hash to the same card. */
function agentKey(rawName: string): string {
  return String(rawName ?? '')
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}(?:️)?/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
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
 *
 * Default is 0.7. Override per TV with ?zoom=0.85 / ?zoom=1 / etc.
 *
 * Implementation: <ZoomWrap> wraps the whole showcase in a scaling box.
 * The inner box is sized to (100/z)vw × (100/z)vh and then transformed
 * with scale(z) from the top-left, so the visible area equals one
 * viewport but the layout thinks it has more space — the agent grid
 * naturally packs more cards. (CSS `zoom` does NOT work reliably here
 * because vw/vh don't update with the property — content overflows
 * the viewport, exactly the problem we were seeing.)
 */
const DEFAULT_ZOOM = 0.7;

function readZoom(): number {
  if (typeof window === 'undefined') return 1;
  const q = new URLSearchParams(window.location.search).get('zoom');
  if (q !== null && Number.isFinite(Number(q)) && Number(q) > 0) return Number(q);
  // Phone viewports already have very little room — scaling them down with
  // the TV-targeted 0.7 default crushes the podium and packs cards into a
  // hard-to-read pair of columns. Real viewport (zoom 1) on mobile.
  // ?mode=mobile lets a laptop preview the same path. ?mode=desktop forces
  // the TV layout. Explicit ?zoom= above always wins.
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'mobile') return 1;
  if (mode === 'desktop') return DEFAULT_ZOOM;
  if (window.innerWidth < 768) return 1;
  return DEFAULT_ZOOM;
}

function ZoomWrap({ children }: { children: React.ReactNode }) {
  const [z, setZ] = useState<number>(1);
  useEffect(() => { setZ(readZoom()); }, []);
  if (z === 1) return <>{children}</>;
  const inv = 100 / z;
  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: '#0a0f1c',
    }}>
      <div style={{
        width:  `${inv}vw`,
        height: `${inv}vh`,
        transform: `scale(${z})`,
        transformOrigin: 'top left',
      }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Live-tracking phone viewport flag. < 768px = mobile. Honours the
 * ?mode=mobile|desktop URL override the directory uses for previews.
 * Showcase scales the podium and pill bar around this — the TV layout
 * stays untouched.
 */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const force = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('mode')
      : null;
    if (force === 'mobile')  { setMobile(true);  return; }
    if (force === 'desktop') { setMobile(false); return; }
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}

/**
 * Team income target — read from the URL's ?target= query param, otherwise
 * the compile-time default. Lets individual TVs show different targets
 * (e.g. the London wallboard shows the London-only split of the combined
 * L+G budget) without a redeploy.
 */
function useTeamTarget(fallback: number): number {
  const [val, setVal] = useState<number>(fallback);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('target');
    const n = q ? Number(q) : NaN;
    if (Number.isFinite(n) && n > 0) setVal(n);
    else setVal(fallback);
  }, [fallback]);
  return val;
}

// ────────────────────────────────────────────────────────────────────────
//  Main view
// ────────────────────────────────────────────────────────────────────────

export default function ShowcaseView({ board, slug, defaultTarget }: Props) {
  const [data, setData]       = useState<WidgetData | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const prevRef               = useRef<Map<string, Snapshot>>(new Map());
  const [tickerItems, setTicker] = useState<TickerItem[]>([]);
  const [cardDeltas, setCardDeltas] = useState<CardDelta[]>([]);
  const teamTarget            = useTeamTarget(defaultTarget ?? DEFAULT_TEAM_TARGET);
  // Opt-out per board — display_config.laziest_manager === false skips
  // the slide. Guildford uses this so only the London board mocks the
  // managers (since the Zendesk update count is global to a person, not
  // tied to which office's wallboard you're looking at).
  const allowLaziest          = ((board.display_config as any) || {}).laziest_manager !== false;
  const laziestSlideRaw       = useLaziestManagerSlide();
  const laziestSlide          = allowLaziest ? laziestSlideRaw : [];
  const isMobile              = useIsMobile();
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

  // Poll the unified showcase data endpoint. Resolves to either the
  // board's leaderboard widget (widget-backed boards) or the merged
  // rows from a combined board's source slugs.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const fetchIt = async () => {
      try {
        const res = await fetch(`/api/board-data/${encodeURIComponent(slug)}`, { cache: 'no-store' });
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
  }, [slug]);

  // Detect changes between renders → ticker events
  useEffect(() => {
    if (!data) return;

    const cols       = data.columns;
    const nameCol    = cols[0] || 'name';
    const incomeCol  = cols.find(c => /income.*mtd|mtd.*income/i.test(c)) || cols.find(c => /income/i.test(c)) || '';
    const polCol     = cols.find(c => /policies.*today|today.*policies/i.test(c)) || cols.find(c => /policies/i.test(c)) || '';
    // Optional column — when the source SQL exposes the agent's most
    // recently-issued policy reference, we surface it on the delta chip
    // so a deal pop reads "+£300 D12345-1" instead of an anonymous £.
    // Match common naming patterns; first match wins.
    const policyRefCol = cols.find(c => /^policy.?ref|^pol.?ref|latest.*pol|latest.*ref|recent.*pol|recent.*ref/i.test(c)) || '';

    const current = new Map<string, Snapshot>();
    data.rows.forEach((r, i) => {
      const key = String(r[nameCol] ?? '').toLowerCase().replace(/\p{Extended_Pictographic}(?:\uFE0F)?/gu, '').trim();
      if (!key) return;
      const refRaw = policyRefCol ? r[policyRefCol] : undefined;
      current.set(key, {
        rank:     i + 1,
        emojis:   extractEmojis(String(r[nameCol] ?? '')),
        income:   parseMoney(r[incomeCol]),
        policies: parseMoney(r[polCol]),
        latestPolicyRef: refRaw != null && String(refRaw).trim() !== '' ? String(refRaw).trim() : undefined,
      });
    });

    const prev = prevRef.current;
    if (prev.size > 0) {
      const newItems:  TickerItem[] = [];
      const newDeltas: CardDelta[]  = [];
      const now = Date.now();
      for (const [key, cur] of current) {
        const was = prev.get(key);
        if (!was) continue;
        const displayName = cleanName(String(data.rows[cur.rank - 1]?.[nameCol] ?? key));

        // Per-card delta — fires on any income change ≥ £1 so the card
        // itself shows a "+£X" / "−£X" floater + tinted glow. The £1
        // floor filters float-noise (49512.5 vs 49512.4 between polls)
        // without hiding any real deal — even a £100 add-on still pops.
        const incomeDelta = cur.income - was.income;
        // Attach the policy ref only when (a) the column exists,
        // (b) the income went up (an actual new deal — refunds don't
        // get tagged with the latest deal's ref, that'd be misleading),
        // and (c) the ref actually changed since last poll. If the
        // ref is unchanged, this is likely a re-quoted figure on an
        // existing deal rather than a new one.
        const refChanged = !!cur.latestPolicyRef && cur.latestPolicyRef !== was.latestPolicyRef;
        const newDealRef = incomeDelta > 0 && refChanged ? cur.latestPolicyRef : undefined;
        if (Math.abs(incomeDelta) >= 1) {
          newDeltas.push({
            id:        `${key}-${now}-${incomeDelta}`,
            agentKey:  key,
            amount:    incomeDelta,
            at:        now,
            policyRef: newDealRef,
          });
        }

        // Ticker — high-fidelity "deal landed" event whenever we know
        // the policy ref. Always wins over the legacy "just added £X"
        // milestone line (covered below) because the ref + agent + £
        // is what the floor actually wants to read.
        if (newDealRef && incomeDelta > 0) {
          newItems.push({
            id:    `${key}-deal-${newDealRef}-${now}`,
            kind:  'milestone',
            emoji: '💸',
            text:  `${displayName} · ${newDealRef} · +${formatMoney(incomeDelta)}`,
            at:    now,
          });
        }

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
        // New emojis — read out the human label for the award rather
        // than echoing the emoji itself in the text (avoids the "🔥
        // Connor Bain just earned 🔥" duplication; the leading icon
        // is already the emoji).
        for (const e of cur.emojis) {
          if (!was.emojis.has(e)) {
            const award = EMOJI_LABELS[e];
            newItems.push({
              id: `${key}-emoji-${e}-${now}`,
              kind: 'emoji',
              emoji: e,
              text: award
                ? `${displayName} just earned ${award}`
                : `${displayName} just earned a new accolade`,
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
        // Big income jump (£1k+) — fallback when we don't have a ref
        // for the deal (boards that haven't added the policy_ref column
        // yet). Skipped if the deal event above already covered it so
        // the same booking doesn't fire two ticker lines.
        if (!newDealRef && cur.income - was.income >= 1000) {
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
      if (newDeltas.length) {
        setCardDeltas(d => [...d, ...newDeltas]);
      }
    }
    prevRef.current = current;
  }, [data]);

  // Drop expired card-delta events. Run only while there's something
  // active so we're not setting state on a 1s tick when the floor is
  // quiet.
  useEffect(() => {
    if (cardDeltas.length === 0) return;
    const iv = setInterval(() => {
      setCardDeltas(d => {
        const cutoff = Date.now() - DELTA_TTL_MS;
        return d.filter(e => e.at >= cutoff);
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [cardDeltas.length]);

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
    <ZoomWrap>
    <CelebrationProvider intervalMs={3_600_000} extraAgents={laziestSlide}>
      {/* Push the showcase agents into the celebration context so the Hall
          of Fame has real candidates (the bespoke showcase doesn't render a
          TableWidget, so without this only Hugo would ever appear). */}
      <CelebrationRegistrar
        widgetId={`board:${slug}`}
        rows={sortedRows}
        nameCol={nameCol}
        statCols={[
          { col: incomeMtdCol,   label: 'Income MTD',    format: (v: any) => formatMoney(parseMoney(v)) },
          { col: polMtdCol,      label: 'Policies MTD',  format: (v: any) => String(Math.round(parseMoney(v))) },
          { col: incomeTodayCol, label: 'Income Today',  format: (v: any) => formatMoney(parseMoney(v)) },
        ].filter(s => s.col)}
      />
      <div style={{
        // TV: fill the ZoomWrap inner box (100/z vw × 100/z vh) and clip
        // overflow — wallboards never scroll. Mobile: let the document
        // scroll naturally so a phone can swipe through the whole agent
        // list (iOS Safari is unreliable about nested overflow:auto, so
        // we drop the constraint instead of relying on the inner grid's
        // own scroller).
        width: '100%',
        height: isMobile ? 'auto' : '100%',
        minHeight: isMobile ? '100vh' : undefined,
        background: 'radial-gradient(ellipse at 20% 10%, #1a1f3a 0%, #0a0f1c 60%, #050813 100%)',
        color: '#f1f5f9',
        overflow: isMobile ? 'visible' : 'hidden',
        fontFamily: 'var(--font-raleway, sans-serif)',
        display: 'flex', flexDirection: 'column', position: 'relative',
      }}>
        {/* Ambient glows in the background */}
        <div aria-hidden style={{ position: 'absolute', top: '-10%', left: '-5%', width: '40vw', height: '40vw', background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 60%)', pointerEvents: 'none' }} />
        <div aria-hidden style={{ position: 'absolute', bottom: '-20%', right: '-10%', width: '50vw', height: '50vw', background: 'radial-gradient(circle, rgba(168,85,247,0.10) 0%, transparent 60%)', pointerEvents: 'none' }} />

        {/* ── Header ───────────────────────────────────────────────── */}
        <Header boardName={board.name} teamTotal={teamTotal} target={teamTarget} targetPct={targetPct} isMobile={isMobile} />

        {/* ── Today's leaderboard strip — fast-moving daily race ────── */}
        <TodayStrip
          rows={sortedRows}
          cols={{ nameCol, incomeTodayCol, polTodayCol }}
          isMobile={isMobile}
          boardSlug={slug}
        />

        {/* ── Podium (MTD position) ────────────────────────────────── */}
        <Podium
          rows={top3}
          cols={{ nameCol, incomeMtdCol, polMtdCol, polTodayCol, incomeTodayCol, ippCol, gwpCol, addonsCol }}
          isMobile={isMobile}
          deltas={cardDeltas}
        />

        {/* ── Rest of the pack ────────────────────────────────────── */}
        <AgentGrid
          rows={rest}
          startIndex={4}
          cols={{ nameCol, incomeMtdCol, polMtdCol, polTodayCol, incomeTodayCol, ippCol, gwpCol, addonsCol }}
          teamLeaderIncome={parseMoney(top3[0]?.[incomeMtdCol]) || 1}
          isMobile={isMobile}
          deltas={cardDeltas}
        />

        {/* ── Bottom toolbar ──────────────────────────────────────── */}
        {/*    Latest deal on the left, OCBL/BISL stock-style ticker on
                the right. Stacks on mobile so each strip stays readable. */}
        <BottomToolbar items={tickerItems} isMobile={isMobile} />
      </div>
    </CelebrationProvider>
    </ZoomWrap>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Header with team target + countdown
// ────────────────────────────────────────────────────────────────────────

function Header({ boardName, teamTotal, target, targetPct, isMobile }: {
  boardName: string; teamTotal: number; target: number; targetPct: number; isMobile: boolean;
}) {
  // Mobile: stack to two rows. The TV layout fits everything on one row
  // because there's plenty of horizontal space; phones don't.
  // Row 1 → board name + countdown
  // Row 2 → team target progress
  if (isMobile) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(10,15,28,0.5)', backdropFilter: 'blur(12px)',
        flexShrink: 0, zIndex: 2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {boardName}
          </div>
          <DayCountdown />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Team · MTD</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: '#fde68a', fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(teamTotal)}
            </span>
            <span style={{ fontSize: 11, color: '#64748b' }}>of {formatMoney(target)}</span>
            <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: targetPct >= 100 ? '#10b981' : '#a5b4fc' }}>
              {targetPct}%
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
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
      </div>
    );
  }

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

/** Re-exposed under the local name the rest of this file already uses;
 *  the canonical definition lives in lib/tradingHours so the celebration
 *  component (and anything else server-side) can share it. */
const openingHoursFor = openingHoursForLib;

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
    // Promote the reopen time to the prominent "value" slot — that's
    // what someone glancing at the screen actually wants to know. Drop
    // the emoji so it doesn't collide visually with the celebration
    // award icons elsewhere on the board.
    if (next) {
      label = `Closed · reopens ${next.dayLabel}`;
      value = fmtTime(openingHoursFor(next.at.getDay()).openH, openingHoursFor(next.at.getDay()).openM);
    } else {
      label = 'Closed';
      value = '';
    }
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

function TodayStrip({ rows, cols, isMobile, boardSlug }: {
  rows: Row[];
  cols: { nameCol: string; incomeTodayCol: string; polTodayCol: string };
  isMobile: boolean;
  /** Public board slug (e.g. 'london-agents'). Drives the server-side
   *  baseline lookup so every device shares the same ▲N/▼N anchor — the
   *  rank an agent was at when their first booking landed today, agreed
   *  across all TVs. Null = baselines disabled (no chip). */
  boardSlug: string | null;
}) {
  // prevRef — rank at the last poll. Drives the green/red row flash
  // animation in the moment a position changes (separate from the
  // baseline-derived persistent chip).
  const prevRef = useRef<Map<string, number>>(new Map());
  // baselines — server-side map of "first-observed rank today" keyed by
  // agent name. Refreshed each data poll via /api/baselines/<slug>; the
  // POST is dedupe-safe (ON CONFLICT DO NOTHING) so any TV that joins
  // late just reads the canonical baselines without overwriting them.
  const [baselines, setBaselines] = useState<Record<string, number>>({});

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
  const oldRanks  = prevRef.current;

  // Sync today's baselines with the server. POST current ranks so the
  // server seeds any agents not yet recorded for today (ON CONFLICT DO
  // NOTHING — first observation wins across all TVs); reads back the
  // canonical day's map. Build a stable signature for the deps array
  // so this only fires when the booked roster or rank order actually
  // changes, not on every parent re-render.
  const bookedSignature = booked.map(a => `${a.name.toLowerCase()}@${newPrev.get(a.name.toLowerCase())}`).join('|');
  useEffect(() => {
    if (!boardSlug) return;
    if (booked.length === 0) return;
    const entries = booked.map((a, i) => ({
      agent_key: a.name.toLowerCase(),
      rank:      i + 1,
    }));
    let cancelled = false;
    fetch(`/api/baselines/${encodeURIComponent(boardSlug)}`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ entries }),
      cache:   'no-store',
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        if (d && d.baselines && typeof d.baselines === 'object') {
          setBaselines(d.baselines);
        }
      })
      .catch(() => { /* keep last known on transient errors */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardSlug, bookedSignature]);
  // Use a layout-effect-equivalent trick — we set after build so the
  // next render sees the snapshot we just produced.
  setTimeout(() => { prevRef.current = newPrev; }, 0);

  const headline = booked.length === 0
    ? 'No bookings yet today — first deal wins the spot'
    : `${booked.length} on the board · ${zeros.length} still to open`;

  return (
    <div style={{
      flexShrink: 0,
      padding: isMobile ? '8px 14px 10px' : 'clamp(6px, 0.7vh, 10px) clamp(16px, 2.2vw, 36px) clamp(8px, 0.9vh, 12px)',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      background: 'rgba(10,15,28,0.55)', backdropFilter: 'blur(10px)',
      display: 'flex', flexDirection: 'column', gap: isMobile ? 6 : 'clamp(4px, 0.5vh, 8px)',
      position: 'relative', zIndex: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: isMobile ? 8 : 14, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: isMobile ? 11 : 'clamp(10px, 0.95vw, 14px)', fontWeight: 800,
          color: '#fbbf24', letterSpacing: '0.22em', textTransform: 'uppercase',
          flexShrink: 0,
        }}>🔥 Today's Earn &amp; Units</span>
        <span style={{ fontSize: isMobile ? 11 : 'clamp(10px, 0.85vw, 13px)', color: '#64748b', fontWeight: 600 }}>
          {headline}
        </span>
      </div>

      {/* Booked agents — wrap on TV (plenty of width) but scroll
          sideways on mobile so we don't burn half the screen on a wall
          of pills. flexShrink:0 on each pill keeps them at natural
          width inside the scroller. */}
      <div
        className={isMobile ? 'wb-no-scrollbar' : undefined}
        style={{
          display: 'flex',
          flexWrap: isMobile ? 'nowrap' : 'wrap',
          overflowX: isMobile ? 'auto' : 'visible',
          // Pair overflow-y so iOS/desktop don't over-render a vertical
          // scrollbar; a small vertical padding leaves room for each
          // pill's glow box-shadow without it getting clipped.
          overflowY: isMobile ? 'hidden' : 'visible',
          paddingTop: isMobile ? 4 : 0,
          paddingBottom: isMobile ? 4 : 0,
          WebkitOverflowScrolling: 'touch' as any,
          gap: isMobile ? '6px' : 'clamp(4px, 0.5vw, 8px) clamp(5px, 0.6vw, 10px)',
        }}
      >
        {booked.map((a, i) => {
          const rank = i + 1;
          const key  = a.name.toLowerCase();
          const was  = oldRanks.get(key);
          const climbed = was !== undefined && was > rank;     // last poll → flash anim
          const dropped = was !== undefined && was < rank;
          // Net movement vs the rank the server has recorded as this
          // agent's first booking today — drives the persistent ▲N/▼N
          // chip. Shared across all TVs.
          const baseline = baselines[key];
          const netChange = typeof baseline === 'number' ? baseline - rank : 0;
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
              display: 'inline-flex', alignItems: 'center', gap: isMobile ? 5 : 6,
              padding: isMobile ? '4px 8px' : 'clamp(3px, 0.4vh, 6px) clamp(7px, 0.8vw, 11px)',
              borderRadius: 99, flexShrink: 0,
              background: tint.bg,
              border: `1px solid ${tint.border}`,
              animation: climbed ? 'wb-row-up 1.2s ease-out' : dropped ? 'wb-row-down 1.2s ease-out' : undefined,
              boxShadow: tint.glow,
            }}>
              <span style={{ fontSize: isMobile ? 11 : 'clamp(10px, 0.9vw, 13px)', fontWeight: 800, color: tint.rankColor, fontVariantNumeric: 'tabular-nums' }}>
                #{rank}
              </span>
              {/* Position-movement chip lives next to the rank so it
                  reads as "they're up 2 places", not "up 2 units". */}
              {netChange > 0 && (
                <span
                  aria-label={`up ${netChange} today`}
                  title={`Up ${netChange} from where they first booked today`}
                  style={{
                    fontSize: isMobile ? 12 : 'clamp(10px, 0.85vw, 12px)',
                    color: '#10b981', fontWeight: 800,
                    display: 'inline-flex', alignItems: 'center',
                    padding: isMobile ? '1px 5px' : '1px 4px',
                    borderRadius: 6,
                    background: 'rgba(16,185,129,0.15)',
                    border: '1px solid rgba(16,185,129,0.4)',
                    lineHeight: 1,
                  }}
                >▲{netChange}</span>
              )}
              {netChange < 0 && (
                <span
                  aria-label={`down ${-netChange} today`}
                  title={`Down ${-netChange} from where they first booked today`}
                  style={{
                    fontSize: isMobile ? 12 : 'clamp(10px, 0.85vw, 12px)',
                    color: '#f87171', fontWeight: 800,
                    display: 'inline-flex', alignItems: 'center',
                    padding: isMobile ? '1px 5px' : '1px 4px',
                    borderRadius: 6,
                    background: 'rgba(248,113,113,0.15)',
                    border: '1px solid rgba(248,113,113,0.4)',
                    lineHeight: 1,
                  }}
                >▼{-netChange}</span>
              )}
              <span style={{ fontSize: isMobile ? 12 : 'clamp(10px, 0.9vw, 14px)', fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap' }}>
                {a.name}
              </span>
              <span style={{ fontSize: isMobile ? 12 : 'clamp(10px, 0.95vw, 14px)', fontWeight: 800, color: tint.moneyColor, fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(a.income)}
              </span>
              {a.policies > 0 && (
                <span style={{
                  fontSize: isMobile ? 10 : 'clamp(9px, 0.75vw, 11px)', fontWeight: 700,
                  color: isUnitsLeader ? '#5eead4' : '#94a3b8',
                }}>
                  · {a.policies} {a.policies === 1 ? 'unit' : 'units'}{isUnitsLeader ? ' ★' : ''}
                </span>
              )}
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

function Podium({ rows, cols, isMobile, deltas }: { rows: Row[]; cols: ColMap; isMobile: boolean; deltas: CardDelta[] }) {
  if (rows.length === 0) return null;

  // Mobile: stack into two rows so each card has real width to breathe.
  //   ┌──────────────┐
  //   │      #1      │   full-width leader
  //   ├──────┬───────┤
  //   │  #2  │  #3   │   side-by-side
  //   └──────┴───────┘
  // The TV layout (the else branch below) keeps the original 3-across
  // podium at fixed vh so nothing changes on the wallboards.
  if (isMobile) {
    return (
      <div style={{
        flex: '0 0 auto', display: 'flex', flexDirection: 'column',
        gap: 10, padding: '14px 14px 0',
        position: 'relative', zIndex: 1,
      }}>
        {rows[0] && (
          <PodiumCard
            key={String(rows[0][cols.nameCol])}
            row={rows[0]} rank={1} cols={cols} isMobile fullWidth deltas={deltas}
          />
        )}
        {(rows[1] || rows[2]) && (
          <div style={{ display: 'flex', gap: 10 }}>
            {rows[1] && <PodiumCard key={String(rows[1][cols.nameCol])} row={rows[1]} rank={2} cols={cols} isMobile deltas={deltas} />}
            {rows[2] && <PodiumCard key={String(rows[2][cols.nameCol])} row={rows[2]} rank={3} cols={cols} isMobile deltas={deltas} />}
          </div>
        )}
      </div>
    );
  }

  // Re-arrange so #2 is left, #1 centre, #3 right. The leader is
  // distinguished by typography (bigger avatar / name / £) and the
  // gold border + glow — we no longer force a height percentage,
  // because shrinking the 2nd / 3rd cards was clipping the agent's
  // name into the £ figure on smaller viewports.
  const arranged: Array<{ row: Row; rank: number }> = [];
  if (rows[1]) arranged.push({ row: rows[1], rank: 2 });
  if (rows[0]) arranged.push({ row: rows[0], rank: 1 });
  if (rows[2]) arranged.push({ row: rows[2], rank: 3 });

  return (
    <div style={{
      flex: '0 0 auto', display: 'flex', alignItems: 'stretch', justifyContent: 'center',
      gap: 'clamp(14px, 1.6vw, 32px)', padding: 'clamp(12px, 1.6vh, 22px) clamp(20px, 3vw, 60px) 0',
      position: 'relative', zIndex: 1,
    }}>
      {arranged.map(({ row, rank }) => (
        <PodiumCard key={String(row[cols.nameCol])} row={row} rank={rank} cols={cols} deltas={deltas} />
      ))}
    </div>
  );
}

function PodiumCard({ row, rank, cols, isMobile, fullWidth, deltas }: {
  row: Row; rank: number; cols: ColMap;
  isMobile?: boolean; fullWidth?: boolean; deltas?: CardDelta[];
}) {
  const rawName  = String(row[cols.nameCol] ?? '');
  const name     = cleanName(rawName);
  const myKey    = agentKey(rawName);
  const myDeltas = (deltas ?? []).filter(d => d.agentKey === myKey);
  const latestDelta = myDeltas[myDeltas.length - 1];
  // Filter the rank's own medal out of the shelf — the tier label up top
  // already shows it.
  const myMedal = RANK_MEDALS[rank];
  const emojis  = [...extractEmojis(rawName)].filter(e => e !== myMedal);
  const grad    = avatarColors(name);

  const incomeMtd   = parseMoney(row[cols.incomeMtdCol]);
  const incomeToday = parseMoney(row[cols.incomeTodayCol]);
  const polToday    = parseMoney(row[cols.polTodayCol]);
  const polMtd      = parseMoney(row[cols.polMtdCol]);
  const ipp         = parseMoney(row[cols.ippCol]);
  const gwp         = parseMoney(row[cols.gwpCol]);
  const online      = incomeToday > 0 || polToday > 0;
  // addons currently unused on the trimmed podium — leave the column
  // detection in place so we can re-introduce the stat without rewiring.
  void cols.addonsCol;

  const tier = rank === 1 ? { ring: '#fde68a', ringGlow: 'rgba(251,191,36,0.6)', label: '🥇 1st', labelColor: '#fde68a' }
             : rank === 2 ? { ring: '#e5e7eb', ringGlow: 'rgba(229,231,235,0.45)', label: '🥈 2nd', labelColor: '#e5e7eb' }
             :              { ring: '#fdba74', ringGlow: 'rgba(253,186,116,0.45)', label: '🥉 3rd', labelColor: '#fdba74' };

  // Pixel-based sizing on mobile so vw-clamps don't collapse at narrow
  // widths. Leader gets bigger numbers and avatar; #2/#3 stay readable in
  // their half-width row.
  const mobileSize = rank === 1
    ? { avatar: 64, name: 24, money: 38, label: 13, statValue: 18, statLabel: 10, emoji: 22 }
    : { avatar: 44, name: 17, money: 24, label: 11, statValue: 14, statLabel:  9, emoji: 16 };

  return (
    <div style={{
      flex: isMobile ? (fullWidth ? '0 0 auto' : '1 1 0') : `1 1 0`,
      width: isMobile && fullWidth ? '100%' : undefined,
      maxWidth: isMobile ? undefined : '24vw',
      minWidth: 0,
      // All three cards size to their content — the leader is still
      // visibly bigger thanks to its larger fonts/avatar/glow without
      // forcing the others to compress and clip their names.
      height: 'auto',
      background: 'linear-gradient(180deg, rgba(26,33,54,0.85) 0%, rgba(14,20,39,0.85) 100%)',
      border: `2px solid ${tier.ring}`,
      borderRadius: isMobile ? 14 : 18,
      padding: isMobile ? '12px 14px' : 'clamp(10px, 1.1vh, 16px) clamp(12px, 1.4vw, 22px)',
      boxShadow: `0 0 ${isMobile ? 30 : 60}px ${tier.ringGlow}, 0 ${isMobile ? 8 : 14}px ${isMobile ? 24 : 40}px rgba(0,0,0,0.55)`,
      backdropFilter: 'blur(14px)',
      display: isMobile ? 'flex' : 'grid',
      flexDirection: isMobile ? 'column' : undefined,
      gap: isMobile ? 8 : undefined,
      gridTemplateColumns: isMobile ? undefined : '1fr',
      gridAutoRows: isMobile ? undefined : 'auto',
      alignContent: isMobile ? undefined : 'space-between',
      justifyItems: isMobile ? undefined : 'center',
      alignItems: isMobile ? 'center' : undefined,
      textAlign: 'center', position: 'relative',
      // overflow:visible so the floating £-delta badges can drift past the
      // rounded corners; nothing else inside the card overflows so we
      // don't lose anything by dropping the prior `overflow:hidden`.
      overflow: 'visible',
      animation: latestDelta
        ? `wb-card-pulse-${latestDelta.amount > 0 ? 'up' : 'down'} ${DELTA_TTL_MS}ms ease-out${rank === 1 ? ', wb-leader-pulse 3.2s ease-in-out infinite' : ''}`
        : (rank === 1 ? 'wb-leader-pulse 3.2s ease-in-out infinite' : undefined),
    }}>
      <DeltaBadges deltas={myDeltas} />

      {/* Tier label + avatar inline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar
            name={name}
            size={isMobile ? `${mobileSize.avatar}px` : (rank === 1 ? 'clamp(48px, 5vw, 78px)' : 'clamp(42px, 4.4vw, 66px)')}
            gradient={grad}
          />
          {online && <OnlineDot size={rank === 1 ? 'clamp(13px, 1.2vw, 18px)' : 'clamp(11px, 1vw, 15px)'} />}
        </div>
        <div style={{
          fontSize: isMobile ? mobileSize.label : 'clamp(11px, 1vw, 18px)', fontWeight: 900,
          letterSpacing: '0.3em', color: tier.labelColor,
          textShadow: `0 0 18px ${tier.ringGlow}`,
          whiteSpace: 'nowrap',
        }}>{tier.label}</div>
      </div>

      {/* Name — never collapses */}
      <div style={{
        fontSize: isMobile
          ? mobileSize.name
          : (rank === 1 ? 'clamp(20px, 2.1vw, 34px)' : 'clamp(17px, 1.8vw, 28px)'),
        fontWeight: 900, color: '#f1f5f9',
        textShadow: '0 4px 20px rgba(0,0,0,0.5)', lineHeight: 1.1,
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flexShrink: 0, width: '100%',
      }}>{name}</div>

      {/* Primary metric */}
      <div>
        <div style={{
          fontSize: isMobile
            ? mobileSize.money
            : (rank === 1 ? 'clamp(28px, 3.4vw, 60px)' : 'clamp(24px, 2.8vw, 44px)'),
          fontWeight: 900, color: '#fde68a',
          textShadow: '0 0 30px rgba(251,191,36,0.35)',
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}>{formatMoney(incomeMtd)}</div>
        <div style={{
          fontSize: isMobile ? mobileSize.statLabel : 'clamp(8px, 0.75vw, 11px)',
          color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: 3,
        }}>Income MTD</div>
      </div>

      {/* Compact stat row — MTD only. Today's leaderboard up top covers
          the daily race; the podium is about the month-long position. */}
      {(() => {
        const stats: Array<{ label: string; value: string }> = [];
        if (cols.polMtdCol)            stats.push({ label: 'Pols', value: String(Math.round(polMtd)) });
        if (cols.ippCol  && ipp > 0)   stats.push({ label: 'IPP',  value: formatMoney(ipp) });
        if (cols.gwpCol  && gwp > 0)   stats.push({ label: 'GWP',  value: formatMoney(gwp) });
        if (stats.length === 0) return null;
        return (
          <div style={{
            display: 'flex',
            gap: isMobile ? 12 : 'clamp(10px, 1.2vw, 22px)',
            justifyContent: 'center', flexWrap: 'wrap',
          }}>
            {stats.map((s, i) => (
              <Stat
                key={i} label={s.label} value={s.value}
                valueSize={isMobile ? mobileSize.statValue : undefined}
                labelSize={isMobile ? mobileSize.statLabel : undefined}
              />
            ))}
          </div>
        );
      })()}

      {/* Emoji shelf — each award gets a tiny inline label. Centred to
          match the rest of the podium card; chips wrap onto multiple
          rows on narrow viewports so a leader with several awards
          still reads cleanly. */}
      {emojis.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
          gap: isMobile ? '4px 10px' : 'clamp(4px, 0.4vh, 6px) clamp(8px, 0.9vw, 14px)',
        }}>
          {emojis.map((e, i) => {
            const label = EMOJI_LABELS[e];
            return (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  fontSize: isMobile ? mobileSize.emoji : 'clamp(16px, 1.7vw, 28px)',
                }}>{e}</span>
                {label && (
                  <span style={{
                    fontSize: isMobile ? 10 : 'clamp(9px, 0.8vw, 12px)',
                    color: '#94a3b8', fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}>{label}</span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Per-card overlay that floats a small "+£X" or "−£X" chip whenever the
 * agent's income changed in the most recent data poll. Each chip plays
 * a quiet sound on mount — bright "ka-ching" for an earn, two-note dip
 * for a drop / cancellation. Auto-removes when its animation completes
 * (TTL enforced by ShowcaseView's cleanup interval). Multiple deltas in
 * rapid succession stack vertically with a slight stagger so a burst of
 * activity reads as several chips and several tings, not one fused blob.
 *
 * Audio respects the global ?sound=off URL flag the celebration system
 * already honours, so a quiet-office TV stays silent.
 */
function DeltaBadges({ deltas }: { deltas: CardDelta[] }) {
  if (deltas.length === 0) return null;
  return (
    <div style={{
      position: 'absolute',
      top: -4, right: 8,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
      gap: 3, zIndex: 10, pointerEvents: 'none',
    }}>
      {deltas.map((d, i) => <DeltaChip key={d.id} delta={d} staggerIndex={i} />)}
    </div>
  );
}

function DeltaChip({ delta, staggerIndex }: { delta: CardDelta; staggerIndex: number }) {
  const positive = delta.amount > 0;
  // Fire the ting / dip once on mount, matching the visual stagger so a
  // burst of three earns sounds like three distinct register pings.
  useEffect(() => {
    const t = setTimeout(() => {
      import('@/lib/sounds').then(s => {
        if (positive) s.playCashTing();
        else          s.playCancelDrop();
      }).catch(() => { /* sound is best-effort */ });
    }, staggerIndex * 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delta.id]);

  const sign = positive ? '+' : '−';
  const abs  = Math.abs(delta.amount);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 8px', borderRadius: 99,
      fontSize: 'clamp(11px, 0.95vw, 14px)', fontWeight: 800,
      fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      color:      positive ? '#10b981' : '#f87171',
      background: positive ? 'rgba(16,185,129,0.18)' : 'rgba(248,113,113,0.18)',
      border:     `1px solid ${positive ? 'rgba(16,185,129,0.55)' : 'rgba(248,113,113,0.55)'}`,
      boxShadow:  positive
        ? '0 0 16px rgba(16,185,129,0.35)'
        : '0 0 16px rgba(248,113,113,0.35)',
      animation: `${positive ? 'wb-delta-rise' : 'wb-delta-sink'} ${DELTA_TTL_MS}ms ease-out forwards`,
      animationDelay: `${staggerIndex * 80}ms`,
    }}>
      <span>{sign}{`£${Math.round(abs).toLocaleString('en-GB')}`}</span>
      {/* Policy reference (if known) — slightly faded and same colour
          family as the chip so it reads as supporting detail, not a
          competing piece of info. */}
      {delta.policyRef && (
        <span style={{
          fontSize: '0.78em', fontWeight: 700, opacity: 0.75,
          letterSpacing: '0.04em',
        }}>
          {delta.policyRef}
        </span>
      )}
    </span>
  );
}

function Stat({ label, value, valueSize, labelSize }: {
  label: string; value: string; valueSize?: number; labelSize?: number;
}) {
  return (
    <div>
      <div style={{
        fontSize: valueSize ?? 'clamp(14px, 1.4vw, 22px)',
        fontWeight: 800, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
      <div style={{
        fontSize: labelSize ?? 'clamp(9px, 0.8vw, 12px)',
        color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>{label}</div>
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

/** Pulsing green "active today" dot. Anchored bottom-right of an avatar
 *  by its parent's relative positioning. Sized with clamp so it tracks
 *  the avatar size — slightly larger than the previous version because
 *  the original 8-12px read as a subtle render glitch from across a
 *  TV-sized room. */
function OnlineDot({ size }: { size?: string } = {}) {
  return (
    <span
      aria-label="Active today"
      title="Active today — has booked income or units today"
      style={{
        position: 'absolute',
        bottom: '-2px', right: '-2px',
        width:  size ?? 'clamp(11px, 1.1vw, 16px)',
        height: size ?? 'clamp(11px, 1.1vw, 16px)',
        borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 35%, #4ade80 0%, #10b981 70%, #047857 100%)',
        border: '2.5px solid #0a0f1c',
        boxShadow: '0 0 12px rgba(16,185,129,0.7)',
        animation: 'wb-online-pulse 2.2s ease-in-out infinite',
      }}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Agent grid — rank 4+
// ────────────────────────────────────────────────────────────────────────

function AgentGrid({ rows, startIndex, cols, teamLeaderIncome, isMobile, deltas }: {
  rows: Row[]; startIndex: number; cols: ColMap; teamLeaderIncome: number; isMobile: boolean; deltas: CardDelta[];
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
      padding: isMobile
        ? '14px 14px 14px'
        : 'clamp(16px, 2vh, 28px) clamp(20px, 3vw, 60px) 0',
      // TV: own scroll container (TVs hide overflow at the page level so
      // this is mostly a layout safety net). Mobile: defer to the document
      // scroller — iOS Safari doesn't reliably hand touch gestures to a
      // nested overflow:auto inside a flex column.
      overflowY: isMobile ? 'visible' : 'auto',
      position: 'relative', zIndex: 1,
      // Hide the scrollbar — TVs can't scroll anyway, this just prevents a
      // visible track.
      scrollbarWidth: 'none',
    }}>
      <div style={{
        display: 'grid',
        // Mobile: single full-width column so each row is tappable and
        // numbers stay legible. Desktop/TV keeps the auto-fill packing.
        gridTemplateColumns: isMobile
          ? '1fr'
          : 'repeat(auto-fill, minmax(clamp(200px, 19vw, 300px), 1fr))',
        gridAutoRows: isMobile ? 'auto' : 'minmax(clamp(104px, 13vh, 140px), auto)',
        gap: isMobile ? 10 : 'clamp(10px, 1.2vh, 16px)',
      }}>
        {rows.map((row, i) => (
          <AgentCard key={String(row[cols.nameCol])} row={row} rank={startIndex + i} cols={cols} leaderIncome={teamLeaderIncome} deltas={deltas} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ row, rank, cols, leaderIncome, deltas }: { row: Row; rank: number; cols: ColMap; leaderIncome: number; deltas?: CardDelta[] }) {
  const rawName = String(row[cols.nameCol] ?? '');
  const name    = cleanName(rawName);
  const emojis  = [...extractEmojis(rawName)];
  const grad    = avatarColors(name);
  const myKey       = agentKey(rawName);
  const myDeltas    = (deltas ?? []).filter(d => d.agentKey === myKey);
  const latestDelta = myDeltas[myDeltas.length - 1];

  const incomeMtd     = parseMoney(row[cols.incomeMtdCol]);
  const incomeToday   = parseMoney(row[cols.incomeTodayCol]);
  const polToday      = parseMoney(row[cols.polTodayCol]);
  const polMtd        = parseMoney(row[cols.polMtdCol]);
  const ipp           = parseMoney(row[cols.ippCol]);
  const gwp           = parseMoney(row[cols.gwpCol]);
  const bracket       = bracketFor(incomeMtd);
  const progressPct   = bracket.pct;
  const maxed         = !bracket.next;
  // Soft "online" — the agent's actively contributing today. Will be
  // promoted to a true call-status feed later; for now anyone with
  // income or units against their name today reads as on.
  const online        = incomeToday > 0 || polToday > 0;

  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(26,33,54,0.55) 0%, rgba(14,20,39,0.55) 100%)',
      border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14,
      padding: 'clamp(8px, 1vh, 14px) clamp(10px, 1.1vw, 16px)',
      display: 'flex', flexDirection: 'column', gap: 5,
      // overflow:visible so a "+£X" badge can drift past the rounded
      // top edge of the card; nothing else inside ever overflows.
      overflow: 'visible', position: 'relative',
      backdropFilter: 'blur(8px)',
      animation: latestDelta
        ? `wb-card-pulse-${latestDelta.amount > 0 ? 'up' : 'down'} ${DELTA_TTL_MS}ms ease-out`
        : undefined,
    }}>
      <DeltaBadges deltas={myDeltas} />
      {/* Top row: avatar + name + rank chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar name={name} size="clamp(30px, 2.8vw, 44px)" gradient={grad} />
          {online && <OnlineDot />}
        </div>
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
        {cols.polMtdCol && <span><strong style={{ color: '#cbd5e1' }}>{Math.round(polMtd)}</strong> pols</span>}
        {cols.ippCol    && ipp > 0 && <span><strong style={{ color: '#cbd5e1' }}>{formatMoney(ipp)}</strong> IPP</span>}
        {cols.gwpCol    && gwp > 0 && <span><strong style={{ color: '#cbd5e1' }}>{formatMoney(gwp)}</strong> GWP</span>}
      </div>

      {/* Commission bracket progress — shows how close this agent is to the
          next rate tier. Maxed agents get a solid gold bar. */}
      <div>
        <div style={{
          fontSize: 'clamp(8px, 0.7vw, 10px)', color: '#64748b',
          textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700,
          marginBottom: 3, lineHeight: 1,
        }}>
          Commission
        </div>
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
            {maxed ? 'Max tier' : `${formatMoney(bracket.toNext)} to next tier`}
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

      {/* Emoji shelf — single horizontal line that scrolls sideways
          inside the card. Stacking the labels was eating two or three
          card heights for high-award agents; a marquee keeps the row
          consistent regardless of how many awards the agent's earned. */}
      {emojis.length > 0 && <AwardShelf emojis={emojis} />}
    </div>
  );
}

/** Horizontal marquee for an agent card's awards. One award stays
 *  static; two or more loop sideways using the same wb-ticker-scroll
 *  animation the office ticker uses (two copies inside, slide -50% for
 *  a seamless loop). */
function AwardShelf({ emojis }: { emojis: string[] }) {
  const items = emojis.slice(0, 6);
  const shouldScroll = items.length > 1;
  // Two copies so the -50% translate loops seamlessly. With a single
  // award no animation is wired so this stays a noop.
  const rendered = shouldScroll ? [...items, ...items] : items;
  // Speed scales with item count so a 4-award agent doesn't blur past;
  // each label gets roughly the same dwell time.
  const durationSec = Math.max(items.length * 5, 12);

  return (
    <div style={{
      overflow: 'hidden', marginTop: 'auto', width: '100%',
    }}>
      <div style={{
        display: 'inline-flex',
        gap: 'clamp(10px, 1vw, 14px)',
        whiteSpace: 'nowrap',
        animation: shouldScroll
          ? `wb-ticker-scroll ${durationSec}s linear infinite`
          : undefined,
      }}>
        {rendered.map((e, i) => {
          const label = EMOJI_LABELS[e];
          return (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              flexShrink: 0,
            }}>
              <span style={{
                fontSize: 'clamp(13px, 1.2vw, 18px)',
                filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))',
              }}>{e}</span>
              {label && (
                <span style={{
                  fontSize: 'clamp(9px, 0.75vw, 11px)',
                  color: '#64748b', fontWeight: 600,
                }}>{label}</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Emoji award labels — used inline next to each emoji on a card so the
//  floor never has to guess what an award means. Keep in sync with
//  lib/emojiSummary's legend comment; both should change together.
// ────────────────────────────────────────────────────────────────────────

const EMOJI_LABELS: Record<string, string> = {
  '🥇': 'Leading MTD',
  '🥈': '2nd MTD',
  '🥉': '3rd MTD',
  '🍪': '4th MTD',
  '🔥': 'Most income today',
  '🎉': 'Most pols today',
  '🚐': 'Most pols MTD',
  '🍺': 'Biggest pol today',
  '🍾': 'Biggest pol MTD',
};

// ────────────────────────────────────────────────────────────────────────
//  Bottom toolbar — latest deal on the left, OCBL/BISL stock ticker on
//  the right. The ActivityTicker (latest deal / climb / first-policy)
//  and OfficeTickerStrip (combined office numbers) live side-by-side on
//  TV viewports and stack on mobile.
// ────────────────────────────────────────────────────────────────────────

function BottomToolbar({ items, isMobile }: { items: TickerItem[]; isMobile: boolean }) {
  return (
    <div style={{
      flexShrink: 0,
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      alignItems: 'stretch',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(10,15,28,0.7)', backdropFilter: 'blur(10px)',
      position: 'relative', zIndex: 2,
    }}>
      {/* Latest deal — content-sized on desktop. Never wraps to a
          second line; if the deal text is longer than the default
          space, the box grows and the tape on the right shrinks
          accordingly. Stacks full-width on mobile. Capped at 70% of
          the strip so a freakishly long name can't shove the tape
          off-screen entirely. */}
      <div style={{
        flex: isMobile ? '0 0 auto' : '0 0 auto',
        width: isMobile ? '100%' : undefined,
        maxWidth: isMobile ? undefined : '70%',
        minWidth: 0,
        borderBottom: isMobile ? '1px solid rgba(255,255,255,0.05)' : 'none',
        borderRight:  isMobile ? 'none' : '1px solid rgba(255,255,255,0.05)',
      }}>
        <ActivityTicker items={items} />
      </div>
      {/* Trading tape — fills all remaining horizontal space on desktop
          so the OCBL/BISL crawl runs across the full right side. */}
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <OfficeTickerStrip isMobile={isMobile} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Office ticker — stock-market-style read-out of OCBL (London) and
//  BISL (Guildford) totals. Independent of which board is on screen so
//  every TV has the same global view.
// ────────────────────────────────────────────────────────────────────────

interface OfficeTotals {
  ticker:         string;
  name:           string;
  incomeTotalMtd: number;
  unitsTotalMtd:  number;
  agents:         number;
  activeAgents:   number;
  incomePerAgent: number;
  unitsPerAgent:  number;
  ok:             boolean;
}

function OfficeTickerStrip({ isMobile }: { isMobile: boolean }) {
  const [offices, setOffices] = useState<OfficeTotals[] | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/office-totals', { cache: 'no-store' });
        const d   = await res.json();
        if (cancelled) return;
        const next: OfficeTotals[] = Array.isArray(d.offices) ? d.offices : [];
        setOffices(next);
      } catch { /* keep last successful read */ }
      finally { if (!cancelled) timer = setTimeout(tick, 60_000); }
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  if (!offices || offices.length === 0) {
    return (
      <div style={{
        padding: isMobile ? '10px 14px' : 'clamp(10px, 1.2vh, 16px) clamp(20px, 2vw, 36px)',
        fontSize: 11, color: '#475569', fontWeight: 700,
        letterSpacing: '0.18em', textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        Loading tape…
      </div>
    );
  }

  // Old-school trading-tape: the two copies sit side by side and the
  // wrapper slides them left by 50% on a constant loop, so the
  // boundary is invisible. The outer flex parent (BottomToolbar)
  // controls how much horizontal room this gets — we take 100% of
  // whatever it gives us so the crawl runs the full strip on desktop.
  const offices2 = [...offices, ...offices];

  return (
    <div style={{
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      width: '100%',
      padding: isMobile ? '10px 0' : 'clamp(10px, 1.2vh, 16px) 0',
    }}>
      <div style={{
        display: 'inline-block',
        // Two copies inside, animation slides by 50% (= one copy's
        // width) so the loop seam is invisible.
        animation: 'wb-ticker-scroll 60s linear infinite',
      }}>
        {offices2.map((o, i) => (
          <OfficeTapeEntry key={`${o.ticker}-${i}`} office={o} isMobile={isMobile} />
        ))}
      </div>
    </div>
  );
}

/** A single ticker-tape entry rendered inline. Four headline metrics
 *  per office: avg income/agent, avg units/agent, total income, total
 *  units. "Active agent" denominator = anyone with non-zero income MTD,
 *  so the per-agent figures aren't diluted by people who haven't booked
 *  this month. */
function OfficeTapeEntry({ office, isMobile }: { office: OfficeTotals; isMobile: boolean }) {
  const fs = (px: number) => (isMobile ? px : `clamp(${px - 2}px, ${(px / 14).toFixed(2)}vw, ${px + 4}px)`);
  const dim   = '#64748b';
  const sep   = '#334155';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline',
      padding: '0 clamp(18px, 2vw, 32px)',
      fontVariantNumeric: 'tabular-nums',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.04em',
      opacity: office.ok ? 1 : 0.5,
      gap: 8,
    }}>
      <span style={{ fontSize: fs(14), fontWeight: 800, color: '#e2e8f0' }}>
        {office.ticker}
      </span>

      {/* Avg income / agent */}
      <span style={{ fontSize: fs(15), fontWeight: 800, color: '#fde68a' }}>
        {formatTickerMoney(office.incomePerAgent)}
      </span>
      <span style={{ fontSize: fs(10), fontWeight: 700, color: dim }}>/AGENT</span>

      <span aria-hidden style={{ fontSize: fs(10), color: sep }}>·</span>

      {/* Avg units / agent — whole number, decimal noise isn't useful here */}
      <span style={{ fontSize: fs(15), fontWeight: 800, color: '#a7f3d0' }}>
        {Math.round(office.unitsPerAgent)}
      </span>
      <span style={{ fontSize: fs(10), fontWeight: 700, color: dim }}>UNITS/AGENT</span>

      <span aria-hidden style={{ fontSize: fs(10), color: sep }}>·</span>

      {/* Total income MTD */}
      <span style={{ fontSize: fs(11), fontWeight: 700, color: dim }}>TOTAL</span>
      <span style={{ fontSize: fs(13), fontWeight: 800, color: '#e2e8f0' }}>
        {formatTickerMoney(office.incomeTotalMtd)}
      </span>

      <span aria-hidden style={{ fontSize: fs(10), color: sep }}>·</span>

      {/* Total units MTD */}
      <span style={{ fontSize: fs(13), fontWeight: 800, color: '#e2e8f0' }}>
        {Math.round(office.unitsTotalMtd).toLocaleString('en-GB')}
      </span>
      <span style={{ fontSize: fs(11), fontWeight: 700, color: dim }}>UNITS</span>

      <span aria-hidden style={{ fontSize: fs(11), color: sep, padding: '0 6px' }}>◆</span>
    </span>
  );
}

/** Compact "stock-ticker" formatter — k for ≥£1k, M for ≥£1M, exact
 *  pounds otherwise. The agent cards still use the full thousands-
 *  separated format; this is just for the bottom strip where space is
 *  the primary constraint. */
function formatTickerMoney(n: number, allowZero = false): string {
  const abs = Math.abs(n);
  if (abs < 1 && !allowZero) return '£0';
  if (abs >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000)    return `£${Math.round(n / 1000)}k`;
  if (abs >= 1000)      return `£${(n / 1000).toFixed(1)}k`;
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

// ────────────────────────────────────────────────────────────────────────
//  Activity ticker — rotates the most recent live events
// ────────────────────────────────────────────────────────────────────────

function ActivityTicker({ items }: { items: TickerItem[] }) {
  // Strict "latest deal" — only milestone-kind events (the new rich
  // ref-tagged deal lines, plus the legacy big-jump fallback). Climbs,
  // drops, emoji-earnings and alerts deliberately don't appear here so
  // the strip never rotates between unrelated updates. The newest deal
  // pins; previous deal stays on screen until a fresh one arrives.
  const deals = items.filter(i => i.kind === 'milestone');
  const item  = deals[deals.length - 1];

  if (!item) {
    return (
      <div style={{
        flexShrink: 0, padding: 'clamp(10px, 1.2vh, 16px) clamp(16px, 2vw, 32px)',
        fontSize: 'clamp(12px, 1.1vw, 15px)', color: '#475569', fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        Latest Deal · waiting for the next booking
      </div>
    );
  }
  return (
    <div style={{
      flexShrink: 0, padding: 'clamp(10px, 1.2vh, 16px) clamp(16px, 2vw, 32px)',
      display: 'flex', alignItems: 'center', gap: 12, overflow: 'hidden', position: 'relative',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 'clamp(10px, 0.9vw, 13px)', fontWeight: 800, color: '#fbbf24', letterSpacing: '0.25em', textTransform: 'uppercase', flexShrink: 0 }}>
        Latest Deal
      </span>
      <span aria-hidden style={{
        width: 8, height: 8, borderRadius: '50%', background: '#ef4444',
        boxShadow: '0 0 12px rgba(239,68,68,0.8)', flexShrink: 0,
        animation: 'wb-celeb-banner 1.4s ease-in-out infinite',
      }} />
      <div key={item.id} style={{
        display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1,
        fontSize: 'clamp(13px, 1.3vw, 20px)', fontWeight: 600, color: '#e2e8f0',
        animation: 'wb-celeb-banner 5s ease-out',
      }}>
        <span style={{ fontSize: 'clamp(18px, 1.6vw, 26px)', flexShrink: 0 }}>{item.emoji}</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{item.text}</span>
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
