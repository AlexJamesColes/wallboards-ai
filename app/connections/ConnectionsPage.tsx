'use client';

import { useEffect, useState } from 'react';
import BrowseHeader from '../_browse/BrowseHeader';

interface Health { ok: boolean; error: string | null; }
interface MssqlHealth   extends Health { database?: string;  user?: string; }
interface ZendeskHealth extends Health { subdomain?: string; accountName?: string; }
interface NoeticaHealth extends Health { count: number; names: string[]; }

interface Payload {
  mssql:   MssqlHealth;
  zendesk: ZendeskHealth;
  noetica: NoeticaHealth;
}

export default function ConnectionsPage() {
  const [data, setData]       = useState<Payload | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/connections', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then(d => { if (!cancelled) { setData(d); setError(null); } })
      .catch(e => { if (!cancelled) setError(e?.message || 'Could not load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 20% 0%, #1a1f3a 0%, #0a0f1c 60%, #050813 100%)',
      color: '#f1f5f9', fontFamily: 'var(--font-raleway, sans-serif)',
      padding: 'clamp(24px, 5vh, 64px) clamp(16px, 4vw, 48px)',
    }}>
      <BrowseHeader
        right={
          <button
            onClick={() => setRefreshTick(t => t + 1)}
            disabled={loading}
            style={{
              padding: '8px 14px', borderRadius: 99,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#94a3b8', fontSize: 12, fontWeight: 700,
              letterSpacing: '0.04em', cursor: loading ? 'wait' : 'pointer',
              fontFamily: 'inherit', opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Checking…' : '↻ Re-check'}
          </button>
        }
      />

      <h1 style={{ fontSize: 'clamp(22px, 2.6vw, 34px)', fontWeight: 800, color: '#f1f5f9', marginBottom: 4 }}>
        Connections
      </h1>
      <p style={{ fontSize: 'clamp(13px, 1vw, 16px)', color: '#94a3b8', marginBottom: 28 }}>
        Live status of every data source feeding the wallboards. A red light here usually explains why a board's gone quiet.
      </p>

      {error && (
        <div style={{ color: '#f87171', padding: 24, fontSize: 14 }}>Couldn't load: {error}</div>
      )}

      {!error && (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          <MssqlCard   health={data?.mssql}   loading={loading && !data} />
          <ZendeskCard health={data?.zendesk} loading={loading && !data} />
          <NoeticaCard health={data?.noetica} loading={loading && !data} />
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Per-source cards. Each one knows enough about its own data shape to
//  surface the identifying detail (database name / subdomain / dataset
//  names) prominently — that's the whole point of the page.
// ────────────────────────────────────────────────────────────────────────

function MssqlCard({ health, loading }: { health: MssqlHealth | undefined; loading: boolean }) {
  const status = pickStatus(health);
  return (
    <ConnectionCard
      icon="🗄️"
      name="MS-SQL · Sales database"
      status={status}
      headline={health?.database
        ? <>Database <code style={codeStyle}>{health.database}</code>{health.user && <> · user <code style={codeStyle}>{health.user}</code></>}</>
        : null}
      description="Drives the agent leaderboards (Income MTD, Income Today, Policies). Queried on every showcase data poll."
      detail={statusDetail(status, health, loading)}
    />
  );
}

function ZendeskCard({ health, loading }: { health: ZendeskHealth | undefined; loading: boolean }) {
  const status = pickStatus(health);
  const headline = health?.subdomain ? (
    <>
      Account{health.accountName && <> <strong style={{ color: '#f1f5f9' }}>{health.accountName}</strong></>}
      {' '}· <code style={codeStyle}>{health.subdomain}.zendesk.com</code>
    </>
  ) : null;
  return (
    <ConnectionCard
      icon="🎫"
      name="Zendesk · Support tickets"
      status={status}
      headline={headline}
      description="Source for ticket counts, leaderboards and the Laziest Manager comedy slide. Fetched per-widget."
      detail={statusDetail(status, health, loading)}
    />
  );
}

function NoeticaCard({ health, loading }: { health: NoeticaHealth | undefined; loading: boolean }) {
  const status = pickStatus(health);
  return (
    <ConnectionCard
      icon="📥"
      name="Datasets · Webhook push"
      status={status}
      headline={
        health && health.count > 0
          ? <>{health.count} {health.count === 1 ? 'dataset' : 'datasets'} stored</>
          : null
      }
      description="Generic key/value dataset store. Anything pushed to /api/datasets/<name>/data ends up here for widgets to consume."
      detail={
        // For datasets, the "detail" is the list of names rather than the
        // generic status line — much more informative.
        loading && !health ? (
          <span style={{ color: '#64748b' }}>Querying…</span>
        ) : health && health.names.length > 0 ? (
          <DatasetChips names={health.names} />
        ) : (
          <span style={{ color: '#64748b' }}>{health?.error || 'No datasets'}</span>
        )
      }
    />
  );
}

function DatasetChips({ names }: { names: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {names.map(n => (
        <code key={n} style={{
          ...codeStyle,
          padding: '4px 8px', fontSize: 11, color: '#cbd5e1',
        }}>{n}</code>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Shared card chrome
// ────────────────────────────────────────────────────────────────────────

type Status = 'ok' | 'down' | 'unknown';

const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11.5, fontWeight: 700,
  color: '#a5b4fc',
  background: 'rgba(99,102,241,0.12)',
  border: '1px solid rgba(99,102,241,0.22)',
  padding: '2px 6px', borderRadius: 5,
  letterSpacing: 0,
};

function pickStatus(health: Health | undefined): Status {
  if (!health) return 'unknown';
  return health.ok ? 'ok' : 'down';
}

function statusDetail(status: Status, health: Health | undefined, loading: boolean): React.ReactNode {
  if (loading && !health) return 'Querying…';
  if (status === 'ok')    return 'Healthy — last check just now';
  if (status === 'down')  return health?.error || 'Not reachable';
  return null;
}

function ConnectionCard({ icon, name, status, headline, description, detail }: {
  icon:        string;
  name:        string;
  status:      Status;
  headline:    React.ReactNode;
  description: string;
  detail:      React.ReactNode;
}) {
  const tint =
    status === 'ok'    ? { dot: '#10b981', glow: 'rgba(16,185,129,0.4)',  border: 'rgba(16,185,129,0.35)', label: 'Connected' }
  : status === 'down'  ? { dot: '#f87171', glow: 'rgba(248,113,113,0.4)', border: 'rgba(248,113,113,0.35)', label: 'Not available' }
  :                       { dot: '#64748b', glow: 'rgba(100,116,139,0.4)', border: 'rgba(255,255,255,0.08)', label: 'Checking…' };

  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(26,33,54,0.85) 0%, rgba(14,20,39,0.85) 100%)',
      border: `1px solid ${tint.border}`,
      borderRadius: 14, padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 22 }} aria-hidden>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9', lineHeight: 1.2 }}>
            {name}
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 99,
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${tint.border}`,
          fontSize: 11, fontWeight: 700, color: tint.dot,
          letterSpacing: '0.05em', whiteSpace: 'nowrap',
        }}>
          <span aria-hidden style={{
            width: 8, height: 8, borderRadius: 99,
            background: tint.dot,
            boxShadow: `0 0 10px ${tint.glow}`,
            animation: status === 'unknown' ? 'wb-celeb-banner 1.6s ease-in-out infinite' : undefined,
          }} />
          {tint.label}
        </span>
      </div>

      {headline && (
        <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>
          {headline}
        </div>
      )}

      <p style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5, margin: 0 }}>
        {description}
      </p>

      <div style={{
        fontSize: 11, color: '#64748b', fontWeight: 600,
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
        borderRadius: 8, padding: '8px 10px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        wordBreak: 'break-word',
      }}>
        {detail}
      </div>
    </div>
  );
}
