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

// ── Timeframe presets (matches Geckoboard's structure) ─────────────────────
export type ZdTimeGroup = 'rolling' | 'current' | 'previous' | 'custom';

export interface ZdTimePreset {
  value: string;
  label: string;
  group: ZdTimeGroup;
}

export const ZD_TIME_PRESETS: ZdTimePreset[] = [
  // Rolling (past N days up to today)
  { value: 'past_7_days',   label: 'Past 7 days',   group: 'rolling' },
  { value: 'past_14_days',  label: 'Past 14 days',  group: 'rolling' },
  { value: 'past_28_days',  label: 'Past 28 days',  group: 'rolling' },
  { value: 'past_30_days',  label: 'Past 30 days',  group: 'rolling' },
  { value: 'past_90_days',  label: 'Past 90 days',  group: 'rolling' },
  // Current (the calendar period we're in, up to today)
  { value: 'today',         label: 'Today',         group: 'current' },
  { value: 'this_week',     label: 'This week',     group: 'current' },
  { value: 'this_month',    label: 'This month',    group: 'current' },
  { value: 'this_quarter',  label: 'This quarter',  group: 'current' },
  { value: 'this_year',     label: 'This year',     group: 'current' },
  // Previous (the calendar period before this one)
  { value: 'yesterday',     label: 'Yesterday',     group: 'previous' },
  { value: 'last_week',     label: 'Last week',     group: 'previous' },
  { value: 'last_month',    label: 'Last month',    group: 'previous' },
  { value: 'last_quarter',  label: 'Last quarter',  group: 'previous' },
  { value: 'last_year',     label: 'Last year',     group: 'previous' },
];

// Flat label lookup (kept for backward compatibility, plus legacy keys)
export const ZD_TIMES: Record<string, string> = {
  ...Object.fromEntries(ZD_TIME_PRESETS.map(p => [p.value, p.label])),
  // Legacy keys used by existing widgets — map to new equivalents
  last_7_days:  'Past 7 days',
  last_30_days: 'Past 30 days',
  all_time:     'All time',
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

/**
 * Resolve a time preset (or a custom range like "custom:YYYY-MM-DD:YYYY-MM-DD")
 * into a concrete { start, end } date range. Returns null for "all_time" /
 * unknown values.
 */
export function getDateRange(time: string): { start: Date; end: Date } | null {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Custom range
  if (time.startsWith('custom:')) {
    const [, s, e] = time.split(':');
    const start = new Date(s);
    const end   = new Date(e);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    return { start, end };
  }

  switch (time) {
    case 'today':        return { start: today, end: today };
    case 'yesterday': {
      const d = new Date(today); d.setDate(d.getDate() - 1);
      return { start: d, end: d };
    }
    // Rolling (inclusive of today)
    case 'past_7_days':
    case 'last_7_days': { const d = new Date(today); d.setDate(d.getDate() - 6);  return { start: d, end: today }; }
    case 'past_14_days': { const d = new Date(today); d.setDate(d.getDate() - 13); return { start: d, end: today }; }
    case 'past_28_days': { const d = new Date(today); d.setDate(d.getDate() - 27); return { start: d, end: today }; }
    case 'past_30_days':
    case 'last_30_days': { const d = new Date(today); d.setDate(d.getDate() - 29); return { start: d, end: today }; }
    case 'past_90_days': { const d = new Date(today); d.setDate(d.getDate() - 89); return { start: d, end: today }; }
    // Current calendar period, up to today
    case 'this_week': {
      const d = new Date(today); const day = d.getDay();
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      return { start: d, end: today };
    }
    case 'this_month':   return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today };
    case 'this_quarter': {
      const q = Math.floor(today.getMonth() / 3);
      return { start: new Date(today.getFullYear(), q * 3, 1), end: today };
    }
    case 'this_year':    return { start: new Date(today.getFullYear(), 0, 1), end: today };
    // Previous calendar period (full range)
    case 'last_week': {
      const d = new Date(today); const day = d.getDay();
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1) - 7);      // previous Monday
      const e = new Date(d); e.setDate(e.getDate() + 6);           // previous Sunday
      return { start: d, end: e };
    }
    case 'last_month': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0); // last day of prev month
      return { start: s, end: e };
    }
    case 'last_quarter': {
      const q = Math.floor(today.getMonth() / 3);
      const s = new Date(today.getFullYear(), (q - 1) * 3, 1);
      const e = new Date(today.getFullYear(),  q      * 3, 0);
      return { start: s, end: e };
    }
    case 'last_year': {
      return {
        start: new Date(today.getFullYear() - 1, 0, 1),
        end:   new Date(today.getFullYear() - 1, 11, 31),
      };
    }
    case 'all_time':
    default:
      return null;
  }
}

