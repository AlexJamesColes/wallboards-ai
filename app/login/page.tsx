'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Raleway } from 'next/font/google';
import styles from './login.module.css';

const raleway = Raleway({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });

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
    <div className={`${styles.body} ${raleway.className}`}>
      <div className={styles.bgWrap} aria-hidden>
        <div className={styles.bgGrid} />
        <div className={`${styles.bgOrb} ${styles.bgOrb1}`} />
        <div className={`${styles.bgOrb} ${styles.bgOrb2}`} />
        <div className={`${styles.bgOrb} ${styles.bgOrb3}`} />
        <div className={`${styles.bgOrb} ${styles.bgOrb4}`} />
      </div>

      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.logo}>
            <svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden>
              <rect x="2" y="4" width="24" height="16" rx="2.5" stroke="#10b981" strokeWidth="1.6" fill="rgba(16,185,129,0.1)" />
              <path d="M10 20 L9 25 M18 20 L19 25 M8 25 L20 25" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="5.5" y="15" width="2.5" height="3" rx="0.5" fill="#6ee7b7" opacity="0.6" />
              <rect x="9.5" y="12" width="2.5" height="6" rx="0.5" fill="#6ee7b7" opacity="0.8" />
              <rect x="13.5" y="9" width="2.5" height="9" rx="0.5" fill="#10b981" />
              <rect x="17.5" y="11" width="2.5" height="7" rx="0.5" fill="#6ee7b7" opacity="0.8" />
              <rect x="21.5" y="13" width="2.5" height="5" rx="0.5" fill="#6ee7b7" opacity="0.6" />
            </svg>
            <div className={styles.logoText}>
              <div className={styles.brand}>Wallboards <span>Pro</span></div>
              <div className={styles.sub}>Admin Access</div>
            </div>
          </div>

          <div className={styles.eyebrowWrap}>
            <div className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              Secure login
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

          <p className={styles.footerText}>InsureTec · Wallboards Pro</p>
        </div>
      </div>
    </div>
  );
}
