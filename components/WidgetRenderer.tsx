'use client';

import { useState, useEffect, useRef } from 'react';
import type { WbWidget } from '@/lib/db';
import { WIDGET_COMPONENTS } from './widget-registry';

interface Props { widget: WbWidget; }

export default function WidgetRenderer({ widget }: Props) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleNext() {
    timerRef.current = setTimeout(fetchData, (widget.refresh_interval || 60) * 1000);
  }

  function fetchData() {
    fetch(`/api/widgets/${widget.id}/data`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else { setData(d); setError(null); }
        setLoading(false);
        scheduleNext();
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
        scheduleNext();
      });
  }

  useEffect(() => {
    fetchData();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [widget.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const wrapper: React.CSSProperties = {
    width: '100%', height: '100%',
    background: 'rgba(20,26,42,0.75)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 12,
    backdropFilter: 'blur(12px)',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
  };

  if (loading) return (
    <div style={{ ...wrapper, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 12, color: '#334155' }}>Loading…</div>
    </div>
  );

  if (error) return (
    <div style={{ ...wrapper, alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ fontSize: 11, color: '#f87171', textAlign: 'center' }}>{error}</div>
    </div>
  );

  const cfg = (widget.display_config as any) || {};
  const fontFamily = cfg.font_family || undefined;
  const fontSize   = cfg.font_size   ? `${cfg.font_size}px` : undefined;

  const childProps = { widget, data };

  // Charts render edge-to-edge with tiny padding so the drawable area is
  // as large as possible. Non-chart widgets (numbers, tables, leaderboards)
  // get slightly more breathing room for readability.
  const isChart = widget.type === 'line' || widget.type === 'bar' || widget.type === 'hbar';
  const bodyPadding = isChart ? '2px 6px 6px' : '2px 10px 8px';

  return (
    <div style={wrapper}>
      <div style={{ padding: '7px 10px 2px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
        {widget.title}
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: bodyPadding, fontFamily, fontSize }}>
        {(() => {
          const Component = WIDGET_COMPONENTS[widget.type];
          return Component ? <Component {...childProps} /> : null;
        })()}
      </div>
    </div>
  );
}