function buildTimeQuery(timeField: string, time: string): string {
  const range = getDateRange(time);
  if (!range) return '';
  const { start, end } = range;
  // Zendesk `>` is strictly-after on dates, so use `>=` for start and `<`
  // against (end + 1 day) to include the full end date.
  const startStr = toDateStr(start);
  const endExclusive = new Date(end); endExclusive.setDate(endExclusive.getDate() + 1);
  const endStr = toDateStr(endExclusive);
  if (start.getTime() === end.getTime()) return `${timeField}>=${startStr} ${timeField}<${endStr}`;
  return `${timeField}>=${startStr} ${timeField}<${endStr}`;
}

function buildZdFilterQuery(filters: Array<{ field: string; value: string; negate?: boolean }>): string {
  return (filters || [])
    .filter(f => f.field && f.value)
    .map(f => {
      const zdKey = ZD_FILTER_FIELDS[f.field]?.zdKey || f.field;
      // Zendesk supports `-tags:foo` to exclude. The legacy editor never
      // emits `negate` so existing widgets keep their positive shape;
      // Sales-Board-1 needs negation for "Tag is NOT failedatvalidation"
      // style filters.
      return f.negate ? `-${zdKey}:${f.value}` : `${zdKey}:${f.value}`;
    })
    .join(' ');
}

/** Columns to extract from Zendesk ticket search results */
const TICKET_COLUMNS = ['id', 'subject', 'status', 'priority', 'assignee_id', 'group_id', 'created_at', 'updated_at', 'tags'];

