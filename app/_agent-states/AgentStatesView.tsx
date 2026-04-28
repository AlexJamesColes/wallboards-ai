'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

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

interface Payload {
  slug:         string;
  dataset_name: string;
  updated_at:   string | null;
  offices:      OfficeBlock[];
  unmatched:    AgentRow[];
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

const STATUS_META: Record<string, StatusMeta> = {
  'Hold':                 { label: 'Hold',       tint: '#fb923c', glow: 'rgba(251,146,60,0.55)',  tier: 'alert',  concernSec: 60 },
  'Permitted Not Ready':  { label: 'Not ready',  tint: '#f87171', glow: 'rgba(248,113,113,0.55)', tier: 'alert',  concernSec: 5 * 60 },
  'Talking':              { label: 'Talking',    tint: '#10b981', glow: 'rgba(16,185,129,0.45)',  tier: 'active' },
  'Waiting':              { label: 'Waiting',    tint: '#38bdf8', glow: 'rgba(56,189,248,0.45)',  tier: 'active' },
  'Wrap':                 { label: 'Wrap',       tint: '#fbbf24', glow: 'rgba(251,191,36,0.45)',  tier: 'active', concernSec: 3 * 60 },
  'Completed':            { label: 'Completed',  tint: '#a855f7', glow: 'rgba(168,85,247,0.45)',  tier: 'active' },
  'Consult':              { label: 'Consult',    tint: '#7dd3fc', glow: 'rgba(125,211,252,0.4)',  tier: 'active' },
  'Transferred':          { label: 'Transferred',tint: '#86efac', glow: 'rgba(134,239,172,0.4)',  tier: 'active' },
  'Lunch':                { label: 'Lunch',      tint: '#94a3b8', glow: 'rgba(148,163,184,0.35)', tier: 'away' },
  'Comfort Break':        { label: 'Break',      tint: '#94a3b8', glow: 'rgba(148,163,184,0.35)', tier: 'away' },
  // Synthetic status the server pads each office with when a roster
  // member doesn't appear in the Noetica feed at all. Visually muted
  // because it's "not at their desk" rather than a real working state.
  'Not logged in':        { label: 'Not logged in', tint: '#475569', glow: 'rgba(71,85,105,0.25)', tier: 'away' },
};

const NEUTRAL_META: StatusMeta = {
  label: 'Unknown', tint: '#64748b', glow: 'rgba(100,116,139,0.35)', tier: 'active',
};

/** Lane order within each tier — shapes the left-to-right reading order
 *  on desktop. Top of each tier list = most prominent placement. */
const ALERT_ORDER  = ['Hold', 'Permitted Not Ready'];
const ACTIVE_ORDER = ['Talking', 'Wrap', 'Waiting', 'Completed', 'Consult', 'Transferred'];
const AWAY_ORDER   = ['Lunch', 'Comfort Break', 'Not logged in'];

// ─── Component ──────────────────────────────────────────────────────────

export default function AgentStatesView({ slug, title, department }: Props) {
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

  // Flatten — all agents in one list with an office tag. Unmatched rows
  // come along with a null office so they still show up in the right
  // status lane rather than being banished to a footer.
  const agents = useMemo<LiveAgent[]>(() => {
    if (!data) return [];
    const out: LiveAgent[] = [];
    for (const office of data.offices) {
      for (const a of office.agents) {
        const meta = STATUS_META[a.status] || NEUTRAL_META;
        const livetime = a.time_in_state + elapsedSinceFetch;
        out.push({
          ...a,
          office:   office.label,
          livetime,
          concern:  !!(meta.concernSec && livetime >= meta.concernSec),
        });
      }
    }
    for (const a of data.unmatched) {
      const meta = STATUS_META[a.status] || NEUTRAL_META;
      const livetime = a.time_in_state + elapsedSinceFetch;
      out.push({
        ...a,
        office:   null,
        livetime,
        concern:  !!(meta.concernSec && livetime >= meta.concernSec),
      });
    }
    return out;
  }, [data, elapsedSinceFetch]);

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
          {alertLanes.length > 0 && (
            <Tier
              key="alert"
              label="Needs attention"
              accent="#f87171"
              lanes={alertLanes}
              minColWidth={220}
            />
          )}
          {activeLanes.length > 0 && (
            <Tier
              key="active"
              label="On the floor"
              accent="#10b981"
              lanes={activeLanes}
              minColWidth={220}
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
            />
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

function Tier({ label, accent, lanes, minColWidth, compact = false }: {
  label:        string;
  accent:       string;
  lanes:        { status: string; agents: LiveAgent[] }[];
  minColWidth:  number;
  compact?:     boolean;
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
          <Lane key={lane.status} lane={lane} compact={compact} />
        ))}
      </div>
    </section>
  );
}

// ─── Lane ──────────────────────────────────────────────────────────────
// One status column. Header shows the status + count, tinted with the
// status accent. Body lists agents (full tiles for active/alert tiers,
// compact name rows for the away tier).

function Lane({ lane, compact }: {
  lane: { status: string; agents: LiveAgent[] }; compact: boolean;
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 4 : 6 }}>
        {lane.agents.map(a =>
          compact
            ? <CompactRow key={a.name + a.office} agent={a} />
            : <Tile       key={a.name + a.office} agent={a} accent={meta.tint} />
        )}
      </div>
    </div>
  );
}

// ─── Tile (active / alert tiers) ───────────────────────────────────────

function Tile({ agent, accent }: { agent: LiveAgent; accent: string }) {
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
      <OfficeChip office={agent.office} />
      <span style={{
        flex: 1, minWidth: 0,
        fontSize: 13, fontWeight: 700, color: '#f1f5f9',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {agent.name}
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

function CompactRow({ agent }: { agent: LiveAgent }) {
  // Time-in-state has no meaning for "Not logged in" — those tiles are
  // padded server-side with time=0, so suppress it rather than showing
  // a misleading "0s".
  const showTime = agent.status !== 'Not logged in';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 6px',
      fontSize: 12,
      color: agent.status === 'Not logged in' ? '#94a3b8' : '#cbd5e1',
    }}>
      <OfficeChip office={agent.office} compact />
      <span style={{
        flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{agent.name}</span>
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
