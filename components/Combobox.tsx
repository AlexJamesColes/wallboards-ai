'use client';

import { useState, useEffect, useRef } from 'react';

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  value:       string;
  onChange:    (value: string) => void;
  options:     ComboOption[];
  loading?:    boolean;
  placeholder?: string;
  /** Max number of visible options in dropdown at once */
  max?:        number;
}

const PRIMARY      = '#6366f1';
const PRIMARY_LT   = '#a5b4fc';
const PRIMARY_SOFT = 'rgba(99,102,241,0.15)';

export default function Combobox({ value, onChange, options, loading, placeholder, max = 10 }: Props) {
  const [open, setOpen]           = useState(false);
  const [query, setQuery]         = useState(value);
  const [highlight, setHighlight] = useState(-1);
  const ref   = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Sync when external value changes (e.g., selecting a different filter row)
  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const filtered = needle === ''
    ? options
    : options.filter(o => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle));

  function commit(v: string) {
    setQuery(v);
    onChange(v);
    setOpen(false);
    setHighlight(-1);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') {
      if (open && highlight >= 0 && filtered[highlight]) {
        e.preventDefault();
        commit(filtered[highlight].value);
      }
    } else if (e.key === 'Escape') { setOpen(false); }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(255,255,255,0.05)',
    border: `1px solid ${open ? PRIMARY : 'rgba(255,255,255,0.1)'}`,
    borderRadius: 8,
    padding: '8px 10px',
    color: '#f1f5f9',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
    boxShadow: open ? `0 0 0 2px rgba(99,102,241,0.25)` : undefined,
    transition: 'border-color 0.12s, box-shadow 0.12s',
  };

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={input}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={onKey}
        style={inputStyle}
      />
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: '#0e1427',
            border: `1px solid ${PRIMARY_SOFT}`,
            borderRadius: 8,
            padding: 4,
            zIndex: 120,
            maxHeight: max * 34 + 16,
            overflowY: 'auto',
            boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
          }}
        >
          {loading && <div style={{ padding: '8px 10px', fontSize: 12, color: '#64748b' }}>Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 12, color: '#475569' }}>
              {query ? `No match for "${query}"` : 'No options'}
            </div>
          )}
          {!loading && filtered.map((o, i) => {
            const selected    = o.value === value;
            const highlighted = i === highlight;
            return (
              <div
                key={o.value}
                role="option"
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={e => { e.preventDefault(); commit(o.value); }}
                style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: highlighted ? PRIMARY_SOFT : selected ? 'rgba(99,102,241,0.08)' : 'transparent',
                  color: selected ? PRIMARY_LT : '#e2e8f0',
                  fontSize: 13,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                {o.hint && <span style={{ fontSize: 11, color: '#475569', flexShrink: 0 }}>{o.hint}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
