'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { WbBoard, WbWidget, WbDataset } from '@/lib/db';

interface Props {
  board: WbBoard & { widgets: WbWidget[] };
  datasets: WbDataset[];
}

const card = { background: 'rgba(20,26,42,0.7)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 16 };
const inp: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', color: '#f1f5f9', fontSize: 13, outline: 'none', marginTop: 6 };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em' };

const PRESETS = {
  desktop: { cols: 12, rows: 6, label: 'Desktop', desc: '12 × 6  —  widescreen TV / monitor' },
  mobile:  { cols: 4,  rows: 8, label: 'Mobile',  desc: '4 × 8  —  portrait / phone display' },
} as const;

const FONT_FAMILIES = [
  { value: '',                        label: 'Default (Raleway)' },
  { value: 'Arial, sans-serif',       label: 'Arial' },
  { value: 'Tahoma, sans-serif',      label: 'Tahoma' },
  { value: 'Verdana, sans-serif',     label: 'Verdana' },
  { value: 'Georgia, serif',          label: 'Georgia' },
  { value: "'Courier New', monospace", label: 'Courier New' },
];

const DEFAULT: Partial<WbWidget> = {
  type: 'number', title: 'New Widget', data_source_type: 'sql',
  data_source_config: {}, display_config: {},
  col_start: 1, col_span: 1, row_start: 1, row_span: 1, refresh_interval: 60,
};

export default function BoardEditor({ board: init, datasets }: Props) {
  const router = useRouter();
  const [board, setBoard] = useState(init);
  const [widgets, setWidgets] = useState<WbWidget[]>(init.widgets || []);
  const [selected, setSelected] = useState<WbWidget | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<WbWidget>>({});
  const [boardName, setBoardName] = useState(init.name);
  const [saving, setSaving] = useState(false);
  const [connections, setConnections] = useState<any>(null);

  // Resize drag
  const [resizePreview, setResizePreview] = useState<{ widgetId: string; colSpan: number; rowSpan: number } | null>(null);
  const resizeFinalRef = useRef<{ widgetId: string; colSpan: number; rowSpan: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/connections').then(r => r.json()).then(setConnections).catch(() => {});
  }, []);

  async function saveBoardSettings(opts: { name?: string; cols?: number; rows?: number; background?: string } = {}) {
    await fetch(`/api/boards/${board.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:       opts.name       ?? boardName,
        cols:       opts.cols       ?? board.cols,
        rows:       opts.rows       ?? board.rows,
        background: opts.background ?? board.background,
      }),
    });
  }

  async function applyPreset(key: keyof typeof PRESETS) {
    const { cols, rows } = PRESETS[key];
    setBoard(b => ({ ...b, cols, rows }));
    await saveBoardSettings({ cols, rows });
  }

  async function deleteBoard() {
    if (!confirm(`Delete "${board.name}"? This cannot be undone.`)) return;
    await fetch(`/api/boards/${board.id}`, { method: 'DELETE' });
    router.push('/admin');
  }

  function startAdd() { setSelected(null); setAdding(true); setForm({ ...DEFAULT }); }
  function selectWidget(w: WbWidget) { setSelected(w); setAdding(false); setForm({ ...w }); }
  function cancelEdit() { setSelected(null); setAdding(false); setForm({}); }

  function parseJson(v: any) {
    if (typeof v === 'object' && v !== null) return v;
    try { return JSON.parse(v); } catch { return v; }
  }

  async function saveWidget() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        data_source_config: parseJson(form.data_source_config),
        display_config:     parseJson(form.display_config),
      };
      if (adding) {
        const res = await fetch(`/api/boards/${board.id}/widgets`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.widget) { setWidgets(ws => [...ws, data.widget]); setAdding(false); setForm({}); }
      } else if (selected) {
        const res = await fetch(`/api/widgets/${selected.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.widget) {
          setWidgets(ws => ws.map(w => w.id === data.widget.id ? data.widget : w));
          setSelected(data.widget);
        }
      }
    } finally { setSaving(false); }
  }

  async function deleteWidget(id: string) {
    if (!confirm('Delete this widget?')) return;
    await fetch(`/api/widgets/${id}`, { method: 'DELETE' });
    setWidgets(ws => ws.filter(w => w.id !== id));
    if (selected?.id === id) cancelEdit();
  }

  // ── Resize drag ─────────────────────────────────────────────────────────
  function startResize(e: React.MouseEvent, widget: WbWidget) {
    e.preventDefault();
    e.stopPropagation();
    const gridEl = gridRef.current;
    if (!gridEl) return;

    const rect = gridEl.getBoundingClientRect();
    // Grid inner area (inset: 8px each side)
    const innerW = rect.width  - 16;
    const innerH = rect.height - 16;
    const cellW  = innerW / board.cols;
    const cellH  = innerH / board.rows;

    const startX     = e.clientX;
    const startY     = e.clientY;
    const origColSpan = widget.col_span;
    const origRowSpan = widget.row_span;

    resizeFinalRef.current = { widgetId: widget.id, colSpan: origColSpan, rowSpan: origRowSpan };
    setResizePreview({ widgetId: widget.id, colSpan: origColSpan, rowSpan: origRowSpan });

    function onMouseMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const maxCol = board.cols - widget.col_start + 1;
      const maxRow = board.rows - widget.row_start + 1;
      const colSpan = Math.max(1, Math.min(maxCol, origColSpan + Math.round(dx / cellW)));
      const rowSpan = Math.max(1, Math.min(maxRow, origRowSpan + Math.round(dy / cellH)));
      resizeFinalRef.current = { widgetId: widget.id, colSpan, rowSpan };
      setResizePreview({ widgetId: widget.id, colSpan, rowSpan });
    }

    async function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
      setResizePreview(null);
      const final = resizeFinalRef.current;
      resizeFinalRef.current = null;
      if (!final) return;
      const res = await fetch(`/api/widgets/${widget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ col_span: final.colSpan, row_span: final.rowSpan }),
      });
      const data = await res.json();
      if (data.widget) {
        setWidgets(ws => ws.map(w => w.id === data.widget.id ? data.widget : w));
        if (selected?.id === widget.id) {
          setSelected(data.widget);
          setForm(f => ({ ...f, col_span: data.widget.col_span, row_span: data.widget.row_span }));
        }
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  }

  // ── display_config helpers ───────────────────────────────────────────────
  function getDisplayCfg(): Record<string, any> {
    const raw = form.display_config;
    if (!raw) return {};
    if (typeof raw === 'object') return raw as any;
    try { return JSON.parse(raw as any); } catch { return {}; }
  }

  function setDisplayCfgField(key: string, value: any) {
    setForm(f => {
      const cur: any = typeof f.display_config === 'string'
        ? (() => { try { return JSON.parse(f.display_config as any); } catch { return {}; } })()
        : (f.display_config || {});
      const next = { ...cur };
      if (value === undefined || value === '' || value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return { ...f, display_config: next as any };
    });
  }

  const connDot = (ok?: boolean) => (
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? '#10b981' : ok === false ? '#f87171' : '#475569', display: 'inline-block', marginRight: 6, boxShadow: ok ? '0 0 6px rgba(16,185,129,0.6)' : undefined }} />
  );

  const activePreset = (board.cols === 12 && board.rows === 6) ? 'desktop'
    : (board.cols === 4  && board.rows === 8) ? 'mobile' : null;

  const dcfg = getDisplayCfg();

  return (
    <div style={{ minHeight: '100vh', color: '#f1f5f9', fontFamily: 'var(--font-raleway, sans-serif)' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(10,15,28,0.9)', backdropFilter: 'blur(18px)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/admin" style={{ color: '#64748b', fontSize: 13 }}>← Boards</Link>
          <span style={{ color: '#334155' }}>/</span>
          <input
            value={boardName}
            onChange={e => setBoardName(e.target.value)}
            onBlur={() => saveBoardSettings()}
            style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.15)', color: '#f1f5f9', fontSize: 15, fontWeight: 700, padding: '2px 4px', width: 220, outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={`/view/${board.slug_token}`} target="_blank" style={{ padding: '8px 16px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#6ee7b7', fontSize: 13, fontWeight: 600 }}>
            View Wallboard ↗
          </Link>
          <button onClick={deleteBoard} style={{ padding: '8px 16px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, color: '#f87171', fontSize: 13, cursor: 'pointer' }}>
            Delete Board
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 57px)' }}>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Board layout presets */}
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Board Layout</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(Object.entries(PRESETS) as [keyof typeof PRESETS, (typeof PRESETS)[keyof typeof PRESETS]][]).map(([key, p]) => {
                const active = activePreset === key;
                return (
                  <button key={key} onClick={() => applyPreset(key)} style={{ padding: '10px 14px', background: active ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 10, color: active ? '#6ee7b7' : '#94a3b8', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: active ? '#4ade80' : '#475569', marginTop: 2 }}>{p.desc}</div>
                  </button>
                );
              })}
              <div style={{ marginTop: 4 }}>
                <div style={lbl}>Background</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <input type="color" value={board.background || '#0a0f1c'}
                    onChange={e => setBoard(b => ({ ...b, background: e.target.value }))}
                    onBlur={() => saveBoardSettings()}
                    style={{ width: 36, height: 28, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'none', cursor: 'pointer', padding: 2 }} />
                  <span style={{ fontSize: 12, color: '#475569' }}>{board.background}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Connections */}
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Connections</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'SQL Server',    ok: connections?.mssql?.ok,    err: connections?.mssql?.error },
                { label: 'Zendesk',       ok: connections?.zendesk?.ok,  err: connections?.zendesk?.error },
                { label: 'Noetica (push)',ok: connections?.noetica?.ok,  err: connections?.noetica?.error },
              ].map(c => (
                <div key={c.label} style={{ fontSize: 12, color: c.ok ? '#6ee7b7' : c.ok === false ? '#f87171' : '#64748b', display: 'flex', alignItems: 'center' }}>
                  {connDot(c.ok)}{c.label}
                  {c.err && !c.ok && <span style={{ marginLeft: 6, color: '#475569', fontSize: 11 }}>({c.err})</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Widget list */}
          <div style={{ ...card, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Widgets ({widgets.length})</div>
              <button onClick={startAdd} style={{ padding: '4px 10px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 6, color: '#6ee7b7', fontSize: 12, cursor: 'pointer' }}>+ Add</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {widgets.map(w => (
                <div key={w.id} onClick={() => selectWidget(w)} style={{ padding: '8px 10px', borderRadius: 8, background: selected?.id === w.id ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${selected?.id === w.id ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.06)'}`, cursor: 'pointer' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{w.title}</div>
                  <div style={{ fontSize: 11, color: '#475569' }}>{w.type} · col {w.col_start} row {w.row_start} · {w.col_span}w × {w.row_span}h</div>
                </div>
              ))}
              {widgets.length === 0 && <div style={{ fontSize: 12, color: '#334155', textAlign: 'center', padding: '12px 0' }}>No widgets yet</div>}
            </div>
          </div>
        </div>

        {/* ── Main area ────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Grid preview */}
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 11, color: '#475569', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Layout Preview</span>
              <span style={{ color: '#334155' }}>·</span>
              <span>{board.cols} cols × {board.rows} rows</span>
              <span style={{ color: '#334155' }}>·</span>
              <span>Drag the <strong style={{ color: '#6ee7b7' }}>⤡</strong> corner handle to resize a widget</span>
            </div>

            {/* Two-layer grid — background cells + widget overlay */}
            <div
              ref={gridRef}
              style={{ position: 'relative', height: 320, padding: 8, userSelect: 'none' }}
            >
              {/* Layer 1: background cells */}
              <div style={{ position: 'absolute', inset: 8, display: 'grid', gridTemplateColumns: `repeat(${board.cols}, 1fr)`, gridTemplateRows: `repeat(${board.rows}, 1fr)`, gap: 4 }}>
                {Array.from({ length: board.cols * board.rows }).map((_, i) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 3 }} />
                ))}
              </div>

              {/* Layer 2: widgets */}
              <div style={{ position: 'absolute', inset: 8, display: 'grid', gridTemplateColumns: `repeat(${board.cols}, 1fr)`, gridTemplateRows: `repeat(${board.rows}, 1fr)`, gap: 4 }}>
                {widgets.map(w => {
                  const rp = resizePreview?.widgetId === w.id ? resizePreview : null;
                  const colSpan = rp?.colSpan ?? w.col_span;
                  const rowSpan = rp?.rowSpan ?? w.row_span;
                  const isSel   = selected?.id === w.id;
                  return (
                    <div
                      key={w.id}
                      onClick={() => selectWidget(w)}
                      style={{
                        gridColumn:  `${w.col_start} / span ${colSpan}`,
                        gridRow:     `${w.row_start} / span ${rowSpan}`,
                        background:  isSel ? 'rgba(16,185,129,0.22)' : 'rgba(16,185,129,0.1)',
                        border:      `1px solid ${isSel ? 'rgba(16,185,129,0.55)' : 'rgba(16,185,129,0.25)'}`,
                        borderRadius: 5,
                        display:     'flex', alignItems: 'center', justifyContent: 'center',
                        position:    'relative',
                        cursor:      'pointer',
                        zIndex:      1,
                        overflow:    'hidden',
                        fontSize:    11, color: '#6ee7b7', fontWeight: 600,
                        padding:     4, textAlign: 'center',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'calc(100% - 22px)', pointerEvents: 'none' }}>
                        {w.title}
                      </span>

                      {/* Resize handle */}
                      <div
                        title="Drag to resize"
                        onMouseDown={e => startResize(e, w)}
                        style={{
                          position: 'absolute', bottom: 2, right: 2,
                          width: 16, height: 16, cursor: 'se-resize',
                          background: 'rgba(16,185,129,0.4)', borderRadius: 3,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          zIndex: 2,
                        }}
                      >
                        {/* Two-line resize icon */}
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ pointerEvents: 'none' }}>
                          <line x1="2" y1="7" x2="7" y2="2" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" strokeLinecap="round"/>
                          <line x1="5" y1="7" x2="7" y2="5" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Widget form */}
          {(adding || selected) && (
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 16 }}>
                {adding ? 'New Widget' : `Edit: ${selected?.title}`}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

                {/* Title */}
                <div style={{ gridColumn: '1/-1' }}>
                  <div style={lbl}>Title</div>
                  <input style={inp} value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                </div>

                {/* Type + data source */}
                <div>
                  <div style={lbl}>Widget Type</div>
                  <select style={inp} value={form.type || 'number'} onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}>
                    {['number', 'table', 'leaderboard', 'line', 'bar'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <div style={lbl}>Data Source</div>
                  <select style={inp} value={form.data_source_type || 'sql'} onChange={e => setForm(f => ({ ...f, data_source_type: e.target.value as any }))}>
                    <option value="sql">SQL Server</option>
                    <option value="dataset">Noetica Dataset</option>
                    <option value="zendesk">Zendesk</option>
                  </select>
                </div>

                {form.data_source_type === 'dataset' && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={lbl}>Dataset</div>
                    <select style={inp} value={(form.data_source_config as any)?.dataset || ''} onChange={e => setForm(f => ({ ...f, data_source_config: { ...(f.data_source_config as any), dataset: e.target.value } }))}>
                      <option value="">Select dataset…</option>
                      {datasets.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                )}

                {/* Data source config */}
                <div style={{ gridColumn: '1/-1' }}>
                  <div style={lbl}>Data Source Config (JSON)</div>
                  <textarea style={{ ...inp, height: 80, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                    value={typeof form.data_source_config === 'string' ? form.data_source_config : JSON.stringify(form.data_source_config || {}, null, 2)}
                    onChange={e => setForm(f => ({ ...f, data_source_config: e.target.value as any }))} />
                </div>

                {/* Display config */}
                <div style={{ gridColumn: '1/-1' }}>
                  <div style={lbl}>Display Config (JSON)</div>
                  <textarea style={{ ...inp, height: 60, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                    value={typeof form.display_config === 'string' ? form.display_config : JSON.stringify(form.display_config || {}, null, 2)}
                    onChange={e => setForm(f => ({ ...f, display_config: e.target.value as any }))} />
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>For number widgets: {'{ "goal": 100, "value_key": "count" }'}</div>
                </div>

                {/* ── Text style ── */}
                <div style={{ gridColumn: '1/-1', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Text Style</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
                    <div>
                      <div style={lbl}>Font Family</div>
                      <select style={inp} value={dcfg.font_family || ''}
                        onChange={e => setDisplayCfgField('font_family', e.target.value || undefined)}>
                        {FONT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={lbl}>Font Size (px)</div>
                      <input type="number" min={8} max={48} style={inp}
                        value={dcfg.font_size ?? ''}
                        placeholder="auto"
                        onChange={e => setDisplayCfgField('font_size', e.target.value ? parseInt(e.target.value) : undefined)} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#334155', marginTop: 8 }}>Font size affects the widget body — useful for cramming more rows into table/leaderboard widgets on large screens.</div>
                </div>

                {/* ── Position ── */}
                <div style={{ gridColumn: '1/-1', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Position &amp; Size <span style={{ fontWeight: 400, textTransform: 'none', color: '#334155' }}>(or drag ⤡ handle in preview above)</span></div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    <div>
                      <div style={lbl}>Col</div>
                      <input type="number" min={1} max={board.cols} style={inp} value={form.col_start ?? 1}
                        onChange={e => setForm(f => ({ ...f, col_start: parseInt(e.target.value) || 1 }))} />
                    </div>
                    <div>
                      <div style={lbl}>Row</div>
                      <input type="number" min={1} max={board.rows} style={inp} value={form.row_start ?? 1}
                        onChange={e => setForm(f => ({ ...f, row_start: parseInt(e.target.value) || 1 }))} />
                    </div>
                    <div>
                      <div style={lbl}>Width</div>
                      <input type="number" min={1} max={board.cols} style={inp} value={form.col_span ?? 1}
                        onChange={e => setForm(f => ({ ...f, col_span: parseInt(e.target.value) || 1 }))} />
                    </div>
                    <div>
                      <div style={lbl}>Height</div>
                      <input type="number" min={1} max={board.rows} style={inp} value={form.row_span ?? 1}
                        onChange={e => setForm(f => ({ ...f, row_span: parseInt(e.target.value) || 1 }))} />
                    </div>
                    <div>
                      <div style={lbl}>Refresh (s)</div>
                      <input type="number" min={5} style={inp} value={form.refresh_interval ?? 60}
                        onChange={e => setForm(f => ({ ...f, refresh_interval: parseInt(e.target.value) || 60 }))} />
                    </div>
                  </div>
                </div>

              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={saveWidget} disabled={saving} style={{ padding: '9px 20px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
                  {saving ? 'Saving…' : 'Save Widget'}
                </button>
                <button onClick={cancelEdit} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
                {selected && (
                  <button onClick={() => deleteWidget(selected.id)} style={{ marginLeft: 'auto', padding: '9px 16px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8, color: '#f87171', fontSize: 13, cursor: 'pointer' }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
