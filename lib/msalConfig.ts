/**
 * MSAL config — Microsoft SSO via the same Entra app registration as
 * the InsureTec Dashboard. Tenant + client ID come from public env
 * vars (they're not secret — public IDs identify our app to Microsoft;
 * Microsoft enforces who can sign in via the tenant's user list +
 * admin consent on the app reg).
 *
 * Redirect URI must be added to the Entra app reg by Ben — the URI
 * we pass here has to match one of the registered redirect URIs
 * exactly or the auth flow rejects with AADSTS50011.
 *
 * Stored in sessionStorage (per integration guide §1) so a tab close
 * signs the user out — no risk of a shared kiosk machine retaining
 * a refresh token across users.
 */

import type { Configuration } from '@azure/msal-browser';

/** Build the MSAL config at runtime from env vars. Must be called
 *  inside a client component or `useEffect` — `process.env` is
 *  evaluated at build time for `NEXT_PUBLIC_*` vars and inlined,
 *  but the redirect URI uses `window.location.origin` so it has to
 *  resolve in the browser. */
export function buildMsalConfig(): Configuration {
  const tenantId = process.env.NEXT_PUBLIC_AZURE_TENANT_ID;
  const clientId = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID;

  if (!tenantId || !clientId) {
    throw new Error(
      'NEXT_PUBLIC_AZURE_TENANT_ID and NEXT_PUBLIC_AZURE_CLIENT_ID must be set. ' +
      'See docs/CROSS_APP_INTEGRATION.md in the dashboard repo.',
    );
  }

  const redirectUri = typeof window !== 'undefined'
    ? `${window.location.origin}/auth/callback`
    : '';

  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri,
      // After sign-out, Microsoft redirects back to this URI. We then
      // hop to the dashboard's logout to clear that session too.
      postLogoutRedirectUri: redirectUri,
    },
    cache: {
      // sessionStorage = tab-scoped; closing the tab signs the user out
      // (kiosk-safe). localStorage would persist across tabs/browser
      // restarts, which is wrong for a shared-machine context.
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false,
    },
  };
}

/** OAuth scopes we request. `openid` + `profile` are needed for the
 *  id_token shape the dashboard's permissions endpoint expects. */
export const LOGIN_REQUEST = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
};
