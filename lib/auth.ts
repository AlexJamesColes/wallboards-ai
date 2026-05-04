/**
 * Local stand-ins for the dashboard's auth helpers, so the copied-
 * verbatim TopNav/UserMenu compile without dragging in the
 * dashboard's full lib/auth.ts + lib/db.ts (which read a Sequelize
 * `permissions` array we don't have).
 *
 * The wallboards user is sourced from the dashboard's
 * /api/auth/permissions endpoint and reduced into a `WbUser` (see
 * lib/permissions.ts). We re-export that shape as `User` here so the
 * copied chrome's `import type { User } from '@/lib/db'` redirects
 * cleanly to `import type { User } from '@/lib/auth'` after the
 * one-line change the integration guide describes.
 *
 * Access stubs: hasCalAccess / hasAnnAccess / hasRemAccess /
 * isCalAdmin always return false. Wallboards never rendered those
 * dashboard menus, and we don't want them suddenly appearing for a
 * `wb:admin` user just because the dashboard's `getPermissionLevel`
 * short-circuits system admins to admin in every app.
 */

import type { WbUser } from './permissions';

/** What our copy of TopNav/UserMenu calls "User". Maps 1:1 onto WbUser. */
export type User = WbUser;

/** Stubs — wallboards doesn't render these dashboard-specific menus.
 *  Always returning false hides them in the TopNav regardless of the
 *  user's actual permissions in the dashboard. If we later want any
 *  of these to appear cross-app, swap the stub for a real check. */
export function hasCalAccess(_user: User | null | undefined): boolean { return false; }
export function hasAnnAccess(_user: User | null | undefined): boolean { return false; }
export function hasRemAccess(_user: User | null | undefined): boolean { return false; }
export function isCalAdmin(_user:  User | null | undefined): boolean { return false; }
