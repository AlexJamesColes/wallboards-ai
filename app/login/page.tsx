'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './login.module.css';

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
    <div className={styles.body}>
      <div className={styles.bgWrap} aria-hidden>
        <div className={styles.bgGrid} />
        <div className={`${styles.bgOrb} ${styles.bgOrb1}`} />
        <div className={`${styles.bgOrb} ${styles.bgOrb2}`} />
        <div className={`${styles.bgOrb} ${styles.bgOrb3}`} />
        <div className={`${styles.bgOrb} ${styles.bgOrb4}`} />
      </div>

      <div className={styles.container}>
        <div className={styles.card}>

          {/* Logo */}
          <div className={styles.logo}>
            <svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden>
              <defs>
                <linearGradient id="shield-fill" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#93c5fd" />
                  <stop offset="100%" stopColor="#3b82f6" />
                </linearGradient>
              </defs>
              <path d="M14 3 L24 7 V14 C24 19.5 19.5 24 14 25 C8.5 24 4 19.5 4 14 V7 Z"
                stroke="url(#shield-fill)" strokeWidth="1.6" fill="rgba(59,130,246,0.12)"
                strokeLinejoin="round" />
              <rect x="8" y="11" width="3" height="8" rx="1" fill="url(#shield-fill)" opacity="0.7" />
              <rect x="12.5" y="8" width="3" height="11" rx="1" fill="url(#shield-fill)" opacity="0.9" />
              <rect x="17" y="13" width="3" height="6" rx="1" fill="url(#shield-fill)" opacity="0.7" />
            </svg>
            <div className={styles.logoText}>
              <div className={styles.brand}>Insure<span>Tec</span></div>
              <div className={styles.sub}>Wallboards Pro</div>
            </div>
          </div>

          {/* Eyebrow pill */}
          <div className={styles.eyebrowWrap}>
            <div className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              Admin login
            </div>
          </div>

          <h1 className={styles.h1}>Welcome back</h1>
          <p className={styles.subtitle}>Enter your admin password to continue</p>

          <form onSubmit={handleSubmit}>
            {error && <div className={styles.errorMsg}>{error}</div>}
            <div className={styles.formGroup}>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter admin password"
                autoFocus
              />
            </div>
            <button type="submit" className={styles.btn} disabled={loading || !password}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className={styles.footerText}>InsureTec Solutions · Wallboards Pro</p>
        </div>
      </div>
    </div>
  );
}
