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
          {/* ── Row 1: Headline KPIs ─────────────────────────────────────
              Mirrors Gecko's hierarchy — Earn and Webbys are the top-left
              eye-catchers a director sees first. NB Earn MTD lives in
              row 3, paired with the Earn-vs-Yesterday chart, so the
              "are we hitting target" answer is mid-board context, not
              the page-dominating headline. */}
          <section style={headlineRowStyle}>
            <HeadlineTile {...get('earn-today')} accent="#38bdf8" big />
            <HeadlineTile {...get('webbys')}     accent="#fbbf24" big />
            <StackTile>
              <SmallKpi {...get('webcnx-today')}     compact />
              <SmallKpi {...get('manual-wrap-ups')}  compact />
            </StackTile>
            <GridTile cols={2}>
              <SmallKpi {...get('quotes-today')} compact />
              <SmallKpi {...get('sales-today')}  compact />
              <SmallKpi {...get('quotes-mtd')}   compact />
              <SmallKpi {...get('sales-mtd')}    compact />
            </GridTile>
          </section>

          {/* ── Row 2: Direct/External + per-channel KPIs ────────────── */}
          <section style={row2Style}>
            <DirectExternal
              direct={get('direct-earn')}
              external={get('external-earn')}
            />
            <StackTile>
              <SmallKpi {...get('nb-units-today')} compact />
              <SmallKpi {...get('ipp-today')}      compact />
              <SmallKpi {...get('avg-ipp-mtd')}    compact />
            </StackTile>
            <StackTile>
              <SmallKpi {...get('vc-spend-today')}      compact />
              <SmallKpi {...get('tradepoint-signups')}  compact />
              <SmallKpi {...get('qts-today')}           compact />
            </StackTile>
          </section>

          {/* ── Row 3: Earn-vs-yesterday chart + NB Earn MTD with target  */}
          <section style={chartBandStyle}>
            <div style={{ flex: '1 1 0', minWidth: 320 }}>
              <ChartTile {...get('earn-vs-yesterday')} yFormat="gbp-k" />
            </div>
            <NBEarnMTDTile
              {...get('nb-earn-mtd')}
              target={data.targets['nb-earn-mtd']}
            />
          </section>

          {/* ── Row 4: trend charts + Mixpanel placeholder ──────────────── */}
          <section style={chartBandStyle}>
            <ChartTile {...get('earn-vs-last-week')} yFormat="gbp-k" />
            <Placeholder
              label="Radio Ads (30 Days)"
              reason="Awaiting Mixpanel API connector"
            />
            <ChartTile {...get('ipp-vs-last-week')}  yFormat="gbp-2dp" />
          </section>

          {/* ── Row 5: Top Brokers Today — fills the bottom space with
              an operational read floor managers actually use. */}
          <TopBrokersToday />
        </div>
      )}

      <Footer title={title} now={now} />
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

// ─── Footer (logo · board name · clock) ────────────────────────────────
//
// More visible than the previous one-liner — wears the InsureTec brand
// strip in three columns: logo on the left, board name centred, clock
// on the right. Reads like a finished operations dashboard rather than
// a forgotten margin.

