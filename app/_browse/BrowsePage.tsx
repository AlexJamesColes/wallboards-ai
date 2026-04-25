'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import BrowseHeader from './BrowseHeader';

interface PublicBoard {
  id:         string;
  name:       string;
  slug:       string | null;
  slug_token: string;
  department: string | null;
  url:        string;
}

type Mode = 'desktop' | 'mobile';

const DEPT_ORDER  = ['Sales', 'Renewals', 'Operations', 'Beta', 'Other'];
const RECENT_KEY  = 'wb-recent-boards-v1';
const RECENT_MAX  = 6;

export default function BrowsePage() {
  const [boards, setBoards]   = useState<PublicBoard[] | null>(null);
  const [mode,   setMode]     = useState<Mode>('desktop');
  const [error,  setError]    = useState<string | null>(null);
  const [query,  setQuery]    = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [recent, setRecent]   = useState<string[]>([]);

  // First-paint defaults: localStorage > device size > desktop
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('wb-mode') : null;
    if (stored === 'mobile' || stored === 'desktop') setMode(stored);
    else if (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches) setMode('mobile');

    try {
      const raw = window.localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw) || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('wb-mode', mode);
  }, [mode]);

  useEffect(() => {
    fetch('/api/boards/public', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setBoards(d.boards || []))
      .catch(e => setError(e?.message || 'Could not load boards'));
  }, []);

  // Track recents — when the user clicks a card, prepend its id and trim.
  const handleOpen = (b: PublicBoard) => {
    try {
      const next = [b.id, ...recent.filter(x => x !== b.id)].slice(0, RECENT_MAX);
      setRecent(next);
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  };

  const filtered = useMemo(() => {
    if (!boards) return [];
    const q = query.trim().toLowerCase();
    if (!q) return boards;
    return boards.filter(b =>
      b.name.toLowerCase().includes(q) ||
      (b.slug || '').toLowerCase().includes(q) ||
      (b.department || '').toLowerCase().includes(q)
    );
  }, [boards, query]);

  const grouped = useMemo(() => {
    const m = new Map<string, PublicBoard[]>();
    filtered.forEach(b => {
      const key = b.department || 'Other';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(b);
    });
    const allKeys   = [...m.keys()];
    const knownKeys = DEPT_ORDER.filter(k => m.has(k));
    const extras    = allKeys.filter(k => !DEPT_ORDER.includes(k)).sort();
    return [...knownKeys, ...extras].map(k => ({
      dept: k,
      boards: m.get(k)!.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [filtered]);

  // Recent boards as full PublicBoard entries, in the order the user
  // last opened them. Resolved by id from the current board list — if a
  // board has been deleted, drop it silently.
  const recentBoards = useMemo(() => {
    if (!boards || recent.length === 0) return [];
    const byId = new Map(boards.map(b => [b.id, b]));
    return recent.map(id => byId.get(id)).filter((b): b is PublicBoard => !!b);
  }, [boards, recent]);

  const urlFor = (b: PublicBoard) => `${b.url}?mode=${mode}`;

  const totalCount = boards?.length ?? 0;
  const matchCount = filtered.length;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 20% 0%, #1a1f3a 0%, #0a0f1c 60%, #050813 100%)',
      color: '#f1f5f9', fontFamily: 'var(--font-raleway, sans-serif)',
      padding: 'clamp(24px, 5vh, 64px) clamp(16px, 4vw, 48px)',
    }}>
      <BrowseHeader right={<ModeToggle value={mode} onChange={setMode} />} />

      <h1 style={{ fontSize: 'clamp(22px, 2.6vw, 34px)', fontWeight: 800, color: '#f1f5f9', marginBottom: 4 }}>
        Pick a wallboard
      </h1>
      <p style={{ fontSize: 'clamp(13px, 1vw, 16px)', color: '#94a3b8', marginBottom: 20 }}>
        Live boards across the floor — opening in <strong style={{ color: '#a5b4fc' }}>{mode === 'mobile' ? 'mobile' : 'desktop'}</strong> mode.
      </p>

      {/* Sticky search — stays accessible as you scroll through ~100 boards */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 5,
        marginLeft: 'calc(-1 * clamp(16px, 4vw, 48px))',
        marginRight: 'calc(-1 * clamp(16px, 4vw, 48px))',
        padding: 'clamp(8px, 1vh, 14px) clamp(16px, 4vw, 48px)',
        background: 'rgba(10,15,28,0.85)', backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', maxWidth: 1400, margin: '0 auto' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span aria-hidden style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#64748b' }}>🔍</span>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`Search ${totalCount} boards by name, slug, or department…`}
              aria-label="Search wallboards"
              style={{
                width: '100%', padding: '12px 14px 12px 40px',
                fontSize: 14, fontWeight: 500, color: '#f1f5f9',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10, outline: 'none',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'}
              onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
            />
          </div>
          {query && (
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {matchCount} {matchCount === 1 ? 'match' : 'matches'}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div style={{ color: '#f87171', padding: 24, fontSize: 14 }}>Couldn't load: {error}</div>
      )}

      {!error && boards === null && <SkeletonGrid />}

      {!error && boards !== null && totalCount === 0 && (
        <EmptyState message="No wallboards configured yet." />
      )}

      {!error && boards !== null && totalCount > 0 && matchCount === 0 && (
        <EmptyState message={`No boards match "${query}".`} />
      )}

      {!error && grouped.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {/* Recents row — only when we have at least one and the user
              hasn't filtered the list. */}
          {!query && recentBoards.length > 0 && (
            <section>
              <SectionHeader
                label="Recently viewed"
                accent="#a5b4fc"
                count={recentBoards.length}
                collapsed={false}
                onToggle={() => { /* recents always expanded */ }}
                disabled
              />
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {recentBoards.map(b => (
                  <BoardCard key={b.id} board={b} url={urlFor(b)} onOpen={() => handleOpen(b)} />
                ))}
              </div>
            </section>
          )}

          {grouped.map(({ dept, boards: deptBoards }) => {
            const isCollapsed = !!collapsed[dept];
            return (
              <section key={dept}>
                <SectionHeader
                  label={dept}
                  accent="#fbbf24"
                  count={deptBoards.length}
                  collapsed={isCollapsed}
                  onToggle={() => setCollapsed(c => ({ ...c, [dept]: !c[dept] }))}
                />
                {!isCollapsed && (
                  <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                    {deptBoards.map(b => (
                      <BoardCard key={b.id} board={b} url={urlFor(b)} onOpen={() => handleOpen(b)} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ label, accent, count, collapsed, onToggle, disabled }: {
  label: string; accent: string; count: number;
  collapsed: boolean; onToggle: () => void; disabled?: boolean;
}) {
  const Tag = disabled ? 'div' : 'button';
  return (
    <Tag
      onClick={disabled ? undefined : onToggle}
      aria-expanded={!collapsed}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: 0, marginBottom: 12, width: '100%', textAlign: 'left',
        background: 'transparent', border: 'none', cursor: disabled ? 'default' : 'pointer',
        color: 'inherit', fontFamily: 'inherit',
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 99, background: accent, boxShadow: `0 0 8px ${accent}88` }} />
      <h2 style={{
        fontSize: 'clamp(11px, 1vw, 14px)', fontWeight: 800,
        color: accent, letterSpacing: '0.25em', textTransform: 'uppercase',
        margin: 0,
      }}>{label}</h2>
      <span style={{ color: '#475569', fontWeight: 600, fontSize: 12 }}>· {count}</span>
      {!disabled && (
        <span aria-hidden style={{
          marginLeft: 'auto', color: '#475569', fontSize: 12, fontWeight: 700,
          transform: collapsed ? 'rotate(-90deg)' : 'none',
          transition: 'transform 0.15s ease',
        }}>▼</span>
      )}
    </Tag>
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
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 14px', borderRadius: 99,
      background: active ? 'linear-gradient(135deg, rgba(99,102,241,0.4) 0%, rgba(168,85,247,0.3) 100%)' : 'transparent',
      border: 'none',
      color: active ? '#f1f5f9' : '#94a3b8',
      fontSize: 12, fontWeight: 700, cursor: 'pointer',
      letterSpacing: '0.04em', transition: 'all 0.15s ease',
      fontFamily: 'inherit',
      boxShadow: active ? '0 4px 18px rgba(99,102,241,0.3)' : undefined,
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span> {label}
    </button>
  );
}

function BoardCard({ board: b, url, onOpen }: { board: PublicBoard; url: string; onOpen: () => void }) {
  return (
    <Link
      href={url}
      onClick={onOpen}
      style={{
        display: 'block', textDecoration: 'none', color: 'inherit',
        background: 'linear-gradient(180deg, rgba(26,33,54,0.85) 0%, rgba(14,20,39,0.85) 100%)',
        border: '1px solid rgba(99,102,241,0.22)',
        borderRadius: 12,
        padding: '14px 16px',
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
      <div style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9', marginBottom: 8, lineHeight: 1.25 }}>
        {b.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <code style={{ fontSize: 10, color: '#475569', background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
          {b.slug ? `/${b.slug}` : `/view/${b.slug_token.slice(0, 8)}…`}
        </code>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc' }}>Open →</span>
      </div>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{
          height: 88, borderRadius: 12,
          background: 'linear-gradient(180deg, rgba(26,33,54,0.6) 0%, rgba(14,20,39,0.6) 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
          animation: 'wb-celeb-banner 1.6s ease-in-out infinite',
        }} />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{
      padding: 'clamp(28px, 5vh, 56px)', textAlign: 'center',
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 16, color: '#64748b', fontSize: 14,
    }}>
      {message}
    </div>
  );
}
