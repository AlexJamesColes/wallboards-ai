'use client';
import { useEffect, useRef, useState } from 'react';
import type { WbWidget } from '@/lib/db';
import { formatNumber } from '@/lib/formatNumber';
import NoDataPlaceholder from '@/components/NoDataPlaceholder';
import { tokenize, extractEmojis } from '@/lib/emoji';
import { CelebrationRegistrar } from '@/components/Celebration';

interface Props { widget: WbWidget; data: any; }

interface ColumnFormat {
  column:        string;
  prefix?:       string;
  suffix?:       string;
  decimals?:     'auto' | number | string;
  abbreviation?: 'auto' | 'none' | 'K' | 'M' | 'B';
}

interface RowSnapshot {
  rank:   number;                         // 0-based position in the sorted list
  emojis: Set<string>;                    // emojis in the name cell
  values: Record<string, string>;         // formatted values per numeric column
}

/**
 * Table widget rendered as a flex-column of grid rows (not an HTML <table>).
 * Gamification layer compares each render to the previous snapshot:
 *   - If a row's rank changed → green glow + ↑/↓ delta arrow (climb / drop)
 *   - If a row gained emojis  → pop-in animation on the new ones
 *   - If a row lost emojis    → fade-out animation
 *   - If a row took #1        → crown flourish
 *   - If a numeric value changed → brief gold flash
 *   - #1 has a perpetual subtle gold pulse so the leader always stands out
 */
