const cache = new Map<string, { data: any; expires: number }>();

export function isZendeskConfigured(): boolean {
  return !!process.env.WB_ZENDESK_SUBDOMAIN;
}

export async function fetchZendesk(path: string): Promise<any> {
  const sub   = process.env.WB_ZENDESK_SUBDOMAIN!;
  const email = process.env.WB_ZENDESK_EMAIL!;
  const token = process.env.WB_ZENDESK_API_TOKEN!;
  const url   = `https://${sub}.zendesk.com/api/v2/${path.replace(/^\//, '')}`;

  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.data;

  const auth = Buffer.from(`${email}/token:${token}`).toString('base64');
  const res  = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`Zendesk ${res.status}: ${await res.text()}`);
  const data = await res.json();
  cache.set(url, { data, expires: Date.now() + 60_000 });
  return data;
}

// ── Metric mode ──────────────────────────────────────────────────────────────

export const ZD_METRICS: Record<string, { label: string; baseQuery: string; timeField: 'created' | 'solved' | 'updated' }> = {
  created_tickets:  { label: 'Created tickets',   baseQuery: 'type:ticket',               timeField: 'created' },
  solved_tickets:   { label: 'Solved tickets',    baseQuery: 'type:ticket status:solved',  timeField: 'solved'  },
  unsolved_tickets: { label: 'Unsolved tickets',  baseQuery: 'type:ticket status<solved',  timeField: 'created' },
  open_tickets:     { label: 'Open tickets',      baseQuery: 'type:ticket status:open',    timeField: 'created' },
  pending_tickets:  { label: 'Pending tickets',   baseQuery: 'type:ticket status:pending', timeField: 'created' },
  on_hold_tickets:  { label: 'On-hold tickets',   baseQuery: 'type:ticket status:hold',    timeField: 'created' },
  all_tickets:      { label: 'All tickets',       baseQuery: 'type:ticket',               timeField: 'created' },
};

export const ZD_TIMES: Record<string, string> = {
  today:       'Today',
  yesterday:   'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days:'Last 30 days',
  this_week:   'This week',
  this_month:  'This month',
  all_time:    'All time',
};

export const ZD_FILTER_FIELDS: Record<string, { label: string; zdKey: string }> = {
  tag:      { label: 'Tag',      zdKey: 'tags'      },
  assignee: { label: 'Assignee', zdKey: 'assignee'  },
  group:    { label: 'Group',    zdKey: 'group'     },
  brand:    { label: 'Brand',    zdKey: 'brand'     },
  status:   { label: 'Status',   zdKey: 'status'    },
  priority: { label: 'Priority', zdKey: 'priority'  },
  requester:{ label: 'Requester',zdKey: 'requester' },
  subject:  { label: 'Subject',  zdKey: 'subject'   },
};

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function buildTimeQuery(timeField: string, time: string): string {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Zendesk search `>` is strictly-after on dates, so "tickets created today"
  // needs `created>=today` (or equivalently `created>yesterday`). We use `>=`.
  switch (time) {
    case 'today':
      return `${timeField}>=${toDateStr(today)}`;
    case 'yesterday': {
      const yd = new Date(today);
      yd.setDate(yd.getDate() - 1);
      return `${timeField}>=${toDateStr(yd)} ${timeField}<${toDateStr(today)}`;
    }
    case 'last_7_days': {
      const d = new Date(today);
      d.setDate(d.getDate() - 6); // last 7 days inclusive of today
      return `${timeField}>=${toDateStr(d)}`;
    }
    case 'last_30_days': {
      const d = new Date(today);
      d.setDate(d.getDate() - 29);
      return `${timeField}>=${toDateStr(d)}`;
    }
    case 'this_week': {
      const d = new Date(today);
      const day = d.getDay();
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // back to Monday
      return `${timeField}>=${toDateStr(d)}`;
    }
    case 'this_month': {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      return `${timeField}>=${toDateStr(d)}`;
    }
    default:
      return '';
  }
}

function buildZdFilterQuery(filters: Array<{ field: string; value: string }>): string {
  return (filters || [])
    .filter(f => f.field && f.value)
    .map(f => {
      const zdKey = ZD_FILTER_FIELDS[f.field]?.zdKey || f.field;
      return `${zdKey}:${f.value}`;
    })
    .join(' ');
}

/** Columns to extract from Zendesk ticket search results */
const TICKET_COLUMNS = ['id', 'subject', 'status', 'priority', 'assignee_id', 'group_id', 'created_at', 'updated_at', 'tags'];

export async function fetchZendeskMetric(config: {
  metric?:     string;
  time?:       string;
  zd_filters?: Array<{ field: string; value: string }>;
}): Promise<{ count: number; rows: any[]; columns: string[] }> {
  const def = ZD_METRICS[config.metric || 'created_tickets'] || ZD_METRICS.created_tickets;

  const parts: string[] = [def.baseQuery];

  const timeQuery = buildTimeQuery(def.timeField, config.time || 'all_time');
  if (timeQuery) parts.push(timeQuery);

  const filterQuery = buildZdFilterQuery(config.zd_filters || []);
  if (filterQuery) parts.push(filterQuery);

  const query = parts.join(' ');
  const data  = await fetchZendesk(`search.json?query=${encodeURIComponent(query)}&per_page=100`);

  const rawRows: any[] = data.results || [];
  const count: number  = data.count   ?? rawRows.length;

  const rows = rawRows.map(t => ({
    id:          t.id,
    subject:     t.subject   || '',
    status:      t.status    || '',
    priority:    t.priority  || '',
    assignee_id: t.assignee_id ?? '',
    group_id:    t.group_id    ?? '',
    created_at:  t.created_at  ? new Date(t.created_at).toLocaleDateString('en-GB') : '',
    updated_at:  t.updated_at  ? new Date(t.updated_at).toLocaleDateString('en-GB') : '',
    tags:        Array.isArray(t.tags) ? t.tags.join(', ') : '',
  }));

  const columns = TICKET_COLUMNS;
  return { count, rows, columns };
}
