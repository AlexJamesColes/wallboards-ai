'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

interface Props {
  slug:         string;
  title:        string;
  department:   string;
}

const POLL_MS = 10_000;

/** Status → visual treatment. The "concern" flag pushes the tile up the
 *  sort order within its office so anyone stuck (long Hold, long PNR)
 *  surfaces first. Anything outside this map renders neutral grey. */
const STATUS_LOOKUP: Record<string, { tint: string; glow: string; concern: boolean; label?: string }> = {
  'Talking':              { tint: '#10b981', glow: 'rgba(16,185,129,0.45)',  concern: false },
  'Waiting':              { tint: '#38bdf8', glow: 'rgba(56,189,248,0.45)',  concern: false },
  'Wrap':                 { tint: '#fbbf24', glow: 'rgba(251,191,36,0.45)',  concern: false },
  'Completed':            { tint: '#a855f7', glow: 'rgba(168,85,247,0.45)',  concern: false },
  'Consult':              { tint: '#7dd3fc', glow: 'rgba(125,211,252,0.4)',  concern: false },
  'Transferred':          { tint: '#86efac', glow: 'rgba(134,239,172,0.4)',  concern: false },
  'Hold':                 { tint: '#fb923c', glow: 'rgba(251,146,60,0.55)',  concern: true,  label: 'Hold' },
  'Permitted Not Ready':  { tint: '#f87171', glow: 'rgba(248,113,113,0.55)', concern: true,  label: 'PNR' },
  'Lunch':                { tint: '#94a3b8', glow: 'rgba(148,163,184,0.35)', concern: false },
  'Comfort Break':        { tint: '#94a3b8', glow: 'rgba(148,163,184,0.35)', concern: false, label: 'Break' },
};

const NEUTRAL = { tint: '#64748b', glow: 'rgba(100,116,139,0.35)', concern: false } as const;

/** Status sort order so a status header strip reads consistently — most
 *  active first, then concerning, then breaks. Anything not listed sinks
 *  to the bottom. */
const STATUS_ORDER = [
  'Talking', 'Waiting', 'Wrap', 'Completed', 'Consult', 'Transferred',
  'Hold', 'Permitted Not Ready', 'Lunch', 'Comfort Break',
];

/** Concerning-state thresholds in seconds. Past these, the tile gets a
 *  red rim and the time-in-state text glows so the floor manager spots
 *  it from across the room. Calibrated to match what felt "off" looking
 *  at the live data — Hold > 1 min, PNR > 5 min. */
const CONCERN_THRESHOLDS: Record<string, number> = {
  'Hold':                60,
  'Permitted Not Ready': 5 * 60,
  'Wrap':                3 * 60,
};