export async function fetchZendeskMetric(config: {
  metric?:     string;
  time?:       string;
  zd_filters?: Array<{ field: string; value: string; negate?: boolean }>;
  /** For charts: fetch enough pages to produce a meaningful time series. */
  maxPages?:   number;
  /** For leaderboards: sideload users/groups/brands/orgs so we can resolve IDs to names. */
  sideload?:   boolean;
}): Promise<{
  count:     number;
  rows:      any[];
  columns:   string[];
  timeField: 'created' | 'solved' | 'updated';
  users:     Record<string, string>;
  groups:    Record<string, string>;
  brands:    Record<string, string>;
  orgs:      Record<string, string>;
}> {
  const def = ZD_METRICS[config.metric || 'created_tickets'] || ZD_METRICS.created_tickets;

  const parts: string[] = [def.baseQuery];

  const timeQuery = buildTimeQuery(def.timeField, config.time || 'all_time');
  if (timeQuery) parts.push(timeQuery);

  const filterQuery = buildZdFilterQuery(config.zd_filters || []);
  if (filterQuery) parts.push(filterQuery);

  const query    = parts.join(' ');
  const maxPages = Math.max(1, config.maxPages || 1);
  const include  = config.sideload ? '&include=users,groups,brands,organizations' : '';

  let rawRows: any[] = [];
  let count   = 0;
  const users:  Record<string, string> = {};
  const groups: Record<string, string> = {};
  const brands: Record<string, string> = {};
  const orgs:   Record<string, string> = {};

  let pagePath: string | null = `search.json?query=${encodeURIComponent(query)}&per_page=100${include}`;
  for (let i = 0; i < maxPages && pagePath; i++) {
    const data: any = await fetchZendesk(pagePath);
    rawRows = rawRows.concat(data.results || []);
    if (i === 0) count = data.count ?? rawRows.length;
    // Merge sideloaded lookups
    for (const u of data.users  || []) if (u?.id) users[u.id]  = u.name  || u.email || String(u.id);
    for (const g of data.groups || []) if (g?.id) groups[g.id] = g.name  || String(g.id);
    for (const b of data.brands || []) if (b?.id) brands[b.id] = b.name  || String(b.id);
    for (const o of data.organizations || []) if (o?.id) orgs[o.id] = o.name || String(o.id);
    // Zendesk returns a full URL in next_page — strip to a relative path
    pagePath = data.next_page ? data.next_page.replace(/^https?:\/\/[^/]+\/api\/v2\//, '') : null;
  }

  const rows = rawRows.map(t => ({
    id:             t.id,
    subject:        t.subject   || '',
    status:         t.status    || '',
    priority:       t.priority  || '',
    assignee_id:    t.assignee_id ?? '',
    requester_id:   t.requester_id ?? '',
    group_id:       t.group_id    ?? '',
    brand_id:       t.brand_id    ?? '',
    organization_id:t.organization_id ?? '',
    created_at:     t.created_at  ? new Date(t.created_at).toLocaleDateString('en-GB') : '',
    updated_at:     t.updated_at  ? new Date(t.updated_at).toLocaleDateString('en-GB') : '',
    tags:           Array.isArray(t.tags) ? t.tags.join(', ') : '',
    _tags_arr:      Array.isArray(t.tags) ? t.tags : [],
    // raw ISO timestamps for downstream bucketing (not shown in tables)
    _created_iso:   t.created_at || null,
    _solved_iso:    t.solved_at  || null,
    _updated_iso:   t.updated_at || null,
  }));

  // Sideload is best-effort — Zendesk search doesn't always include end-user
  // requesters. Resolve any IDs we still don't have a name for via a
  // follow-up /users/show_many (same for groups/brands/orgs if needed).
  if (config.sideload) {
    const missingUserIds: string[] = [];
    const missingGroupIds: string[] = [];
    const missingBrandIds: string[] = [];
    const missingOrgIds:   string[] = [];
    for (const r of rows) {
      if (r.requester_id     && !users[String(r.requester_id)])       missingUserIds.push(String(r.requester_id));
      if (r.assignee_id      && !users[String(r.assignee_id)])        missingUserIds.push(String(r.assignee_id));
      if (r.group_id         && !groups[String(r.group_id)])          missingGroupIds.push(String(r.group_id));
      if (r.brand_id         && !brands[String(r.brand_id)])          missingBrandIds.push(String(r.brand_id));
      if (r.organization_id  && !orgs[String(r.organization_id)])     missingOrgIds.push(String(r.organization_id));
    }
    await Promise.all([
      resolveShowMany('users',        missingUserIds, users,  (u: any) => u.name || u.email || String(u.id)),
      resolveShowMany('groups',       missingGroupIds, groups, (g: any) => g.name || String(g.id)),
      resolveShowMany('brands',       missingBrandIds, brands, (b: any) => b.name || String(b.id)),
      resolveShowMany('organizations',missingOrgIds,   orgs,   (o: any) => o.name || String(o.id)),
    ]);
  }

  return { count, rows, columns: TICKET_COLUMNS, timeField: def.timeField, users, groups, brands, orgs };
}

/**
 * Batched show_many lookup: fill the `into` map with names for any IDs that
 * sideloading missed. Zendesk allows up to 100 IDs per call.
 */
async function resolveShowMany(
  resource: 'users' | 'groups' | 'brands' | 'organizations',
  ids: string[],
  into: Record<string, string>,
  nameOf: (entity: any) => string,
): Promise<void> {
  const unique = Array.from(new Set(ids.filter(id => id && !into[id])));
  if (!unique.length) return;
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    try {
      const data: any = await fetchZendesk(`${resource}/show_many.json?ids=${batch.join(',')}`);
      const list = data[resource] || [];
      for (const entity of list) {
        if (entity?.id) into[entity.id] = nameOf(entity);
      }
    } catch { /* swallow — we'll fall back to "User {id}" */ }
  }
}

// ── Leaderboard / group-by ────────────────────────────────────────────────
export const ZD_GROUP_BY: Record<string, { label: string }> = {
  assignee:     { label: 'Assignee'     },
  requester:    { label: 'Requester'    },
  group:        { label: 'Ticket Group' },
  brand:        { label: 'Brand'        },
  organization: { label: 'Organization' },
  status:       { label: 'Status'       },
  priority:     { label: 'Priority'     },
  tag:          { label: 'Tag'          },
};

/**
 * Group Zendesk ticket rows by a chosen dimension and count. Returns a
 * leaderboard-ready array sorted descending by count. For ID-based dimensions
 * (assignee/requester/group/brand/organization) resolves IDs to names using
 * the sideloaded lookups.
 */
