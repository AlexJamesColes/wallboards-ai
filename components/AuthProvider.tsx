'use client';

import { useMemo } from 'react';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication, EventType, type AccountInfo } from '@azure/msal-browser';
import { buildMsalConfig } from '@/lib/msalConfig';

/**
 * Wraps the app in MSAL's React provider so child components can use
 * `useMsal` / `useIsAuthenticated` to drive the SSO flow.
 *
 * Built once per session via useMemo — `PublicClientApplication`
 * holds internal state (account cache, token cache) that should
 * NOT be re-created on every render. The instance is stored in
 * sessionStorage per the MSAL config so a tab close signs the user
 * out (kiosk-safe).
 *
 * On mount we register a single auth-event listener that adopts the
 * first account MSAL sees as the active account. Without this, calls
 * like `acquireTokenSilent` have no idea which account to use even
 * though one is signed in. Microsoft's own samples do this.
 */

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const msalInstance = useMemo(() => {
    if (typeof window === 'undefined') {
      // SSR pass — return a placeholder that will never be used. The
      // real instance gets built on the client. This branch keeps
      // useMemo type-correct without crashing on the server.
      return null as any;
    }
    const instance = new PublicClientApplication(buildMsalConfig());

    // Keep the active account in sync — handles the case where the
    // user signs in via a popup / redirect and we need to mark that
    // account as active for subsequent silent token acquisitions.
    instance.addEventCallback(event => {
      if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
        const account = (event.payload as { account?: AccountInfo }).account;
        if (account) instance.setActiveAccount(account);
      }
    });
    // First-load case: a previous session still has an active account
    // in the cache — adopt it so useIsAuthenticated returns true.
    const accounts = instance.getAllAccounts();
    if (accounts.length > 0 && !instance.getActiveAccount()) {
      instance.setActiveAccount(accounts[0]);
    }

    return instance;
  }, []);

  // SSR: render children without the provider. The MSAL hooks return
  // safe defaults (no accounts, not authenticated) under that path,
  // so the gate will show the loading state and re-evaluate on
  // hydration.
  if (!msalInstance) return <>{children}</>;

  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}
