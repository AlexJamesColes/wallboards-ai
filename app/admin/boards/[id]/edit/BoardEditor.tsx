'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { WbBoard, WbWidget, WbDataset } from '@/lib/db';
import { ZD_METRICS, ZD_TIMES, ZD_FILTER_FIELDS, ZD_GROUP_BY } from '@/lib/zendesk';
import CustomSelect from '@/components/CustomSelect';
import SourcePicker from '@/components/SourcePicker';
import WidgetRenderer from '@/components/WidgetRenderer';
import Combobox, { ComboOption } from '@/components/Combobox';

interface Props {
  board: WbBoard & { widgets: WbWidget[] };
  datasets: WbDataset[];
}

const card = { background: 'rgba(20,26,42,0.7)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 16 };
const inp: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', color: '#f1f5f9', fontSize: 13, outline: 'none', marginTop: 6 };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em' };

// InsureTec indigo/purple palette
const C = {
  primary:      '#6366f1',
  primaryDark:  '#4f46e5',
  primaryLight: '#a5b4fc',
  bg:     (a: number) => `rgba(99,102,241,${a})`,
  glow:   'rgba(99,102,241,0.5)',
};

const PRESETS = {
  desktop: { cols: 8,  rows: 5, label: 'Desktop',    desc: '8 × 5  —  widescreen TV / monitor (16:9)' },
  wide:    { cols: 12, rows: 7, label: 'Wide TV',    desc: '12 × 7  —  more widgets per board' },
  ultra:   { cols: 16, rows: 9, label: 'Ultra Wide', desc: '16 × 9  —  maximum density for large screens' },
  mobile:  { cols: 4,  rows: 8, label: 'Mobile',     desc: '4 × 8  —  portrait / phone display' },
} as const;

const FONT_FAMILIES = [
  { value: '',                         label: 'Default (Raleway)' },
  { value: 'Arial, sans-serif',        label: 'Arial' },
  { value: 'Tahoma, sans-serif',       label: 'Tahoma' },
  { value: 'Verdana, sans-serif',      label: 'Verdana' },
  { value: 'Georgia, serif',           label: 'Georgia' },
  { value: "'Courier New', monospace", label: 'Courier New' },
];

const DEFAULT: Partial<WbWidget> = {
  type: 'number', title: 'New Widget', data_source_type: 'sql',
  data_source_config: {}, display_config: {},
  col_start: 1, col_span: 1, row_start: 1, row_span: 1, refresh_interval: 60,
};

// Drag preview state covers both move and resize
type DragPreview = {
  widgetId:    string;
  colStart:    number;
  rowStart:    number;
  colSpan:     number;
  rowSpan:     number;
} | null;

const DRAG_THRESHOLD = 6; // px — below this is treated as a click

export default function BoardEditor({ board: init, datasets }: Props) {
  const router = useRouter();
  const [board,    setBoard]    = useState(init);
  const [widgets,  setWidgets]  = useState<WbWidget[]>(init.widgets || []);
  const [selected, setSelected] = useState<WbWidget | null>(null);
  const [adding,   setAdding]   = useState(false);
  const [pickingSource, setPickingSource] = useState(false);
  const [form,     setForm]     = useState<Partial<WbWidget>>({});
  const [boardName, setBoardName] = useState(init.name);
  const [saving,   setSaving]   = useState(false);
  const [connections, setConnections] = useState<any>(null);

  const [dragPreview, setDragPreview] = useState<DragPreview>(null);
  const dragFinalRef = useRef<DragPreview>(null);
  const gridRef      = useRef<HTMLDivElement>(null);

  // Zendesk filter-value autocomplete options, cached by field
  const [zdOptions, setZdOptions] = useState<Record<string, ComboOption[]>>({});
  const [zdLoading, setZdLoading] = useState<Record<string, boolean>>({});
  function loadZdOptions(field: string) {
    if (!field) return;
    if (zdOptions[field] || zdLoading[field]) return;
    setZdLoading(l => ({ ...l, [field]: true }));
    fetch(`/api/zendesk/options?field=${encodeURIComponent(field)}`)
      .then(r => r.json())
      .then(d => setZdOptions(o => ({ ...o, [field]: d.options || [] })))
      .catch(() => setZdOptions(o => ({ ...o, [field]: [] })))
      .finally(() => setZdLoading(l => ({ ...l, [field]: false })));
  }
  const AUTOCOMPLETE_FIELDS = new Set(['tag', 'assignee', 'group', 'brand', 'status', 'priority']);

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

  function startAdd()                      { setSelected(null); setAdding(false); setPickingSource(true); setForm({}); }
  function pickSource(src: 'sql' | 'zendesk' | 'dataset') {
    setPickingSource(false);
    setAdding(true);
    const defaultConfig: Record<string, any> =
      src === 'zendesk' ? { mode: 'metric', metric: 'created_tickets', time: 'today' } :
      src === 'sql'     ? { query: '' } :
                          {};
    setForm({ ...DEFAULT, data_source_type: src, data_source_config: defaultConfig });
  }
  function selectWidget(w: WbWidget)       { setSelected(w);    setAdding(false); setPickingSource(false); setForm({ ...w }); }
  function cancelEdit()                    { setSelected(null); setAdding(false); setPickingSource(false); setForm({});       }

  function parseJson(v: any) {
    if (typeof v === 'object' && v !== null) return v;
    try { return JSON.parse(v); } catch { return v; }
  }

  /** Returns a list of problems that must be fixed before saving. Empty = valid. */
  function validateForm(): string[] {
    const errors: string[] = [];
    const title = (form.title || '').trim();
    if (!title) errors.push('Title is required.');
    if (!form.type) errors.push('Widget type is required.');
    if (!form.data_source_type) errors.push('Data source is required.');

    const dsc: any = typeof form.data_source_config === 'string'
      ? (() => { try { return JSON.parse(form.data_source_config as any); } catch { return {}; } })()
      : (form.data_source_config || {});

    if (form.data_source_type === 'sql' && !(dsc.query || '').trim()) {
      errors.push('SQL query is required.');
    }
    if (form.data_source_type === 'dataset' && !(dsc.dataset || '').trim()) {
      errors.push('A Noetica dataset must be selected.');
    }
    if (form.data_source_type === 'zendesk') {
      if (dsc.mode === 'raw') {
        if (!(dsc.path || '').trim()) errors.push('Zendesk API path is required in Raw mode.');
      } else if (!(dsc.metric || '').trim()) {
        errors.push('Zendesk metric is required.');
      }
    }

    // Gauge needs a sensible range
    const d: any = typeof form.display_config === 'string'
      ? (() => { try { return JSON.parse(form.display_config as any); } catch { return {}; } })()
      : (form.display_config || {});
    if (form.type === 'gauge') {
      const min = Number(d.gauge_min ?? 0);
      const max = Number(d.gauge_max ?? 100);
      if (!(max > min)) errors.push('Gauge max must be greater than min.');
    }

    return errors;
  }

  async function saveWidget() {
    const errors = validateForm();
    if (errors.length) return; // button is disabled, but guard anyway
    setSaving(true);
    try {
      const payload = {
        ...form,
        data_source_config: parseJson(form.data_source_config),
        display_config:     parseJson(form.display_config),
      };
      if (adding) {
        const res  = await fetch(`/api/boards/${board.id}/widgets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.widget) {
          setWidgets(ws => [...ws, data.widget]);
          // Close the form after a successful save
          setAdding(false); setSelected(null); setForm({});
        }
      } else if (selected) {
        const res  = await fetch(`/api/widgets/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.widget) {
          setWidgets(ws => ws.map(w => w.id === data.widget.id ? data.widget : w));
          // Close the form after a successful save
          setSelected(null); setForm({});
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

  async function duplicateWidget(src: WbWidget) {
    // Place the copy one row below the original, clamped to the board
    const nextRowStart = Math.min(board.rows - src.row_span + 1, src.row_start + src.row_span);
    const payload = {
      title:              `${src.title} (copy)`,
      type:               src.type,
      data_source_type:   src.data_source_type,
      data_source_config: src.data_source_config,
      display_config:     src.display_config,
      col_start:          src.col_start,
      row_start:          nextRowStart,
      col_span:           src.col_span,
      row_span:           src.row_span,
      refresh_interval:   src.refresh_interval,
    };
    const res  = await fetch(`/api/boards/${board.id}/widgets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.widget) {
      setWidgets(ws => [...ws, data.widget]);
      selectWidget(data.widget);
    }
  }

  // ── Grid helpers ─────────────────────────────────────────────────────────
  function getGridCellSize() {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return { cellW: 1, cellH: 1 };
    return {
      cellW: (rect.width  - 16) / board.cols,
      cellH: (rect.height - 16) / board.rows,
    };
  }

  // ── Drag-to-MOVE (drag anywhere on widget body) ──────────────────────────
  function startMove(e: React.MouseEvent, widget: WbWidget) {
    e.preventDefault();
    const { cellW, cellH } = getGridCellSize();
    const startX = e.clientX, startY = e.clientY;
    let hasDragged = false;

    const initial = {
      widgetId: widget.id,
      colStart: widget.col_start, rowStart: widget.row_start,
      colSpan:  widget.col_span,  rowSpan:  widget.row_span,
    };
    dragFinalRef.current = initial;

    function onMouseMove(ev: MouseEvent) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) hasDragged = true;
      if (!hasDragged) return;
      const dCols = Math.round(dx / cellW);
      const dRows = Math.round(dy / cellH);
      const colStart = Math.max(1, Math.min(board.cols - widget.col_span + 1, widget.col_start + dCols));
      const rowStart = Math.max(1, Math.min(board.rows - widget.row_span + 1, widget.row_start + dRows));
      const next = { ...initial, colStart, rowStart };
      dragFinalRef.current = next;
      setDragPreview(next);
    }

    async function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
      document.body.style.cursor = '';
      const final = dragFinalRef.current;
      setDragPreview(null);
      dragFinalRef.current = null;

      if (!hasDragged) { selectWidget(widget); return; } // it was a click

      if (!final || (final.colStart === widget.col_start && final.rowStart === widget.row_start)) return;
      const res  = await fetch(`/api/widgets/${widget.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ col_start: final.colStart, row_start: final.rowStart }) });
      const data = await res.json();
      if (data.widget) {
        setWidgets(ws => ws.map(w => w.id === data.widget.id ? data.widget : w));
        if (selected?.id === widget.id) { setSelected(data.widget); setForm(f => ({ ...f, col_start: data.widget.col_start, row_start: data.widget.row_start })); }
      }
    }

    document.body.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  }

  // ── Drag-to-RESIZE (corner handle) ───────────────────────────────────────
  function startResize(e: React.MouseEvent, widget: WbWidget) {
    e.preventDefault();
    e.stopPropagation();
    const { cellW, cellH } = getGridCellSize();
    const startX = e.clientX, startY = e.clientY;

    const initial = {
      widgetId: widget.id,
      colStart: widget.col_start, rowStart: widget.row_start,
      colSpan:  widget.col_span,  rowSpan:  widget.row_span,
    };
    dragFinalRef.current = initial;
    setDragPreview(initial);

    function onMouseMove(ev: MouseEvent) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      const colSpan = Math.max(1, Math.min(board.cols - widget.col_start + 1, widget.col_span + Math.round(dx / cellW)));
      const rowSpan = Math.max(1, Math.min(board.rows - widget.row_start + 1, widget.row_span + Math.round(dy / cellH)));
      const next = { ...initial, colSpan, rowSpan };
      dragFinalRef.current = next;
      setDragPreview(next);
    }

    async function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
      document.body.style.cursor = '';
      const final = dragFinalRef.current;
      setDragPreview(null);
      dragFinalRef.current = null;

      if (!final || (final.colSpan === widget.col_span && final.rowSpan === widget.row_span)) return;
      const res  = await fetch(`/api/widgets/${widget.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ col_span: final.colSpan, row_span: final.rowSpan }) });
      const data = await res.json();
      if (data.widget) {
        setWidgets(ws => ws.map(w => w.id === data.widget.id ? data.widget : w));
        if (selected?.id === widget.id) { setSelected(data.widget); setForm(f => ({ ...f, col_span: data.widget.col_span, row_span: data.widget.row_span })); }
      }
    }

    document.body.style.cursor = 'se-resize';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  }

  // ── display_config helpers ────────────────────────────────────────────────
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
      if (value === undefined || value === '' || value === null) delete next[key]; else next[key] = value;
      return { ...f, display_config: next as any };
    });
  }

  // ── data_source_config helpers ────────────────────────────────────────────
  function getDsc(): Record<string, any> {
    const raw = form.data_source_config;
    if (!raw) return {};
    if (typeof raw === 'object') return raw as any;
    try { return JSON.parse(raw as any); } catch { return {}; }
  }
  function setDscField(key: string, value: any) {
    setForm(f => {
      const cur: any = typeof f.data_source_config === 'string'
        ? (() => { try { return JSON.parse(f.data_source_config as any); } catch { return {}; } })()
        : (f.data_source_config || {});
      const next = { ...cur };
      if (value === undefined || value === null || value === '') delete next[key]; else next[key] = value;
      return { ...f, data_source_config: next as any };
    });
  }

  // ── Zendesk metric filter helpers ─────────────────────────────────────────
  type ZdFilterRow = { field: string; value: string };
  function getZdFilters(): ZdFilterRow[] { return getDsc().zd_filters || []; }
  function setZdFilters(filters: ZdFilterRow[]) { setDscField('zd_filters', filters.length ? filters : undefined); }
  function addZdFilter()                        { setZdFilters([...getZdFilters(), { field: 'tag', value: '' }]); }
  function removeZdFilter(i: number)            { setZdFilters(getZdFilters().filter((_, j) => j !== i)); }
  function updateZdFilter(i: number, k: keyof ZdFilterRow, v: string) {
    const f = [...getZdFilters()]; f[i] = { ...f[i], [k]: v }; setZdFilters(f);
  }

  // ── Filter helpers ────────────────────────────────────────────────────────
  type FilterRow = { field: string; op: string; value: string };
  function getFilters(): FilterRow[] { return getDisplayCfg().filters || []; }
  function setFilters(filters: FilterRow[]) { setDisplayCfgField('filters', filters.length ? filters : undefined); }
  function addFilter()                      { setFilters([...getFilters(), { field: '', op: '=', value: '' }]); }
  function removeFilter(i: number)          { setFilters(getFilters().filter((_, j) => j !== i)); }
  function updateFilter(i: number, k: keyof FilterRow, v: string) {
    const f = [...getFilters()]; f[i] = { ...f[i], [k]: v }; setFilters(f);
  }

  // ── Grid layer renderer — shared between device frames ───────────────────
  function renderGridLayers(inset: number, gap: number) {
    return (
      <>
        {/* Background cells */}
        <div style={{ position: 'absolute', inset, display: 'grid', gridTemplateColumns: `repeat(${board.cols}, 1fr)`, gridTemplateRows: `repeat(${board.rows}, 1fr)`, gap }}>
          {Array.from({ length: board.cols * board.rows }).map((_, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 2 }} />
          ))}
        </div>
        {/* Widget overlay — renders live widget, with drag interaction on top */}
        <div style={{ position: 'absolute', inset, display: 'grid', gridTemplateColumns: `repeat(${board.cols}, 1fr)`, gridTemplateRows: `repeat(${board.rows}, 1fr)`, gap }}>
          {widgets.map(w => {
            const dp         = dragPreview?.widgetId === w.id ? dragPreview : null;
            const colStart   = dp?.colStart ?? w.col_start;
            const rowStart   = dp?.rowStart ?? w.row_start;
            const colSpan    = dp?.colSpan  ?? w.col_span;
            const rowSpan    = dp?.rowSpan  ?? w.row_span;
            const isSel      = selected?.id  === w.id;
            const isDragging = !!dp;
            return (
              <div key={w.id}
                style={{
                  gridColumn:   `${colStart} / span ${colSpan}`,
                  gridRow:      `${rowStart} / span ${rowSpan}`,
                  position:     'relative',
                  zIndex:       isDragging ? 10 : 1,
                  boxShadow:    isDragging ? `0 4px 24px ${C.bg(0.4)}` : undefined,
                  borderRadius: 12,
                  overflow:     'hidden',
                  opacity:      isDragging ? 0.92 : 1,
                }}
              >
                {/* Live widget render (behind, non-interactive) */}
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  <WidgetRenderer widget={w} />
                </div>
                {/* Drag / select overlay (captures mouse) */}
                <div onMouseDown={e => startMove(e, w)}
                  style={{
                    position: 'absolute', inset: 0,
                    background:   isDragging ? C.bg(0.25) : isSel ? C.bg(0.18) : 'transparent',
                    border:       `2px solid ${isDragging ? C.bg(0.75) : isSel ? C.bg(0.6) : 'transparent'}`,
                    borderRadius: 12,
                    cursor:       'grab',
                    transition:   'background 0.15s, border-color 0.15s',
                  }}
                />
                {/* Resize handle (on top of overlay) */}
                <div title="Drag to resize" onMouseDown={e => startResize(e, w)}
                  style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, cursor: 'se-resize', background: C.bg(0.7), borderTopLeftRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3 }}
                >
                  <svg width="8" height="8" viewBox="0 0 9 9" fill="none" style={{ pointerEvents: 'none' }}>
                    <line x1="2" y1="8" x2="8" y2="2" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round"/>
                    <line x1="5.5" y1="8" x2="8" y2="5.5" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  const connDot = (ok?: boolean) => (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: ok ? '#10b981' : ok === false ? '#f87171' : '#475569',
      display: 'inline-block', marginRight: 8, flexShrink: 0,
      boxShadow: ok ? '0 0 8px rgba(16,185,129,0.55)' : ok === false ? '0 0 6px rgba(248,113,113,0.45)' : undefined,
    }} />
  );

  const activePreset: keyof typeof PRESETS | null = (() => {
    const entry = Object.entries(PRESETS).find(([, p]) => p.cols === board.cols && p.rows === board.rows);
    return (entry ? entry[0] : null) as keyof typeof PRESETS | null;
  })();
  // All non-mobile landscape presets (and custom landscapes) get the monitor frame
  const isLandscape = board.cols >= board.rows;
  const showMonitor = activePreset !== 'mobile' && isLandscape;

  const dcfg = getDisplayCfg();

  return (
    <div style={{ minHeight: '100vh', color: '#f1f5f9', fontFamily: 'var(--font-raleway, sans-serif)' }}>

      {pickingSource && (
        <SourcePicker onPick={pickSource} onCancel={() => setPickingSource(false)} />
      )}

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(10,15,28,0.9)', backdropFilter: 'blur(18px)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/admin" style={{ color: '#64748b', fontSize: 13 }}>← Boards</Link>
          <span style={{ color: '#334155' }}>/</span>
          <input value={boardName} onChange={e => setBoardName(e.target.value)} onBlur={() => saveBoardSettings()}
            style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.15)', color: '#f1f5f9', fontSize: 15, fontWeight: 700, padding: '2px 4px', width: 220, outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={`/view/${board.slug_token}`} target="_blank"
            style={{ padding: '8px 16px', background: C.bg(0.1), border: `1px solid ${C.bg(0.3)}`, borderRadius: 8, color: C.primaryLight, fontSize: 13, fontWeight: 600 }}>
            View Wallboard ↗
          </Link>
          <button onClick={deleteBoard} style={{ padding: '8px 16px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, color: '#f87171', fontSize: 13, cursor: 'pointer' }}>
            Delete Board
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 57px)' }}>

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Board layout presets */}
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.primary, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Board Layout</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(Object.entries(PRESETS) as [keyof typeof PRESETS, (typeof PRESETS)[keyof typeof PRESETS]][]).map(([key, p]) => {
                const active = activePreset === key;
                return (
                  <button key={key} onClick={() => applyPreset(key)}
                    style={{ padding: '10px 14px', background: active ? C.bg(0.15) : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? C.bg(0.4) : 'rgba(255,255,255,0.08)'}`, borderRadius: 10, color: active ? C.primaryLight : '#94a3b8', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: active ? '#818cf8' : '#475569', marginTop: 2 }}>{p.desc}</div>
                  </button>
                );
              })}
              <div style={{ marginTop: 4 }}>
                <div style={lbl}>Grid Size <span style={{ fontWeight: 400, textTransform: 'none', color: '#475569' }}>(custom)</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <input type="number" min={2} max={32} style={{ ...inp, marginTop: 0, width: 60, textAlign: 'center', padding: '6px 4px' }}
                    value={board.cols}
                    onChange={e => {
                      const cols = Math.max(2, Math.min(32, parseInt(e.target.value) || board.cols));
                      setBoard(b => ({ ...b, cols }));
                    }}
                    onBlur={() => saveBoardSettings({ cols: board.cols })} />
                  <span style={{ fontSize: 12, color: '#475569' }}>cols ×</span>
                  <input type="number" min={2} max={20} style={{ ...inp, marginTop: 0, width: 60, textAlign: 'center', padding: '6px 4px' }}
                    value={board.rows}
                    onChange={e => {
                      const rows = Math.max(2, Math.min(20, parseInt(e.target.value) || board.rows));
                      setBoard(b => ({ ...b, rows }));
                    }}
                    onBlur={() => saveBoardSettings({ rows: board.rows })} />
                  <span style={{ fontSize: 12, color: '#475569' }}>rows</span>
                </div>
              </div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'SQL Server', subtitle: 'Gecko RDS',       ok: connections?.mssql?.ok,   err: connections?.mssql?.error   },
                { label: 'Zendesk',    subtitle: 'thedirectteam',   ok: connections?.zendesk?.ok, err: connections?.zendesk?.error  },
                { label: 'Noetica',    subtitle: 'Live Call Data',  ok: connections?.noetica?.ok, err: connections?.noetica?.error  },
              ].map(c => (
                <div key={c.label} title={c.err && !c.ok ? c.err : undefined}
                  style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <span style={{ marginTop: 4 }}>{connDot(c.ok)}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: c.ok ? '#e2e8f0' : c.ok === false ? '#fecaca' : '#94a3b8', lineHeight: 1.2 }}>
                      {c.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.subtitle}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Widget list */}
          <div style={{ ...card, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Widgets ({widgets.length})</div>
              <button onClick={startAdd}
                style={{ padding: '4px 10px', background: C.bg(0.1), border: `1px solid ${C.bg(0.25)}`, borderRadius: 6, color: C.primaryLight, fontSize: 12, cursor: 'pointer' }}>
                + Add
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {widgets.map(w => (
                <div key={w.id} onClick={() => selectWidget(w)}
                  style={{ padding: '8px 10px', borderRadius: 8, background: selected?.id === w.id ? C.bg(0.12) : 'rgba(255,255,255,0.03)', border: `1px solid ${selected?.id === w.id ? C.bg(0.3) : 'rgba(255,255,255,0.06)'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</div>
                    <div style={{ fontSize: 11, color: '#475569' }}>{w.type} · col {w.col_start} row {w.row_start} · {w.col_span}w×{w.row_span}h</div>
                  </div>
                  <button
                    title="Duplicate widget"
                    onClick={e => { e.stopPropagation(); duplicateWidget(w); }}
                    style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 5, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="4" width="8" height="8" rx="1.5" />
                      <path d="M10 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" />
                    </svg>
                  </button>
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
            {/* Header */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 11, color: '#475569', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Preview</span>
              <span style={{ color: '#1e2a40' }}>·</span>
              <span>{board.cols} cols × {board.rows} rows</span>
              <span style={{ color: '#1e2a40' }}>·</span>
              <span><strong style={{ color: C.primaryLight }}>Drag</strong> to move · <strong style={{ color: C.primaryLight }}>⤡</strong> corner to resize</span>
            </div>

            {/* Device frame area */}
            <div style={{ background: '#04060e', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: !isLandscape ? '32px 20px 24px' : '20px 16px 0' }}>

              {!isLandscape ? (
                /* ── iPhone frame ─────────────────────────────────────── */
                <div style={{
                  position: 'relative', width: 244, flexShrink: 0,
                  background: 'linear-gradient(160deg, #1d2236 0%, #10141f 100%)',
                  borderRadius: 46,
                  border: '2px solid rgba(255,255,255,0.1)',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.7), 0 32px 72px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.07)',
                  padding: '54px 11px 32px',
                }}>
                  {/* Dynamic island */}
                  <div style={{ position: 'absolute', top: 17, left: '50%', transform: 'translateX(-50%)', width: 90, height: 24, background: '#000', borderRadius: 12 }} />
                  {/* Power button (right) */}
                  <div style={{ position: 'absolute', top: 98, right: -4, width: 4, height: 46, background: '#181d2e', borderRadius: '0 3px 3px 0' }} />
                  {/* Silent switch (left) */}
                  <div style={{ position: 'absolute', top: 58, left: -4, width: 4, height: 18, background: '#181d2e', borderRadius: '3px 0 0 3px' }} />
                  {/* Volume up (left) */}
                  <div style={{ position: 'absolute', top: 86, left: -4, width: 4, height: 34, background: '#181d2e', borderRadius: '3px 0 0 3px' }} />
                  {/* Volume down (left) */}
                  <div style={{ position: 'absolute', top: 128, left: -4, width: 4, height: 34, background: '#181d2e', borderRadius: '3px 0 0 3px' }} />

                  {/* Screen */}
                  <div style={{ background: board.background || '#0a0f1c', borderRadius: 28, overflow: 'hidden', height: 430 }}>
                    <div ref={gridRef} style={{ position: 'relative', height: '100%', padding: 5, userSelect: 'none' }}>
                      {renderGridLayers(5, 3)}
                    </div>
                  </div>

                  {/* Home indicator */}
                  <div style={{ height: 4, width: 80, background: 'rgba(255,255,255,0.22)', borderRadius: 2, margin: '14px auto 0' }} />
                </div>

              ) : showMonitor ? (
                /* ── Monitor frame ─────────────────────────────────────── */
                <div style={{ width: '100%', maxWidth: 1100, margin: '0 auto' }}>
                  {/* Bezel */}
                  <div style={{
                    background: 'linear-gradient(180deg, #191e30 0%, #10141f 100%)',
                    borderRadius: '14px 14px 3px 3px',
                    border: '2px solid rgba(255,255,255,0.08)',
                    borderBottom: '3px solid rgba(255,255,255,0.04)',
                    padding: '24px 10px 10px',
                    position: 'relative',
                    boxShadow: '0 10px 48px rgba(0,0,0,0.7)',
                  }}>
                    {/* Camera dot */}
                    <div style={{ position: 'absolute', top: 9, left: '50%', transform: 'translateX(-50%)', width: 7, height: 7, background: '#1a2038', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.07)' }} />
                    {/* Screen — 16:9 aspect, like a real widescreen TV */}
                    <div style={{ background: board.background || '#0a0f1c', borderRadius: 3, overflow: 'hidden', aspectRatio: '16 / 9' }}>
                      <div ref={gridRef} style={{ position: 'relative', width: '100%', height: '100%', padding: 8, userSelect: 'none', boxSizing: 'border-box' }}>
                        {renderGridLayers(8, 4)}
                      </div>
                    </div>
                  </div>
                  {/* Stand neck */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 46, height: 20, background: '#10141f', border: '2px solid rgba(255,255,255,0.06)', borderTop: 'none', borderRadius: '0 0 3px 3px' }} />
                    <div style={{ width: 112, height: 7, background: '#0c1018', borderRadius: '0 0 6px 6px', border: '2px solid rgba(255,255,255,0.05)', borderTop: 'none', marginTop: -1 }} />
                  </div>
                </div>

              ) : (
                /* ── Custom / plain grid ───────────────────────────────── */
                <div ref={gridRef} style={{ width: '100%', position: 'relative', aspectRatio: '16 / 9', maxWidth: 1100, margin: '0 auto', padding: 8, userSelect: 'none', boxSizing: 'border-box' }}>
                  {renderGridLayers(8, 4)}
                </div>
              )}

            </div>
          </div>

          {/* Widget form */}
          {(adding || selected) && (
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 16 }}>
                {adding ? 'New Widget' : `Edit: ${selected?.title}`}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

                <div style={{ gridColumn: '1/-1' }}>
                  <div style={lbl}>Title</div>
                  <input style={inp} value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                </div>

                <div>
                  <div style={lbl}>Widget Type</div>
                  <CustomSelect
                    value={form.type || 'number'}
                    onChange={v => setForm(f => ({ ...f, type: v as any }))}
                    options={[
                      { value: 'number',      label: 'Number' },
                      { value: 'gauge',       label: 'Gauge (Geck-O-Meter)' },
                      { value: 'line',        label: 'Line chart' },
                      { value: 'bar',         label: 'Column chart (vertical bars)' },
                      { value: 'hbar',        label: 'Bar chart (horizontal bars)' },
                      { value: 'leaderboard', label: 'Leaderboard' },
                      { value: 'table',       label: 'Table' },
                    ]}
                  />
                </div>
                <div>
                  <div style={lbl}>Data Source</div>
                  <CustomSelect
                    value={form.data_source_type || 'sql'}
                    onChange={v => setForm(f => ({ ...f, data_source_type: v as any }))}
                    options={[
                      { value: 'sql',     label: 'SQL Server' },
                      { value: 'dataset', label: 'Noetica Dataset' },
                      { value: 'zendesk', label: 'Zendesk' },
                    ]}
                  />
                </div>

                {/* ── SQL source ── */}
                {form.data_source_type === 'sql' && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={lbl}>SQL Query</div>
                    <textarea style={{ ...inp, height: 100, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                      placeholder="SELECT name, count FROM dbo.agents ORDER BY count DESC"
                      value={(getDsc() as any).query || ''}
                      onChange={e => setDscField('query', e.target.value || undefined)} />
                  </div>
                )}

                {/* ── Noetica Dataset source ── */}
                {form.data_source_type === 'dataset' && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={lbl}>Dataset</div>
                    <CustomSelect
                      value={getDsc().dataset || ''}
                      onChange={v => setDscField('dataset', v || undefined)}
                      placeholder="Select dataset…"
                      options={datasets.map(d => ({ value: d.name, label: d.name }))}
                    />
                  </div>
                )}

                {/* ── Zendesk source ── */}
                {form.data_source_type === 'zendesk' && (() => {
                  const dsc  = getDsc();
                  const mode = dsc.mode || 'metric';
                  const btnS: React.CSSProperties = { padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontSize: 12, fontWeight: 600 };
                  const on  = (active: boolean): React.CSSProperties => active
                    ? { ...btnS, background: C.primary, color: '#fff', borderColor: C.primary }
                    : { ...btnS, background: 'rgba(255,255,255,0.04)', color: '#94a3b8' };
                  return (
                    <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {/* Mode toggle */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={on(mode === 'metric')} onClick={() => setDscField('mode', 'metric')}>Metric</button>
                        <button style={on(mode === 'raw')}    onClick={() => setDscField('mode', 'raw')}>Raw API path</button>
                      </div>

                      {mode === 'metric' ? (
                        <>
                          {/* Metric */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div>
                              <div style={lbl}>Display</div>
                              <CustomSelect
                                value={dsc.metric || 'created_tickets'}
                                onChange={v => setDscField('metric', v)}
                                options={Object.entries(ZD_METRICS).map(([k, v]) => ({ value: k, label: v.label }))}
                              />
                            </div>
                            <div>
                              <div style={lbl}>Time</div>
                              <CustomSelect
                                value={dsc.time || 'today'}
                                onChange={v => setDscField('time', v)}
                                options={[
                                  // Rolling
                                  { value: 'past_7_days',  label: 'Past 7 days'  },
                                  { value: 'past_14_days', label: 'Past 14 days' },
                                  { value: 'past_28_days', label: 'Past 28 days' },
                                  { value: 'past_30_days', label: 'Past 30 days' },
                                  { value: 'past_90_days', label: 'Past 90 days' },
                                  // Current
                                  { value: 'today',        label: 'Today'        },
                                  { value: 'this_week',    label: 'This week'    },
                                  { value: 'this_month',   label: 'This month'   },
                                  { value: 'this_quarter', label: 'This quarter' },
                                  { value: 'this_year',    label: 'This year'    },
                                  // Previous
                                  { value: 'yesterday',    label: 'Yesterday'    },
                                  { value: 'last_week',    label: 'Last week'    },
                                  { value: 'last_month',   label: 'Last month'   },
                                  { value: 'last_quarter', label: 'Last quarter' },
                                  { value: 'last_year',    label: 'Last year'    },
                                  { value: 'all_time',     label: 'All time'     },
                                ]}
                              />
                            </div>
                          </div>

                          {/* Group by — leaderboard widgets only */}
                          {form.type === 'leaderboard' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                              <div>
                                <div style={lbl}>Group by</div>
                                <CustomSelect
                                  value={dsc.group_by || 'assignee'}
                                  onChange={v => setDscField('group_by', v)}
                                  options={Object.entries(ZD_GROUP_BY).map(([k, v]) => ({ value: k, label: v.label }))}
                                />
                              </div>
                              <div>
                                <div style={lbl}>Show top</div>
                                <input type="number" min={3} max={100} style={inp}
                                  value={getDisplayCfg().limit ?? 25}
                                  onChange={e => setDisplayCfgField('limit', parseInt(e.target.value) || undefined)} />
                              </div>
                            </div>
                          )}

                          {/* Zendesk filters */}
                          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '10px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Zendesk Filters</div>
                              <button onClick={addZdFilter} style={{ padding: '2px 10px', background: C.bg(0.1), border: `1px solid ${C.bg(0.25)}`, borderRadius: 6, color: C.primaryLight, fontSize: 12, cursor: 'pointer' }}>+ Add</button>
                            </div>
                            {getZdFilters().length === 0 && (
                              <div style={{ fontSize: 11, color: '#334155' }}>No filters — showing all tickets matching the metric &amp; time period.</div>
                            )}
                            {getZdFilters().map((f, i) => {
                              const supportsAutocomplete = AUTOCOMPLETE_FIELDS.has(f.field);
                              if (supportsAutocomplete) loadZdOptions(f.field);
                              return (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 28px', gap: 6, marginBottom: 6, alignItems: 'start' }}>
                                  <div style={{ marginTop: -6 }}>
                                    <CustomSelect
                                      value={f.field}
                                      onChange={v => { updateZdFilter(i, 'field', v); if (AUTOCOMPLETE_FIELDS.has(v)) loadZdOptions(v); }}
                                      options={Object.entries(ZD_FILTER_FIELDS).map(([k, v]) => ({ value: k, label: v.label }))}
                                    />
                                  </div>
                                  {supportsAutocomplete ? (
                                    <Combobox
                                      value={f.value}
                                      onChange={v => updateZdFilter(i, 'value', v)}
                                      options={zdOptions[f.field] || []}
                                      loading={zdLoading[f.field]}
                                      placeholder={`Search ${ZD_FILTER_FIELDS[f.field]?.label.toLowerCase() || f.field}s…`}
                                    />
                                  ) : (
                                    <input placeholder="value" value={f.value} onChange={e => updateZdFilter(i, 'value', e.target.value)} style={{ ...inp, marginTop: 0 }} />
                                  )}
                                  <button onClick={() => removeZdFilter(i)} style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, color: '#f87171', fontSize: 14, cursor: 'pointer' }}>×</button>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        /* Raw mode */
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10 }}>
                          <div>
                            <div style={lbl}>API Path</div>
                            <input type="text" style={inp} value={dsc.path || ''} placeholder="search.json?query=type:ticket status:open"
                              onChange={e => setDscField('path', e.target.value || undefined)} />
                          </div>
                          <div>
                            <div style={lbl}>Array key</div>
                            <input type="text" style={inp} value={dsc.key || ''} placeholder="results"
                              onChange={e => setDscField('key', e.target.value || undefined)} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div style={{ gridColumn: '1/-1' }}>
                  <div style={lbl}>Display Config (JSON)</div>
                  <textarea style={{ ...inp, height: 60, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                    value={typeof form.display_config === 'string' ? form.display_config : JSON.stringify(form.display_config || {}, null, 2)}
                    onChange={e => setForm(f => ({ ...f, display_config: e.target.value as any }))} />
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>Number: {'{ "goal": 100, "value_key": "count" }'}  ·  Gauge: {'{ "gauge_min": 0, "gauge_max": 50 }'}  ·  Charts: {'{ "x_key": "name", "y_key": "total" }'}</div>
                </div>

                {/* ── Filters ── */}
                <div style={{ gridColumn: '1/-1', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.07em' }}>
                      Filters <span style={{ fontWeight: 400, textTransform: 'none' as const, color: '#334155' }}>— slice this widget from a shared dataset</span>
                    </div>
                    <button onClick={addFilter}
                      style={{ padding: '3px 10px', background: C.bg(0.1), border: `1px solid ${C.bg(0.25)}`, borderRadius: 6, color: C.primaryLight, fontSize: 12, cursor: 'pointer' }}>
                      + Add Filter
                    </button>
                  </div>
                  {getFilters().map((f, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 1fr 32px', gap: 6, marginBottom: 6, alignItems: 'start' }}>
                      <input
                        placeholder="Field name (e.g. Status)"
                        value={f.field}
                        onChange={e => updateFilter(i, 'field', e.target.value)}
                        style={{ ...inp, marginTop: 0 }} />
                      <div style={{ marginTop: -6 }}>
                        <CustomSelect
                          value={f.op}
                          onChange={v => updateFilter(i, 'op', v)}
                          options={[
                            { value: '=',        label: '= equals' },
                            { value: '!=',       label: '≠ not equals' },
                            { value: 'in',       label: 'is one of' },
                            { value: 'not in',   label: 'not one of' },
                            { value: '>',        label: '> greater than' },
                            { value: '<',        label: '< less than' },
                            { value: '>=',       label: '≥ at least' },
                            { value: '<=',       label: '≤ at most' },
                            { value: 'contains', label: 'contains' },
                          ]}
                        />
                      </div>
                      <input
                        placeholder={f.op === 'in' || f.op === 'not in' ? '15, 23, 24 (comma-sep)' : 'value'}
                        value={f.value}
                        onChange={e => updateFilter(i, 'value', e.target.value)}
                        style={{ ...inp, marginTop: 0 }} />
                      <button onClick={() => removeFilter(i)}
                        style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, color: '#f87171', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>
                        ×
                      </button>
                    </div>
                  ))}
                  {getFilters().length === 0 && (
                    <div style={{ fontSize: 12, color: '#334155' }}>No filters — widget shows all rows from the dataset.</div>
                  )}
                </div>

                {/* ── Column selection ── */}
                <div style={{ gridColumn: '1/-1' }}>
                  <div style={lbl}>Show Columns <span style={{ fontWeight: 400, textTransform: 'none' as const, color: '#475569' }}>(comma-separated — blank = all)</span></div>
                  <input style={inp}
                    placeholder="e.g. Agent Name, Status, Time In State"
                    value={(getDisplayCfg().show_columns || []).join(', ')}
                    onChange={e => setDisplayCfgField('show_columns',
                      e.target.value ? e.target.value.split(',').map((v: string) => v.trim()).filter(Boolean) : undefined
                    )} />
                </div>

                {/* ── Count rows (number widget only) ── */}
                {form.type === 'number' && (
                  <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="checkbox" id="count_rows"
                      checked={!!getDisplayCfg().count_rows}
                      onChange={e => setDisplayCfgField('count_rows', e.target.checked || undefined)}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: C.primary }} />
                    <label htmlFor="count_rows" style={{ fontSize: 13, color: '#94a3b8', cursor: 'pointer' }}>
                      <strong style={{ color: '#f1f5f9' }}>Count matching rows</strong>
                      <span style={{ color: '#475569' }}> — e.g. "how many calls are waiting?" (counts rows after filters)</span>
                    </label>
                  </div>
                )}

                {/* ── Gauge config ── */}
                {form.type === 'gauge' && (
                  <div style={{ gridColumn: '1/-1', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Gauge Settings</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <div>
                        <div style={lbl}>Min value</div>
                        <input type="number" style={inp} value={getDisplayCfg().gauge_min ?? 0}
                          onChange={e => setDisplayCfgField('gauge_min', Number(e.target.value))} />
                      </div>
                      <div>
                        <div style={lbl}>Max value</div>
                        <input type="number" style={inp} value={getDisplayCfg().gauge_max ?? 100}
                          onChange={e => setDisplayCfgField('gauge_max', Number(e.target.value))} />
                      </div>
                      <div>
                        <div style={lbl}>Value column</div>
                        <input type="text" style={inp} value={getDisplayCfg().value_key ?? ''} placeholder="auto"
                          onChange={e => setDisplayCfgField('value_key', e.target.value || undefined)} />
                      </div>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <div style={lbl}>Label (optional)</div>
                      <input type="text" style={inp} value={getDisplayCfg().gauge_label ?? ''} placeholder="e.g. Calls waiting"
                        onChange={e => setDisplayCfgField('gauge_label', e.target.value || undefined)} />
                    </div>
                    <div style={{ fontSize: 11, color: '#334155', marginTop: 8 }}>
                      Dial goes green → amber → red as the value approaches max. Colour zones: 0–60% green, 60–80% amber, 80–100% red.
                    </div>
                  </div>
                )}

                {/* ── Number format ── */}
                {['number', 'gauge', 'leaderboard', 'hbar', 'bar'].includes(form.type || '') && (() => {
                  const fmt = getDisplayCfg();
                  const abbr    = fmt.num_abbreviation ?? 'auto';
                  const decMode = fmt.num_decimals === 'auto' || fmt.num_decimals === undefined ? 'auto' : 'fixed';
                  const decVal  = typeof fmt.num_decimals === 'number' ? fmt.num_decimals : 0;
                  const unitType = fmt.num_unit_type ?? 'auto';

                  const btnBase: React.CSSProperties = { padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s' };
                  const btnOn:  React.CSSProperties = { ...btnBase, background: '#6366f1', color: '#fff', borderColor: '#6366f1' };
                  const btnOff: React.CSSProperties = { ...btnBase, background: 'rgba(255,255,255,0.04)', color: '#94a3b8' };

                  return (
                    <div style={{ gridColumn: '1/-1', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Number Format</div>

                      {/* Abbreviation */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                        <div style={{ width: 100, fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>Abbreviation</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {(['auto', 'none', 'K', 'M', 'B'] as const).map(v => (
                            <button key={v} style={abbr === v ? btnOn : btnOff}
                              onClick={() => setDisplayCfgField('num_abbreviation', v)}>
                              {v === 'auto' ? 'Auto' : v === 'none' ? 'None' : v}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Decimal places */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                        <div style={{ width: 100, fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>Decimal places</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button style={decMode === 'auto' ? btnOn : btnOff}
                            onClick={() => setDisplayCfgField('num_decimals', 'auto')}>Auto</button>
                          <button style={decMode === 'fixed' ? btnOn : btnOff}
                            onClick={() => setDisplayCfgField('num_decimals', decVal)}>Fixed</button>
                          {decMode === 'fixed' && (
                            <>
                              <button style={{ ...btnOff, padding: '5px 10px' }}
                                onClick={() => setDisplayCfgField('num_decimals', Math.max(0, decVal - 1))}>−</button>
                              <span style={{ minWidth: 20, textAlign: 'center', fontSize: 13, color: '#f1f5f9', fontWeight: 700 }}>{decVal}</span>
                              <button style={{ ...btnOff, padding: '5px 10px' }}
                                onClick={() => setDisplayCfgField('num_decimals', Math.min(8, decVal + 1))}>+</button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Unit */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 100, fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>Unit</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {(['auto', 'prefix', 'suffix'] as const).map(v => (
                            <button key={v} style={unitType === v ? btnOn : btnOff}
                              onClick={() => setDisplayCfgField('num_unit_type', v)}>
                              {v.charAt(0).toUpperCase() + v.slice(1)}
                            </button>
                          ))}
                          {unitType !== 'auto' && (
                            <input type="text" maxLength={6} style={{ ...inp, width: 64, marginTop: 0, textAlign: 'center', fontSize: 14 }}
                              value={fmt.num_unit ?? ''}
                              placeholder="£ % …"
                              onChange={e => setDisplayCfgField('num_unit', e.target.value || undefined)} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Text style */}
                <div style={{ gridColumn: '1/-1', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Text Style</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
                    <div>
                      <div style={lbl}>Font Family</div>
                      <CustomSelect
                        value={dcfg.font_family || ''}
                        onChange={v => setDisplayCfgField('font_family', v || undefined)}
                        options={FONT_FAMILIES.map(f => ({ value: f.value, label: f.label }))}
                      />
                    </div>
                    <div>
                      <div style={lbl}>Font Size (px)</div>
                      <input type="number" min={8} max={48} style={inp} value={dcfg.font_size ?? ''} placeholder="auto"
                        onChange={e => setDisplayCfgField('font_size', e.target.value ? parseInt(e.target.value) : undefined)} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#334155', marginTop: 8 }}>
                    Controls body text size — great for fitting more rows into table/leaderboard widgets on large screens.
                  </div>
                </div>

                {/* Position & size */}
                <div style={{ gridColumn: '1/-1', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                    Position &amp; Size <span style={{ fontWeight: 400, textTransform: 'none', color: '#334155' }}>(or drag in preview above)</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    {[
                      { l: 'Col',       k: 'col_start' as const, max: board.cols },
                      { l: 'Row',       k: 'row_start' as const, max: board.rows },
                      { l: 'Width',     k: 'col_span'  as const, max: board.cols },
                      { l: 'Height',    k: 'row_span'  as const, max: board.rows },
                      { l: 'Refresh s', k: 'refresh_interval' as const, max: 86400 },
                    ].map(({ l, k, max }) => (
                      <div key={k}>
                        <div style={lbl}>{l}</div>
                        <input type="number" min={1} max={max} style={inp}
                          value={(form as any)[k] ?? 1}
                          onChange={e => setForm(f => ({ ...f, [k]: parseInt(e.target.value) || 1 }))} />
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {(() => {
                const errors = validateForm();
                if (!errors.length) return null;
                return (
                  <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8, color: '#f87171', fontSize: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Fix the following before saving:</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                {(() => {
                  const invalid = validateForm().length > 0;
                  const disabled = saving || invalid;
                  return (
                    <button onClick={saveWidget} disabled={disabled}
                      title={invalid ? 'Fill in the required fields above' : undefined}
                      style={{ padding: '9px 20px', background: disabled ? 'rgba(255,255,255,0.06)' : `linear-gradient(135deg, #a855f7, ${C.primary})`, border: disabled ? '1px solid rgba(255,255,255,0.1)' : 'none', borderRadius: 8, color: disabled ? '#64748b' : '#fff', fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1 }}>
                      {saving ? 'Saving…' : 'Save Widget'}
                    </button>
                  );
                })()}
                <button onClick={cancelEdit}
                  style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
                {selected && (
                  <>
                    <button onClick={() => duplicateWidget(selected)}
                      style={{ marginLeft: 'auto', padding: '9px 16px', background: C.bg(0.1), border: `1px solid ${C.bg(0.3)}`, borderRadius: 8, color: C.primaryLight, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                      Duplicate
                    </button>
                    <button onClick={() => deleteWidget(selected.id)}
                      style={{ padding: '9px 16px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8, color: '#f87171', fontSize: 13, cursor: 'pointer' }}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
