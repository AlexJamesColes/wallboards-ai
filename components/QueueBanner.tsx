'use client';

import type { QueueSummary } from '@/lib/useAgentStates';

/**
 * Slim one-row queue banner that surfaces inbound-call pressure on the
 * sales leaderboards. Replaces the previous smart-pin-on-queue rotation
 * — instead of flipping the TV away from the leaderboard when a call
 * lands, this strip appears above the existing header, draws the eye,
 * and disappears again when the queue clears.
 *
 * Hidden when every queue has zero callers. Pulses the "in queue"
 * number when the count is non-zero so a TV across the room reads
 * pressure without anyone needing to read the text.
 *
 * Designed to be visually quieter than the full <QueueStrip> on the
 * agent-states board (which has four big stat tiles per queue group).
 * This is one row, one queue per line — meant to *augment* the
 * leaderboard, not crowd it out.
 */

interface Props {
  queues: QueueSummary[];
}

export default function QueueBanner({ queues }: Props) {
  // Filter to queues that actually have someone waiting. Empty queues
  // contribute nothing — banner stays out of the way until it matters.
  const active = queues.filter(q => q.in_queue > 0);
  if (active.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '8px clamp(14px, 2vw, 24px)',
        background: 'linear-gradient(90deg, rgba(248,113,113,0.18) 0%, rgba(251,146,60,0.16) 50%, rgba(251,191,36,0.14) 100%)',
        borderBottom: '1px solid rgba(248,113,113,0.4)',
        animation: 'wb-queue-banner-slide 0.4s ease-out',
        // CSS keyframes defined in app/globals.css; if the animation
        // class isn't registered the banner just appears, which is fine.
      }}
    >
      {active.map(q => (
        <Row key={q.label} q={q} />
      ))}

      <style>{`
        @keyframes wb-queue-banner-slide {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        @keyframes wb-queue-banner-pulse {
          0%, 100% { transform: scale(1);     opacity: 1;   }
          50%      { transform: scale(1.08);  opacity: 0.92; }
        }
      `}</style>
    </div>
  );
}

function Row({ q }: { q: QueueSummary }) {
  const tint = q.in_queue >= 8  ? '#f87171'
             : q.in_queue >= 4  ? '#fb923c'
             : q.in_queue >= 1  ? '#fbbf24'
             :                    '#94a3b8';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      fontFamily: 'var(--font-raleway, sans-serif)', color: '#f1f5f9',
    }}>
      <span aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>📞</span>
      <span style={{
        fontSize: 13, fontWeight: 800, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: '#fde68a',
      }}>{q.label}</span>

      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '4px 14px', borderRadius: 99,
        background: `${tint}22`, border: `1px solid ${tint}77`,
        fontSize: 18, fontWeight: 800, color: tint,
        fontVariantNumeric: 'tabular-nums',
        textShadow: `0 0 12px ${tint}66`,
        animation: 'wb-queue-banner-pulse 1.3s ease-in-out infinite',
      }}>
        {q.in_queue}
        <span style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', letterSpacing: '0.06em' }}>
          IN QUEUE
        </span>
      </span>

      {q.longest_wait > 0 && (
        <span style={{ fontSize: 14, fontWeight: 700, color: '#cbd5e1' }}>
          Longest wait <span style={{
            fontVariantNumeric: 'tabular-nums', color: '#fbbf24', fontWeight: 800,
          }}>{formatWait(q.longest_wait)}</span>
        </span>
      )}
    </div>
  );
}

function formatWait(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '–';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
