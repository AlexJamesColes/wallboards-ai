'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

interface PublicBoard {
  id:         string;
  name:       string;
  slug:       string | null;
  slug_token: string;
  department: string | null;
  url:        string;
}

type Mode = 'desktop' | 'mobile';

const DEPT_ORDER = ['Sales', 'Renewals', 'Operations', 'Beta', 'Other'];

export default function BrowsePage() {
  const [boards, setBoards] = useState<PublicBoard[] | null>(null);
  const [mode,   setMode]   = useState<Mode>('desktop');
  const [error,  setError]  = useState<string | null>(null);

  // First-paint default: localStorage > device size > desktop
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('wb-mode') : null;
    if (stored === 'mobile' || stored === 'desktop') {
      setMode(stored);
    } else if (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches) {
      setMode('mobile');
    }
  }, []);

  // Persist user's preference across visits
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('wb-mode', mode);
  }, [mode]);

  useEffect(() => {
    fetch('/api/boards/public', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setBoards(d.boards || []))
      .catch(e => setError(e?.message || 'Could not load boards'));
  }, []);

  // Bucket boards into departments, ordered by DEPT_ORDER then any extras alphabetically
  const grouped = useMemo(() => {
    const m = new Map<string, PublicBoard[]>();
    (boards || []).forEach(b => {
      const key = b.department || 'Other';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(b);
    });
    const allKeys   = [...m.keys()];
    const knownKeys = DEPT_ORDER.filter(k => m.has(k));
    const extras    = allKeys.filter(k => !DEPT_ORDER.includes(k)).sort();
    return [...knownKeys, ...extras].map(k => ({ dept: k, boards: m.get(k)!.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [boards]);

  // Append the chosen mode as a query param so the kiosk view can respect it
  const urlFor = (b: PublicBoard) => `${b.url}?mode=${mode}`;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 20% 0%, #1a1f3a 0%, #0a0f1c 60%, #050813 100%)',
      color: '#f1f5f9', fontFamily: 'var(--font-raleway, sans-serif)',
      padding: 'clamp(24px, 5vh, 64px) clamp(16px, 4vw, 48px)',
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
        <Link href="http://insuretec.ai" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 14 }}>
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

        <ModeToggle value={mode} onChange={setMode} />
      </div>

      <h1 style={{ fontSize: 'clamp(22px, 2.6vw, 34px)', fontWeight: 800, color: '#f1f5f9', marginBottom: 4 }}>
        Pick a wallboard
      </h1>
      <p style={{ fontSize: 'clamp(13px, 1vw, 16px)', color: '#94a3b8', marginBottom: 28 }}>
        Live boards across the floor — opening in <strong style={{ color: '#a5b4fc' }}>{mode === 'mobile' ? 'mobile' : 'desktop'}</strong> mode.
      </p>

      {error && (
        <div style={{ color: '#f87171', padding: 24, fontSize: 14 }}>Couldn't load: {error}</div>
      )}

      {!error && boards === null && <SkeletonGrid />}

      {!error && boards !== null && grouped.length === 0 && (
        <div style={{
          padding: 'clamp(28px, 5vh, 56px)', textAlign: 'center',
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 16, color: '#64748b', fontSize: 15,
        }}>
          No boards yet. An admin can create one in /admin.
        </div>
      )}

      {!error && grouped.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
          {grouped.map(({ dept, boards }) => (
            <section key={dept}>
              <h2 style={{
                fontSize: 'clamp(11px, 1vw, 14px)', fontWeight: 800,
                color: '#fbbf24', letterSpacing: '0.25em', textTransform: 'uppercase',
                marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: '#fbbf24', boxShadow: '0 0 8px rgba(251,191,36,0.6)' }} />
                {dept}
                <span style={{ color: '#475569', fontWeight: 600 }}>· {boards.length}</span>
              </h2>
              <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {boards.map(b => (
                  <BoardCard key={b.id} board={b} url={urlFor(b)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ModeToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div style={{
      display: 'inline-flex', padding: 4, borderRadius: 99,
      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
      gap: 4,
    }}>
      <ModeButton current={value} mine="desktop" label="Desktop" icon="🖥️" onClick={() => onChange('desktop')} />
      <ModeButton current={value} mine="mobile"  label="Mobile"  icon="📱" onClick={() => onChange('mobile')} />
    </div>
  );
}

function ModeButton({ current, mine, label, icon, onClick }: {
  current: Mode; mine: Mode; label: string; icon: string; onClick: () => void;
}) {
  const active = current === mine;
  return (
    <button onClick={onClick} aria-pressed={active} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '8px 16px', borderRadius: 99,
      background: active ? 'linear-gradient(135deg, rgba(99,102,241,0.4) 0%, rgba(168,85,247,0.3) 100%)' : 'transparent',
      border: 'none',
      color: active ? '#f1f5f9' : '#94a3b8',
      fontSize: 13, fontWeight: 700, cursor: 'pointer',
      letterSpacing: '0.04em', transition: 'all 0.15s ease',
      boxShadow: active ? '0 4px 18px rgba(99,102,241,0.3)' : undefined,
    }}>
      <span style={{ fontSize: 15 }}>{icon}</span> {label}
    </button>
  );
}

function BoardCard({ board: b, url }: { board: PublicBoard; url: string }) {
  return (
    <Link
      href={url}
      style={{
        display: 'block', textDecoration: 'none', color: 'inherit',
        background: 'linear-gradient(180deg, rgba(26,33,54,0.85) 0%, rgba(14,20,39,0.85) 100%)',
        border: '1px solid rgba(99,102,241,0.22)',
        borderRadius: 14,
        padding: 'clamp(14px, 1.8vh, 20px) clamp(16px, 1.4vw, 22px)',
        transition: 'transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative', overflow: 'hidden',
      }}
      onMouseOver={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)';
        e.currentTarget.style.boxShadow = '0 12px 36px rgba(99,102,241,0.18)';
      }}
      onMouseOut={e => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.borderColor = 'rgba(99,102,241,0.22)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9', marginBottom: 12, lineHeight: 1.2 }}>
        {b.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <code style={{ fontSize: 11, color: '#475569', background: 'rgba(255,255,255,0.04)', padding: '3px 8px', borderRadius: 6 }}>
          {b.slug ? `/${b.slug}` : `/view/${b.slug_token.slice(0, 8)}…`}
        </code>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>Open →</span>
      </div>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{
          height: 110, borderRadius: 14,
          background: 'linear-gradient(180deg, rgba(26,33,54,0.6) 0%, rgba(14,20,39,0.6) 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
          animation: 'wb-celeb-banner 1.6s ease-in-out infinite',
        }} />
      ))}
    </div>
  );
}
