import { redirect } from 'next/navigation';
import { ensureDbReady, getBoard, listDatasets } from '@/lib/db';
import BoardEditor from './BoardEditor';

export const dynamic = 'force-dynamic';

export default async function EditBoardPage({ params }: { params: { id: string } }) {
  await ensureDbReady();
  const board = await getBoard(params.id);
  if (!board) redirect('/admin');
  const datasets = await listDatasets();
  return <BoardEditor board={board} datasets={datasets} />;
}
