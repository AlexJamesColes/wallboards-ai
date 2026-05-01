'use client';

import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
  useAutoFullscreenOnFirstGesture,
  useAutoFullscreenAfterIdle,
  useAutoHideCursor,
  useAutoReloadOnDeploy,
  useKioskRotation,
} from '@/lib/kioskHooks';
import BoardBackButton from '@/components/BoardBackButton';
import {
  SALES_BOARD_1_WIDGETS,
  type WidgetSpec,
  type WidgetFormat,
} from '@/lib/salesBoard1Spec';

interface WidgetResult {
  id:           string;
  value?:       number | null;
  rows?:        any[];
  columns?:     string[];
  placeholder?: boolean;
  reason?:      string;
  error?:       string;
}

interface Payload {
  updated_at: string;
  widgets:    Record<string, WidgetResult>;
  targets:    Record<string, number>;
  reconciliation: { directExternalDelta: number; unclassifiedDivisions: string[] };
}

const POLL_MS = 30_000;

interface Props {
  title:      string;
  department: string;
}

// ─── Component ──────────────────────────────────────────────────────────

export default function SalesBoard1View({ title, department }: Props) {
  // Same kiosk niceties the other boards use — auto-fullscreen on TVs,
  // hide cursor, auto-reload on deploy, support /kiosk rotators.
  useAutoFullscreenOnFirstGesture();
  useAutoFullscreenAfterIdle(30_000);
  useAutoHideCursor(3_000);
  useAutoReloadOnDeploy();
  useKioskRotation();

  const [data,    setData]    = useState<Payload | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick,    setTick]    = useState(0);
  const [now,     setNow]     = useState(() => Date.now());

  // 1Hz heartbeat for the freshness chip + clock.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Server poll — 30s is plenty for a director board (Gecko also
  // polled at this cadence). The Noetica `division` push lands every
  // ~5 mins so polling faster doesn't reveal anything.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/sales-board-1', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d: Payload) => { if (!cancelled) { setData(d); setError(null); } })
      .catch(e => { if (!cancelled) setError(e?.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), POLL_MS);
    return () => clearInterval(iv);
  }, []);

  const specsById = useMemo(() => {
    const m: Record<string, WidgetSpec> = {};
    for (const w of SALES_BOARD_1_WIDGETS) m[w.id] = w;
    return m;
  }, []);

  const get = (id: string): { spec: WidgetSpec; result: WidgetResult | undefined } => ({
    spec:   specsById[id],
    result: data?.widgets[id],
  });

  return (
    <div style={pageStyle}>
      <Header
        title={title}
        department={department}
        loading={loading}
        updatedAt={data?.updated_at ?? null}
        now={now}
      />

      {error && !data && (
        <div style={errorBoxStyle}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9', marginBottom: 6 }}>
            Couldn&apos;t load: {error}
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8' }}>
            One of the upstream sources (MS-SQL, Noetica, Zendesk) isn&apos;t reachable. Check
            the connections page.
          </div>
        </div>
      )}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* ── Headline strip: NB Earn MTD (biggest), Earn today ────────── */}
          <section style={headlineStripStyle}>
            <BigNumberWithTarget
              {...get('nb-earn-mtd')}
              target={data.targets['nb-earn-mtd']}
            />
            <BigNumber {...get('earn-today')} />
          </section>

          {/* ── Today-flow row: 8 small KPI tiles ───────────────────────── */}
          <section style={kpiRowStyle}>
            <SmallKpi {...get('quotes-today')} />
            <SmallKpi {...get('sales-today')} />
            <SmallKpi {...get('nb-units-today')} />
            <SmallKpi {...get('ipp-today')} />
            <SmallKpi {...get('qts-today')} />
            <SmallKpi {...get('webbys')} />
            <SmallKpi {...get('webcnx-today')} />
            <SmallKpi {...get('manual-wrap-ups')} />
          </section>

          {/* ── MTD continuation row: MTD volume + avg IPP + ad spend ───── */}
          <section style={kpiRowStyle}>
            <SmallKpi {...get('quotes-mtd')} />
            <SmallKpi {...get('sales-mtd')} />
            <SmallKpi {...get('avg-ipp-mtd')} />
            <SmallKpi {...get('tradepoint-signups')} />
            <SmallKpi {...get('vc-spend-today')} />
          </section>

          {/* ── Direct v External — horizontal split bar ─────────────────── */}
          <DirectExternal
            direct={get('direct-earn')}
            external={get('external-earn')}
          />

          {/* ── Hourly trend band — three charts side by side ────────────── */}
          <section style={chartBandStyle}>
            <ChartTile {...get('earn-vs-yesterday')} yFormat="gbp-k" />
            <ChartTile {...get('earn-vs-last-week')} yFormat="gbp-k" />
            <ChartTile {...get('ipp-vs-last-week')}  yFormat="gbp-2dp" />
          </section>

          {/* ── Funnel placeholder — Mixpanel pending ────────────────────── */}
          <Placeholder
            label="Radio Ads (30 Days)"
            reason="Awaiting Mixpanel API connector"
          />
        </div>
      )}

      <Footer now={now} />
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────

