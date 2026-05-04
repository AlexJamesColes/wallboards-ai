'use client';

/**
 * Small pill-style theme toggle (moon icon for dark / sun for light).
 * Flips `<html class="light">`, persists to BOTH localStorage AND a
 * `theme` cookie (cookie lets the server render the right mode on
 * first paint — see app/layout.tsx for the SSR read + FOUC script).
 */

import { useEffect, useState } from 'react';
import styles from './theme-toggle.module.css';

type Theme = 'dark' | 'light';

function currentTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
  if (typeof window === 'undefined') return;
  if (theme === 'light') document.documentElement.classList.add('light');
  else document.documentElement.classList.remove('light');
  try { localStorage.setItem('theme', theme); } catch { /* storage blocked */ }
  // Fire-and-forget server persist — cookie gets set so SSR picks it up.
  fetch('/api/me/theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme }),
  }).catch(() => { /* non-critical — localStorage carries us */ });
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(currentTheme());
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    applyTheme(next);
  }

  // Render a skeleton with the same footprint during SSR/hydration so
  // the menu doesn't reflow when the button materialises.
  const label = theme === 'light' ? 'Switch to dark' : 'Switch to light';
  const isLight = mounted && theme === 'light';

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={toggle}
      role="menuitem"
      aria-label={label}
    >
      <span className={styles.iconSlot} aria-hidden>
        {isLight ? (
          /* Sun — currently in light mode, clicking goes dark */
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path d="M10 2a1 1 0 011 1v1.5a1 1 0 11-2 0V3a1 1 0 011-1zm4.95 2.636a1 1 0 011.414 0 1 1 0 010 1.414l-1.061 1.06a1 1 0 01-1.414-1.414l1.06-1.06zM17 9.5a1 1 0 010 2h-1.5a1 1 0 110-2H17zM15.303 13.94a1 1 0 011.414 1.414l-1.06 1.06a1 1 0 11-1.415-1.414l1.061-1.06zM10 15a1 1 0 011 1v1.5a1 1 0 11-2 0V16a1 1 0 011-1zm-5.303-1.06a1 1 0 011.414 1.414l-1.06 1.06a1 1 0 11-1.414-1.414l1.06-1.06zM4.5 9.5a1 1 0 010 2H3a1 1 0 110-2h1.5zM5.636 4.636a1 1 0 011.414 1.414l-1.06 1.06A1 1 0 014.575 5.696l1.06-1.06zM10 6a4 4 0 100 8 4 4 0 000-8z" />
          </svg>
        ) : (
          /* Moon — currently in dark mode, clicking goes light */
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        )}
      </span>
      <span className={styles.label}>
        {mounted ? (theme === 'light' ? 'Light' : 'Dark') : 'Theme'} mode
      </span>
      <span className={styles.hint}>{mounted ? (theme === 'light' ? 'On' : 'Off') : ''}</span>
    </button>
  );
}
