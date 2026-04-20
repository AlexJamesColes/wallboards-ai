import { notFound } from 'next/navigation';
import { ensureDbReady, getBoardByToken } from '@/lib/db';
import KioskView from './KioskView';

export const dynamic = 'force-dynamic';

export default async function KioskPage({ params }: { params: { token: string } }) {
  await ensureDbReady();
  const board = await getBoardByToken(params.token);
  if (!board) notFound();
  return <KioskView board={board} />;
}
