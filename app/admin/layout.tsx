import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    if (!isAuthenticated()) redirect('/login');
  } catch (e: any) {
    // redirect() throws NEXT_REDIRECT internally — must re-throw it
    if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    // Anything else (e.g. cookies() unavailable) — safe fallback
    redirect('/login');
  }
  return <>{children}</>;
}