function Header({ title, department, loading, updatedAt, now }: {
  title: string; department: string; loading: boolean;
  updatedAt: string | null; now: number;
}) {
  const stale = updatedAt ? (now - new Date(updatedAt).getTime()) > 90_000 : true;
  const fresh = formatFreshness(updatedAt, now);
  return (
    <header style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <BoardBackButton />
        <span style={pillStyle('#a855f7', 'rgba(168,85,247,0.12)', 'rgba(168,85,247,0.4)', '#d8b4fe')}>
          <span aria-hidden style={pillDotStyle('#a855f7')} />
          {department} · Director overview
        </span>
      </div>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap',
        justifyContent: 'space-between',
      }}>
        <h1 style={{
          fontSize: 'clamp(22px, 2.6vw, 32px)', fontWeight: 800,
          color: '#f1f5f9', lineHeight: 1.1, margin: 0,
        }}>{title}</h1>
        <span style={pillStyle(
          stale ? '#f87171' : '#10b981',
          stale ? 'rgba(248,113,113,0.1)' : 'rgba(16,185,129,0.1)',
          stale ? 'rgba(248,113,113,0.4)' : 'rgba(16,185,129,0.4)',
          stale ? '#fca5a5' : '#86efac',
        )}>
          <span aria-hidden style={{
            ...pillDotStyle(stale ? '#f87171' : '#10b981'),
            animation: loading ? 'wb-online-pulse 1.4s ease-in-out infinite' : undefined,
          }} />
          {fresh}
        </span>
      </div>
    </header>
  );
}

// ─── Footer (clock) ─────────────────────────────────────────────────────

function Footer({ now }: { now: number }) {
  const t = new Date(now);
  const hh = t.getHours().toString().padStart(2, '0');
  const mm = t.getMinutes().toString().padStart(2, '0');
  return (
    <footer style={{
      marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      color: '#475569', fontSize: 13, fontWeight: 600,
    }}>
      <span>InsureTec</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{hh}:{mm}</span>
    </footer>
  );
}

// ─── Big number with target progress (the headline tile) ───────────────

