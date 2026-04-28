'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CanxRefundReport, CanxRefundRow } from '@/lib/canxRefund';

const REFRESH_MS = 5 * 60 * 1000;  // 5 minutes — matches the cadence audit users care about

const STATUS_COLORS: Record<string, string> = {
  open:    '#f87171',
  pending: '#fbbf24',
  hold:    '#a5b4fc',
};

const TYPE_COLORS: Record<string, string> = {
  'Canx automation':   '#10b981',
  'Agent led / form':  '#fbbf24',
};

function formatGBP(n: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', maximumFractionDigits: 2,
  }).format(n);
}

function formatInt(n: number): string {
  return new Intl.NumberFormat('en-GB').format(n);
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} d ago`;
}

export default function CanxRefundReportView() {
  const [report, setReport]   = useState<CanxRefundReport | null>(null);
  const [error,  setError]    = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/reports/canx-refund', { cache: 'no-store' });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error || `HTTP ${res.status}`);
        } else {
          setReport(body);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  return (
    <div style={{
      minHeight: '100vh', width: '100vw',
      background: 'radial-gradient(ellipse at 20% 0%, #1a1f3a 0%, #0a0f1c 60%, #050813 100%)',
      color: '#f1f5f9', fontFamily: 'var(--font-raleway, sans-serif)',
      padding: 'clamp(20px, 3vh, 36px) clamp(16px, 3vw, 40px)',
      display: 'flex', flexDirection: 'column', gap: 24,
    }}>
      <Header report={report} loading={loading} />
      {error && <ErrorBanner message={error} />}
      {!error && report && (
        <>
          <HeadlineTiles report={report} />
          <BreakdownStrip report={report} />
          <TicketTable rows={report.rows} />
        </>
      )}
      {!error && !report && loading && <LoadingPlaceholder />}
    </div>
  );
}

function Header({ report, loading }: { report: CanxRefundReport | null; loading: boolean }) {
  const [now, setNow] = useState('');
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexWrap: 'wrap', gap: 16,
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#fbbf24', letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: 6 }}>
          Operations · Audit
        </div>
        <h1 style={{ fontSize: 'clamp(22px, 2.6vw, 34px)', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>
          Cancellation Refund Report
        </h1>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>
          Tickets tagged <code style={pillCode}>postrefund</code> or <code style={pillCode}>postrefundready</code>{' '}
          in <code style={pillCode}>open</code> / <code style={pillCode}>pending</code> / <code style={pillCode}>hold</code>.
          {report?.generated_at && <> · Last refreshed {formatRelativeTime(report.generated_at)}</>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <DownloadButton disabled={loading || !report} />
        <a href="/api/reports/canx-refund/logout" style={{
          fontSize: 12, fontWeight: 600, color: '#64748b', textDecoration: 'none',
          padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)',
        }}>Sign out</a>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#64748b', letterSpacing: '0.05em' }}>{now}</span>
      </div>
    </div>
  );
}

const pillCode: React.CSSProperties = {
  fontSize: 11, color: '#a5b4fc',
  background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
  padding: '2px 6px', borderRadius: 6, margin: '0 2px',
};

function DownloadButton({ disabled }: { disabled: boolean }) {
  return (
    <a
      href={disabled ? undefined : '/api/reports/canx-refund/csv'}
      aria-disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 18px', borderRadius: 99,
        background: disabled
          ? 'rgba(148,163,184,0.12)'
          : 'linear-gradient(135deg, rgba(99,102,241,0.45) 0%, rgba(168,85,247,0.32) 100%)',
        color: disabled ? '#64748b' : '#f1f5f9',
        textDecoration: 'none',
        fontSize: 13, fontWeight: 700, letterSpacing: '0.04em',
        border: '1px solid ' + (disabled ? 'rgba(148,163,184,0.2)' : 'rgba(99,102,241,0.45)'),
        boxShadow: disabled ? undefined : '0 4px 18px rgba(99,102,241,0.3)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12" /><path d="m6 9 6 6 6-6" /><path d="M5 21h14" />
      </svg>
      Download CSV
    </a>
  );
}

function HeadlineTiles({ report }: { report: CanxRefundReport }) {
  return (
    <div style={{
      display: 'grid', gap: 14,
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    }}>
      <Tile label="Total tickets"        value={formatInt(report.total_count)} />
      <Tile label="Total refund value"   value={formatGBP(report.total_refund)} accent="#10b981" />
      {report.by_type.map(t => (
        <Tile
          key={t.type}
          label={t.type}
          value={formatInt(t.count)}
          subtitle={formatGBP(t.refund_amount)}
          accent={TYPE_COLORS[t.type]}
        />
      ))}
    </div>
  );
}

function Tile({ label, value, subtitle, accent }: { label: string; value: string; subtitle?: string; accent?: string }) {
  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(26,33,54,0.85) 0%, rgba(14,20,39,0.85) 100%)',
      border: '1px solid ' + (accent ? hexAlpha(accent, 0.35) : 'rgba(99,102,241,0.22)'),
      borderRadius: 14, padding: '18px 22px',
      boxShadow: accent ? `0 0 24px ${hexAlpha(accent, 0.12)}` : undefined,
      display: 'flex', flexDirection: 'column', gap: 8, minHeight: 110,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 'clamp(28px, 3.4vw, 44px)', fontWeight: 800, color: accent || '#f1f5f9', lineHeight: 1, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1' }}>{subtitle}</div>
      )}
    </div>
  );
}

function BreakdownStrip({ report }: { report: CanxRefundReport }) {
  return (
    <div style={{
      display: 'grid', gap: 14,
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    }}>
      <Card title="By status">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {report.by_status.map(s => (
            <Row key={s.status}
              dot={STATUS_COLORS[s.status] || '#64748b'}
              label={s.status[0].toUpperCase() + s.status.slice(1)}
              count={s.count}
              amount={s.refund_amount}
              denominator={report.total_count}
            />
          ))}
        </div>
      </Card>
      <Card title="By type">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {report.by_type.map(t => (
            <Row key={t.type}
              dot={TYPE_COLORS[t.type] || '#64748b'}
              label={t.type}
              count={t.count}
              amount={t.refund_amount}
              denominator={report.total_count}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(26,33,54,0.7) 0%, rgba(14,20,39,0.7) 100%)',
      border: '1px solid rgba(99,102,241,0.18)',
      borderRadius: 14, padding: '16px 20px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ dot, label, count, amount, denominator }: {
  dot: string; label: string; count: number; amount: number; denominator: number;
}) {
  const pct = denominator > 0 ? Math.round((count / denominator) * 100) : 0;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: dot, boxShadow: `0 0 8px ${dot}` }} />
        <span style={{ flex: 1, color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{label}</span>
        <span style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {formatInt(count)}
        </span>
        <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, minWidth: 36, textAlign: 'right' }}>
          {pct}%
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 18 }}>
        <div style={{ flex: 1, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: dot, opacity: 0.85 }} />
        </div>
        <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}>
          {formatGBP(amount)}
        </span>
      </div>
    </div>
  );
}

function TicketTable({ rows }: { rows: CanxRefundRow[] }) {
  // Sort by created_at desc (matches the script's ordering) — defensive in case the API didn't.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [rows],
  );

  if (sorted.length === 0) {
    return (
      <Card title="Tickets">
        <div style={{ color: '#64748b', fontSize: 14, padding: '12px 0' }}>
          No matching tickets right now.
        </div>
      </Card>
    );
  }

  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(26,33,54,0.7) 0%, rgba(14,20,39,0.7) 100%)',
      border: '1px solid rgba(99,102,241,0.18)',
      borderRadius: 14, padding: '16px 20px',
      flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 12, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          Tickets
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {formatInt(sorted.length)} row{sorted.length === 1 ? '' : 's'} · newest first
        </div>
      </div>
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, background: '#0f1631', zIndex: 1 }}>
              <Th>Ticket</Th>
              <Th>Reference</Th>
              <Th align="right">Refund £</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th>Type</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.ticket_id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <Td><a
                  href={`https://thedirectteam.zendesk.com/agent/tickets/${r.ticket_id}`}
                  target="_blank" rel="noreferrer"
                  style={{ color: '#a5b4fc', textDecoration: 'none', fontWeight: 600 }}
                >#{r.ticket_id}</a></Td>
                <Td><code style={{ fontSize: 12, color: '#cbd5e1' }}>{r.reference_number || '—'}</code></Td>
                <Td align="right" mono>{r.refund_amount !== null ? formatGBP(r.refund_amount) : <Muted>—</Muted>}</Td>
                <Td><StatusPill status={r.status} /></Td>
                <Td mono>{r.created_date}</Td>
                <Td><TypePill type={r.type} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align || 'left',
      color: '#94a3b8', fontWeight: 600, fontSize: 11,
      letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '8px 12px',
      borderBottom: '1px solid rgba(99,102,241,0.18)',
    }}>{children}</th>
  );
}

