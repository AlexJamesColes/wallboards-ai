'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  useAutoFullscreenOnFirstGesture,
  useAutoFullscreenAfterIdle,
  useAutoHideCursor,
  useAutoReloadOnDeploy,
} from '@/lib/kioskHooks';
import { parseAgentName } from '@/lib/agentDisplayName';

interface AgentRow {
  name:           string;
  status:         string;
  time_in_state:  number;     // seconds
  team:           string | null;
}

interface OfficeBlock {
  label:    string;
  source:   string;
  agents:   AgentRow[];
}

interface QueueSummary {
  label:           string;
  in_queue:        number;
  offered:         number;
  answered:        number;
  abandoned:       number;
  abandon_pct:     number;
  average_wait:    number;
  longest_wait:    number;
  queues_matched:  string[];
  queues_missing:  string[];
  updated_at:      string | null;
}

interface Payload {
  slug:         string;
  dataset_name: string;
  updated_at:   string | null;
  offices:      OfficeBlock[];
  unmatched:    AgentRow[];
  queues?:      QueueSummary[];
}

/** A row enriched with the office tag and a continuously-ticking livetime
 *  so the layout components don't have to re-compute either. */
interface LiveAgent extends AgentRow {
  office:    string | null;     // 'London' | 'Guildford' | null (unmatched)
  livetime:  number;
  concern:   boolean;           // true once over threshold for status
}

interface Props {
  slug:         string;
  title:        string;
  department:   string;
}

const POLL_MS = 10_000;

// ─── Status visual + categorisation ─────────────────────────────────────
//
// `tier` controls layout placement:
//   alert   — needs eyes on it. Floats to the top, big tiles, glow.
//   active  — productive states. Bulk of the layout, multi-column.
//   away    — out of office. Compact name list at the bottom.
//
// `concernSec` is the "this is taking too long" threshold; a tile that
// crosses it gets a red rim regardless of its tier.

type Tier = 'alert' | 'active' | 'away';

interface StatusMeta {
  label:        string;        // short label shown in lane header + chip
  tint:         string;        // lane accent + tile text
  glow:         string;        // halo behind status dots
  tier:         Tier;
  concernSec?:  number;        // tile gets concern rim past this many seconds
}

// Seven canonical buckets every Noetica status collapses into. Tier
// shapes layout placement: alert at the top, active in the middle,
// away at the bottom.
const STATUS_META: Record<string, StatusMeta> = {
  'Hold':           { label: 'Hold',          tint: '#fb923c', glow: 'rgba(251,146,60,0.55)',  tier: 'alert',  concernSec: 60 },
  'Not Ready':      { label: 'Not Ready',     tint: '#f87171', glow: 'rgba(248,113,113,0.55)', tier: 'alert',  concernSec: 5 * 60 },
  'Talking':        { label: 'Talking',       tint: '#10b981', glow: 'rgba(16,185,129,0.45)',  tier: 'active' },
  'Wrap':           { label: 'Wrap',          tint: '#fbbf24', glow: 'rgba(251,191,36,0.45)',  tier: 'active', concernSec: 3 * 60 },
  'Waiting':        { label: 'Waiting',       tint: '#38bdf8', glow: 'rgba(56,189,248,0.45)',  tier: 'active' },
  'Lunch':          { label: 'Lunch',         tint: '#94a3b8', glow: 'rgba(148,163,184,0.35)', tier: 'away' },
  'Comfort Break':  { label: 'Comfort Break', tint: '#94a3b8', glow: 'rgba(148,163,184,0.35)', tier: 'away' },
  // Synthetic — server-padded for rostered agents not in the Noetica
  // feed at all. Distinct from Lunch/Break (those are signed in but
  // away) because nobody's even at the desk.
  'Not logged in':  { label: 'Not logged in', tint: '#475569', glow: 'rgba(71,85,105,0.25)',  tier: 'away' },
};

const NEUTRAL_META: StatusMeta = {
  label: 'Unknown', tint: '#64748b', glow: 'rgba(100,116,139,0.35)', tier: 'active',
};

/** Every Noetica status collapses into one of the seven canonical
 *  buckets above. Anything not in this map falls through unchanged
 *  (and would render as "Unknown" if it isn't a canonical key) — kept
 *  as a safety net so a brand-new Noetica status surfaces visibly
 *  rather than being silently merged. */
