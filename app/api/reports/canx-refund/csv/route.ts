import { NextResponse } from 'next/server';
import { isReportAuthenticatedFromRequest } from '@/lib/reportAuth';
import { isZendeskConfigured } from '@/lib/zendesk';
import { buildCanxRefundReport, reportToCsv, csvFilename } from '@/lib/canxRefund';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isReportAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: 'Zendesk is not configured' }, { status: 503 });
  }
  try {
    const report = await buildCanxRefundReport();
    const csv = reportToCsv(report);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFilename()}"`,
        'Cache-Control':       'no-store',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to build CSV' }, { status: 500 });
  }
}