function Td({ children, align, mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td style={{
      textAlign: align || 'left',
      padding: '10px 12px',
      color: '#e2e8f0',
      fontVariantNumeric: mono ? 'tabular-nums' : undefined,
    }}>{children}</td>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#475569' }}>{children}</span>;
}

function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || '#64748b';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      background: hexAlpha(c, 0.14),
      border: `1px solid ${hexAlpha(c, 0.4)}`,
      color: c, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
    }}>{status}</span>
  );
}

function TypePill({ type }: { type: string }) {
  const c = TYPE_COLORS[type] || '#64748b';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      background: hexAlpha(c, 0.12),
      border: `1px solid ${hexAlpha(c, 0.35)}`,
      color: c, fontSize: 11, fontWeight: 700,
    }}>{type}</span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      padding: '14px 18px', borderRadius: 12,
      background: 'rgba(248,113,113,0.08)',
      border: '1px solid rgba(248,113,113,0.4)',
      color: '#fecaca', fontSize: 14,
    }}>
      Couldn't load report: {message}
    </div>
  );
}

function LoadingPlaceholder() {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#64748b', fontSize: 14, padding: 48,
    }}>
      Loading from Zendesk… this can take ~10 seconds on first load.
    </div>
  );
}

// Small helper so we don't pull in a colour library — accepts a #rrggbb and returns rgba().
function hexAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}
