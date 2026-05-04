'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import BrowseHeader from './BrowseHeader';

interface PublicBoard {
  id:         string;
  name:       string;
  slug:       string | null;
  slug_token: string;
  department: string | null;
  url:        string;
  /** Synthetic boards are defined in code (lib/showcaseBoards.ts), not
   *  the wb_boards table. They have no DB row, so admin actions like
   *  "Move department" or "Delete" don't apply — the catalogue config
   *  is the source of truth. The admin overflow menu is hidden on
   *  these boards entirely. */
  synthetic?: boolean;
}

type Mode = 'desktop' | 'mobile';

/** Viewport threshold below which a board opens in mobile mode. Matches
 *  the breakpoint used by wb-mobile-sticky-top in globals.css so the
 *  browse page chrome and the chosen wallboard layout flip together. */
const MOBILE_MAX_WIDTH = 768;

// "Kiosk" sits at the bottom — these are TV-bookmark rotator URLs,
// not boards an analyst opens day-to-day. Last in the list keeps them
// out of the way unless the user has favourited them (favourites
// section pins to the top regardless of department).
const DEPT_ORDER  = ['Sales', 'Renewals', 'Operations', 'Internal Audit', 'Beta', 'Other', 'Kiosk'];
const FAVOURITES_KEY = 'wb-favourites-v1';
const ADMIN_KEY_STORAGE = 'wb-admin-key-v1';

/** Departments offered in the admin "move" dropdown. Same set as
 *  DEPT_ORDER without the catch-all "Other" — choosing nothing in the
 *  dropdown clears the department. */
const DEPT_CHOICES = ['Sales', 'Renewals', 'Operations', 'Beta'];

