'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';

/**
 * Shared brand + tab header used by the browse home and the connections
 * page. Visual language matches the InsureTec dashboard's nav strip
 * exactly: shield-check icon to the left of the wordmark, single
 * horizontal line, the "Tec" in cyan-blue. No subtitle — the dashboard
 * doesn't use one and this kept reading as a different product. The
 * Boards/Connections tabs sit in their own row below.
 */
export default function BrowseHeader({ right }: { right?: ReactNode }) {
  const pathname = usePathname() || '/';
  const tabs: Array<{ href: string; label: string; matches: (p: string) => boolean }> = [
    { href: '/',            label: 'Boards',      matches: p => p === '/' },
    { href: '/connections', label: 'Connections', matches: p => p.startsWith('/connections') },
  ];

  return (
    <div className="wb-mobile-sticky-top" style={{ marginBottom: 26 }}>
      {/* Brand strip — single line, exactly mirrors the dashboard.
          Back arrow appears on every non-home page (Connections,
          Dataset test boards) so users can step back the same way
          the dashboard's reminders / calendar pages let them. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {pathname !== '/' && <BrowseBackButton />}
          <Link href="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 12 }}>
            <ShieldMark />
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1 }}>
              <span style={{ color: '#f1f5f9' }}>Insure</span>
              <span style={{ color: '#38bdf8' }}>Tec</span>
            </div>
          </Link>
        </div>

        {right}
      </div>

      {/* Tabs — pill nav matching the dashboard's section pills. */}
      <nav role="tablist" aria-label="Sections" style={{
        display: 'inline-flex', gap: 4, padding: 4, borderRadius: 99,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
      }}>
        {tabs.map(t => {
          const active = t.matches(pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              role="tab"
              aria-selected={active}
              style={{
                padding: '8px 18px', borderRadius: 99, textDecoration: 'none',
                fontSize: 13, fontWeight: 700, letterSpacing: '0.04em',
                color: active ? '#f1f5f9' : '#94a3b8',
                background: active
                  ? 'linear-gradient(135deg, rgba(99,102,241,0.4) 0%, rgba(168,85,247,0.3) 100%)'
                  : 'transparent',
                boxShadow: active ? '0 4px 18px rgba(99,102,241,0.3)' : undefined,
                transition: 'all 0.15s ease',
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Back chevron sitting before the brand mark on non-home pages.
 *  Goes back through history when there's something to go back to,
 *  otherwise lands on /. Same rounded-square treatment as the
 *  dashboard's nav-strip back button. */
function BrowseBackButton() {
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

/** Shield + checkmark mark mirroring the InsureTec dashboard logo —
 *  thin-stroke shield outline in cyan-blue with a white check. Sized
 *  to match the dashboard's inline icon (no chip / glow background) so
 *  the brand reads identically across the two apps. */
function ShieldMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="wb-shield-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#6366f1" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <path
        d="M16 3 L26 7 V15 C26 22 16 28 16 28 C16 28 6 22 6 15 V7 Z"
        fill="url(#wb-shield-grad)"
        fillOpacity="0.16"
        stroke="url(#wb-shield-grad)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M11 16 L14.5 19.5 L21 12.5"
        stroke="#38bdf8"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
