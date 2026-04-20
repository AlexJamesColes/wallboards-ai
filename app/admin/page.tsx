import Link from 'next/link';
import { ensureDbReady, listBoards } from '@/lib/db';
import NewBoardButton from './NewBoardButton';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  await ensureDbReady();
  const boards = await listBoards();

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1c', fontFamily: 'var(--font-raleway, sans-serif)', paddingBottom: 60 }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'linear-gradient(180deg, rgba(10,15,28,0.92), rgba(10,15,28,0.6))', backdropFilter: 'blur(18px)', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 28 28" fill="none">
              <rect x="2" y="4" width="24" height="16" rx="2.5" stroke="#10b981" strokeWidth="1.8" fill="none" />
              <rect x="9.5" y="12" width="2.5" height="6" rx="0.5" fill="#10b981" opacity="0.8" />
              <rect x="13.5" y="9" width="2.5" height="9" rx="0.5" fill="#10b981" />
              <rect x="17.5" y="11" width="2.5" height="7" rx="0.5" fill="#10b981" opacity="0.8" />
            </svg>
          </div>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9' }}>Wallboards <span style={{ color: '#10b981' }}>Pro</span></span>
          <span style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#6ee7b7', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>Admin</span>
        </div>
        <a href="/api/logout" style={{ fontSize: 13, color: '#64748b' }}>Sign out</a>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 32px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 36 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px rgba(16,185,129,0.7)', display: 'inline-block' }} />
              Wallboards Pro
            </div>
            <h1 style={{ fontSize: 34, fontWeight: 800, color: '#f1f5f9', lineHeight: 1.1 }}>Your Boards</h1>
            <p style={{ color: '#64748b', marginTop: 8, fontSize: 14 }}>
              {boards.length} board{boards.length !== 1 ? 's' : ''} configured
            </p>
          </div>
          <NewBoardButton />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
          {boards.map((board) => (
            <div key={board.id} style={{ background: 'linear-gradient(180deg, rgba(20,26,42,0.78), rgba(15,20,32,0.65))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, backdropFilter: 'blur(18px)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>{board.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {board.widget_count} widget{board.widget_count !== 1 ? 's' : ''} · {board.cols}×{board.rows} grid
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Link href={`/view/${board.slug_token}`} target="_blank" style={{ flex: 1, textAlign: 'center', padding: '9px 0', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, color: '#6ee7b7', fontSize: 13, fontWeight: 600 }}>
                  View ↗
                </Link>
                <Link href={`/admin/boards/${board.id}/edit`} style={{ flex: 1, textAlign: 'center', padding: '9px 0', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#94a3b8', fontSize: 13, fontWeight: 600 }}>
                  Edit
                </Link>
              </div>
            </div>
          ))}
          {boards.length === 0 && (
            <div style={{ gridColumn: '1/-1', padding: '60px 0', textAlign: 'center', color: '#475569', fontSize: 14 }}>
              No boards yet. Hit "New Board" to create your first wallboard.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