function BigNumberWithTarget({ spec, result, target }: {
  spec?: WidgetSpec; result?: WidgetResult; target?: number;
}) {
  if (!spec) return null;
  const value = result?.value ?? null;
  const pct = (target && value != null) ? Math.max(0, Math.min(1, value / target)) : 0;
  return (
    <div style={{ ...tileStyle, flex: 2.4, padding: '20px 24px' }}>
      <div style={tileLabelStyle}>{spec.label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 4 }}>
        <span style={{
          fontSize: 'clamp(40px, 5.8vw, 78px)', fontWeight: 800, lineHeight: 0.95,
          color: '#f1f5f9', fontVariantNumeric: 'tabular-nums',
          textShadow: '0 0 28px rgba(56,189,248,0.18)',
        }}>{formatValue(value, spec.format)}</span>
        {target != null && (
          <span style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8' }}>
            of {formatValue(target, spec.format)}
          </span>
        )}
      </div>
      {target != null && (
        <div style={{ marginTop: 14 }}>
          <div style={{
            position: 'relative', height: 10, borderRadius: 99,
            background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', inset: 0, width: `${pct * 100}%`,
              background: 'linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)',
              boxShadow: '0 0 16px rgba(56,189,248,0.4)',
              transition: 'width 0.6s ease',
            }} />
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            marginTop: 6, fontSize: 12, fontWeight: 700,
            color: pct >= 1 ? '#86efac' : '#cbd5e1',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <span>{Math.round(pct * 100)}%</span>
            <span style={{ color: '#475569' }}>target {formatValue(target, spec.format)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Big number (no target) — used for Earn today next to NB Earn MTD ──

function BigNumber({ spec, result }: { spec?: WidgetSpec; result?: WidgetResult }) {
  if (!spec) return null;
  return (
    <div style={{ ...tileStyle, flex: 1.2, padding: '20px 24px' }}>
      <div style={tileLabelStyle}>{spec.label}</div>
      <div style={{
        fontSize: 'clamp(32px, 4.2vw, 56px)', fontWeight: 800, lineHeight: 0.95,
        color: '#f1f5f9', fontVariantNumeric: 'tabular-nums',
        marginTop: 8,
      }}>{formatValueOrError(result, spec.format)}</div>
    </div>
  );
}

// ─── Small KPI tile (today-flow row) ───────────────────────────────────

function SmallKpi({ spec, result }: { spec?: WidgetSpec; result?: WidgetResult }) {
  if (!spec) return null;
  if (result?.placeholder) {
    return <PlaceholderKpi label={spec.label} reason={result.reason || ''} />;
  }
  return (
    <div style={{ ...tileStyle, flex: '1 1 0', padding: '12px 14px' }}>
      <div style={{ ...tileLabelStyle, fontSize: 10 }}>{spec.label}</div>
      <div style={{
        fontSize: 'clamp(20px, 2.2vw, 30px)', fontWeight: 800, lineHeight: 1,
        color: '#f1f5f9', fontVariantNumeric: 'tabular-nums',
        marginTop: 6,
      }}>{formatValueOrError(result, spec.format)}</div>
    </div>
  );
}

// ─── Direct v External split bar ───────────────────────────────────────

function DirectExternal({ direct, external }: {
  direct:   { spec?: WidgetSpec; result?: WidgetResult };
  external: { spec?: WidgetSpec; result?: WidgetResult };
}) {
  const d = direct.result?.value ?? 0;
  const e = external.result?.value ?? 0;
  const total = d + e;
  const dPct = total > 0 ? d / total : 0;
  const ePct = total > 0 ? e / total : 0;

  // Two horizontal bars share the same scale (max = total) so the
  // longer bar visually wins, giving the eye an immediate "which
  // channel is bigger" read. Mirrors the progress-bar idiom we use
  // for NB Earn MTD target — same vocabulary across the board.
  const ROW_H = 36; // ample room for value text inside the bar
  return (
    <section style={{
      ...tileStyle, padding: '16px 20px',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 14,
      }}>
        <span style={tileLabelStyle}>Direct v External</span>
        <span style={{
          fontSize: 14, fontWeight: 700, color: '#94a3b8',
          fontVariantNumeric: 'tabular-nums',
        }}>
          Total {formatValue(total, 'gbp-k')}
        </span>
      </div>

      <ChannelBar
        label="Direct"   value={d} pct={dPct} total={total} rowHeight={ROW_H}
        gradient="linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)"
        labelColor="#a5b4fc"
      />
      <div style={{ height: 8 }} />
      <ChannelBar
        label="External" value={e} pct={ePct} total={total} rowHeight={ROW_H}
        gradient="linear-gradient(90deg, #94a3b8 0%, #64748b 100%)"
        labelColor="#cbd5e1"
      />
    </section>
  );
}

function ChannelBar({ label, value, pct, total, rowHeight, gradient, labelColor }: {
  label: string; value: number; pct: number; total: number;
  rowHeight: number; gradient: string; labelColor: string;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '90px 1fr 90px',
      alignItems: 'center', gap: 12,
    }}>
      <span style={{
        fontSize: 12, fontWeight: 800,
        color: labelColor, letterSpacing: '0.18em', textTransform: 'uppercase',
      }}>{label}</span>

      <div style={{
        position: 'relative', height: rowHeight, borderRadius: 8, overflow: 'hidden',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          width: `${Math.max(2, pct * 100)}%`, // min 2% so a £0 channel still shows a sliver
          background: gradient,
          transition: 'width 0.6s ease',
        }} />
        {/* Value floats inside the bar at the right edge — keeps the
            eye anchored to where the bar ends */}
        <span style={{
          position: 'absolute', top: 0, bottom: 0,
          left: total > 0 ? `calc(${pct * 100}% + 8px)` : 8,
          display: 'flex', alignItems: 'center',
          fontSize: 16, fontWeight: 800, color: '#f1f5f9',
          fontVariantNumeric: 'tabular-nums',
          textShadow: '0 1px 2px rgba(0,0,0,0.4)',
          whiteSpace: 'nowrap',
        }}>
          {formatValue(value, 'gbp-k')}
        </span>
      </div>

      <span style={{
        fontSize: 18, fontWeight: 800, color: '#f1f5f9',
        fontVariantNumeric: 'tabular-nums', textAlign: 'right',
      }}>{Math.round(pct * 100)}%</span>
    </div>
  );
}

// ─── Custom Recharts tooltip ───────────────────────────────────────────
//
// Default tooltip showed "17" as the heading and stacked the series
// awkwardly. This one renders the hour as a real time ("5pm" / "17:00"),
// shows both series side-by-side colour-coded, and matches the dark
// glass aesthetic used elsewhere on the board.

interface HourTooltipProps {
  active?:  boolean;
  payload?: Array<{ dataKey: string; value: number | null }>;
  label?:   string | number;
  yFormat:  WidgetFormat;
  series:   Array<{ key: string; label: string; tint: string }>;
}

function HourTooltip({ active, payload, label, yFormat, series }: HourTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{
      background: 'rgba(14,20,39,0.96)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 10, padding: '10px 14px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      fontFamily: 'var(--font-raleway, sans-serif)',
      minWidth: 140,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 800,
        color: '#94a3b8', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: 8,
      }}>{formatHourLabel(label)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {series.map(s => {
          const entry = payload?.find(p => p.dataKey === s.key);
          const v     = entry?.value;
          return (
            <div key={s.key} style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              gap: 16,
            }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: '#cbd5e1',
              }}>
                <span aria-hidden style={{
                  width: 8, height: 8, borderRadius: 99, background: s.tint,
                }} />
                {s.label}
              </span>
              <span style={{
                fontSize: 14, fontWeight: 800, color: s.tint,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {v == null ? '–' : formatValue(Number(v), yFormat)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** "17" → "5pm", "08" → "8am", "00" → "12am". Falls back to the raw
 *  string for anything that doesn't parse as an hour. */
function formatHourLabel(raw: string | number | undefined): string {
  if (raw == null) return '';
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 23) return String(raw);
  const suffix = n < 12 ? 'am' : 'pm';
  const h12 = ((n + 11) % 12) + 1;
  return `${h12}${suffix}`;
}

// ─── Hourly trend chart tile ───────────────────────────────────────────

function ChartTile({ spec, result, yFormat }: {
  spec?: WidgetSpec; result?: WidgetResult; yFormat: WidgetFormat;
}) {
  if (!spec || spec.source !== 'sql' || spec.visual !== 'bar-pair') return null;
  const rows = result?.rows ?? [];
  const series = spec.series || [];
  return (
    <div style={{ ...tileStyle, flex: '1 1 0', minWidth: 280, padding: '14px 16px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 10,
      }}>
        <span style={tileLabelStyle}>{spec.label}</span>
        <span style={{ display: 'inline-flex', gap: 12, fontSize: 11, fontWeight: 700 }}>
          {series.map(s => (
            <span key={s.key} style={{ color: s.tint }}>● {s.label}</span>
          ))}
        </span>
      </div>
      <div style={{ height: 200 }}>
        {rows.length === 0 ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#475569', fontSize: 12, fontWeight: 600,
          }}>No data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey={spec.xKey || 'Hour'}
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                tickLine={false}
                tickFormatter={(v: number) => formatValue(v, yFormat).replace('£', '£')}
                width={50}
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                content={<HourTooltip yFormat={yFormat} series={series} />}
              />
              {series.map(s => (
                <Bar key={s.key} dataKey={s.key} fill={s.tint} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ─── Placeholders for deferred widgets ─────────────────────────────────

function Placeholder({ label, reason }: { label: string; reason: string }) {
  return (
    <section style={{
      ...tileStyle,
      borderStyle: 'dashed',
      borderColor: 'rgba(255,255,255,0.12)',
      padding: '18px 22px',
      color: '#64748b',
    }}>
      <div style={{ ...tileLabelStyle, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#475569', marginTop: 6 }}>
        ⏸ {reason}
      </div>
    </section>
  );
}

function PlaceholderKpi({ label, reason }: { label: string; reason: string }) {
  return (
    <div title={reason} style={{
      ...tileStyle, flex: '1 1 0', padding: '12px 14px',
      borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.12)',
    }}>
      <div style={{ ...tileLabelStyle, fontSize: 10, color: '#64748b' }}>{label}</div>
      <div style={{
        fontSize: 'clamp(16px, 1.6vw, 22px)', fontWeight: 700, lineHeight: 1,
        color: '#475569', marginTop: 6,
      }}>⏸ Pending</div>
    </div>
  );
}

// ─── Styling primitives ────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0e1426',
  backgroundImage: `
    radial-gradient(ellipse at 50% -10%, rgba(56,189,248,0.06) 0%, transparent 55%),
    linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
  `,
  backgroundSize: 'auto, 40px 40px, 40px 40px',
  color: '#f1f5f9',
  fontFamily: 'var(--font-raleway, sans-serif)',
  padding: 'clamp(14px, 2.4vh, 24px) clamp(14px, 2.4vw, 28px)',
  display: 'flex', flexDirection: 'column',
};

const tileStyle: React.CSSProperties = {
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.06)',
  background: 'linear-gradient(180deg, rgba(99,102,241,0.06) 0%, rgba(20,26,46,0.55) 70%)',
};

const tileLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 800,
  color: '#94a3b8', letterSpacing: '0.18em', textTransform: 'uppercase',
};

const headlineStripStyle: React.CSSProperties = {
  display: 'flex', gap: 14, flexWrap: 'wrap',
};

const kpiRowStyle: React.CSSProperties = {
  display: 'grid', gap: 10,
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
};

const chartBandStyle: React.CSSProperties = {
  display: 'flex', gap: 12, flexWrap: 'wrap',
};

const errorBoxStyle: React.CSSProperties = {
  padding: 'clamp(28px, 5vh, 56px)', textAlign: 'center',
  background: 'rgba(20,26,46,0.6)', border: '1px solid rgba(248,113,113,0.4)',
  borderRadius: 14, color: '#94a3b8', marginTop: 24,
};

function pillStyle(_dot: string, bg: string, border: string, fg: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '5px 12px', borderRadius: 99,
    background: bg, border: `1px solid ${border}`,
    fontSize: 11, fontWeight: 800, color: fg,
    letterSpacing: '0.18em', textTransform: 'uppercase',
  };
}
function pillDotStyle(color: string): React.CSSProperties {
  return {
    width: 6, height: 6, borderRadius: 99,
    background: color, boxShadow: `0 0 8px ${color}aa`,
  };
}

// ─── Formatters ────────────────────────────────────────────────────────

function formatValueOrError(result: WidgetResult | undefined, format: WidgetFormat): string {
  if (!result) return '—';
  if (result.error)       return '—';
  if (result.placeholder) return '⏸';
  return formatValue(result.value ?? null, format);
}

function formatValue(v: number | null | undefined, format: WidgetFormat): string {
  if (v == null || !Number.isFinite(v)) return '—';
  switch (format) {
    case 'count':    return v.toLocaleString('en-GB');
    case 'count-k':  return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toLocaleString('en-GB');
    case 'gbp':      return `£${Math.round(v).toLocaleString('en-GB')}`;
    case 'gbp-k':    return v >= 1000 ? `£${(v / 1000).toFixed(2)}K` : `£${v.toFixed(2)}`;
    case 'gbp-m':    return v >= 1_000_000 ? `£${(v / 1_000_000).toFixed(2)}M`
                          : v >= 1000     ? `£${(v / 1000).toFixed(1)}K`
                          :                 `£${v.toFixed(0)}`;
    case 'gbp-2dp':  return `£${v.toFixed(2)}`;
    case 'percent':  return `${v.toFixed(0)}%`;
    default:         return String(v);
  }
}

function formatFreshness(updatedAt: string | null, now: number): string {
  if (!updatedAt) return 'no data';
  const ms = now - new Date(updatedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 15)       return 'live';
  if (s < 60)       return `${s}s old`;
  const m = Math.floor(s / 60);
  if (m < 60)       return `${m}m old`;
  return `${Math.floor(m / 60)}h old`;
}