export default function AgentStatesView({ slug, title, department }: Props) {
  const [data,    setData]    = useState<Payload | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick,    setTick]    = useState(0);

  // Heartbeat — re-render every second so time-in-state counters tick
  // forwards between server polls. Cheap because each tile reads the
  // shared `now` and re-formats locally.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Server poll — refresh dataset rows + roster join every 10s.
  const lastFetchedAt = useRef<number>(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/agent-states/${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d: Payload) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        lastFetchedAt.current = Date.now();
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, tick]);

  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), POLL_MS);
    return () => clearInterval(iv);
  }, []);

  // Time advance for in-state counters: seconds since the dataset's
  // updated_at. Floor at 0 so a clock skew between server + browser
  // doesn't produce negative ages.
  const elapsedSinceFetch = useMemo(() => {
    if (!data?.updated_at) return 0;
    const t = new Date(data.updated_at).getTime();
    return Math.max(0, Math.floor((now - t) / 1000));
  }, [now, data?.updated_at]);

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
        elapsedSinceFetch={elapsedSinceFetch}
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
        <>
          {/* Office blocks — desktop sits them side by side, mobile stacks */}
          <div style={{
            display: 'grid', gap: 'clamp(16px, 2.4vh, 28px)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
          }}>
            {data.offices.map(office => (
              <OfficeColumn
                key={office.label}
                office={office}
                elapsedSinceFetch={elapsedSinceFetch}
              />
            ))}
          </div>

          {data.unmatched.length > 0 && (
            <UnmatchedFooter
              rows={data.unmatched}
              elapsedSinceFetch={elapsedSinceFetch}
            />
          )}
        </>
      )}

      {!data && !error && loading && (
        <div style={{ color: '#475569', fontSize: 14, padding: 32, textAlign: 'center' }}>
          Loading agent states…
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
//  Header — title + freshness + global status counts
// ────────────────────────────────────────────────────────────────────

function Header({ title, department, loading, updatedAt, elapsedSinceFetch }: {
  title: string; department: string; loading: boolean;
  updatedAt: string | null; elapsedSinceFetch: number;
}) {
  const fresh = useMemo(() => formatFreshness(updatedAt, elapsedSinceFetch), [updatedAt, elapsedSinceFetch]);
  const stale = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) > 60_000 : true;
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
        <h1 style={{
          fontSize: 'clamp(22px, 3vw, 38px)', fontWeight: 800,
          color: '#f1f5f9', lineHeight: 1.1, margin: 0,
        }}>{title}</h1>
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

// ────────────────────────────────────────────────────────────────────
//  Office column — header strip + agent grid
// ────────────────────────────────────────────────────────────────────

function OfficeColumn({ office, elapsedSinceFetch }: {
  office: OfficeBlock; elapsedSinceFetch: number;
}) {
  // Live time-in-state for sorting + display.
  const enriched = useMemo(() => office.agents.map(a => ({
    ...a,
    livetime: a.time_in_state + elapsedSinceFetch,
  })), [office.agents, elapsedSinceFetch]);

  // Status tally for the header strip.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of enriched) m.set(a.status, (m.get(a.status) || 0) + 1);
    return STATUS_ORDER
      .filter(s => m.has(s))
      .map(s => ({ status: s, count: m.get(s)! }))
      .concat(
        [...m.entries()]
          .filter(([s]) => !STATUS_ORDER.includes(s))
          .map(([status, count]) => ({ status, count })),
      );
  }, [enriched]);

  // Sort: concerning first, then status-order index, then longest time first.
  const sorted = useMemo(() => {
    const idx = (s: string) => {
      const i = STATUS_ORDER.indexOf(s);
      return i < 0 ? 999 : i;
    };
    return [...enriched].sort((a, b) => {
      const aLook = STATUS_LOOKUP[a.status] || NEUTRAL;
      const bLook = STATUS_LOOKUP[b.status] || NEUTRAL;
      const aConcern = aLook.concern && a.livetime >= (CONCERN_THRESHOLDS[a.status] ?? Infinity);
      const bConcern = bLook.concern && b.livetime >= (CONCERN_THRESHOLDS[b.status] ?? Infinity);
      if (aConcern !== bConcern) return aConcern ? -1 : 1;
      const ai = idx(a.status), bi = idx(b.status);
      if (ai !== bi) return ai - bi;
      return b.livetime - a.livetime;
    });
  }, [enriched]);

  return (
    <section style={{
      borderRadius: 14,
      border: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(20,26,46,0.5)',
      padding: 'clamp(14px, 2vh, 22px)',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{
          fontSize: 'clamp(15px, 1.4vw, 19px)', fontWeight: 800,
          color: '#f1f5f9', lineHeight: 1, margin: 0,
        }}>
          {office.label}
        </h2>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em' }}>
          {enriched.length} {enriched.length === 1 ? 'agent' : 'agents'}
        </span>
      </div>

      {counts.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {counts.map(({ status, count }) => {
            const look = STATUS_LOOKUP[status] || NEUTRAL;
            return (
              <span key={status} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 9px', borderRadius: 99,
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${look.tint}66`,
                fontSize: 11, fontWeight: 700,
                color: look.tint, letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
              }}>
                <span aria-hidden style={{
                  width: 6, height: 6, borderRadius: 99,
                  background: look.tint, boxShadow: `0 0 8px ${look.glow}`,
                }} />
                {look.label || status} · <strong style={{ color: '#f1f5f9' }}>{count}</strong>
              </span>
            );
          })}
        </div>
      )}

      {enriched.length === 0 ? (
        <div style={{
          padding: '24px 12px', textAlign: 'center',
          fontSize: 13, color: '#64748b',
          background: 'rgba(255,255,255,0.02)',
          border: '1px dashed rgba(255,255,255,0.08)',
          borderRadius: 10,
        }}>
          No agents from {office.label} are signed into Noetica right now.
        </div>
      ) : (
        <div style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
        }}>
          {sorted.map(a => (
            <AgentTile key={a.name} agent={a} livetime={a.livetime} />
          ))}
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
//  Agent tile — name + status pill + time-in-state, optional alert rim
// ────────────────────────────────────────────────────────────────────

function AgentTile({ agent, livetime }: { agent: AgentRow & { livetime: number }; livetime: number }) {
  const look = STATUS_LOOKUP[agent.status] || NEUTRAL;
  const threshold = CONCERN_THRESHOLDS[agent.status];
  const overThreshold = look.concern && threshold != null && livetime >= threshold;

  const rimColor = overThreshold ? '#f87171'
                : look.concern   ? `${look.tint}80`
                :                  'rgba(255,255,255,0.08)';

  return (
    <div style={{
      borderRadius: 11, padding: '10px 12px',
      background: 'rgba(14,20,39,0.7)',
      border: `1px solid ${rimColor}`,
      boxShadow: overThreshold ? `0 0 18px rgba(248,113,113,0.25)` : undefined,
      display: 'flex', flexDirection: 'column', gap: 6,
      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    }}>
      <div style={{
        fontSize: 13, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.25,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {agent.name}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 8px', borderRadius: 99,
          background: `${look.tint}1f`,
          border: `1px solid ${look.tint}66`,
          fontSize: 10.5, fontWeight: 800,
          color: look.tint, letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
        }}>
          <span aria-hidden style={{
            width: 6, height: 6, borderRadius: 99,
            background: look.tint, boxShadow: `0 0 6px ${look.glow}`,
          }} />
          {look.label || agent.status}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: overThreshold ? '#fca5a5' : '#94a3b8',
          textShadow: overThreshold ? '0 0 8px rgba(248,113,113,0.4)' : undefined,
        }}>
          {formatDuration(livetime)}
        </span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
//  Footer — agents in the dataset who didn't match either roster.
//  Surfaces silently so a Noetica/Gecko spelling drift doesn't hide
//  agents from the board for weeks before someone notices.
// ────────────────────────────────────────────────────────────────────

function UnmatchedFooter({ rows, elapsedSinceFetch }: {
  rows: AgentRow[]; elapsedSinceFetch: number;
}) {
  return (
    <details style={{
      marginTop: 22,
      borderRadius: 12,
      border: '1px solid rgba(251,191,36,0.3)',
      background: 'rgba(251,191,36,0.06)',
      padding: '10px 14px',
    }}>
      <summary style={{
        cursor: 'pointer', fontSize: 12, fontWeight: 700,
        color: '#fcd34d', letterSpacing: '0.06em',
      }}>
        ⚠ {rows.length} {rows.length === 1 ? 'agent' : 'agents'} not matched to a roster
      </summary>
      <div style={{ display: 'grid', gap: 6, marginTop: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))' }}>
        {rows.map(a => (
          <AgentTile
            key={a.name}
            agent={{ ...a, livetime: a.time_in_state + elapsedSinceFetch }}
            livetime={a.time_in_state + elapsedSinceFetch}
          />
        ))}
      </div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────

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

function formatFreshness(updatedAt: string | null, _elapsed: number): string {
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
