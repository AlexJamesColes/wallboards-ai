import { NextResponse } from 'next/server';
import { ensureDbReady, getWidget, getDatasetData, listDatasets } from '@/lib/db';
import { runQuery, isMssqlConfigured } from '@/lib/mssql';
import { fetchZendesk } from '@/lib/zendesk';

// No auth — called by the public kiosk view
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await ensureDbReady();
    const widget = await getWidget(params.id);
    if (!widget) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data_source_type, data_source_config, display_config, type } = widget;

    if (data_source_type === 'sql') {
      const query = (data_source_config as any)?.query;
      if (!query) return NextResponse.json({ columns: [], rows: [], value: null });
      const result = await runQuery(query);
      if (type === 'number' && result.rows.length > 0) {
        const firstCol = result.columns[0];
        const value = result.rows[0][firstCol];
        return NextResponse.json({ value: Number(value) || 0, columns: result.columns, rows: result.rows });
      }
      return NextResponse.json(result);
    }

    if (data_source_type === 'dataset') {
      const datasetName = (data_source_config as any)?.dataset;
      if (!datasetName) return NextResponse.json({ columns: [], rows: [] });
      const datasets = await listDatasets();
      const ds = datasets.find(d => d.name === datasetName);
      if (!ds) return NextResponse.json({ columns: [], rows: [] });
      const dataRow = await getDatasetData(ds.id);
      const rows: any[] = dataRow?.data || [];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      if (type === 'number' && rows.length > 0) {
        const valueKey = (display_config as any)?.value_key || columns[0];
        return NextResponse.json({ value: Number(rows[0][valueKey]) || 0, columns, rows });
      }
      return NextResponse.json({ columns, rows });
    }

    if (data_source_type === 'zendesk') {
      const path = (data_source_config as any)?.path;
      if (!path) return NextResponse.json({ columns: [], rows: [] });
      const data = await fetchZendesk(path);
      const key = (data_source_config as any)?.key || Object.keys(data).find(k => Array.isArray(data[k]));
      const rows: any[] = key ? data[key] : [data];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      if (type === 'number' && rows.length > 0) {
        const valueKey = (display_config as any)?.value_key || columns[0];
        return NextResponse.json({ value: Number(rows[0][valueKey]) || 0, columns, rows });
      }
      return NextResponse.json({ columns, rows });
    }

    return NextResponse.json({ columns: [], rows: [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
