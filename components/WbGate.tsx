'use client';

import { useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { usePathname } from 'next/navigation';
import { LOGIN_REQUEST } from '@/lib/msalConfig';
import { useUser } from '@/lib/useUser';
import TopNav from './TopNav';

/**
 * Authentication + permissions gate. Wraps every page (except the
 * MSAL redirect handler at /auth/callback) and:
 *
 *   - 'loading'   → renders a quiet "Loading…" panel while MSAL
 *                   initialises and the dashboard's permissions
 *                   endpoint resolves. Typically <500ms.
 *   - 'no-auth'   → calls instance.loginRedirect() to start the
 *                   Microsoft SSO flow. The browser hops to
 *                   login.microsoftonline.com, the user signs in,
 *                   Microsoft redirects to /auth/callback, MSAL
 *                   stores the tokens, then forwards back here.
 *   - 'no-access' → user is signed in but has no wb permission
 *                   (and isn't a system admin). Redirect to the
 *                   InsureTec dashboard — they probably have other
 *                   apps to do, just not this one.
 *   - 'inactive'  → account deactivated by an admin. Render a
 *                   polite explanation; no SSO retry helps until
 *                   an admin reactivates them.
 *   - 'error'     → upstream blew up (Heroku down, CORS misconfig,
 *                   id_token rejected by JWKS, etc.). Explain and
 *                   offer a retry.
 *   - 'ready'     → render TopNav + the children. The wb level
 *                   ('viewer' vs 'admin') is read elsewhere via
 *                   the same useUser hook to gate admin-only UI.
 *
 * The gate also skips itself for the MSAL callback route — that
 * page MUST render server-side without requiring auth (it's where
 * auth completes), so we let it through.
 */

const AUTH_BYPASS_PATHS = ['/auth/callback'];

export default function WbGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const isBypassed = AUTH_BYPASS_PATHS.some(p => pathname.startsWith(p));

  if (isBypassed) {
    return <>{children}</>;
  }

  return <Gated>{children}</Gated>;
}

function Gated({ children }: { children: React.ReactNode }) {
  const state = useUser();
  const { instance } = useMsal();

  // Trigger SSO redirect once we know the user isn't authed. Effect
  // (not render-time) so we don't cause a render-during-render
  // navigation issue.
  useEffect(() => {
    if (state.state !== 'no-auth') return;
    const returnTo = typeof window !== 'undefined'
      ? window.location.pathname + window.location.search
      : '/';
    instance.loginRedirect({
      ...LOGIN_REQUEST,
      // Stash the destination so /auth/callback can forward back.
      state: returnTo,
    }).catch(err => {
      // eslint-disable-next-line no-console
      console.error('MSAL loginRedirect failed', err);
    });
  }, [state.state, instance]);

  // No-access: bounce to the dashboard. Users land there with the
  // same SSO session, so they're not asked to sign in again.
  useEffect(() => {
    if (state.state !== 'no-access') return;
    const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://insuretec.ai';
    window.location.href = dashboardUrl;
  }, [state.state]);

  if (state.state === 'loading' || state.state === 'no-auth' || state.state === 'no-access') {
    return <FullPageMessage tone="info">Loading…</FullPageMessage>;
  }

  if (state.state === 'inactive') {
    return (
      <FullPageMessage tone="error" title="Account suspended">
        Your InsureTec account has been deactivated. Contact an admin to restore access.
      </FullPageMessage>
    );
  }

  if (state.state === 'error') {
    return (
      <FullPageMessage tone="error" title="Couldn't sign you in">
        {state.message}
        <br /><br />
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
            padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >Retry</button>
      </FullPageMessage>
    );
  }

  // 'ready' — user resolved with a wb level. Render TopNav above
  // the page content. Individual pages can use useUser() themselves
  // to gate admin-only UI within the page.
  return (
    <>
      <TopNav user={state.user} currentApp="wb" />
      {children}
    </>
  );
}

function FullPageMessage({ children, title, tone = 'info' }: {
  children: React.ReactNode;
  title?: string;
  tone?: 'info' | 'error';
}) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-body)',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-raleway, sans-serif)',
      padding: 24,
    }}>
      <div style={{
        maxWidth: 480, textAlign: 'center',
        padding: '24px 28px', borderRadius: 12,
        background: 'var(--bg-card)',
        border: `1px solid ${tone === 'error' ? 'rgba(248,113,113,0.4)' : 'var(--border-subtle)'}`,
        boxShadow: 'var(--shadow-card)',
      }}>
        {title && (
          <div style={{
            fontSize: 18, fontWeight: 800, color: 'var(--text-primary)',
            marginBottom: 10,
          }}>{title}</div>
        )}
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  );
}
