'use client';

import { useRouter } from 'next/navigation';

/**
 * Square chevron-left back button used on every kiosk board (showcase
 * leaderboards + agent-state grids). Shared so a styling change ripples
 * to every wallboard surface in one edit.
 *
 * Goes back through history when there's something to go back to (e.g.
 * arrived from the browse home), otherwise lands on /.
 */
export default function BoardBackButton() {
  const router = useRouter();
  const onBack = () => {
    if (typeof window === 'undefined') return;
    if (window.history.length > 1) router.back();
    else router.push('/');
  };
  return (
    <button
      onClick={onBack}
      aria-label="Back"
      style={{
        flexShrink: 0,
        width: 36, height: 36, borderRadius: 10,
        background: 'rgba(20,26,46,0.85)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: '#e2e8f0', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'inherit',
        transition: 'transform 150ms ease, border-color 150ms ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateX(-1px)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M15 18 L9 12 L15 6" />
      </svg>
    </button>
  );
}