function Footer({ title, now }: { title: string; now: number }) {
  const t = new Date(now);
  const hh = t.getHours().toString().padStart(2, '0');
  const mm = t.getMinutes().toString().padStart(2, '0');
  return (
    <footer style={{
      marginTop: 16, padding: '12px 18px',
      borderTop: '1px solid rgba(255,255,255,0.10)',
      background: 'rgba(11,16,32,0.5)',
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
      alignItems: 'center', borderRadius: 10,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#cbd5e1' }}>
        <img src="/insuretec-logo.svg" alt="InsureTec" height={22}
             style={{ display: 'block', filter: 'drop-shadow(0 0 8px rgba(56,189,248,0.2))' }} />
      </span>
      <span style={{
        textAlign: 'center', fontSize: 14, fontWeight: 700,
        color: '#cbd5e1', letterSpacing: '0.12em', textTransform: 'uppercase',
      }}>{title}</span>
      <span style={{
        textAlign: 'right', fontSize: 22, fontWeight: 800, color: '#f1f5f9',
        fontVariantNumeric: 'tabular-nums',
      }}>{hh}:{mm}</span>
    </footer>
  );
}

// ─── Headline tile (Earn + Webbys) — biggest cards, top-left placement ─
//
// The pair of metrics a director glances at first when they walk past
// the wall. Mirrors the Gecko hierarchy: today's Earn is the lead, with
// Webbys as the live-flow companion. Bigger and brighter than every
// other tile on the board so the eye lands here on entry.

function HeadlineTile({ spec, result, accent, big = false }: {
  spec?: WidgetSpec; result?: WidgetResult; accent: string; big?: boolean;
}) {
  if (!spec) return null;
  const value = result?.value ?? null;
  const status = computeStatus(value, spec.status);
  // If a threshold trips, the status colour overrides the tile's
  // configured accent — alert always wins. Keeps the visual rule
  // consistent: red/amber/green means the same thing on every tile.
  const tint =
    status === 'good'  ? { fg: '#86efac', glow: 'rgba(16,185,129,0.24)',  border: 'rgba(16,185,129,0.55)' }
  : status === 'warn'  ? { fg: '#fcd34d', glow: 'rgba(251,191,36,0.24)',  border: 'rgba(251,191,36,0.55)' }
  : status === 'alert' ? { fg: '#fca5a5', glow: 'rgba(248,113,113,0.30)', border: 'rgba(248,113,113,0.6)' }
  : null;

  const finalAccent = tint?.fg     ?? accent;
  const borderCol   = tint?.border ?? `${accent}55`;
  const glowCol     = tint?.glow   ?? `${accent}20`;

  return (
    <div style={{
      ...tileStyle, flex: big ? '2 1 0' : '1 1 0',
      padding: 'clamp(16px, 2vw, 24px) clamp(18px, 2.4vw, 28px)',
      // Headline tiles pop a little harder — brighter border + glow
      // halo so they carry distance.
      border: `1px solid ${borderCol}`,
      background: tint
        ? `linear-gradient(180deg, ${tint.glow} 0%, rgba(20,26,46,0.7) 75%)`
        : `linear-gradient(180deg, ${accent}1c 0%, rgba(20,26,46,0.65) 70%)`,
      boxShadow: `0 0 32px ${glowCol}`,
      animation: status === 'alert' ? 'wb-alert-pulse 1.6s ease-in-out infinite' : undefined,
      position: 'relative',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 8,
      }}>
        <div style={{ ...tileLabelStyle, fontSize: 13, color: finalAccent }}>
          {spec.label}
        </div>
        {status && <StatusChip status={status} />}
      </div>
      <div style={{
        fontSize: big
          ? 'clamp(46px, 6.4vw, 88px)'
          : 'clamp(34px, 4.6vw, 60px)',
        fontWeight: 800, lineHeight: 0.92,
        color: tint ? tint.fg : '#f1f5f9',
        fontVariantNumeric: 'tabular-nums',
        textShadow: `0 0 28px ${glowCol}`,
      }}>{formatValueOrError(result, spec.format)}</div>
    </div>
  );
}

// ─── NB Earn MTD tile — mid-board pairing with the Earn-vs-Yesterday
// chart. Demoted from page-headline to row 3, where Gecko also placed
// it. The big number + target progress bar communicate "are we on
// track for the month" at a glance.

function NBEarnMTDTile({ spec, result, target }: {
  spec?: WidgetSpec; result?: WidgetResult; target?: number;
}) {
  if (!spec) return null;
  const value = result?.value ?? null;
  const pct = (target && value != null) ? Math.max(0, Math.min(1, value / target)) : 0;
  const onTrack = pct >= 1;
  return (
    <div style={{
      ...tileStyle, flex: '1 1 0', minWidth: 280,
      padding: 'clamp(16px, 2vw, 22px)',
      border: '1px solid rgba(129,140,248,0.4)',
      background: 'linear-gradient(180deg, rgba(129,140,248,0.10) 0%, rgba(20,26,46,0.65) 70%)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 6,
      }}>
        <div style={{ ...tileLabelStyle, color: '#a5b4fc' }}>{spec.label}</div>
        <div style={{
          fontSize: 14, fontWeight: 700, color: onTrack ? '#86efac' : '#cbd5e1',
          fontVariantNumeric: 'tabular-nums',
        }}>{Math.round(pct * 100)}%</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{
          fontSize: 'clamp(40px, 5.4vw, 72px)', fontWeight: 800, lineHeight: 0.95,
          color: '#f1f5f9', fontVariantNumeric: 'tabular-nums',
          textShadow: '0 0 24px rgba(129,140,248,0.25)',
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
            position: 'relative', height: 12, borderRadius: 99,
            background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{
              position: 'absolute', inset: 0, width: `${pct * 100}%`,
              background: 'linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)',
              boxShadow: '0 0 16px rgba(56,189,248,0.4)',
              transition: 'width 0.6s ease',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stack / grid wrappers — for grouping small KPIs in row 1/2 ────────

function StackTile({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      ...tileStyle, flex: '1 1 0', minWidth: 180,
      padding: 12,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>{children}</div>
  );
}

function GridTile({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <div style={{
      ...tileStyle, flex: '1.4 1 0', minWidth: 280,
      padding: 12,
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 8,
    }}>{children}</div>
  );
}

// ─── Small KPI tile ────────────────────────────────────────────────────
//
// Beefier than the previous version — bigger value font, brighter
// labels (no more whisper-thin tracking), stronger card contrast,
// optional status chip in the corner. `compact` mode is what the
// stack/grid rows use; full standalone mode is left for future use.

function SmallKpi({ spec, result, compact = false }: {
  spec?: WidgetSpec; result?: WidgetResult; compact?: boolean;
}) {
  if (!spec) return null;
  if (result?.placeholder) {
    return <PlaceholderKpi label={spec.label} reason={result.reason || ''} compact={compact} />;
  }
  const status = computeStatus(result?.value ?? null, spec.status);
  // The whole card now reads as the indicator — tinted background +
  // coloured border + matching chip + value text shifts shade. Reads
  // from across the room: green = OK, amber = watch, red = act.
  const tint =
    status === 'good'  ? { bg: 'rgba(16,185,129,0.14)',  border: 'rgba(16,185,129,0.55)',  glow: 'rgba(16,185,129,0.20)',  fg: '#86efac' }
  : status === 'warn'  ? { bg: 'rgba(251,191,36,0.14)',  border: 'rgba(251,191,36,0.55)',  glow: 'rgba(251,191,36,0.18)',  fg: '#fcd34d' }
  : status === 'alert' ? { bg: 'rgba(248,113,113,0.16)', border: 'rgba(248,113,113,0.6)',  glow: 'rgba(248,113,113,0.30)', fg: '#fca5a5' }
  :                      null;

  const baseStyle = compact ? compactKpiStyle : standaloneKpiStyle;
  const overlayStyle: React.CSSProperties = tint
    ? {
        background: tint.bg,
        border: `1px solid ${tint.border}`,
        boxShadow: `0 0 18px ${tint.glow} inset`,
        animation: status === 'alert' ? 'wb-alert-pulse 1.6s ease-in-out infinite' : undefined,
      }
    : {};

  return (
    <div style={{ ...baseStyle, ...overlayStyle }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, marginBottom: 3,
      }}>
        <div style={{
          fontSize: compact ? 11 : 12, fontWeight: 800,
          color: tint ? tint.fg : '#cbd5e1',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{spec.label}</div>
        {status && <StatusChip status={status} small />}
      </div>
      <div style={{
        fontSize: compact ? 'clamp(24px, 2.6vw, 34px)' : 'clamp(32px, 3.4vw, 44px)',
        fontWeight: 800, lineHeight: 1,
        color: tint ? tint.fg : '#f1f5f9',
        fontVariantNumeric: 'tabular-nums',
        textShadow: tint ? `0 0 12px ${tint.glow}` : undefined,
      }}>{formatValueOrError(result, spec.format)}</div>
    </div>
  );
}

// ─── Direct v External — big numbers first, bar as supporting context ──
//
// Rebuilt to lead with two prominent channel cards (value + percent)
// before the proportional bar underneath, matching the original Gecko
// where the two figures were the primary read. The bar still gives
// the at-a-glance proportion but doesn't compete with the numbers.

function DirectExternal({ direct, external }: {
  direct:   { spec?: WidgetSpec; result?: WidgetResult };
  external: { spec?: WidgetSpec; result?: WidgetResult };
}) {
  const d = direct.result?.value ?? 0;
  const e = external.result?.value ?? 0;
  const total = d + e;
  const dPct = total > 0 ? d / total : 0;
  const ePct = total > 0 ? e / total : 0;

  return (
    <section style={{
      ...tileStyle, flex: '1.6 1 0', minWidth: 360,
      padding: '14px 18px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span style={{ ...tileLabelStyle, fontSize: 12, color: '#cbd5e1' }}>
          Direct v External
        </span>
        <span style={{
          fontSize: 13, fontWeight: 700, color: '#94a3b8',
          fontVariantNumeric: 'tabular-nums',
        }}>
          Total {formatValue(total, 'gbp-k')}
        </span>
      </div>

      {/* Two big-number cards side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <ChannelCard label="Direct"   value={d} pct={dPct} accent="#38bdf8" />
        <ChannelCard label="External" value={e} pct={ePct} accent="#94a3b8" />
      </div>

      {/* Stacked horizontal bar — single bar with two segments, sized
          by proportion. Acts as the visual sanity check for the two
          numbers above. */}
      <div style={{
        position: 'relative', height: 8, borderRadius: 99, overflow: 'hidden',
        background: 'rgba(255,255,255,0.04)',
      }}>
        {total > 0 && (
          <>
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: 0,
              width: `${dPct * 100}%`,
              background: 'linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)',
            }} />
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${dPct * 100}%`,
              width: `${ePct * 100}%`,
              background: 'linear-gradient(90deg, #94a3b8 0%, #64748b 100%)',
            }} />
          </>
        )}
      </div>
    </section>
  );
}

function ChannelCard({ label, value, pct, accent }: {
  label: string; value: number; pct: number; accent: string;
}) {
  return (
    <div style={{
      borderRadius: 10,
      padding: '10px 14px',
      background: `${accent}10`,
      border: `1px solid ${accent}33`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 4,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 800,
          color: accent, letterSpacing: '0.18em', textTransform: 'uppercase',
        }}>{label}</span>
        <span style={{
          fontSize: 14, fontWeight: 800, color: '#f1f5f9',
          fontVariantNumeric: 'tabular-nums',
        }}>{Math.round(pct * 100)}%</span>
      </div>
      <div style={{
        fontSize: 'clamp(28px, 3vw, 40px)', fontWeight: 800, lineHeight: 0.95,
        color: '#f1f5f9', fontVariantNumeric: 'tabular-nums',
        textShadow: `0 0 18px ${accent}33`,
      }}>{formatValue(value, 'gbp-k')}</div>
    </div>
  );
}

// ─── Status indicator helpers ──────────────────────────────────────────

type Status = 'good' | 'warn' | 'alert';

function computeStatus(
  value: number | null,
  threshold: WidgetSpec['status'] | undefined,
): Status | null {
  if (value == null || !threshold) return null;
  if ('goodAbove' in threshold) {
    if (value >= threshold.goodAbove) return 'good';
    if (value >= threshold.warnAbove) return 'warn';
    return 'alert';
  }
  if (value <= threshold.goodBelow) return 'good';
  if (value <= threshold.warnBelow) return 'warn';
  return 'alert';
}

function StatusChip({ status, small = false }: { status: Status; small?: boolean }) {
  const conf =
    status === 'good'  ? { bg: 'rgba(16,185,129,0.16)', fg: '#86efac', mark: '✓' }
  : status === 'warn'  ? { bg: 'rgba(251,191,36,0.18)', fg: '#fcd34d', mark: '!' }
  :                       { bg: 'rgba(248,113,113,0.20)', fg: '#fca5a5', mark: '!' };
  const sz = small ? 18 : 22;
  return (
    <span aria-hidden style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: sz, height: sz, borderRadius: 99,
      background: conf.bg, color: conf.fg,
      fontSize: small ? 11 : 13, fontWeight: 900,
      flexShrink: 0,
    }}>{conf.mark}</span>
  );
}

// ─── Top Brokers Today — fills the bottom space ────────────────────────
//
// Reuses the existing /api/board-data/sales-group endpoint (the
// combined London + Guildford leaderboard). Pulls the top 5 by income
// today and renders a small horizontal podium. Operational read floor
// managers actually use — "who's having a great morning, who needs a
// nudge" — without anyone having to flip to another board.

function TopBrokersToday() {
  const [rows,  setRows]  = useState<any[]>([]);
  const [tick,  setTick]  = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/board-data/sales-group', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        if (cancelled || !d) return;
        const cols   = (d.columns || []) as string[];
        const rs     = (d.rows    || []) as any[];
        const nameC  = cols[0] || 'name';
        const todayC = cols.find((c: string) => /income.*today|today.*income/i.test(c)) || '';
        if (!todayC) return setRows([]);
        const ranked = rs
          .map(r => ({
            name: String(r[nameC] ?? ''),
            today: parseMoney(r[todayC]),
          }))
          .filter(r => r.today > 0)
          .sort((a, b) => b.today - a.today)
          .slice(0, 5);
        setRows(ranked);
      })
      .catch(() => { /* swallow — board still renders without this strip */ });
    return () => { cancelled = true; };
  }, [tick]);

  // Refresh every 60s — we don't need second-by-second precision here
  // and we want to amortise the SQL hit on the underlying leaderboard.
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <section style={{ ...tileStyle, padding: '14px 18px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 12,
      }}>
        <span style={{ ...tileLabelStyle, color: '#fde68a' }}>🏆 Top Brokers Today</span>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
          combined London + Guildford
        </span>
      </div>
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
      }}>
        {rows.length === 0 && (
          <div style={{ color: '#475569', fontSize: 13, fontWeight: 600 }}>
            No income recorded yet today
          </div>
        )}
        {rows.map((r, i) => (
          <BrokerCard key={r.name + i} rank={i + 1} name={r.name} income={r.today} />
        ))}
      </div>
    </section>
  );
}

function BrokerCard({ rank, name, income }: { rank: number; name: string; income: number }) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
  const accent = rank === 1 ? '#fcd34d'
              : rank === 2 ? '#cbd5e1'
              : rank === 3 ? '#fbbf24'
              :              '#64748b';
  return (
    <div style={{
      borderRadius: 10, padding: '10px 14px',
      background: `linear-gradient(180deg, ${accent}14 0%, rgba(20,26,46,0.5) 80%)`,
      border: `1px solid ${accent}40`,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span aria-hidden style={{
        fontSize: 22, lineHeight: 1, flexShrink: 0,
        opacity: medal ? 1 : 0.5,
      }}>{medal || `#${rank}`}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 800, color: '#f1f5f9',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{stripAwardEmojis(name)}</div>
        <div style={{
          fontSize: 18, fontWeight: 800, color: accent,
          fontVariantNumeric: 'tabular-nums', marginTop: 2,
        }}>{formatValue(income, 'gbp')}</div>
      </div>
    </div>
  );
}

/** Pull the £ value out of whatever the leaderboard SQL returned —
 *  could be a number, a £-prefixed string, with K/M suffixes etc. */
function parseMoney(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[£$,\s]/g, '');
  const mul = /K$/i.test(s) ? 1e3 : /M$/i.test(s) ? 1e6 : 1;
  const n = parseFloat(s.replace(/[KM]$/i, ''));
  return Number.isFinite(n) ? n * mul : 0;
}

/** Award emojis (🥇🥈🥉🍪🔥🎉🚐🍺🍾) are pre-stamped onto leaderboard
 *  names by the per-office SQL. We're showing our own podium, so strip
 *  them off to avoid redundancy. */
function stripAwardEmojis(name: string): string {
  return name
    .replace(/[\u{1F947}\u{1F948}\u{1F949}\u{1F36A}\u{1F525}\u{1F389}\u{1F690}\u{1F37A}\u{1F37E}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
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
    <div style={{ ...tileStyle, flex: '1 1 0', minWidth: 280, padding: '16px 18px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 12,
      }}>
        <span style={{ ...tileLabelStyle, fontSize: 12, color: '#cbd5e1' }}>{spec.label}</span>
        <span style={{ display: 'inline-flex', gap: 14, fontSize: 13, fontWeight: 700 }}>
          {series.map(s => (
            <span key={s.key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, color: s.tint,
            }}>
              <span aria-hidden style={{
                width: 10, height: 10, borderRadius: 99, background: s.tint,
                boxShadow: `0 0 8px ${s.tint}80`,
              }} />
              {s.label}
            </span>
          ))}
        </span>
      </div>
      <div style={{ height: 220 }}>
        {rows.length === 0 ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#475569', fontSize: 12, fontWeight: 600,
          }}>No data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis
                dataKey={spec.xKey || 'Hour'}
                tick={{ fill: '#cbd5e1', fontSize: 13, fontWeight: 700 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#cbd5e1', fontSize: 12, fontWeight: 600 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                tickLine={false}
                tickFormatter={(v: number) => formatValue(v, yFormat)}
                width={56}
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.06)' }}
                content={<HourTooltip yFormat={yFormat} series={series} />}
              />
              {series.map(s => (
                <Bar key={s.key} dataKey={s.key} fill={s.tint} radius={[4, 4, 0, 0]} />
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
      ...tileStyle, flex: '1 1 0', minWidth: 280,
      borderStyle: 'dashed',
      borderColor: 'rgba(255,255,255,0.16)',
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

function PlaceholderKpi({ label, reason, compact = false }: {
  label: string; reason: string; compact?: boolean;
}) {
  return (
    <div title={reason} style={compact ? { ...compactKpiStyle, borderStyle: 'dashed' }
                                       : { ...standaloneKpiStyle, borderStyle: 'dashed' }}>
      <div style={{
        fontSize: compact ? 11 : 12, fontWeight: 800,
        color: '#64748b', letterSpacing: '0.12em', textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        fontSize: compact ? 'clamp(20px, 2.2vw, 28px)' : 'clamp(28px, 3vw, 38px)',
        fontWeight: 700, lineHeight: 1,
        color: '#475569', marginTop: 4,
      }}>⏸ Pending</div>
    </div>
  );
}

// ─── Styling primitives ────────────────────────────────────────────────
//
// Page background went a touch darker (#08101e) so the cards' lighter
// gradients have something to lift off — fixes the "too flat" feedback
// where cards were close to the page colour. Tile borders also bumped
// from rgba(255,255,255,0.06) → 0.10 so each card has visible
// boundaries from across the room.

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#08101e',
  backgroundImage: `
    radial-gradient(ellipse at 50% -10%, rgba(56,189,248,0.10) 0%, transparent 55%),
    linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
  `,
  backgroundSize: 'auto, 40px 40px, 40px 40px',
  color: '#f1f5f9',
  fontFamily: 'var(--font-raleway, sans-serif)',
  padding: 'clamp(14px, 2.4vh, 24px) clamp(14px, 2.4vw, 28px)',
  display: 'flex', flexDirection: 'column',
};

const tileStyle: React.CSSProperties = {
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'linear-gradient(180deg, rgba(99,102,241,0.10) 0%, rgba(20,26,46,0.68) 70%)',
  boxShadow: '0 4px 18px rgba(0,0,0,0.25)',
};

const tileLabelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 800,
  color: '#cbd5e1', letterSpacing: '0.14em', textTransform: 'uppercase',
};

/** Inner KPI tile — used inside a StackTile or GridTile. No own
 *  background or border (the parent provides the card chrome); just
 *  spacing + label + value. */
const compactKpiStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  background: 'rgba(11,16,32,0.55)',
  border: '1px solid rgba(255,255,255,0.04)',
  minWidth: 0,
};

/** Full-card KPI — for use outside a StackTile/GridTile (currently
 *  unused, kept for layout flexibility). */
const standaloneKpiStyle: React.CSSProperties = {
  ...({} as any),
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'linear-gradient(180deg, rgba(99,102,241,0.10) 0%, rgba(20,26,46,0.68) 70%)',
  boxShadow: '0 4px 18px rgba(0,0,0,0.25)',
  padding: '14px 18px', flex: '1 1 0', minWidth: 0,
};

const headlineRowStyle: React.CSSProperties = {
  display: 'flex', gap: 12, flexWrap: 'wrap',
};

const row2Style: React.CSSProperties = {
  display: 'flex', gap: 12, flexWrap: 'wrap',
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
