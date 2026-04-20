'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewBoardButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function create() {
    setLoading(true);
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Board' }),
      });
      const data = await res.json();
      if (data.board?.id) router.push(`/admin/boards/${data.board.id}/edit`);
      else router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={create} disabled={loading} style={{ padding: '12px 22px', background: loading ? 'rgba(16,185,129,0.4)' : 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
      {loading ? 'Creating…' : '+ New Board'}
    </button>
  );
}
