import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { isAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  if (!isAuthenticated(cookieStore)) redirect('/login');
  return <>{children}</>;
}