export default function TableWidget({ widget, data }: Props) {
  const columns: string[] = data?.columns || [];
  const rows:    any[]    = data?.rows    || [];
  const cfg     = (widget.display_config as any) || {};
  const formats: ColumnFormat[] = Array.isArray(cfg.column_formats) ? cfg.column_formats : [];
  const formatFor = (col: string) => formats.find(f => f.column === col);
  const hideHeader: boolean    = !!cfg.hide_header;
  const gamify:     boolean    = cfg.gamify !== false;   // on by default

  if (columns.length === 0) return <NoDataPlaceholder />;

  function isNumericColumn(col: string): boolean {
    if (formatFor(col)) return true;
    const sample = rows.find(r => r[col] !== null && r[col] !== undefined);
    if (!sample) return false;
    const v = sample[col];
    return typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== '');
  }

  function renderCell(col: string, value: any): string {
    if (value === null || value === undefined) return '—';
    const fmt = formatFor(col);
    if (!fmt) return String(value);
    const n = Number(value);
    if (isNaN(n)) return String(value);
    const decimals = fmt.decimals === undefined || fmt.decimals === 'auto' || fmt.decimals === ''
      ? 'auto'
      : Number(fmt.decimals);
    const prefix = fmt.prefix || '';
    const suffix = fmt.suffix || '';
    const formatted = formatNumber(n, {
      num_abbreviation: fmt.abbreviation ?? 'none',
      num_decimals:     decimals as any,
    });
    return `${prefix}${formatted}${suffix}`;
  }

  // ── Diffing: snapshot last render's state, keyed on the first column ───
  const nameCol = columns[0];
  const numericCols = columns.filter(isNumericColumn);

  // Strip emojis awarded to multiple rows — each decorative emoji should
  // recognise a SINGLE winner. If two agents tie for "most income today" the
  // SQL query often tags both with 🔥; we drop it from both so the accolade
  // is only shown when there's a clear winner.
  const dupedEmojis = (() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      // Dedup within the same row first (e.g. 🏆🏆 in one string counts once)
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

  function cleanName(raw: string): string {
    if (!dupedEmojis.size) return raw;
    let out = raw;
    dupedEmojis.forEach(e => { out = out.split(e).join(''); });
    return out.replace(/\s+/g, ' ').trim();
  }

  // Project rows so the first column has de-duped name text. Downstream
  // logic (diffing, NameCell, CelebrationRegistrar) all see the cleaned name.
  const cleanedRows = rows.map(r => ({ ...r, [nameCol]: cleanName(String(r[nameCol] ?? '')) }));

  const prev = useRef<Map<string, RowSnapshot>>(new Map());
  const [animToken, setAnimToken] = useState(0); // bumped each render so keyframes restart

  // Build current snapshot from the cleaned rows (so tied emojis are gone)
  const current = new Map<string, RowSnapshot>();
  cleanedRows.forEach((row, rank) => {
    const key = String(row[nameCol] ?? `__row_${rank}`);
    const values: Record<string, string> = {};
    numericCols.forEach(c => { values[c] = renderCell(c, row[c]); });
    current.set(key, {
      rank,
      emojis: extractEmojis(String(row[nameCol] ?? '')),
      values,
    });
  });

  // After each render, record the snapshot for next time.
  useEffect(() => {
    prev.current = current;
    setAnimToken(t => t + 1);     // eslint-disable-line react-hooks/exhaustive-deps
    // we intentionally want this to fire every time data changes
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  function diff(key: string): {
    rankDelta:    number;   // positive = climbed, negative = dropped, 0 = unchanged, NaN = brand new
    newEmojis:    Set<string>;
    lostEmojis:   Set<string>;
    changedCols:  Set<string>;
    tookFirst:    boolean;
  } {
    const cur = current.get(key)!;
    const was = prev.current.get(key);
    if (!was) {
      return { rankDelta: NaN, newEmojis: new Set(), lostEmojis: new Set(), changedCols: new Set(), tookFirst: cur.rank === 0 };
    }
    const newEmojis  = new Set<string>();
    const lostEmojis = new Set<string>();
    cur.emojis.forEach(e => { if (!was.emojis.has(e)) newEmojis.add(e); });
    was.emojis.forEach(e => { if (!cur.emojis.has(e)) lostEmojis.add(e); });
    const changedCols = new Set<string>();
    numericCols.forEach(c => { if ((was.values[c] ?? '') !== (cur.values[c] ?? '')) changedCols.add(c); });
    return {
      rankDelta:  was.rank - cur.rank,                    // positive if moved up
      newEmojis,
      lostEmojis,
      changedCols,
      tookFirst:  cur.rank === 0 && was.rank !== 0,
    };
  }

  // ── Column sizing (from prior pass) ─────────────────────────────────────
  const numNumeric = numericCols.length;
  const nameWeight = numNumeric >= 6 ? 2 : numNumeric >= 3 ? 2 : 3;
  // Extra leading column for the rank-change arrow
  const arrowCol = gamify ? '28px ' : '';
  const gridCols = arrowCol + columns
    .map((col, i) => {
      if (isNumericColumn(col)) return 'minmax(64px, 1fr)';
      return i === 0 ? `minmax(180px, ${nameWeight}fr)` : 'minmax(0, 1fr)';
    })
    .join(' ');

  const cellBase: React.CSSProperties = {
    padding: '2px 8px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    display: 'flex', alignItems: 'center',
  };

  function NameCell({ row, d }: { row: any; d: ReturnType<typeof diff> }) {
    const text = String(row[nameCol] ?? '—');
    const toks = tokenize(text);
    return (
      <div style={{ ...cellBase, gap: 2, color: '#e2e8f0', fontWeight: 500 }}>
        {toks.map((t, i) => {
          if (t.type === 'text') return <span key={i}>{t.value}</span>;
          const isNew  = d.newEmojis.has(t.value);
          const isCrown= d.tookFirst && i === 0;
          return (
            <span key={i}
              style={{
                display: 'inline-block',
                animation: isCrown
                  ? 'wb-crown 1.1s ease-out'
                  : isNew ? 'wb-emoji-pop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
                transformOrigin: 'center',
              }}>
              {t.value}
            </span>
          );
        })}
        {/* Lost emojis: render as tiny fading ghost suffix */}
        {[...d.lostEmojis].slice(0, 3).map((e, i) => (
          <span key={`lost-${i}`} aria-hidden style={{
            display: 'inline-block',
            animation: 'wb-emoji-fade 0.6s forwards',
            fontSize: '0.9em',
          }}>{e}</span>
        ))}
      </div>
    );
  }

  function ArrowCell({ d }: { d: ReturnType<typeof diff> }) {
    if (!gamify) return null;
    if (Number.isNaN(d.rankDelta) || d.rankDelta === 0) {
      return <div style={{ ...cellBase, padding: 0, justifyContent: 'center' }} />;
    }
    const up    = d.rankDelta > 0;
    const color = up ? '#10b981' : '#f87171';
    const arrow = up ? '▲' : '▼';
    const anim  = up ? 'wb-arrow-up 0.5s ease-out' : 'wb-arrow-down 0.5s ease-out';
    return (
      <div style={{ ...cellBase, padding: 0, justifyContent: 'center', flexDirection: 'column', lineHeight: 1, gap: 1 }}>
        <span style={{ color, fontSize: '0.75em', animation: anim }}>{arrow}</span>
        <span style={{ color, fontSize: '0.65em', fontWeight: 700 }}>{Math.abs(d.rankDelta)}</span>
      </div>
    );
  }

  // Feed the hall-of-fame celebration with whichever of our rows have
  // decorative emojis — uses the first up-to-3 numeric columns as the stat
  // lines under their name.
  const statCols = numericCols.slice(0, 3).map(col => ({
    col,
    label:  col,
    format: (v: any) => renderCell(col, v),
  }));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontSize: 'inherit' }}>
      {gamify && (
        <CelebrationRegistrar
          widgetId={widget.id}
          rows={cleanedRows}
          nameCol={nameCol}
          statCols={statCols}
        />
      )}
      {!hideHeader && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: gridCols,
          borderBottom: '1px solid rgba(99,102,241,0.18)',
          flexShrink: 0,
        }}>
          {gamify && <div style={{ ...cellBase, padding: 0 }} />}
          {columns.map(col => (
            <div key={col} style={{
              ...cellBase,
              padding: '4px 8px',
              color: '#94a3b8', fontWeight: 600, fontSize: '0.85em',
              letterSpacing: '-0.005em',
              justifyContent: isNumericColumn(col) ? 'flex-end' : 'flex-start',
            }}>
              {col}
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {cleanedRows.map((row, i) => {
          const key = String(row[nameCol] ?? `__row_${i}`);
          const d   = diff(key);
          const rowAnim = !gamify || Number.isNaN(d.rankDelta) || d.rankDelta === 0
            ? undefined
            : d.rankDelta > 0 ? 'wb-row-up 1.2s ease-out' : 'wb-row-down 1.2s ease-out';
          const leaderStyle: React.CSSProperties = gamify && i === 0
            ? { animation: 'wb-leader-pulse 3.2s ease-in-out infinite' }
            : {};

          return (
            <div key={key + '|' + animToken} style={{
              display: 'grid',
              gridTemplateColumns: gridCols,
              flex: '1 1 0',
              minHeight: 22,
              maxHeight: 80,
              borderBottom: i < cleanedRows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined,
              animation: [rowAnim, leaderStyle.animation].filter(Boolean).join(', ') || undefined,
              position: 'relative',
            }}>
              {gamify && <ArrowCell d={d} />}
              {columns.map((col, ci) => {
                if (ci === 0) return <NameCell key={col} row={row} d={d} />;
                const isNum    = isNumericColumn(col);
                const changed  = gamify && d.changedCols.has(col);
                return (
                  <div key={col} style={{
                    ...cellBase,
                    color: '#e2e8f0',
                    fontWeight: isNum ? 600 : 500,
                    justifyContent: isNum ? 'flex-end' : 'flex-start',
                    fontVariantNumeric: isNum ? 'tabular-nums' : undefined,
                    animation: changed ? 'wb-value-flash 1.4s ease-out' : undefined,
                  }}>
                    {renderCell(col, row[col])}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
