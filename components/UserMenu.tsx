'use client';

/**
 * Top-right user chip with a dropdown menu — copied from the
 * dashboard's UserMenu per docs/CROSS_APP_INTEGRATION.md §3. Three
 * deviations from the verbatim copy, all called for by the spec:
 *
 *   1. `import type { User } from '@/lib/db'` → `from '@/lib/auth'`
 *      (local stand-in re-exports WbUser as `User`).
 *   2. Sign-out redirects to the dashboard's `/api/logout?return=/login`
 *      so the user signs out of both apps in one click. We also clear
 *      our MSAL sessionStorage cache by calling instance.logoutRedirect.
 *   3. Settings / Users / Audit-log links point at the dashboard
 *      (single source of truth), not at any local route.
 *
 * The visual structure (CSS module, markup) is byte-identical so
 * the menu reads pixel-perfect alongside the dashboard's.
 */

import { useEffect, useRef, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import type { User } from '@/lib/auth';
import { clearPermissionsCache } from '@/lib/permissions';
import ThemeToggle from './ThemeToggle';
import styles from './usermenu.module.css';

type Props = { user: User };

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  user:  'User',
};

/** Dashboard URL — single source of truth for cross-app links
 *  (Settings, Manage Users, Audit log, sign-out). Pulled from env
 *  so dev / staging / prod each point at the right host. */
function dashboardUrl(): string {
  return process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://insuretec.ai';
}

export default function UserMenu({ user }: Props) {
  const { instance } = useMsal();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  async function signOut() {
    // Clear any cached permissions so a re-sign-in fetches fresh.
    clearPermissionsCache();
    // MSAL's logoutRedirect bounces through Microsoft to clear the
    // tenant-side session, then returns to postLogoutRedirectUri (set
    // in msalConfig). We then forward to the dashboard's logout so
    // the dashboard session also clears in the same click.
    try {
      await instance.logoutRedirect({
        postLogoutRedirectUri: `${dashboardUrl()}/api/logout?return=/login`,
      });
    } catch {
      // Fallback: force-redirect to the dashboard logout even if MSAL
      // logout failed locally — the dashboard will clear its own
      // session and we accept the wallboards MSAL cache will get
      // reaped on the next tab close (sessionStorage).
      window.location.href = `${dashboardUrl()}/api/logout?return=/login`;
    }
  }

  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const displayName = user.name || user.email;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.chip} ${open ? styles.chipOpen : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={styles.avatar} aria-hidden>{user.avatar || '👤'}</span>
        <span className={styles.name}>{displayName}</span>
        <svg className={styles.caret} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 4.5 L6 7.5 L9 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.menuHeader}>
            <span className={styles.menuAvatar} aria-hidden>{user.avatar || '👤'}</span>
            <div className={styles.menuIdent}>
              <div className={styles.menuName}>{displayName}</div>
              <div className={styles.menuMeta}>{user.email}</div>
              <div className={styles.menuRole}>{roleLabel}</div>
            </div>
          </div>
          <div className={styles.menuDivider} />
          {/* Settings — points at the dashboard's /account, single source
           *  of truth for password, avatar, theme, etc. */}
          <a href={`${dashboardUrl()}/account`} className={styles.menuItem} role="menuitem">
            <svg className={styles.menuIcon} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
            Settings
          </a>
          {user.role === 'admin' && (
            <>
              <div className={styles.menuDivider} />
              {/* Per the integration guide §3.c: Manage users always
               *  points at the dashboard's /admin, NEVER a local one.
               *  Wallboards never builds its own permissions UI. */}
              <a href={`${dashboardUrl()}/admin`} className={styles.menuItem} role="menuitem">
                <svg className={styles.menuIcon} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zm8 0a3 3 0 11-6 0 3 3 0 016 0zm-4.07 11c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                </svg>
                Users
              </a>
              <a href={`${dashboardUrl()}/audit-log`} className={styles.menuItem} role="menuitem">
                <svg className={styles.menuIcon} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                </svg>
                Audit log
              </a>
            </>
          )}
          <div className={styles.menuDivider} />
          <ThemeToggle />
          <div className={styles.menuDivider} />
          <button type="button" className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={signOut} role="menuitem">
            <svg className={styles.menuIcon} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h5a1 1 0 100-2H4V5h4a1 1 0 100-2H3zm10.293 3.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L14.586 11H7a1 1 0 110-2h7.586l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
