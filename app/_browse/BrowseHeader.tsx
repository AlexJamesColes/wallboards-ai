'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';

/**
 * Top header for every browse / connections / dataset page. Top row
 * exactly matches the InsureTec dashboard's nav strip:
 *
 *   [back?]  [InsureTec brand SVG]                       [bell] [avatar]
 *
 * Everything else (Boards/Connections tabs, page-specific controls
 * passed in `right`) lives in a SECOND row below the brand strip so
 * the top of the screen is consistent across the two apps.
 *
 * The brand mark is the canonical /insuretec-logo.svg — the single
 * source of truth shared with the dashboard. Never re-draw the shield
 * or re-type "InsureTec" inline (the SVG carries both, plus the
 * "DASHBOARD" tagline). Sized purely via CSS — 40px tall on mobile,
 * 48px on desktop — so a redesign of the SVG flows everywhere with
 * zero code edits.
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
            <Link href="/" aria-label="InsureTec home" style={{
              textDecoration: 'none', color: 'inherit',
              display: 'flex', alignItems: 'center', minWidth: 0,
            }}>
              <img
                src="/insuretec-logo.svg"
                alt="InsureTec"
                className="wb-brand-logo"
                draggable={false}
              />
            </Link>
          </div>

          {/* Bell + avatar removed for now — they'll come back wired up
              to the dashboard's alerts/profile routes once SSO lands. */}
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

