'use client';

import { useEffect, useRef, useState } from 'react';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { LOGIN_REQUEST } from './msalConfig';
import { fetchPermissions, PermissionsError, type WbUser } from './permissions';

/**
 * Combined SSO + permissions hook. Returns the resolved wallboards
 * user (with effective `wbLevel`), or one of three sentinel states:
 *
 *   - `state: 'loading'`  — MSAL initialising, or fetching permissions
 *   - `state: 'no-auth'`  — user is not signed in via MSAL yet (the
 *                           gate component triggers a login flow)
 *   - `state: 'no-access'` — signed in, but no `wb` app permission
 *                           and not a system admin → bounce to dashboard
 *   - `state: 'error'`     — anything else (network, 5xx, etc.)
 *   - `state: 'ready'`     — `user` populated, render the app
 *
 * Single hook surfaces all the moving pieces so callers don't have to
 * juggle three different sources of state.
 */

export type UserState =
  | { state: 'loading' }
  | { state: 'no-auth' }
  | { state: 'no-access'; user: WbUser }
  | { state: 'inactive' }
  | { state: 'error';     message: string }
  | { state: 'ready';     user: WbUser };

export function useUser(): UserState {
  const { instance, accounts } = useMsal();
  const isAuthed = useIsAuthenticated();
  const [result, setResult] = useState<UserState>({ state: 'loading' });

  // Avoid re-fetching permissions for the same id_token across
  // re-renders triggered by other state changes.
  const lastTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isAuthed || accounts.length === 0) {
        if (!cancelled) setResult({ state: 'no-auth' });
        return;
      }

      try {
        // Get a fresh id_token. MSAL's silent flow uses the cached
        // refresh token; falls back to interactive when the cache
        // expires (rare on a daily-use kiosk).
        const tokenRes = await instance.acquireTokenSilent({
          ...LOGIN_REQUEST,
          account: accounts[0],
        });

        const idToken = tokenRes.idToken;
        if (!idToken) {
          if (!cancelled) setResult({ state: 'error', message: 'No id_token from MSAL.' });
          return;
        }

        if (lastTokenRef.current === idToken && result.state === 'ready') {
          // Already resolved this token — short-circuit.
          return;
        }
        lastTokenRef.current = idToken;

        const user = await fetchPermissions(idToken);

        if (cancelled) return;

        if (user.wbLevel === null) {
          setResult({ state: 'no-access', user });
        } else {
          setResult({ state: 'ready', user });
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof PermissionsError && e.code === 'inactive') {
          setResult({ state: 'inactive' });
        } else if (e instanceof PermissionsError && e.code === 'unauthorised') {
          // id_token rejected — force re-auth
          setResult({ state: 'no-auth' });
        } else {
          const msg = e instanceof Error ? e.message : 'Unknown error';
          setResult({ state: 'error', message: msg });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [isAuthed, accounts, instance]); // eslint-disable-line react-hooks/exhaustive-deps

  return result;
}