const STATUS_ALIASES: Record<string, string> = {
  // Spelling / phrasing variants of "agent is signed in but unavailable"
  'NotReady':             'Not Ready',
  'Permitted Not Ready':  'Not Ready',
  'Pending Not Ready':    'Not Ready',

  // Active call activity → Talking
  'Dialling':    'Talking',
  'Consult':     'Talking',

  // Post-call admin → Wrap
  'Completed':   'Wrap',
  'Transferred': 'Wrap',

  // Idle / signed-in waiting → Waiting
  'Logged in':   'Waiting',
};

function canonicalStatus(s: string): string {
  return STATUS_ALIASES[s] ?? s;
}

/** Lane order within each tier — shapes the left-to-right reading
 *  order on desktop. Top of each tier list = most prominent placement. */
const ALERT_ORDER  = ['Hold', 'Not Ready'];
const ACTIVE_ORDER = ['Talking', 'Wrap', 'Waiting'];
const AWAY_ORDER   = ['Lunch', 'Comfort Break', 'Not logged in'];

// ─── Component ──────────────────────────────────────────────────────────

export default function AgentStatesView({ slug, title, department }: Props) {
  // Kiosk-mode niceties — TV-only by default, ?fs=on/?fs=off override.
  // Same set of hooks the leaderboards use so a TV running either kind
  // of board behaves identically.
  useAutoFullscreenOnFirstGesture();
  useAutoFullscreenAfterIdle(30_000);
  useAutoHideCursor(3_000);
  useAutoReloadOnDeploy();

  const [data,    setData]    = useState<Payload | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick,    setTick]    = useState(0);

  // Heartbeat — re-render every second so time-in-state ticks forwards
  // between server polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Server poll.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/agent-states/${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d: Payload) => { if (!cancelled) { setData(d); setError(null); } })
      .catch(e => { if (!cancelled) setError(e?.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, tick]);

  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), POLL_MS);
    return () => clearInterval(iv);
  }, []);

  const elapsedSinceFetch = useMemo(() => {
    if (!data?.updated_at) return 0;
    const t = new Date(data.updated_at).getTime();
    return Math.max(0, Math.floor((now - t) / 1000));
  }, [now, data?.updated_at]);

  // Flatten — every matched agent in one list with an office tag.
  //
  // Unmatched rows are intentionally NOT rendered into the lanes on
  // per-office boards (they're almost always cross-office drift — a
  // Noetica/Gecko spelling typo for someone on the other office's
  // roster — and showing them on whichever board happens to be open
  // confuses floor managers). They surface in a small drift footer
  // instead so the signal isn't lost. Combined boards (multi-roster)
  // render unmatched into the lanes since "unknown office" is genuinely
  // useful info there.
  const isPerOffice = (data?.offices?.length ?? 0) <= 1;
  const agents = useMemo<LiveAgent[]>(() => {
    if (!data) return [];
    const out: LiveAgent[] = [];
    for (const office of data.offices) {
      for (const a of office.agents) {
        const status = canonicalStatus(a.status);
        const meta = STATUS_META[status] || NEUTRAL_META;
        const livetime = a.time_in_state + elapsedSinceFetch;
        out.push({
          ...a,
          status,
          office:   office.label,
          livetime,
          concern:  !!(meta.concernSec && livetime >= meta.concernSec),
        });
      }
    }
    if (!isPerOffice) {
      for (const a of data.unmatched) {
        const status = canonicalStatus(a.status);
        const meta = STATUS_META[status] || NEUTRAL_META;
        const livetime = a.time_in_state + elapsedSinceFetch;
        out.push({
          ...a,
          status,
          office:   null,
          livetime,
          concern:  !!(meta.concernSec && livetime >= meta.concernSec),
        });
      }
    }
    return out;
  }, [data, elapsedSinceFetch, isPerOffice]);

  // Group agents by status — the layout's spine.
  const byStatus = useMemo(() => {
    const m = new Map<string, LiveAgent[]>();
    for (const a of agents) {
      const k = STATUS_META[a.status] ? a.status : a.status || 'Unknown';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    // Sort within lane: concerning first, then longest in state.
    for (const lane of m.values()) {
      lane.sort((a, b) => {
        if (a.concern !== b.concern) return a.concern ? -1 : 1;
        return b.livetime - a.livetime;
      });
    }
    return m;
  }, [agents]);

  const lanesFor = (order: string[]): { status: string; agents: LiveAgent[] }[] => {
    const known = order
      .filter(s => byStatus.has(s))
      .map(s => ({ status: s, agents: byStatus.get(s)! }));
    // Pull in any statuses not in the order list (e.g. a new Noetica
    // value) so they don't silently disappear. They land at the end.
    const extras = [...byStatus.keys()]
      .filter(s => !ALERT_ORDER.includes(s) && !ACTIVE_ORDER.includes(s) && !AWAY_ORDER.includes(s))
      .map(s => ({ status: s, agents: byStatus.get(s)! }));
    return order === ACTIVE_ORDER ? [...known, ...extras] : known;
  };

  const alertLanes  = lanesFor(ALERT_ORDER);
  const activeLanes = lanesFor(ACTIVE_ORDER);
  const awayLanes   = lanesFor(AWAY_ORDER);

  // Single-office board (London XOR Guildford) → hide the office chip.
  // Every tile would carry the same letter, claiming pixels for no info.
  // Multi-office (combined) boards keep it.
  const showOfficeChip = !isPerOffice;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#131b30',
      backgroundImage: `
        radial-gradient(ellipse at 50% -10%, rgba(56,189,248,0.06) 0%, transparent 55%),
        linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
      `,
      backgroundSize: 'auto, 40px 40px, 40px 40px',
      color: '#f1f5f9', fontFamily: 'var(--font-raleway, sans-serif)',
      padding: 'clamp(20px, 4vh, 40px) clamp(16px, 4vw, 40px)',
    }}>
      <Header
        title={title}
        department={department}
        loading={loading}
        updatedAt={data?.updated_at ?? null}
        signedIn={agents.filter(a => a.status !== 'Not logged in').length}
        rosterTotal={agents.length}
      />

      {error && (
        <div style={errorBoxStyle}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9', marginBottom: 6 }}>
            {error === '404' ? 'Dataset not pushed yet' : `Couldn't load: ${error}`}
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8' }}>
            {error === '404'
              ? 'Waiting for the first Noetica push to land. The board will fill in within 10s of data arriving.'
              : 'The agent-states feed isn\'t reachable. Check the connections page for the Noetica dataset light.'}
          </div>
        </div>
      )}

      {!error && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(16px, 2.4vh, 26px)' }}>
          {data.queues && data.queues.length > 0 && (
            <QueueStrip queues={data.queues} />
          )}
          {alertLanes.length > 0 && (
            <Tier
              key="alert"
              label="Needs attention"
              accent="#f87171"
              lanes={alertLanes}
              minColWidth={220}
              showOfficeChip={showOfficeChip}
            />
          )}
          {activeLanes.length > 0 && (
            <Tier
              key="active"
              label="On the floor"
              accent="#10b981"
              lanes={activeLanes}
              minColWidth={220}
              showOfficeChip={showOfficeChip}
            />
          )}
          {awayLanes.length > 0 && (
            <Tier
              key="away"
              label="Away"
              accent="#94a3b8"
              lanes={awayLanes}
              minColWidth={260}
              compact
              showOfficeChip={showOfficeChip}
            />
          )}
          {isPerOffice && data.unmatched.length > 0 && (
            <DriftFooter rows={data.unmatched} />
          )}
        </div>
      )}

      {!data && !error && loading && (
        <div style={{ color: '#475569', fontSize: 14, padding: 32, textAlign: 'center' }}>
          Loading agent states…
        </div>
      )}
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────

