import { NextResponse } from 'next/server';
import { ensureDbReady, getWidget, getDatasetData, listDatasets } from '@/lib/db';
import { runQuery } from '@/lib/mssql';
import { fetchZendesk, fetchZendeskMetric, fetchZendeskDailyCounts, groupTickets } from '@/lib/zendesk';
import { finalisePayload } from '@/lib/dataProcessor';

// No auth — called by the public kiosk view at /view/:token

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await ensureDbReady();
    const widget = await getWidget(params.id);
    if (!widget) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data_source_type, data_source_config, display_config, type } = widget;
    const dcfg = display_config as any;

    // ── SQL ──────────────────────────────────────────────────────────────────
    if (data_source_type === 'sql') {
      const query = (data_source_config as any)?.query;
      if (!query) return NextResponse.json({ columns: [], rows: [], value: null });
      const result = await runQuery(query);
      return NextResponse.json(finalisePayload(result.rows, result.columns, dcfg, type));
    }

    // ── Dataset (Noetica push) ────────────────────────────────────────────────
    if (data_source_type === 'dataset') {
      const datasetName = (data_source_config as any)?.dataset;
      if (!datasetName) return NextResponse.json({ columns: [], rows: [] });
      const datasets = await listDatasets();
      const ds = datasets.find(d => d.name === datasetName);
      if (!ds) return NextResponse.json({ columns: [], rows: [] });
      const dataRow = await getDatasetData(ds.id);
      const rows: any[] = dataRow?.data || [];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return NextResponse.json(finalisePayload(rows, columns, dcfg, type));
    }

    // ── Zendesk ───────────────────────────────────────────────────────────────
    if (data_source_type === 'zendesk') {
      const dsc = data_source_config as any;

      // Raw mode: only when explicitly chosen AND a path is given
      if (dsc?.mode === 'raw' && dsc?.path) {
        const data  = await fetchZendesk(dsc.path);
        const key   = dsc?.key || Object.keys(data).find((k: string) => Array.isArray(data[k]));
        const rows: any[] = key ? data[key] : [data];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return NextResponse.json(finalisePayload(rows, columns, dcfg, type));
      }

      const isChart       = type === 'line' || type === 'bar' || type === 'hbar';
      const isLeaderboard = type === 'leaderboard';
      const groupBy       = dsc?.group_by as string | undefined;

      const commonCfg = {
        metric:     dsc?.metric     || 'created_tickets',
        time:       dsc?.time       || 'today',
        zd_filters: dsc?.zd_filters || [],
      };

      // Charts: per-day count queries — accurate at any volume, avoids
      // Zendesk's 1000-result search cap that would silently drop older days.
      if (isChart) {
        const series = await fetchZendeskDailyCounts(commonCfg);
        const chartCfg = { ...dcfg, x_key: dcfg?.x_key || 'date', y_key: dcfg?.y_key || 'count' };
        return NextResponse.json(finalisePayload(series, ['date', 'count'], chartCfg, type));
      }

      // Leaderboards and tables need ticket rows (with user/group/etc names)
      const result = await fetchZendeskMetric({
        ...commonCfg,
        maxPages: isLeaderboard ? 5 : 1,
        sideload: isLeaderboard,
      });

      if (type === 'number' && !dcfg?.count_rows && !dcfg?.value_key) {
        return NextResponse.json(finalisePayload([{ count: result.count }], ['count'], { ...dcfg, value_key: 'count' }, type));
      }

      if (isLeaderboard && groupBy) {
        const limit  = Number(dcfg?.limit || 25);
        const bucket = groupTickets(result.rows, { users: result.users, groups: result.groups, brands: result.brands, orgs: result.orgs }, groupBy, limit);
        return NextResponse.json({ columns: ['label', 'count'], rows: bucket });
      }

      return NextResponse.json(finalisePayload(result.rows, result.columns, dcfg, type));
    }

    return NextResponse.json({ columns: [], rows: [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
