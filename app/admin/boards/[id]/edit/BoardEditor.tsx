'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { WbBoard, WbWidget, WbDataset } from '@/lib/db';

interface Props {
  board: WbBoard & { widgets: WbWidget[] };
  datasets: WbDataset[];
}

const card = { background: 'rgba(20,26,42,0.7)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 16 };
const input: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', color: '#f1f5f9', fontSize: 13, outline: 'none', marginTop: 6 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em' };

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

  useEffect(() => {
    fetch('/api/connections').then(r => r.json()).then(setConnections).catch(() => {});
  }, []);

  async function saveBoard() {
    await fetch(`/api/boards/${board.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: boardName, cols: board.cols, rows: board.rows, background: board.background }),
    });
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
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return v; }
  }

  async function saveWidget() {
    setSaving(true);
    try {
      const payload = { ...form, data_source_config: parseJson(form.data_source_config), display_config: parseJson(form.display_config) };
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
        if (data.widget) { setWidgets(ws => ws.map(w => w.id === data.widget.id ? data.widget : w)); setSelected(data.widget); }
      }
    } finally { setSaving(false); }
  }

  async function deleteWidget(id: string) {
    if (!confirm('Delete this widget?')) return;
    await fetch(`/api/widgets/${id}`, { method: 'DELETE' });
    setWidgets(ws => ws.filter(w => w.id !== id));
    if (selected?.id === id) cancelEdit();
  }

  const connDot = (ok?: boolean) => <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? '#10b981' : ok === false ? '#f87171' : '#475569', display: 'inline-block', marginRight: 6, boxShadow: ok ? '0 0 6px rgba(16,185,129,0.6)' : undefined }} />;

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
            onBlur={saveBoard}
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
        {/* Sidebar */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Board settings */}
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Board Settings</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={label}>Columns</div>
                <input type="number" min={1} max={12} value={board.cols} style={input}
                  onChange={e => setBoard(b => ({ ...b, cols: parseInt(e.target.value) || 4 }))}
                  onBlur={saveBoard} />
              </div>
              <div>
                <div style={label}>Rows</div>
                <input type="number" min={1} max={20} value={board.rows} style={input}
                  onChange={e => setBoard(b => ({ ...b, rows: parseInt(e.target.value) || 3 }))}
                  onBlur={saveBoard} />
              </div>
            </div>
          </div>

          {/* Connections */}
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Connections</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'SQL Server', ok: connections?.mssql?.ok, err: connections?.mssql?.error },
                { label: 'Zendesk', ok: connections?.zendesk?.ok, err: connections?.zendesk?.error },
                { label: 'Noetica (push)', ok: connections?.noetica?.ok, err: connections?.noetica?.error },
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
                <div key={w.id} onClick={() => selectWidget(w)} style={{ padding: '8px 10px', borderRadius: 8, background: selected?.id === w.id ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${selected?.id === w.id ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.06)'}`, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{w.title}</div>
                    <div style={{ fontSize: 11, color: '#475569' }}>{w.type} · {w.col_span}×{w.row_span}</div>
                  </div>
                </div>
              ))}
              {widgets.length === 0 && <div style={{ fontSize: 12, color: '#334155', textAlign: 'center', padding: '12px 0' }}>No widgets yet</div>}
            </div>
          </div>
        </div>

        {/* Main area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Grid preview */}
          <div style={{ ...card, aspectRatio: `${board.cols} / ${board.rows}`, maxHeight: 400, display: 'grid', gridTemplateColumns: `repeat(${board.cols}, 1fr)`, gridTemplateRows: `repeat(${board.rows}, 1fr)`, gap: 6 }}>
            {Array.from({ length: board.cols * board.rows }).map((_, i) => {
              const col = (i % board.cols) + 1;
              const row = Math.floor(i / board.cols) + 1;
              const w = widgets.find(x => x.col_start === col && x.row_start === row);
              return (
                <div key={i} onClick={() => w && selectWidget(w)} style={{ borderRadius: 6, background: w ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${w ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.06)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: w ? 'pointer' : 'default', fontSize: 11, color: w ? '#6ee7b7' : '#334155', fontWeight: w ? 600 : 400, padding: 4, textAlign: 'center' }}>
                  {w ? w.title : ''}
                </div>
              );
            })}
          </div>

          {/* Widget form */}
          {(adding || selected) && (
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 16 }}>
                {adding ? 'New Widget' : `Edit: ${selected?.title}`}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ gridColumn: '1/-1' }}>
                  <div style={label}>Title</div>
                  <input style={input} value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <div style={label}>Widget Type</div>
                  <select style={input} value={form.type || 'number'} onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}>
                    {['number', 'table', 'leaderboard', 'line', 'bar'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <div style={label}>Data Source</div>
                  <select style={input} value={form.data_source_type || 'sql'} onChange={e => setForm(f => ({ ...f, data_source_type: e.target.value as any }))}>
                    <option value="sql">SQL Server</option>
                    <option value="dataset">Noetica Dataset</option>
                    <option value="zendesk">Zendesk</option>
                  </select>
                </div>
                {form.data_source_type === 'dataset' && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={label}>Dataset</div>
                    <select style={input} value={(form.data_source_config as any)?.dataset || ''} onChange={e => setForm(f => ({ ...f, data_source_config: { ...(f.data_source_config as any), dataset: e.target.value } }))}>
                      <option value="">Select dataset…</option>
                      {datasets.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ gridColumn: '1/-1' }}>
                  <div style={label}>Data Source Config (JSON)</div>
                  <textarea style={{ ...input, height: 80, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                    value={typeof form.data_source_config === 'string' ? form.data_source_config : JSON.stringify(form.data_source_config || {}, null, 2)}
                    onChange={e => setForm(f => ({ ...f, data_source_config: e.target.value }))} />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <div style={label}>Display Config (JSON)</div>
                  <textarea style={{ ...input, height: 60, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                    value={typeof form.display_config === 'string' ? form.display_config : JSON.stringify(form.display_config || {}, null, 2)}
                    onChange={e => setForm(f => ({ ...f, display_config: e.target.value }))} />
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>For number widgets: {"{ \"goal\": 100, \"value_key\": \"count\" }"}</div>
                </div>
                <div>
                  <div style={label}>Col Start</div>
                  <input type="number" min={1} max={board.cols} style={input} value={form.col_start || 1} onChange={e => setForm(f => ({ ...f, col_start: parseInt(e.target.value) || 1 }))} />
                </div>
                <div>
                  <div style={label}>Col Span</div>
                  <input type="number" min={1} max={board.cols} style={input} value={form.col_span || 1} onChange={e => setForm(f => ({ ...f, col_span: parseInt(e.target.value) || 1 }))} />
                </div>
                <div>
                  <div style={label}>Row Start</div>
                  <input type="number" min={1} max={board.rows} style={input} value={form.row_start || 1} onChange={e => setForm(f => ({ ...f, row_start: parseInt(e.target.value) || 1 }))} />
                </div>
                <div>
                  <div style={label}>Row Span</div>
                  <input type="number" min={1} max={board.rows} style={input} value={form.row_span || 1} onChange={e => setForm(f => ({ ...f, row_span: parseInt(e.target.value) || 1 }))} />
                </div>
                <div>
                  <div style={label}>Refresh (seconds)</div>
                  <input type="number" min={5} style={input} value={form.refresh_interval || 60} onChange={e => setForm(f => ({ ...f, refresh_interval: parseInt(e.target.value) || 60 }))} />
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
