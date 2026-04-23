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

/** Live-tracking "is this a phone?" flag. 768px is the common breakpoint. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}

interface Props {
  board: WbBoard & { widgets: WbWidget[] };
}

export default function KioskView({ board }: Props) {
  const { cols = 4, rows = 3, background = '#0a0f1c', name, widgets } = board;
  const isMobile = useIsMobile();
  const [activeIdx, setActiveIdx] = useState(0);

  // Order widgets top-to-bottom, left-to-right for a sensible swipe sequence.
  const ordered = [...widgets].sort((a, b) =>
    a.row_start !== b.row_start ? a.row_start - b.row_start : a.col_start - b.col_start
  );

  return (
    <div style={{ width: '100vw', height: '100vh', background, overflow: 'hidden', fontFamily: 'var(--font-raleway, sans-serif)', display: 'flex', flexDirection: 'column' }}>
      {/* Minimal header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#334155', letterSpacing: '0.04em' }}>
          {name}
          {isMobile && <span style={{ color: '#475569' }}> · {activeIdx + 1}/{ordered.length}</span>}
        </span>
        <Clock />
      </div>

      {isMobile ? (
        // Mobile: horizontal scroll-snap carousel — one widget per screen,
        // swipe left/right between them. Each widget gets the full viewport
        // instead of being squeezed into a grid cell.
        <MobileCarousel widgets={ordered} onActiveChange={setActiveIdx} />
      ) : (
        // Desktop / TV: the full grid layout.
        // minmax(0, 1fr) is critical — without the 0 min, CSS Grid rows and
        // columns grow to fit content and a wide widget would blow out the
        // viewport. With minmax, every row/col is strict equal share.
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, gap: 8, padding: 8, minHeight: 0 }}>
          {widgets.map(widget => (
            <div key={widget.id} style={{ gridColumn: `${widget.col_start} / span ${widget.col_span}`, gridRow: `${widget.row_start} / span ${widget.row_span}`, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <WidgetRenderer widget={widget} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One-widget-per-screen mobile carousel. Uses native CSS scroll-snap so
 *  swipe physics / momentum / the scrollbar indicator all come for free. */
function MobileCarousel({ widgets, onActiveChange }: { widgets: WbWidget[]; onActiveChange: (i: number) => void }) {
  const [scrollerRef, setScrollerRef] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollerRef) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const idx = Math.round(scrollerRef.scrollLeft / scrollerRef.clientWidth);
        onActiveChange(idx);
      });
    };
    scrollerRef.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollerRef.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [scrollerRef, onActiveChange]);

  return (
    <div
      ref={setScrollerRef}
      style={{
        flex: 1,
        display: 'flex',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollSnapType: 'x mandatory',
        scrollBehavior: 'smooth',
        WebkitOverflowScrolling: 'touch',
        minHeight: 0,
      }}
    >
      {widgets.map(widget => (
        <div key={widget.id} style={{
          flex: '0 0 100%',
          width: '100%',
          height: '100%',
          scrollSnapAlign: 'start',
          scrollSnapStop: 'always',
          padding: 12,
          boxSizing: 'border-box',
          minWidth: 0,
        }}>
          <WidgetRenderer widget={widget} />
        </div>
      ))}
    </div>
  );
}