function Header({ title, department, loading, updatedAt, signedIn, rosterTotal }: {
  title: string; department: string; loading: boolean;
  updatedAt: string | null; signedIn: number; rosterTotal: number;
}) {
  const stale = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) > 60_000 : true;
  const fresh = formatFreshness(updatedAt);
  return (
    <header style={{ marginBottom: 'clamp(18px, 2.6vh, 30px)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '5px 12px', borderRadius: 99,
          background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.4)',
          fontSize: 11, fontWeight: 800, color: '#d8b4fe',
          letterSpacing: '0.18em', textTransform: 'uppercase',
        }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: 99, background: '#a855f7', boxShadow: '0 0 8px rgba(168,85,247,0.6)' }} />
          {department} · Live agent states
        </span>
        <Link href="/" style={{
          fontSize: 12, fontWeight: 600, color: '#64748b',
          textDecoration: 'none', letterSpacing: '0.06em',
        }}>← Boards</Link>
      </div>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap',
        justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{
            fontSize: 'clamp(22px, 3vw, 38px)', fontWeight: 800,
            color: '#f1f5f9', lineHeight: 1.1, margin: 0,
          }}>{title}</h1>
          <div style={{
            fontSize: 13, fontWeight: 600, color: '#94a3b8',
            marginTop: 6, letterSpacing: '0.04em',
          }}>
            <strong style={{ color: '#f1f5f9' }}>{signedIn}</strong> of {rosterTotal} signed in
          </div>
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 12px', borderRadius: 99,
          background: stale ? 'rgba(248,113,113,0.1)' : 'rgba(16,185,129,0.1)',
          border: `1px solid ${stale ? 'rgba(248,113,113,0.4)' : 'rgba(16,185,129,0.4)'}`,
          fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
          color: stale ? '#fca5a5' : '#86efac',
        }}>
          <span aria-hidden style={{
            width: 8, height: 8, borderRadius: 99,
            background: stale ? '#f87171' : '#10b981',
            boxShadow: `0 0 8px ${stale ? 'rgba(248,113,113,0.6)' : 'rgba(16,185,129,0.6)'}`,
            animation: loading ? 'wb-online-pulse 1.4s ease-in-out infinite' : undefined,
          }} />
          {fresh}
        </div>
      </div>
    </header>
  );
}

