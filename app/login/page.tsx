'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) router.push('/admin');
      else setError('Incorrect password');
    } catch {
      setError('Something went wrong — check your connection');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0f1c 0%, #0f172a 60%, #0a1628 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-raleway, sans-serif)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 16, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', marginBottom: 16 }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect x="2" y="4" width="24" height="16" rx="2.5" stroke="#10b981" strokeWidth="1.6" fill="rgba(16,185,129,0.1)" />
              <path d="M10 20 L9 25 M18 20 L19 25 M8 25 L20 25" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="5.5" y="15" width="2.5" height="3" rx="0.5" fill="#6ee7b7" opacity="0.6" />
              <rect x="9.5" y="12" width="2.5" height="6" rx="0.5" fill="#6ee7b7" opacity="0.8" />
              <rect x="13.5" y="9" width="2.5" height="9" rx="0.5" fill="#10b981" />
              <rect x="17.5" y="11" width="2.5" height="7" rx="0.5" fill="#6ee7b7" opacity="0.8" />
              <rect x="21.5" y="13" width="2.5" height="5" rx="0.5" fill="#6ee7b7" opacity="0.6" />
            </svg>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9', marginBottom: 6 }}>
            Wallboards <span style={{ color: '#10b981' }}>Pro</span>
          </h1>
          <p style={{ fontSize: 11, color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>Admin Access</p>
        </div>

        <form onSubmit={handleSubmit} style={{ background: 'rgba(20,26,42,0.8)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '32px 28px', backdropFilter: 'blur(18px)' }}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter admin password"
              autoFocus
              style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 14px', color: '#f1f5f9', fontSize: 14, outline: 'none', transition: 'border-color 0.15s' }}
              onFocus={e => (e.target.style.borderColor = 'rgba(16,185,129,0.5)')}
              onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            />
          </div>
          {error && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 16 }}>{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            style={{ width: '100%', background: loading ? 'rgba(16,185,129,0.4)' : 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: 10, padding: '13px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