export function groupTickets(
  rows: any[],
  lookups: {
    users:  Record<string, string>;
    groups: Record<string, string>;
    brands: Record<string, string>;
    orgs:   Record<string, string>;
  },
  groupBy: string,
  limit = 25,
): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) || 0) + 1);

  for (const r of rows) {
    switch (groupBy) {
      case 'assignee': {
        const id = r.assignee_id;
        const name = id ? (lookups.users[String(id)] || `User ${id}`) : 'Unassigned';
        bump(name);
        break;
      }
      case 'requester': {
        const id = r.requester_id;
        const name = id ? (lookups.users[String(id)] || `User ${id}`) : 'Unknown';
        bump(name);
        break;
      }
      case 'group': {
        const id = r.group_id;
        bump(id ? (lookups.groups[String(id)] || `Group ${id}`) : 'No group');
        break;
      }
      case 'brand': {
        const id = r.brand_id;
        bump(id ? (lookups.brands[String(id)] || `Brand ${id}`) : 'No brand');
        break;
      }
      case 'organization': {
        const id = r.organization_id;
        bump(id ? (lookups.orgs[String(id)] || `Org ${id}`) : 'No organization');
        break;
      }
      case 'status':   bump(r.status   || 'unknown'); break;
      case 'priority': bump(r.priority || 'unset');   break;
      case 'tag': {
        for (const t of r._tags_arr || []) bump(t);
        break;
      }
      default: bump(String(r[groupBy] ?? '—'));
    }
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Fetch accurate daily counts for a metric + time range, using Zendesk's
 * /search/count endpoint (one lightweight call per day). This is the only
 * reliable way to chart long periods because Zendesk search caps total
 * results at 1000, so fetching full tickets and bucketing them silently
 * truncates anything older than the most recent 1000. Per-day counts have
 * no such cap and stay accurate regardless of volume.
 */
export async function fetchZendeskDailyCounts(config: {
  metric?:     string;
  time?:       string;
  zd_filters?: Array<{ field: string; value: string; negate?: boolean }>;
}): Promise<Array<{ date: string; count: number }>> {
  const def = ZD_METRICS[config.metric || 'created_tickets'] || ZD_METRICS.created_tickets;
  const range = getDateRange(config.time || 'today');
  if (!range) return [];

  const filterQuery = buildZdFilterQuery(config.zd_filters || []);

  const days: Date[] = [];
  for (let d = new Date(range.start); d <= range.end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  // Parallel-batch the count queries to stay polite with Zendesk rate limits
  const BATCH = 10;
  const out: Array<{ date: string; count: number }> = new Array(days.length);
  for (let i = 0; i < days.length; i += BATCH) {
    const slice = days.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async (d, j) => {
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const parts = [def.baseQuery, `${def.timeField}>=${toDateStr(d)}`, `${def.timeField}<${toDateStr(next)}`];
      if (filterQuery) parts.push(filterQuery);
      const query = parts.join(' ');
      const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      try {
        const data: any = await fetchZendesk(`search/count.json?query=${encodeURIComponent(query)}`);
        return { idx: i + j, row: { date: label, count: Number(data.count) || 0 } };
      } catch {
        return { idx: i + j, row: { date: label, count: 0 } };
      }
    }));
    for (const r of results) out[r.idx] = r.row;
  }
  return out;
}

/**
 * Group Zendesk ticket rows into daily buckets for line/bar charts.
 * Produces a dense series (one row per day in the range, zero-filled).
 * NOTE: for charts prefer fetchZendeskDailyCounts — this function only sees
 * up to 1000 tickets (Zendesk search cap) and silently drops older days.
 */
export function bucketTicketsByDay(
  rows: any[],
  timeField: 'created' | 'solved' | 'updated',
  time: string,
): Array<{ date: string; count: number }> {
  const isoKey = `_${timeField}_iso` as const;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const iso = r[isoKey];
    if (!iso) continue;
    const d = new Date(iso);
    if (isNaN(d.getTime())) continue;
    // bucket by local date (YYYY-MM-DD)
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  // Determine the date range to render (zero-fill missing days)
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start: Date; let end: Date;
  const range = getDateRange(time);
  if (range) {
    start = range.start;
    end   = range.end;
  } else {
    // no predefined range — infer from data
    const keys = Array.from(counts.keys()).sort();
    if (keys.length) { start = new Date(keys[0]); end = new Date(keys[keys.length - 1]); }
    else              { start = today; end = today; }
  }

  const series: Array<{ date: string; count: number }> = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    // Display as DD MMM (e.g. "22 Apr")
    const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    series.push({ date: label, count: counts.get(key) || 0 });
  }
  return series;
}
