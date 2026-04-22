'use client';

import { useState, useEffect, useRef } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

const PRIMARY      = '#6366f1';
const PRIMARY_LT   = '#a5b4fc';
const PRIMARY_SOFT = 'rgba(99,102,241,0.15)';

export default function CustomSelect({ value, options, onChange, placeholder = 'Select…', disabled, style }: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);

  const current = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(options.length - 1, h + 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
      if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); onChange(options[highlight].value); setOpen(false); }
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, highlight, options, onChange]);

  useEffect(() => {
    if (open) {
      const idx = options.findIndex(o => o.value === value);
      setHighlight(idx >= 0 ? idx : 0);
    }
  }, [open, options, value]);

  const triggerStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(255,255,255,0.05)',
    border: `1px solid ${open ? PRIMARY : 'rgba(255,255,255,0.1)'}`,
    borderRadius: 8,
    padding: '8px 32px 8px 10px',
    color: current ? '#f1f5f9' : '#64748b',
    fontSize: 13,
    outline: 'none',
    marginTop: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    textAlign: 'left',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    position: 'relative',
    fontFamily: 'inherit',
    lineHeight: 1.3,
    minHeight: 34,
    boxShadow: open ? `0 0 0 2px rgba(99,102,241,0.25)` : undefined,
    transition: 'border-color 0.12s, box-shadow 0.12s',
    ...style,
  };

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        style={triggerStyle}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {current ? current.label : placeholder}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', color: open ? PRIMARY_LT : '#64748b' }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

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
            zIndex: 100,
            maxHeight: 280,
            overflowY: 'auto',
            boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
          }}
        >
          {options.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#475569' }}>No options</div>
          )}
          {options.map((o, i) => {
            const selected    = o.value === value;
            const highlighted = i === highlight;
            return (
              <div
                key={o.value}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: highlighted ? PRIMARY_SOFT : selected ? 'rgba(99,102,241,0.08)' : 'transparent',
                  color: selected ? PRIMARY_LT : '#e2e8f0',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.label}
                  {o.hint && <span style={{ color: '#475569', marginLeft: 6, fontSize: 11 }}>{o.hint}</span>}
                </span>
                {selected && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M2 6l3 3 5-6" stroke={PRIMARY_LT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
