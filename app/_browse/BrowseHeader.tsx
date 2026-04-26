'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

/**
 * Shared brand + tab header used by the browse home and the connections
 * page. Visual language tracks the InsureTec dashboard: shield-check
 * mark, two-tone wordmark with the "Tec" in cyan-blue, subtle muted
 * subtitle. Tabs are simple internal links so each tab gets a real
 * URL — works for back/forward, sharing, and bookmark workflows.
 */
export default function BrowseHeader({ right }: { right?: ReactNode }) {
  const pathname = usePathname() || '/';
  const tabs: Array<{ href: string; label: string; matches: (p: string) => boolean }> = [
    { href: '/',            label: 'Boards',      matches: p => p === '/' },
    { href: '/connections', label: 'Connections', matches: p => p.startsWith('/connections') },
  ];

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, marginBottom: 22,
      }}>
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 14 }}>
          <ShieldMark />
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em' }}>
              <span style={{ color: '#f1f5f9' }}>Insure</span>
              <span style={{ color: '#38bdf8' }}>Tec</span>
            </div>
            <div style={{
              fontSize: 11, fontWeight: 700, color: '#64748b',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              marginTop: 2,
            }}>Wallboards</div>
          </div>
        </Link>

        {right}
      </div>

      {/* Tabs — pill nav matching the dashboard's "current section" affordance. */}
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

/** Shield + checkmark mark that mirrors the InsureTec dashboard logo —
 *  blue gradient body, soft outer glow, tick stroke in white. */
function ShieldMark() {
  return (
    <div style={{
      width: 46, height: 46, borderRadius: 12,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(56,189,248,0.18) 100%)',
      border: '1px solid rgba(99,102,241,0.35)',
      boxShadow: '0 6px 20px rgba(56,189,248,0.18)',
      flexShrink: 0,
    }}>
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
        <defs>
          <linearGradient id="wb-shield-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="#6366f1" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <path
          d="M16 3 L26 7 V15 C26 22 16 28 16 28 C16 28 6 22 6 15 V7 Z"
          fill="url(#wb-shield-grad)"
          fillOpacity="0.18"
          stroke="url(#wb-shield-grad)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M11 16 L14.5 19.5 L21 12.5"
          stroke="#38bdf8"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}
