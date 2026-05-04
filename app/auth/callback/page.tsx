'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMsal } from '@azure/msal-react';

/**
 * MSAL redirect callback.
 *
 * After Microsoft redirects the user back to /auth/callback?code=…,
 * MSAL's `handleRedirectPromise` exchanges the code for tokens and
 * stores them in sessionStorage. We then forward the user back to
 * wherever they were before sign-in (preserved via `?returnTo=…` if
 * the gate set it, otherwise the home page).
 *
 * Renders a brief "Signing in…" state — the redirect handler usually
 * resolves in <500ms.
 */

export default function AuthCallbackPage() {
  const { instance } = useMsal();
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    instance.handleRedirectPromise()
      .then(() => {
        if (cancelled) return;
        const returnTo = params?.get('returnTo') || '/';
        router.replace(returnTo);
      })
      .catch(err => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('MSAL redirect handler failed', err);
        router.replace('/?auth_error=1');
      });
    return () => { cancelled = true; };
  }, [instance, router, params]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-body)',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-raleway, sans-serif)',
      fontSize: 14, fontWeight: 600,
    }}>
      Signing you in…
    </div>
  );
}
