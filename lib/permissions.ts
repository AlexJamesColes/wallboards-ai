/**
 * Permissions client — calls the InsureTec dashboard's
 * /api/auth/permissions endpoint with the user's Microsoft id_token,
 * returns the user record + the level they hold in the `wb` app.
 *
 * Single source of truth for "who can see what" lives in the
 * dashboard. Wallboards never builds its own permissions UI; we just
 * read this endpoint and gate the UI accordingly.
 *
 * Caching: the endpoint sets `Cache-Control: private, max-age=60`,
 * but we also cache in-memory across hook calls to dedupe within a
 * single page nav. Browser cache handles cross-route persistence.
 *
 * Reference:
 *   docs/CROSS_APP_INTEGRATION.md in the dashboard repo (sections 1-2)
 *   app/api/auth/permissions/route.ts in the dashboard repo (response shape)
 */

/** Mirrors the dashboard's permissions endpoint response shape.
 *  Backwards-compat note from the dashboard side: this endpoint will
 *  only ever ADD fields, never rename or remove. So we can pin to
 *  this shape and trust it. */
export interface PermissionsResponse {
  user: {
    id:           string;             // dashboard's internal UUID — stable forever
    sub:          string | null;      // Microsoft subject — what we key on (null for legacy local-auth users)
    email:        string;
    name:         string;
    avatar:       string | null;      // emoji
    department:   string | null;
    employee_id:  string | null;
    is_active:    boolean;
    is_admin:     boolean;            // system-level admin (manage users + treated as admin in every app)
  };
  apps: Array<{
    key:       string;
    level:     string;
    metadata?: Record<string, unknown>;
  }>;
}

/** What a wallboards-rendered user looks like once we've reduced the
 *  dashboard's response to the bits this app actually consumes.
 *  Mirrors the User shape the shared TopNav expects (per the
 *  integration guide §3.a). */
export interface WbUser {
  id:          string;
  sub:         string | null;
  email:       string;
  name:        string;
  avatar:      string | null;
  department:  string | null;
  /** Translated from the dashboard's `is_admin` boolean: true → 'admin',
   *  false → 'user'. Drives TopNav's admin-only items. */
  role:        'admin' | 'user';
  /** Effective wallboards level — `'admin'`, `'viewer'`, or `null`
   *  when the user has no `wb` access at all. `is_admin: true` on the
   *  dashboard short-circuits to `'admin'` here, mirroring the
   *  dashboard's `getPermissionLevel` logic. */
  wbLevel:     'admin' | 'viewer' | null;
  /** Convenience flag — `wbLevel === 'admin'`. */
  isWbAdmin:   boolean;
  /** All apps the user has access to. Surfaces things like a Calendar
   *  or Reminders link in TopNav if the dashboard wants to keep those
   *  visible cross-app. Empty array when the user only has wb access. */
  apps:        Array<{ key: string; level: string }>;
}

interface CacheEntry {
  user:      WbUser;
  expiresAt: number;
}

let cache: { token: string; entry: CacheEntry } | null = null;
const CACHE_TTL_MS = 60 * 1000;

/** Fetch the user's permissions from the dashboard. Caches in-memory
 *  for 60s keyed by the id_token (a different user logging in
 *  invalidates because the token changes). */
export async function fetchPermissions(idToken: string): Promise<WbUser> {
  // In-memory dedupe within a tab session. Browser cache (60s
  // Cache-Control) handles persistence across reloads.
  const now = Date.now();
  if (cache && cache.token === idToken && cache.entry.expiresAt > now) {
    return cache.entry.user;
  }

  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL;
  if (!dashboardUrl) {
    throw new Error(
      'NEXT_PUBLIC_DASHBOARD_URL must be set. See docs/CROSS_APP_INTEGRATION.md.',
    );
  }

  const res = await fetch(`${dashboardUrl}/api/auth/permissions`, {
    method:  'GET',
    headers: { Authorization: `Bearer ${idToken}` },
    // We're explicitly cross-origin; CORS allow-list on the
    // dashboard's CROSS_APP_ALLOWED_ORIGINS env var must include
    // our origin. Ben handles that; if missing, this fetch fails
    // with the browser's default CORS error.
    credentials: 'omit',
    cache: 'no-store',
  });

  if (res.status === 401) {
    throw new PermissionsError('unauthorised', 'id_token rejected — re-authenticate.');
  }
  if (res.status === 403) {
    throw new PermissionsError('inactive', 'Your InsureTec account is deactivated. Contact an admin.');
  }
  if (!res.ok) {
    throw new PermissionsError('http', `Permissions endpoint returned ${res.status}.`);
  }

  const body = (await res.json()) as PermissionsResponse;
  const user = mapUser(body);

  cache = {
    token: idToken,
    entry: { user, expiresAt: now + CACHE_TTL_MS },
  };
  return user;
}

/** Bust the cache (e.g. on sign-out, or when an admin grants the
 *  current user new permissions and we want them to take effect
 *  before the 60s TTL elapses). */
export function clearPermissionsCache(): void {
  cache = null;
}

/** Reduce the dashboard's response to the wallboards-relevant shape. */
function mapUser(body: PermissionsResponse): WbUser {
  const wb = body.apps.find(a => a.key === 'wb');
  // is_admin short-circuits to 'admin' regardless of explicit wb
  // permission row — mirrors dashboard's getPermissionLevel logic.
  const wbLevel: WbUser['wbLevel'] =
    body.user.is_admin            ? 'admin'
  : wb?.level === 'admin'         ? 'admin'
  : wb?.level === 'viewer'        ? 'viewer'
  :                                 null;

  return {
    id:         body.user.id,
    sub:        body.user.sub,
    email:      body.user.email,
    name:       body.user.name,
    avatar:     body.user.avatar,
    department: body.user.department,
    role:       body.user.is_admin ? 'admin' : 'user',
    wbLevel,
    isWbAdmin:  wbLevel === 'admin',
    apps:       body.apps.map(a => ({ key: a.key, level: a.level })),
  };
}

/** Specific error shape so the gate component can show the right
 *  message ("re-auth" vs. "deactivated" vs. "no access"). */
export class PermissionsError extends Error {
  constructor(public code: 'unauthorised' | 'inactive' | 'http' | 'no-access', message: string) {
    super(message);
    this.name = 'PermissionsError';
  }
}
