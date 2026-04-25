'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface PublicBoard {
  id:           string;
  name:         string;
  slug:         string | null;
  slug_token:   string;
  department:   string | null;
  display_type: 'mobile' | 'desktop';
  url:          string;
}

type Tab = 'mobile' | 'desktop';

export default function BrowsePage() {
  const [boards, setBoards] = useState<PublicBoard[] | null>(null);
  const [tab,    setTab]    = useState<Tab>('desktop');
  const [error,  setError]  = useState<string | null>(null);

  // Pick the default tab from device width on first paint. Phones
  // (≤640px) default to Mobile, everything else to Desktop. Mirrors
  // the matchMedia rule the showcase uses elsewhere.
  useEffect(() => {
    const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
    setTab(mobile ? 'mobile' : 'desktop');
  }, []);

  useEffect(() => {
    fetch('/api/boards/public', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setBoards(d.boards || []))
      .catch(e => setError(e?.message || 'Could not load boards'));
  }, []);

  const filtered = (boards || []).filter(b => b.display_type === tab);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 20% 0%, #1a1f3a 0%, #0a0f1c 60%, #050813 100%)',
      color: '#f1f5f9', fontFamily: 'var(--font-raleway, sans-serif)',
      padding: 'clamp(24px, 5vh, 64px) clamp(16px, 4vw, 48px)',
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 32 }}>
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
      </div>

      <h1 style={{ fontSize: 'clamp(24px, 3vw, 38px)', fontWeight: 800, color: '#f1f5f9', marginBottom: 6 }}>
        Pick a wallboard
      </h1>
      <p style={{ fontSize: 'clamp(13px, 1vw, 16px)', color: '#94a3b8', marginBottom: 28 }}>
        Live boards across the floor. Tap one to open it in this window.
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <TabButton active={tab === 'desktop'} onClick={() => setTab('desktop')} label="Desktop" icon="🖥️" />
        <TabButton active={tab === 'mobile'}  onClick={() => setTab('mobile')}  label="Mobile"  icon="📱" />
      </div>

      {/* Body */}
      {error && (
        <div style={{ color: '#f87171', padding: 24, fontSize: 14 }}>Couldn't load: {error}</div>
      )}

      {!error && boards === null && (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              height: 130, borderRadius: 16,
              background: 'linear-gradient(180deg, rgba(26,33,54,0.6) 0%, rgba(14,20,39,0.6) 100%)',
              border: '1px solid rgba(255,255,255,0.06)',
              animation: 'wb-celeb-banner 1.6s ease-in-out infinite',
            }} />
          ))}
        </div>
      )}

      {!error && boards !== null && filtered.length === 0 && (
        <div style={{
          padding: 'clamp(28px, 5vh, 56px)', textAlign: 'center',
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 16, color: '#64748b', fontSize: 15,
        }}>
          No {tab} boards yet — switch tabs above or ask an admin to mark a board for {tab}.
        </div>
      )}

      {!error && filtered.length > 0 && (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filtered.map(b => (
            <Link
              key={b.id}
              href={b.url}
              style={{
                display: 'block', textDecoration: 'none', color: 'inherit',
                background: 'linear-gradient(180deg, rgba(26,33,54,0.85) 0%, rgba(14,20,39,0.85) 100%)',
                border: '1px solid rgba(99,102,241,0.22)',
                borderRadius: 16,
                padding: 'clamp(16px, 2vh, 22px) clamp(18px, 1.6vw, 24px)',
                transition: 'transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                position: 'relative', overflow: 'hidden',
              }}
              onMouseOver={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)';
                e.currentTarget.style.boxShadow = '0 14px 40px rgba(99,102,241,0.18)';
              }}
              onMouseOut={e => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.borderColor = 'rgba(99,102,241,0.22)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {b.department && (
                <div style={{ fontSize: 10, fontWeight: 800, color: '#a5b4fc', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8 }}>
                  {b.department}
                </div>
              )}
              <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9', marginBottom: 8, lineHeight: 1.2 }}>
                {b.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
                <code style={{ fontSize: 11, color: '#475569', background: 'rgba(255,255,255,0.04)', padding: '3px 8px', borderRadius: 6 }}>
                  {b.slug ? `/${b.slug}` : `/view/${b.slug_token.slice(0, 8)}…`}
                </code>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>Open →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, label, icon }: {
  active: boolean; onClick: () => void; label: string; icon: string;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '10px 18px',
      background: active
        ? 'linear-gradient(135deg, rgba(99,102,241,0.25) 0%, rgba(168,85,247,0.18) 100%)'
        : 'rgba(255,255,255,0.04)',
      border: `1px solid ${active ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 12, color: active ? '#f1f5f9' : '#94a3b8',
      fontSize: 14, fontWeight: 700, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 8,
      letterSpacing: '0.04em',
    }}>
      <span style={{ fontSize: 16 }}>{icon}</span> {label}
    </button>
  );
}
