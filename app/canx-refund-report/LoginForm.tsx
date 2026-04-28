'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Self-contained login form rendered when the report cookie is missing.
 * No separate /login route — the gate lives on the report page itself
 * to keep the surface area minimal. Posts to the report-scoped login
 * endpoint which sets the cookie and redirects back here.
 */
export default function LoginForm({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/reports/canx-refund/login', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ password }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || 'Incorrect password');
      }
    } catch {
      setError('Network error — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', width: '100vw',
      background: 'radial-gradient(ellipse at 20% 0%, #1a1f3a 0%, #0a0f1c 60%, #050813 100%)',
      color: '#f1f5f9', fontFamily: 'var(--font-raleway, sans-serif)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 380,
        background: 'linear-gradient(180deg, rgba(26,33,54,0.85) 0%, rgba(14,20,39,0.85) 100%)',
        border: '1px solid rgba(251,191,36,0.32)',
        borderRadius: 18, padding: '32px 30px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.4), 0 0 30px rgba(251,191,36,0.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'rgba(251,191,36,0.16)',
            border: '1px solid rgba(251,191,36,0.4)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>🔒</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#fbbf24', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
              Internal Audit
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#f1f5f9', marginTop: 2 }}>
              Cancellation Refund Report
            </div>
          </div>
        </div>

        <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 18, lineHeight: 1.5 }}>
          {disabled
            ? 'This report is currently unavailable — the server hasn\'t been configured with an access key yet.'
            : 'Enter the access key to view the report.'}
        </p>

        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{
              fontSize: 12, color: '#fecaca',
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.4)',
              borderRadius: 8, padding: '8px 12px', marginBottom: 12,
            }}>{error}</div>
          )}
          <label htmlFor="password" style={{
            display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8',
            letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6,
          }}>Access key</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={disabled}
            autoFocus
            autoComplete="current-password"
            placeholder="••••••••"
            style={{
              width: '100%', padding: '10px 12px',
              background: 'rgba(15,22,49,0.7)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10, color: '#f1f5f9',
              fontSize: 14, fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={disabled || loading || !password}
            style={{
              width: '100%', marginTop: 16,
              padding: '11px 16px',
              borderRadius: 10, border: 'none',
              background: disabled || loading || !password
                ? 'rgba(148,163,184,0.16)'
                : 'linear-gradient(135deg, rgba(251,191,36,0.55) 0%, rgba(245,158,11,0.45) 100%)',
              color: disabled || loading || !password ? '#64748b' : '#0a0f1c',
              fontSize: 13, fontWeight: 800, letterSpacing: '0.06em',
              cursor: disabled || loading || !password ? 'not-allowed' : 'pointer',
              boxShadow: disabled || loading || !password ? undefined : '0 6px 24px rgba(251,191,36,0.28)',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
