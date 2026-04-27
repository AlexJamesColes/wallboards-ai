'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';

/**
 * Top header for every browse / connections / dataset page. Top row
 * exactly matches the InsureTec dashboard's nav strip:
 *
 *   [back?]  [shield] [InsureTec]                       [bell] [avatar]
 *
 * Everything else (Boards/Connections tabs, page-specific controls
 * passed in `right`) lives in a SECOND row below the brand strip so
 * the top of the screen is consistent across the two apps.
 *
 * Bell + avatar are placeholders today — once the dashboard is plugged
 * in for SSO/redirects they'll point at the dashboard's alerts and
 * profile routes. Kept visually present so the cross-app top bar
 * doesn't look amputated.
 */
export default function BrowseHeader({ right }: { right?: ReactNode }) {
  const pathname = usePathname() || '/';
  const tabs: Array<{ href: string; label: string; matches: (p: string) => boolean }> = [
    { href: '/',            label: 'Boards',      matches: p => p === '/' },
    { href: '/connections', label: 'Connections', matches: p => p.startsWith('/connections') },
  ];

  return (
    <>
      {/* ── Brand strip — dark navy bar matching the dashboard ─────
          Bleeds full-width past the page padding (matches the
          dashboard's top chrome) and sticks to the top of the
          viewport on mobile. */}
      <div className="wb-brand-strip wb-mobile-sticky-top">
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {pathname !== '/' && <BrowseBackButton />}
            <Link href="/" style={{
              textDecoration: 'none', color: 'inherit',
              display: 'flex', alignItems: 'center', gap: 12, minWidth: 0,
            }}>
              <ShieldMark />
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1, whiteSpace: 'nowrap' }}>
                <span style={{ color: '#f1f5f9' }}>Insure</span>
                <span style={{ color: '#38bdf8' }}>Tec</span>
              </div>
            </Link>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <BellButton />
            <UserAvatar />
          </div>
        </div>
      </div>

      {/* ── Tabs + page-specific controls — sit on the page bg, not
          part of the dark brand strip. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 26,
      }}>
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

        {right}
      </div>
    </>
  );
}

/** Back chevron sitting before the brand mark on non-home pages. */
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

/** Bell icon top-right matching the dashboard. Placeholder for now —
 *  on click would route to the dashboard's alerts page. Inert until
 *  cross-app routing is wired. */
function BellButton() {
  return (
    <button
      type="button"
      aria-label="Alerts"
      style={{
        width: 40, height: 40, borderRadius: 10,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: '#cbd5e1', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'inherit', flexShrink: 0,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 8 a6 6 0 0 1 12 0 c0 7 3 9 3 9 H3 s3-2 3-9 z" />
        <path d="M10.3 21 a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    </button>
  );
}

/** Avatar placeholder — circular gradient with the same default avatar
 *  glyph the dashboard uses on a fresh account. Replaced when SSO
 *  lands and we have a real user. */
function UserAvatar() {
  return (
    <button
      type="button"
      aria-label="Account"
      style={{
        width: 40, height: 40, borderRadius: '50%',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.35) 0%, rgba(56,189,248,0.35) 100%)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: '#fff', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'inherit', flexShrink: 0,
        fontSize: 18,
      }}
    >
      <span aria-hidden>🐶</span>
    </button>
  );
}

/** Shield + checkmark mark mirroring the InsureTec dashboard logo. */
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