export default function BrowsePage() {
  const [boards, setBoards]   = useState<PublicBoard[] | null>(null);
  const [mode,   setMode]     = useState<Mode>('desktop');
  const [error,  setError]    = useState<string | null>(null);
  const [query,  setQuery]    = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [favourites, setFavourites] = useState<string[]>([]);
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PublicBoard | null>(null);

  // Mode is derived from the device, not the user. Phones get the mobile
  // layout, everything else gets desktop. Live-listening to the media
  // query means rotating an iPad or resizing a window keeps the link
  // target in sync — useful when QA'ing on a desktop browser.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    const apply = () => setMode(mq.matches ? 'mobile' : 'desktop');
    apply();
    mq.addEventListener('change', apply);

    try {
      const raw = window.localStorage.getItem(FAVOURITES_KEY);
      if (raw) setFavourites(JSON.parse(raw) || []);
    } catch { /* ignore */ }

    // Admin-mode bootstrap. Either:
    //   • ?admin=<key>  on the URL — stash to localStorage, strip from URL
    //   • previously stashed in localStorage — pick it up silently
    // We never display the key, only the activated state.
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('admin');
    if (fromUrl) {
      window.localStorage.setItem(ADMIN_KEY_STORAGE, fromUrl);
      url.searchParams.delete('admin');
      window.history.replaceState({}, '', url.toString());
      setAdminKey(fromUrl);
    } else {
      const stashed = window.localStorage.getItem(ADMIN_KEY_STORAGE);
      if (stashed) setAdminKey(stashed);
    }

    return () => mq.removeEventListener('change', apply);
  }, []);

  const loadBoards = useCallback(() => {
    fetch('/api/boards/public', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setBoards(d.boards || []))
      .catch(e => setError(e?.message || 'Could not load boards'));
  }, []);

  useEffect(() => { loadBoards(); }, [loadBoards]);

  // Toggle a board's favourite status. Persisted to localStorage so a
  // tab-close doesn't lose the user's pinned boards. Newest favourite
  // bumps to the front so the most-recently-pinned tile reads first
  // in the Favourites section.
  const toggleFavourite = (b: PublicBoard) => {
    setFavourites(prev => {
      const has  = prev.includes(b.id);
      const next = has ? prev.filter(x => x !== b.id) : [b.id, ...prev];
      try { window.localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const isFavourite = (id: string) => favourites.includes(id);

  const exitAdmin = () => {
    setAdminKey(null);
    try { window.localStorage.removeItem(ADMIN_KEY_STORAGE); } catch { /* ignore */ }
  };

  const moveBoard = useCallback(async (board: PublicBoard, dept: string | null) => {
    if (!adminKey) return;
    try {
      const res = await fetch(`/api/boards/${board.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({ department: dept }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Move failed: ${err.error || res.status}`);
        if (res.status === 401) exitAdmin();
        return;
      }
      loadBoards();
    } catch (e: any) {
      alert(`Move failed: ${e?.message || 'network error'}`);
    }
  }, [adminKey, loadBoards]);

  const deleteBoard = useCallback(async (board: PublicBoard) => {
    if (!adminKey) return;
    try {
      const res = await fetch(`/api/boards/${board.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${adminKey}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Delete failed: ${err.error || res.status}`);
        if (res.status === 401) exitAdmin();
        return;
      }
      setConfirmDelete(null);
      loadBoards();
    } catch (e: any) {
      alert(`Delete failed: ${e?.message || 'network error'}`);
    }
  }, [adminKey, loadBoards]);

  const filtered = useMemo(() => {
    if (!boards) return [];
    const q = query.trim().toLowerCase();
    if (!q) return boards;
    return boards.filter(b =>
      b.name.toLowerCase().includes(q) ||
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

  const favouriteBoards = useMemo(() => {
    if (!boards || favourites.length === 0) return [];
    const byId = new Map(boards.map(b => [b.id, b]));
    return favourites.map(id => byId.get(id)).filter((b): b is PublicBoard => !!b);
  }, [boards, favourites]);

  const urlFor = (b: PublicBoard) => `${b.url}?mode=${mode}`;

  const totalCount = boards?.length ?? 0;
  const matchCount = filtered.length;
  const isAdmin    = !!adminKey;

  return (
    <div style={{
      minHeight: '100vh',
      // Dashboard-matched: very dark navy with a faint grid wash so the
      // page reads as an InsureTec surface rather than a standalone tool.
      background: '#131b30',
      backgroundImage: `
        radial-gradient(ellipse at 50% -10%, rgba(56,189,248,0.06) 0%, transparent 55%),
        linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
      `,
      backgroundSize: 'auto, 40px 40px, 40px 40px',
      color: '#f1f5f9', fontFamily: 'var(--font-raleway, sans-serif)',
      padding: 'clamp(24px, 5vh, 64px) clamp(16px, 4vw, 48px)',
    }}>
      <BrowseHeader
        right={isAdmin ? <AdminBadge onExit={exitAdmin} /> : undefined}
      />

      <h1 className="wb-page-lead" style={{ fontSize: 'clamp(22px, 2.6vw, 34px)', fontWeight: 800, color: '#f1f5f9', marginBottom: 4 }}>
        Pick a wallboard
      </h1>
      <p className="wb-page-sub" style={{ fontSize: 'clamp(13px, 1vw, 16px)', color: '#94a3b8', marginBottom: 20 }}>
        Live boards across the floor — tap one to open.
      </p>

      {/* Search — flows in normal page order. Used to be sticky too,
          but on mobile the BrowseHeader is now sticky at top:0 and
          two competing stickies just stack on top of each other. */}
      <div style={{
        marginLeft: 'calc(-1 * clamp(16px, 4vw, 48px))',
        marginRight: 'calc(-1 * clamp(16px, 4vw, 48px))',
        padding: 'clamp(8px, 1vh, 14px) clamp(16px, 4vw, 48px)',
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', maxWidth: 1400, margin: '0 auto' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span aria-hidden style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#64748b' }}>🔍</span>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`Search ${totalCount} ${totalCount === 1 ? 'board' : 'boards'}…`}
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

      {error && <div style={{ color: '#f87171', padding: 24, fontSize: 14 }}>Couldn't load: {error}</div>}

      {!error && boards === null && <SkeletonGrid />}

      {!error && boards !== null && totalCount === 0 && (
        <EmptyState message="No wallboards configured yet." />
      )}

      {!error && boards !== null && totalCount > 0 && matchCount === 0 && (
        <EmptyState message={`No boards match "${query}".`} />
      )}

      {!error && grouped.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {!query && favouriteBoards.length > 0 && (
            <section>
              <SectionHeader label="Favourites" accent="#fbbf24" count={favouriteBoards.length} collapsed={false} onToggle={() => {}} disabled />
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                {favouriteBoards.map(b => (
                  <BoardCard key={b.id} board={b} url={urlFor(b)}
                    isAdmin={isAdmin}
                    isFavourite={isFavourite(b.id)}
                    onToggleFavourite={() => toggleFavourite(b)}
                    onMove={dept => moveBoard(b, dept)}
                    onAskDelete={() => setConfirmDelete(b)}
                  />
                ))}
              </div>
            </section>
          )}

          {grouped.map(({ dept, boards: deptBoards }) => {
            const isCollapsed = !!collapsed[dept];
            return (
              <section key={dept}>
                <SectionHeader label={dept} accent="#a855f7" count={deptBoards.length}
                  collapsed={isCollapsed}
                  onToggle={() => setCollapsed(c => ({ ...c, [dept]: !c[dept] }))} />
                {!isCollapsed && (
                  <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                    {deptBoards.map(b => (
                      <BoardCard key={b.id} board={b} url={urlFor(b)}
                        isAdmin={isAdmin}
                        isFavourite={isFavourite(b.id)}
                        onToggleFavourite={() => toggleFavourite(b)}
                        onMove={dept => moveBoard(b, dept)}
                        onAskDelete={() => setConfirmDelete(b)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          board={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteBoard(confirmDelete)}
        />
      )}
    </div>
  );
}

function AdminBadge({ onExit }: { onExit: () => void }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 10px 6px 12px', borderRadius: 99,
      background: 'rgba(248,113,113,0.12)',
      border: '1px solid rgba(248,113,113,0.4)',
      fontSize: 11, fontWeight: 800, color: '#fca5a5',
      letterSpacing: '0.1em', textTransform: 'uppercase',
    }}>
      <span aria-hidden style={{
        width: 7, height: 7, borderRadius: 99,
        background: '#f87171', boxShadow: '0 0 8px rgba(248,113,113,0.6)',
      }} />
      Admin
      <button
        onClick={onExit}
        title="Exit admin mode"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#fca5a5', fontFamily: 'inherit',
          fontSize: 13, fontWeight: 800, padding: '0 0 0 4px',
        }}
      >×</button>
    </span>
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
        padding: 0, marginBottom: 14, width: '100%', textAlign: 'left',
        background: 'transparent', border: 'none', cursor: disabled ? 'default' : 'pointer',
        color: 'inherit', fontFamily: 'inherit',
      }}
    >
      <span aria-hidden style={{
        width: 7, height: 7, borderRadius: 99, background: accent,
        boxShadow: `0 0 10px ${accent}aa`,
      }} />
      <h2 style={{
        fontSize: 12, fontWeight: 800,
        color: accent, letterSpacing: '0.22em', textTransform: 'uppercase',
        margin: 0,
      }}>{label}</h2>
      <span style={{
        color: '#475569', fontWeight: 700, fontSize: 11,
        padding: '2px 7px', borderRadius: 99,
        background: 'rgba(255,255,255,0.04)',
      }}>{count}</span>
      {!disabled && (
        <span aria-hidden style={{
          marginLeft: 'auto', color: '#475569', fontSize: 11, fontWeight: 700,
          transform: collapsed ? 'rotate(-90deg)' : 'none',
          transition: 'transform 0.15s ease',
        }}>▼</span>
      )}
    </Tag>
  );
}

function BoardCard({ board: b, url, isAdmin, isFavourite, onToggleFavourite, onMove, onAskDelete }: {
  board: PublicBoard;
  url: string;
  isAdmin: boolean;
  isFavourite: boolean;
  onToggleFavourite: () => void;
  onMove: (dept: string | null) => void;
  onAskDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Star is positioned absolutely top-right. Make space inside the
  // card padding so the chevron / name don't crash into it.
  const starGutter = isAdmin ? 64 : 32;

  return (
    <div className="wb-tappable" style={{
      position: 'relative',
      background: 'rgba(20,26,46,0.6)',
      border: `1px solid ${isFavourite ? 'rgba(251,191,36,0.32)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 12,
      transition: 'transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
      overflow: 'visible',
    }}>
      <Link
        href={url}
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          textDecoration: 'none', color: 'inherit',
          padding: '14px 16px',
          paddingRight: 16 + starGutter,
          borderRadius: 12,
        }}
        onMouseOver={e => {
          const card = e.currentTarget.parentElement!;
          card.style.transform = 'translateY(-1px)';
          card.style.borderColor = 'rgba(99,102,241,0.4)';
          card.style.background = 'rgba(26,33,54,0.85)';
          card.style.boxShadow = '0 10px 30px rgba(99,102,241,0.15)';
        }}
        onMouseOut={e => {
          const card = e.currentTarget.parentElement!;
          card.style.transform = 'none';
          card.style.borderColor = 'rgba(255,255,255,0.06)';
          card.style.background = 'rgba(20,26,46,0.6)';
          card.style.boxShadow = 'none';
        }}
      >
        {/* Icon on the left — matches the dashboard's alert-card pattern. */}
        <BoardIcon department={b.department} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Department isn't shown here — boards are already grouped
              under the section header above the card, so repeating the
              dept name on every card was redundant noise. The space is
              given to the name, which is now allowed to wrap to two
              lines + bumped a couple of points so it reads cleanly
              from across the room. */}
          <div style={{
            fontSize: 15, fontWeight: 700, color: '#f1f5f9',
            lineHeight: 1.25,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            // Hyphenate is a no-op on most board names but kicks in
            // gracefully if someone names one "Cancellation Refund Audit"
            // and the second word would otherwise spill.
            wordBreak: 'break-word',
          }}>
            {b.name}
          </div>
        </div>

        <span aria-hidden style={{
          fontSize: 16, color: '#64748b', flexShrink: 0,
          fontWeight: 600, transition: 'color 0.15s ease, transform 0.15s ease',
        }}>→</span>
      </Link>

      {/* Favourite toggle — always visible, top-right corner. Sits above
          the Link so a click doesn't trigger navigation. */}
      <button
        onClick={e => { e.stopPropagation(); e.preventDefault(); onToggleFavourite(); }}
        aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
        title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
        style={{
          position: 'absolute', top: 8, right: 8,
          width: 28, height: 28, borderRadius: 8,
          background: isFavourite ? 'rgba(251,191,36,0.18)' : 'rgba(0,0,0,0.25)',
          border: `1px solid ${isFavourite ? 'rgba(251,191,36,0.55)' : 'rgba(255,255,255,0.08)'}`,
          color: isFavourite ? '#fbbf24' : '#64748b',
          cursor: 'pointer', fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1, padding: 0,
          transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24"
          fill={isFavourite ? 'currentColor' : 'none'}
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>

      {/* Admin overflow — hidden on synthetic boards (their config lives
          in lib/showcaseBoards.ts, not the DB, so move/delete here would
          500 on the API. Edit the catalogue file instead). */}
      {isAdmin && !b.synthetic && (
        <>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
            aria-label="Board actions"
            style={{
              // Sits to the left of the favourite star so both are
              // reachable without overlap.
              position: 'absolute', top: 8, right: 44,
              width: 28, height: 28, borderRadius: 8,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#94a3b8', fontSize: 14, fontWeight: 800,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
            }}
          >⋯</button>
          {menuOpen && (
            <AdminMenu
              currentDept={b.department}
              onClose={() => setMenuOpen(false)}
              onMove={dept => { setMenuOpen(false); onMove(dept); }}
              onAskDelete={() => { setMenuOpen(false); onAskDelete(); }}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Department-themed icon for the board card. Mirrors the dashboard's
 *  practice of giving each card a recognisable left-edge glyph. */
function BoardIcon({ department }: { department: string | null }) {
  const dept = department || 'Other';
  const tints: Record<string, { bg: string; border: string; emoji: string }> = {
    Sales:           { bg: 'rgba(168,85,247,0.18)', border: 'rgba(168,85,247,0.4)',  emoji: '📈' },
    Renewals:        { bg: 'rgba(56,189,248,0.18)', border: 'rgba(56,189,248,0.4)',  emoji: '🔁' },
    Operations:      { bg: 'rgba(16,185,129,0.18)', border: 'rgba(16,185,129,0.4)',  emoji: '⚙️' },
    'Internal Audit':{ bg: 'rgba(251,191,36,0.18)', border: 'rgba(251,191,36,0.4)',  emoji: '🛡️' },
    Beta:            { bg: 'rgba(251,191,36,0.18)', border: 'rgba(251,191,36,0.4)',  emoji: '🧪' },
    Kiosk:           { bg: 'rgba(99,102,241,0.18)', border: 'rgba(99,102,241,0.4)',  emoji: '📺' },
    Other:           { bg: 'rgba(148,163,184,0.18)',border: 'rgba(148,163,184,0.4)', emoji: '📊' },
  };
  const tint = tints[dept] || tints.Other;
  return (
    <div aria-hidden style={{
      width: 36, height: 36, borderRadius: 9,
      background: tint.bg, border: `1px solid ${tint.border}`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 16, flexShrink: 0,
    }}>
      {tint.emoji}
    </div>
  );
}

function AdminMenu({ currentDept, onClose, onMove, onAskDelete }: {
  currentDept: string | null;
  onClose: () => void;
  onMove: (dept: string | null) => void;
  onAskDelete: () => void;
}) {
  // Close on outside click — bind a one-shot listener after the menu mounts.
  useEffect(() => {
    const t = setTimeout(() => {
      const close = () => onClose();
      window.addEventListener('click', close, { once: true });
      return () => window.removeEventListener('click', close);
    }, 0);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: 40, right: 8, zIndex: 20,
        minWidth: 180, padding: 6, borderRadius: 10,
        background: 'rgba(14,20,39,0.98)',
        border: '1px solid rgba(99,102,241,0.35)',
        boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', letterSpacing: '0.12em', textTransform: 'uppercase', padding: '6px 8px 4px' }}>
        Move to
      </div>
      {DEPT_CHOICES.map(d => {
        const active = currentDept === d;
        return (
          <button key={d} disabled={active} onClick={() => onMove(d)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '6px 8px', borderRadius: 6,
              background: active ? 'rgba(99,102,241,0.2)' : 'transparent',
              border: 'none', cursor: active ? 'default' : 'pointer',
              color: active ? '#a5b4fc' : '#e2e8f0',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              opacity: active ? 0.7 : 1,
            }}
          >
            {d}{active && ' (current)'}
          </button>
        );
      })}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '6px 4px' }} />
      <button onClick={onAskDelete}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          padding: '6px 8px', borderRadius: 6,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#f87171', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
        }}
      >Delete board…</button>
    </div>
  );
}

function ConfirmDeleteModal({ board, onCancel, onConfirm }: {
  board: PublicBoard; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div
      role="dialog" aria-modal="true"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(4,6,14,0.7)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        maxWidth: 440, width: '100%',
        background: 'linear-gradient(180deg, rgba(26,33,54,0.98) 0%, rgba(14,20,39,0.98) 100%)',
        border: '1px solid rgba(248,113,113,0.4)',
        borderRadius: 14, padding: 22,
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#f1f5f9', marginBottom: 8 }}>
          Delete this board?
        </div>
        <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5, marginBottom: 18 }}>
          <strong style={{ color: '#f1f5f9' }}>{board.name}</strong> and all of its widgets will be removed permanently. Anyone watching this board on a TV will start seeing a 404 within minutes.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '8px 16px', borderRadius: 8,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#e2e8f0', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            padding: '8px 16px', borderRadius: 8,
            background: 'linear-gradient(135deg, #f87171 0%, #dc2626 100%)',
            border: '1px solid rgba(248,113,113,0.5)', color: '#fff',
            fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          }}>Delete board</button>
        </div>
      </div>
    </div>
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
