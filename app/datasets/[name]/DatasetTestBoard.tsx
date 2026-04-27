'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import BrowseHeader from '../../_browse/BrowseHeader';

interface DatasetPayload {
  name:       string;
  schema:     any[];
  rows:       Record<string, any>[];
  count:      number;
  updated_at: string | null;
}

const POLL_MS = 30_000;

/**
 * Generic dataset test board. Polls /api/datasets/<name>/data every
 * 30s and renders whatever's stored as a plain table. Use this to
 * verify a Noetica (or any other webhook-pushed) dataset is landing
 * before wiring it into a real wallboard.
 */
export default function DatasetTestBoard({ name }: { name: string }) {
  const [data, setData]       = useState<DatasetPayload | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick]       = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/datasets/${encodeURIComponent(name)}/data`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(d => { if (!cancelled) { setData(d); setError(null); } })
      .catch(e => { if (!cancelled) setError(e?.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [name, tick]);

  // Auto-refresh
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), POLL_MS);
    return () => clearInterval(iv);
  }, []);

  // Column list — prefer the dataset's stored schema; fall back to
  // the keys of the first row so a freshly-pushed dataset without a
  // declared schema still renders.
  const columns = useMemo(() => {
    if (!data) return [] as string[];
    if (Array.isArray(data.schema) && data.schema.length > 0) {
      return data.schema.map((c: any) => (typeof c === 'string' ? c : c.name || c.key)).filter(Boolean);
    }
    return data.rows[0] ? Object.keys(data.rows[0]) : [];
  }, [data]);

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
      padding: 'clamp(24px, 5vh, 64px) clamp(16px, 4vw, 48px)',
    }}>
      <BrowseHeader
        right={
          <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={() => setTick(t => t + 1)}
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
              {loading ? 'Loading…' : '↻ Re-check'}
            </button>
          </div>
        }
      />

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '5px 12px', borderRadius: 99,
          background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.4)',
          fontSize: 11, fontWeight: 800, color: '#7dd3fc',
          letterSpacing: '0.18em', textTransform: 'uppercase',
        }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: 99, background: '#38bdf8', boxShadow: '0 0 8px rgba(56,189,248,0.6)' }} />
          Dataset · Test
        </span>
        <Link href="/connections" style={{
          fontSize: 12, fontWeight: 600, color: '#64748b',
          textDecoration: 'none', letterSpacing: '0.06em',
        }}>← Connections</Link>
      </div>

      <h1 style={{ fontSize: 'clamp(22px, 2.6vw, 34px)', fontWeight: 800, color: '#f1f5f9', marginBottom: 4 }}>
        <code style={codeStyle}>{name}</code>
      </h1>
      <p style={{ fontSize: 'clamp(13px, 1vw, 16px)', color: '#94a3b8', marginBottom: 24 }}>
        Live read of whatever's stored under this dataset name. Auto-refreshes every {POLL_MS / 1000}s. Use this to confirm a webhook push has landed.
      </p>

      {error && (
        <EmptyCard tone="error" title={error === '404' ? 'Dataset not pushed yet' : `Couldn't load: ${error}`}>
          {error === '404'
            ? <>POST to <code style={codeStyle}>/api/datasets/{name}/data</code> first, then refresh this page.</>
            : <>Server returned an error. Try the re-check button or check the connections page.</>}
        </EmptyCard>
      )}

      {!error && data && (
        <>
          <StatStrip
            count={data.count}
            updatedAt={data.updated_at}
            columnCount={columns.length}
          />
          {data.count === 0 && (
            <EmptyCard tone="muted" title="No rows yet">
              The dataset record exists but no rows have been pushed. Send a POST with the data array.
            </EmptyCard>
          )}
          {data.count > 0 && (
            <DataTable rows={data.rows} columns={columns} />
          )}
        </>
      )}

      {!data && !error && loading && (
        <div style={{ color: '#475569', fontSize: 14, padding: 32, textAlign: 'center' }}>
          Querying…
        </div>
      )}
    </div>
  );
}

function StatStrip({ count, updatedAt, columnCount }: {
  count: number; updatedAt: string | null; columnCount: number;
}) {
  const ago = useFreshness(updatedAt);
  return (
    <div style={{
      display: 'grid', gap: 12, marginBottom: 22,
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    }}>
      <Stat label="Rows"        value={count.toLocaleString('en-GB')} />
      <Stat label="Columns"     value={String(columnCount)} />
      <Stat label="Last update" value={ago} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 12,
      background: 'rgba(20,26,46,0.6)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

function useFreshness(updatedAt: string | null): string {
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force(x => x + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  if (!updatedAt) return 'never';
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return 'unknown';
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60)      return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)      return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)      return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function DataTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  // Cap at 200 rendered rows to keep the page responsive on huge
  // datasets — this is a verification surface, not a reporting one.
  const display = rows.slice(0, 200);
  const truncated = rows.length - display.length;
  return (
    <div style={{
      borderRadius: 12, overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(20,26,46,0.6)',
    }}>
      <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontSize: 13, color: '#e2e8f0',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}>
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c} style={thStyle}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {display.map((r, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.025)' }}>
                {columns.map(c => (
                  <td key={c} style={tdStyle}>{formatCell(r[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated > 0 && (
        <div style={{
          padding: '10px 14px', fontSize: 12, color: '#64748b',
          borderTop: '1px solid rgba(255,255,255,0.06)', textAlign: 'center',
        }}>
          Showing first 200 of {rows.length.toLocaleString('en-GB')} rows · {truncated.toLocaleString('en-GB')} hidden
        </div>
      )}
    </div>
  );
}

function formatCell(v: any): string {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function EmptyCard({ tone, title, children }: {
  tone: 'muted' | 'error'; title: string; children: React.ReactNode;
}) {
  const accent = tone === 'error' ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.08)';
  return (
    <div style={{
      padding: 'clamp(28px, 5vh, 56px)', textAlign: 'center',
      background: 'rgba(20,26,46,0.6)', border: `1px solid ${accent}`,
      borderRadius: 14, color: '#94a3b8', fontSize: 14, lineHeight: 1.6,
    }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9', marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ color: '#64748b' }}>{children}</div>
    </div>
  );
}

const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.75em', fontWeight: 700,
  color: '#a5b4fc',
  background: 'rgba(99,102,241,0.12)',
  border: '1px solid rgba(99,102,241,0.22)',
  padding: '2px 8px', borderRadius: 6,
  letterSpacing: 0,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11, fontWeight: 800,
  color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase',
  background: 'rgba(15,22,40,0.85)',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  position: 'sticky', top: 0, zIndex: 1,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  whiteSpace: 'nowrap',
  maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis',
};
