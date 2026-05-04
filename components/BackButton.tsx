'use client';

/**
 * App-level back button — sits in the top-left of TopNav, only shown
 * when the user is on a non-home page. Item #9 from the mobile UX
 * overhaul.
 *
 * Why this exists: Capacitor's WKWebView doesn't enable iOS's swipe-
 * back gesture by default (it can be turned on via native code, but
 * that'd require an Xcode rebuild AND it'd only solve iOS). A real
 * button works on every platform, every viewport, and is more
 * discoverable for users coming from a web background.
 *
 * Behaviour:
 *   - On any page where pathname !== '/', the button shows.
 *   - Click → router.back() if there's history, else navigate to '/'.
 *   - Hidden on /, /login, /change-password (top-level pages with
 *     nowhere to go back to).
 */
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import styles from './topnav.module.css';

const HIDDEN_ON: string[] = ['/', '/login', '/change-password'];
// Mobile-only hidden routes: pages that are top-level tabs in the
// MobileTabBar (so the user can always get to them by tapping a
// tab, no back button needed) plus /ann which Ben classes as a
// top-level destination on mobile (the bell icon in the TopNav
// jumps you straight there full-page).
const HIDDEN_ON_MOBILE: string[] = ['/cal', '/rem', '/ann'];

export default function BackButton() {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const [hasHistory, setHasHistory] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect whether there's a history entry to go back to. Without
  // history (e.g. user opened a deep link directly) router.back() is
  // a no-op; we fall back to navigating to '/'.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setHasHistory(window.history.length > 1);
    const mql = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsMobile(mql.matches);
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [pathname]);

  if (HIDDEN_ON.includes(pathname)) return null;
  if (isMobile && HIDDEN_ON_MOBILE.includes(pathname)) return null;

  function go() {
    if (hasHistory) router.back();
    else router.push('/');
  }

  return (
    <button
      type="button"
      onClick={go}
      className={styles.backBtn}
      aria-label="Go back"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M10 3 L5 8 L10 13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
