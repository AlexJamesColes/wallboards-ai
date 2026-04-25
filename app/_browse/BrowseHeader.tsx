'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

/**
 * Shared brand + tab header used by the browse home and the connections
 * page. Tabs are simple internal links so each tab gets a real URL —
 * works for back/forward, sharing, and bookmark workflows.
 */
export default function BrowseHeader({ right }: { right?: ReactNode }) {
  const pathname = usePathname() || '/';
  const tabs: Array<{ href: string; label: string; matches: (p: string) => boolean }> = [
    { href: '/',            label: 'Boards',      matches: p => p === '/' },
    { href: '/connections', label: 'Connections', matches: p => p.startsWith('/connections') },
  ];

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, marginBottom: 18,
      }}>
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11,
            background: 'rgba(99,102,241,0.18)',
            border: '1.5px solid rgba(99,102,241,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
              <rect x="2" y="4" width="24" height="16" rx="2.5" stroke="#a5b4fc" strokeWidth="1.8" fill="none" />
              <rect x="9.5" y="12" width="2.5" height="6" rx="0.5" fill="#a5b4fc" opacity="0.8" />
              <rect x="13.5" y="9"  width="2.5" height="9" rx="0.5" fill="#a5b4fc" />
              <rect x="17.5" y="11" width="2.5" height="7" rx="0.5" fill="#a5b4fc" opacity="0.8" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', letterSpacing: '0.25em', textTransform: 'uppercase' }}>InsureTec</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', marginTop: 2 }}>Wallboards</div>
          </div>
        </Link>

        {right}
      </div>

      {/* Tabs */}
      <nav role="tablist" aria-label="Sections" style={{
        display: 'inline-flex', gap: 4, padding: 4, borderRadius: 99,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
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
