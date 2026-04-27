import DatasetTestBoard from './DatasetTestBoard';

export const dynamic = 'force-dynamic';

export default function Page({ params }: { params: { name: string } }) {
  return <DatasetTestBoard name={params.name} />;
}