// ─── Tier ──────────────────────────────────────────────────────────────
// A row of status lanes sharing a tier accent + label. Lanes auto-fit
// to the available width; on mobile they stack one per row.

function Tier({ label, accent, lanes, minColWidth, compact = false, showOfficeChip = false }: {
  label:           string;
  accent:          string;
  lanes:           { status: string; agents: LiveAgent[] }[];
  minColWidth:     number;
  compact?:        boolean;
  showOfficeChip?: boolean;
}) {
  const total = lanes.reduce((s, l) => s + l.agents.length, 0);
  return (
    <section>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 10, padding: '0 2px',
      }}>
        <span aria-hidden style={{
          width: 7, height: 7, borderRadius: 99, background: accent,
          boxShadow: `0 0 10px ${accent}aa`,
        }} />
        <h2 style={{
          fontSize: 11, fontWeight: 800,
          color: accent, letterSpacing: '0.22em', textTransform: 'uppercase',
          margin: 0,
        }}>{label}</h2>
        <span style={{
          color: '#475569', fontWeight: 700, fontSize: 11,
          padding: '2px 7px', borderRadius: 99,
          background: 'rgba(255,255,255,0.04)',
        }}>{total}</span>
      </div>
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minColWidth}px), 1fr))`,
        alignItems: 'flex-start',
      }}>
        {lanes.map(lane => (
          <Lane key={lane.status} lane={lane} compact={compact} showOfficeChip={showOfficeChip} />
        ))}
      </div>
    </section>
  );
}

// ─── Lane ──────────────────────────────────────────────────────────────
// One status column. Header shows the status + count, tinted with the
// status accent. Body lists agents (full tiles for active/alert tiers,
// compact name rows for the away tier).

function Lane({ lane, compact, showOfficeChip }: {
  lane: { status: string; agents: LiveAgent[] };
  compact: boolean;
  showOfficeChip: boolean;
}) {
  const meta = STATUS_META[lane.status] || NEUTRAL_META;
  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${meta.tint}55`,
      background: `linear-gradient(180deg, ${meta.tint}10 0%, rgba(20,26,46,0.5) 60%)`,
      padding: 'clamp(10px, 1.4vh, 14px) 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        paddingBottom: 6,
        borderBottom: `1px solid ${meta.tint}33`,
      }}>
        <span aria-hidden style={{
          width: 7, height: 7, borderRadius: 99,
          background: meta.tint, boxShadow: `0 0 8px ${meta.glow}`,
          alignSelf: 'center',
        }} />
        <span style={{
          fontSize: 12, fontWeight: 800, color: meta.tint,
          letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>{meta.label}</span>
        <span style={{
          fontSize: 13, fontWeight: 800, color: '#f1f5f9',
          marginLeft: 'auto', fontVariantNumeric: 'tabular-nums',
        }}>{lane.agents.length}</span>
      </div>

      <div style={{
        display: 'grid',
        gap: compact ? 4 : 6,
        // Horizontal grid — tiles flow across the lane's available width
        // instead of stacking in one tall column. Min cell width is the
        // smallest size each tile still reads cleanly at; auto-fit packs
        // as many columns as fit. On a TV this means a single populated
        // status lane fills the row width with 4-7 tiles per line
        // instead of one centred name per line.
        gridTemplateColumns: compact
          ? 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))'
          : 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
      }}>
        {lane.agents.map(a =>
          compact
            ? <CompactRow key={a.name + a.office} agent={a} showOfficeChip={showOfficeChip} />
            : <Tile       key={a.name + a.office} agent={a} accent={meta.tint} showOfficeChip={showOfficeChip} />
        )}
      </div>
    </div>
  );
}

