'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewBoardButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');

  async function create() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Board' }),
      });
      const data = await res.json();
      if (data.board?.id) {
        router.push(`/admin/boards/${data.board.id}/edit`);
      } else {
        setError(`API error ${res.status}: ${JSON.stringify(data)}`);
      }
    } catch (e: any) {
      setError(`Fetch failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      <button onClick={create} disabled={loading} style={{ padding: '12px 22px', background: loading ? 'rgba(16,185,129,0.4)' : 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
        {loading ? 'Creating…' : '+ New Board'}
      </button>
      {error && <div style={{ fontSize: 12, color: '#f87171', maxWidth: 400, textAlign: 'right' }}>{error}</div>}
    </div>
  );
}
