import { NextResponse } from 'next/server';
import { fetchZendesk } from '@/lib/zendesk';
import { isAuthenticatedFromRequest } from '@/lib/auth';

// GET /api/zendesk/options?field=tag|assignee|group|brand|status|priority
// Returns a list of { value, label } suitable for a filter autocomplete.
// Cached via fetchZendesk's internal 60s cache.

export async function GET(req: Request) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const field = searchParams.get('field') || '';

  try {
    switch (field) {
      case 'tag': {
        const data = await fetchZendesk('tags.json?page[size]=100');
        const tags = (data.tags || []) as Array<{ name: string; count?: number }>;
        const options = tags
          .map(t => ({ value: t.name, label: t.name, hint: t.count ? `${t.count}` : undefined }))
          .sort((a, b) => a.label.localeCompare(b.label));
        return NextResponse.json({ options });
      }
      case 'assignee': {
        const data  = await fetchZendesk('users.json?role[]=agent&role[]=admin&page[size]=100');
        const users = (data.users || []) as Array<{ id: number; name: string; email?: string }>;
        const options = users
          .map(u => ({ value: String(u.id), label: u.name, hint: u.email }))
          .sort((a, b) => a.label.localeCompare(b.label));
        return NextResponse.json({ options });
      }
      case 'group': {
        const data   = await fetchZendesk('groups.json');
        const groups = (data.groups || []) as Array<{ id: number; name: string }>;
        const options = groups
          .map(g => ({ value: String(g.id), label: g.name }))
          .sort((a, b) => a.label.localeCompare(b.label));
        return NextResponse.json({ options });
      }
      case 'brand': {
        const data   = await fetchZendesk('brands.json');
        const brands = (data.brands || []) as Array<{ id: number; name: string; active?: boolean }>;
        const options = brands
          .filter(b => b.active !== false)
          .map(b => ({ value: String(b.id), label: b.name }))
          .sort((a, b) => a.label.localeCompare(b.label));
        return NextResponse.json({ options });
      }
      case 'status':
        return NextResponse.json({ options: [
          { value: 'new',      label: 'New' },
          { value: 'open',     label: 'Open' },
          { value: 'pending',  label: 'Pending' },
          { value: 'hold',     label: 'On-hold' },
          { value: 'solved',   label: 'Solved' },
          { value: 'closed',   label: 'Closed' },
        ]});
      case 'priority':
        return NextResponse.json({ options: [
          { value: 'low',    label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high',   label: 'High' },
          { value: 'urgent', label: 'Urgent' },
        ]});
      default:
        return NextResponse.json({ options: [] });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message, options: [] }, { status: 500 });
  }
}
