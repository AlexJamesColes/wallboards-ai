/**
 * Stub — the dashboard's CalendarMenu doesn't render in Wallboards.
 * `hasCalAccess` always returns false in lib/auth.ts so this is never
 * called; the file exists only so the imported-verbatim TopNav.tsx
 * can resolve `import CalendarMenu from './CalendarMenu'` at compile
 * time. If you ever want the calendar dropdown surfaced in Wallboards,
 * swap this for the real component and flip the stub in lib/auth.ts.
 */
type Props = { department: string; canCreate: boolean };
export default function CalendarMenu(_p: Props) { return null; }
