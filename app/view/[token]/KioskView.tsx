'use client';

import { useState, useEffect } from 'react';
import type { WbBoard, WbWidget } from '@/lib/db';
import WidgetRenderer from '@/components/WidgetRenderer';

function Clock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    function tick() {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    }
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);
  return <span style={{ fontSize: 14, fontWeight: 700, color: '#64748b', letterSpacing: '0.05em' }}>{time}</span>;
}

interface Props {
  board: WbBoard & { widgets: WbWidget[] };
}

export default function KioskView({ board }: Props) {
  const { cols = 4, rows = 3, background = '#0a0f1c', name, widgets } = board;

  return (
    <div style={{ width: '100vw', height: '100vh', background, overflow: 'hidden', fontFamily: 'var(--font-raleway, sans-serif)', display: 'flex', flexDirection: 'column' }}>
      {/* Minimal header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#334155', letterSpacing: '0.04em' }}>{name}</span>
        <Clock />
      </div>

      {/* Widget grid.
          `minmax(0, 1fr)` is critical: without the 0 min, CSS Grid rows and
          columns grow to fit their content, so a widget with a 25-row table
          would blow its cell out, pushing the whole board past the viewport.
          With minmax(0, 1fr) every row/column is a strict equal share of the
          available space and content that doesn't fit scrolls inside. */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, gap: 8, padding: 8, minHeight: 0 }}>
        {widgets.map(widget => (
          <div key={widget.id} style={{ gridColumn: `${widget.col_start} / span ${widget.col_span}`, gridRow: `${widget.row_start} / span ${widget.row_span}`, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
            <WidgetRenderer widget={widget} />
          </div>
        ))}
      </div>
    </div>
  );
}
