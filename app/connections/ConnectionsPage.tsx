'use client';

import { useEffect, useState } from 'react';
import BrowseHeader from '../_browse/BrowseHeader';

interface Health { ok: boolean; error: string | null; count?: number; }
interface Payload {
  mssql:   Health;
  zendesk: Health;
  noetica: Health;
}

const SOURCES: Array<{
  key:         keyof Payload;
  name:        string;
  description: string;
  icon:        string;
}> = [
  {
    key: 'mssql',
    name: 'MS-SQL · Sales database',
    description: 'Drives the agent leaderboards (Income MTD, Income Today, Policies). Queried on every showcase data poll.',
    icon: '🗄️',
  },
  {
    key: 'zendesk',
    name: 'Zendesk · Support tickets',
    description: 'Source for ticket counts, leaderboards and the Laziest Manager comedy slide. Fetched per-widget.',
    icon: '🎫',
  },
  {
    key: 'noetica',
    name: 'Datasets · Webhook push',
    description: 'Generic key/value dataset store. Anything pushed to /api/datasets/<name>/data ends up here for widgets to consume.',
    icon: '📥',
  },
];

export default function ConnectionsPage() {
  const [data, setData]   = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {SOURCES.map(s => {
            const h: Health | undefined = data ? data[s.key] : undefined;
            return <ConnectionCard key={s.key} name={s.name} description={s.description} icon={s.icon} health={h} loading={loading && !data} />;
          })}
        </div>
      )}
    </div>
  );
}

function ConnectionCard({ name, description, icon, health, loading }: {
  name: string; description: string; icon: string;
  health: Health | undefined; loading: boolean;
}) {
  const status: 'ok' | 'down' | 'unknown' = !health ? 'unknown' : health.ok ? 'ok' : 'down';
  const tint = status === 'ok'    ? { dot: '#10b981', glow: 'rgba(16,185,129,0.4)',  border: 'rgba(16,185,129,0.35)', label: 'Connected' }
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

      <p style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5, margin: 0 }}>
        {description}
      </p>

      {/* Status detail line — error message when down, count when up */}
      <div style={{
        fontSize: 11, color: '#64748b', fontWeight: 600,
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
        borderRadius: 8, padding: '8px 10px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        wordBreak: 'break-word',
      }}>
        {loading && !health && 'Querying…'}
        {!loading && health && health.ok && (
          health.count !== undefined ? `${health.count} dataset${health.count === 1 ? '' : 's'} pushed` : 'Healthy — last check just now'
        )}
        {!loading && health && !health.ok && (health.error || 'Not reachable')}
      </div>
    </div>
  );
}