// ─── Tile (active / alert tiers) ───────────────────────────────────────

function Tile({ agent, accent, showOfficeChip }: {
  agent: LiveAgent; accent: string; showOfficeChip: boolean;
}) {
  const rim = agent.concern ? '#f87171' : `${accent}33`;
  return (
    <div style={{
      borderRadius: 9, padding: '8px 10px',
      background: 'rgba(14,20,39,0.72)',
      border: `1px solid ${rim}`,
      boxShadow: agent.concern ? `0 0 16px rgba(248,113,113,0.22)` : undefined,
      display: 'flex', alignItems: 'center', gap: 8,
      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    }}>
      {showOfficeChip && <OfficeChip office={agent.office} />}
      <span style={{
        flex: 1, minWidth: 0,
        fontSize: 14, fontWeight: 700, color: '#f1f5f9',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {parseAgentName(agent.name).display}
      </span>
      <span style={{
        flexShrink: 0,
        fontSize: 11, fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: agent.concern ? '#fca5a5' : '#94a3b8',
        textShadow: agent.concern ? '0 0 6px rgba(248,113,113,0.4)' : undefined,
      }}>
        {formatDuration(agent.livetime)}
      </span>
    </div>
  );
}

// ─── Compact row (away tier — names only, less ink) ─────────────────────

function CompactRow({ agent, showOfficeChip }: {
  agent: LiveAgent; showOfficeChip: boolean;
}) {
  // Time-in-state has no meaning for "Not logged in" — those tiles are
  // padded server-side with time=0, so suppress it rather than showing
  // a misleading "0s".
  const showTime = agent.status !== 'Not logged in';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 6px',
      fontSize: 13,
      color: agent.status === 'Not logged in' ? '#94a3b8' : '#cbd5e1',
    }}>
      {showOfficeChip && <OfficeChip office={agent.office} compact />}
      <span style={{
        flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{parseAgentName(agent.name).display}</span>
      {showTime && (
        <span style={{
          fontSize: 11, color: '#64748b',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {formatDuration(agent.livetime)}
        </span>
      )}
    </div>
  );
}

// ─── Office chip — single letter pill so the source still reads at a
// glance without claiming a layout column. Drift / unmatched agents get
// '?' in muted grey so they're visible but not alarming.

function OfficeChip({ office, compact = false }: { office: string | null; compact?: boolean }) {
  const letter = office ? office[0].toUpperCase() : '?';
  const tint = office === 'London'    ? { fg: '#a5b4fc', bg: 'rgba(99,102,241,0.18)',  border: 'rgba(99,102,241,0.4)'  }
            : office === 'Guildford'  ? { fg: '#7dd3fc', bg: 'rgba(56,189,248,0.18)',  border: 'rgba(56,189,248,0.4)'  }
            :                           { fg: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)' };
  const sz = compact ? 16 : 18;
  return (
    <span aria-label={office ? `Office: ${office}` : 'Office unknown'} title={office || 'Unmatched'} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: sz, height: sz, borderRadius: 5,
      background: tint.bg, border: `1px solid ${tint.border}`,
      color: tint.fg, fontSize: 9, fontWeight: 800,
      letterSpacing: 0, flexShrink: 0,
    }}>{letter}</span>
  );
}

// ─── Queue strip — top of the board on kiosk-bound TVs ─────────────────
//
// Big-number summary of inbound call traffic, the question a floor
// manager glances at first ("how many customers are on hold right
// now?"). Each metric colour-codes by threshold so it reads from
// across the room: green = healthy, amber = watch, red = act.

function QueueStrip({ queues }: { queues: QueueSummary[] }) {
  return (
    <section style={{
      display: 'grid', gap: 'clamp(10px, 1.4vh, 16px)',
    }}>
      {queues.map(q => (
        <QueueGroup key={q.label} q={q} />
      ))}
    </section>
  );
}

function QueueGroup({ q }: { q: QueueSummary }) {
  // Continuous In-queue ramp — white at 0, ladders through yellow /
  // orange / red / deep red the longer the queue gets. Pulses whenever
  // the count is above zero so a TV across the room broadcasts pressure
  // even before anyone reads the digits.
  const inQueueLook    = inQueueAppearance(q.in_queue);
  const longestColor   = q.longest_wait < 30    ? STAT_GREEN
                       : q.longest_wait < 120   ? STAT_AMBER
                       :                          STAT_RED;
  const abandonColor   = q.abandon_pct < 5      ? STAT_GREEN
                       : q.abandon_pct < 10     ? STAT_AMBER
                       :                          STAT_RED;
  return (
    <div style={{
      borderRadius: 14,
      border: '1px solid rgba(255,255,255,0.06)',
      background: 'linear-gradient(180deg, rgba(99,102,241,0.10) 0%, rgba(20,26,46,0.55) 70%)',
      padding: 'clamp(10px, 1.6vh, 16px) clamp(14px, 2vw, 22px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 'clamp(8px, 1.2vh, 12px)' }}>
        <span aria-hidden style={{
          fontSize: 'clamp(16px, 1.8vw, 22px)', lineHeight: 1,
        }}>📞</span>
        <h2 style={{
          fontSize: 'clamp(11px, 1vw, 14px)', fontWeight: 800,
          color: '#a5b4fc', letterSpacing: '0.22em', textTransform: 'uppercase',
          margin: 0,
        }}>{q.label}</h2>
        {q.queues_matched.length > 0 && (
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
            {q.queues_matched.length} {q.queues_matched.length === 1 ? 'queue' : 'queues'}
          </span>
        )}
      </div>
      <div style={{
        display: 'grid', gap: 'clamp(10px, 1.6vw, 18px)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
      }}>
        <BigStat label="In queue"     value={String(q.in_queue)}              tint={inQueueLook.tint} pulseColor={inQueueLook.pulse} />
        <BigStat label="Longest wait" value={formatWait(q.longest_wait)}      tint={longestColor} sub={q.longest_wait > 0 ? 'right now' : undefined} />
        <BigStat label="Answered"     value={`${q.answered}`}                 tint={STAT_NEUTRAL} sub={`of ${q.offered} offered today`} />
        <BigStat label="Abandoned"    value={`${q.abandon_pct}%`}             tint={abandonColor} sub={`${q.abandoned} today · avg wait ${formatWait(q.average_wait)}`} />
      </div>
    </div>
  );
}

function BigStat({ label, value, tint, sub, pulseColor }: {
  label: string; value: string; tint: { fg: string; glow: string }; sub?: string;
  /** When set, the tile pulses the given colour (used for In-queue
   *  severity). Pass undefined / null to disable the pulse. */
  pulseColor?: string | null;
}) {
  return (
    <div
      style={{
        borderRadius: 12, padding: 'clamp(10px, 1.4vh, 14px) clamp(12px, 1.4vw, 16px)',
        background: 'rgba(14,20,39,0.6)',
        border: `1px solid ${tint.fg}33`,
        display: 'flex', flexDirection: 'column', gap: 6,
        // CSS custom prop drives the @keyframes wb-queue-pulse ring;
        // unset means "no pulse" because the keyframe falls back to
        // transparent.
        ...(pulseColor ? {
          ['--queue-pulse' as any]: pulseColor,
          animation: 'wb-queue-pulse 1.6s ease-in-out infinite',
        } : null),
      }}
    >
      <div style={{
        fontSize: 'clamp(10px, 0.85vw, 12px)', fontWeight: 800,
        color: '#94a3b8', letterSpacing: '0.18em', textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        fontSize: 'clamp(28px, 4vw, 50px)', fontWeight: 800, lineHeight: 1,
        color: tint.fg, fontVariantNumeric: 'tabular-nums',
        textShadow: `0 0 22px ${tint.glow}`,
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 'clamp(10px, 0.8vw, 12px)', color: '#64748b', fontWeight: 600 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** Continuous severity ramp for the In-queue stat — stays inside the
 *  InsureTec dashboard palette. White at 0, soft yellow at 1, amber
 *  at 2-3, orange at 4-7, and the same #f87171 the Hold / Not-ready
 *  lanes use from 8 onwards (no fire-engine deep reds). Higher counts
 *  bump the pulse intensity rather than darkening the colour, so a
 *  busy queue still reads urgent without breaking the brand language. */
function inQueueAppearance(n: number): {
  tint:  { fg: string; glow: string };
  pulse: string | null;
} {
  if (n <= 0) {
    return { tint: { fg: '#f1f5f9', glow: 'rgba(241,245,249,0.18)' }, pulse: null };
  }
  if (n === 1) {
    return { tint: { fg: '#fde68a', glow: 'rgba(253,230,138,0.35)' }, pulse: 'rgba(253,230,138,0.32)' };
  }
  if (n <= 3) {
    return { tint: { fg: '#fbbf24', glow: 'rgba(251,191,36,0.32)' },  pulse: 'rgba(251,191,36,0.30)' };
  }
  if (n <= 7) {
    return { tint: { fg: '#fb923c', glow: 'rgba(251,146,60,0.34)' },  pulse: 'rgba(251,146,60,0.34)' };
  }
  if (n <= 12) {
    return { tint: { fg: '#f87171', glow: 'rgba(248,113,113,0.34)' }, pulse: 'rgba(248,113,113,0.36)' };
  }
  // 13+ — stay on #f87171, lift the pulse a touch so the tile feels
  // more insistent without the colour going darker / angrier.
  return     { tint: { fg: '#f87171', glow: 'rgba(248,113,113,0.4)' },  pulse: 'rgba(248,113,113,0.5)' };
}

const STAT_GREEN   = { fg: '#10b981', glow: 'rgba(16,185,129,0.3)' };
const STAT_AMBER   = { fg: '#fbbf24', glow: 'rgba(251,191,36,0.32)' };
const STAT_RED     = { fg: '#f87171', glow: 'rgba(248,113,113,0.32)' };
const STAT_NEUTRAL = { fg: '#f1f5f9', glow: 'rgba(241,245,249,0.18)' };

function formatWait(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '–';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

// ─── Drift footer — surface unmatched agents on per-office boards ─────
//
// Cross-office spelling drift (Noetica says "Reobuck", Gecko says
// "Roebuck") leaves agents matching neither roster. Hiding them from
// the lanes keeps the wrong-board misplacement off the screen, but
// dropping them silently would let drift go unnoticed for weeks.
// Compromise: a small amber pill with the count, names available on
// hover / tap.

function DriftFooter({ rows }: { rows: AgentRow[] }) {
  const names = rows.map(r => parseAgentName(r.name).clean).join(', ');
  return (
    <details style={{
      borderRadius: 10,
      border: '1px solid rgba(251,191,36,0.3)',
      background: 'rgba(251,191,36,0.06)',
      padding: '8px 14px',
      fontSize: 12, color: '#fcd34d',
    }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, letterSpacing: '0.06em' }}>
        ⚠ {rows.length} {rows.length === 1 ? 'agent' : 'agents'} not matched to either office roster
      </summary>
      <div style={{ marginTop: 8, color: '#94a3b8', fontWeight: 500, lineHeight: 1.6 }}>
        {names}. Likely a Noetica/Gecko spelling drift — fix the name in either source so the agent shows up on the right board.
      </div>
    </details>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  if (s < 60)        return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60)        return `${m}m ${r.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const mr = m % 60;
  return `${h}h ${mr.toString().padStart(2, '0')}m`;
}

function formatFreshness(updatedAt: string | null): string {
  if (!updatedAt) return 'no data';
  const ms = Date.now() - new Date(updatedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 15)       return 'live';
  if (s < 60)       return `${s}s old`;
  const m = Math.floor(s / 60);
  if (m < 60)       return `${m}m old`;
  return `${Math.floor(m / 60)}h old`;
}

const errorBoxStyle: React.CSSProperties = {
  padding: 'clamp(28px, 5vh, 56px)', textAlign: 'center',
  background: 'rgba(20,26,46,0.6)', border: '1px solid rgba(248,113,113,0.4)',
  borderRadius: 14, color: '#94a3b8', marginTop: 24,
};
