import { fetchZendesk } from './zendesk';

// Zendesk custom field IDs (subset of canxrefundreporttfileonly.py;
// customer name intentionally dropped — the audit team doesn't need it).
const CF_REFERENCE_NUMBER = 360009033178;
const CF_REFUND_AMOUNT    = 10404272444829;

const TAGS     = ['postrefund', 'postrefundready'] as const;
const STATUSES = ['open', 'pending', 'hold']       as const;

const CSV_HEADERS = [
  'Ticket ID',
  'Reference number',
  'Refund amount £',
  'Status',
  'Created date',
  'Type',
] as const;

export type CanxRefundType = 'Canx automation' | 'Agent led / form';

export interface CanxRefundRow {
  ticket_id:        number;
  reference_number: string | null;
  refund_amount:    number | null;
  status:           string;
  created_date:     string;   // DD/MM/YYYY
  created_at:       string;   // raw ISO for sorting
  type:             CanxRefundType;
}

export interface CanxRefundReport {
  generated_at: string;
  total_count:  number;
  total_refund: number;
  by_type:      Array<{ type: CanxRefundType; count: number; refund_amount: number }>;
  by_status:    Array<{ status: string; count: number; refund_amount: number }>;
  rows:         CanxRefundRow[];
}

function getCustomFieldValue(ticket: any, fieldId: number): any {
  const fields = Array.isArray(ticket?.custom_fields) ? ticket.custom_fields : [];
  for (const f of fields) {
    if (f && f.id === fieldId) return f.value;
  }
  return null;
}

function deriveType(subject: string | null | undefined): CanxRefundType {
  return (subject || '').trim() === 'Cancellation refund required'
    ? 'Canx automation'
    : 'Agent led / form';
}

function formatDateDDMMYYYY(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function parseRefundAmount(raw: any): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  // Custom field values come back as strings; strip currency / commas.
  const cleaned = String(raw).replace(/[£,\s]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Fetch all tickets matching the cancellation-refund audit queries.
 * Mirrors the 6-query loop from canxrefundreporttfileonly.py:
 *   tag in {postrefund, postrefundready} × status in {open, pending, hold}.
 * De-duplicates by ticket id (a ticket can carry both tags).
 */
async function fetchAllMatchingTickets(): Promise<any[]> {
  const seen = new Set<number>();
  const out: any[] = [];

  for (const tag of TAGS) {
    for (const status of STATUSES) {
      const query = `type:ticket tags:${tag} status:${status}`;
      let pagePath: string | null = `search.json?query=${encodeURIComponent(query)}&per_page=100`;
      while (pagePath) {
        const data: any = await fetchZendesk(pagePath);
        for (const t of data.results || []) {
          if (t?.id && !seen.has(t.id)) {
            seen.add(t.id);
            out.push(t);
          }
        }
        pagePath = data.next_page
          ? data.next_page.replace(/^https?:\/\/[^/]+\/api\/v2\//, '')
          : null;
      }
    }
  }

  out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return out;
}

export async function buildCanxRefundReport(): Promise<CanxRefundReport> {
  const tickets = await fetchAllMatchingTickets();

  const rows: CanxRefundRow[] = tickets.map(t => {
    const refundRaw = getCustomFieldValue(t, CF_REFUND_AMOUNT);
    return {
      ticket_id:        t.id,
      reference_number: getCustomFieldValue(t, CF_REFERENCE_NUMBER) ?? null,
      refund_amount:    parseRefundAmount(refundRaw),
      status:           t.status || '',
      created_date:     formatDateDDMMYYYY(t.created_at),
      created_at:       t.created_at || '',
      type:             deriveType(t.subject),
    };
  });

  const byTypeMap = new Map<CanxRefundType, { count: number; refund_amount: number }>();
  const byStatusMap = new Map<string, { count: number; refund_amount: number }>();
  let totalRefund = 0;

  for (const r of rows) {
    const amt = r.refund_amount ?? 0;
    totalRefund += amt;

    const t = byTypeMap.get(r.type) || { count: 0, refund_amount: 0 };
    t.count += 1; t.refund_amount += amt;
    byTypeMap.set(r.type, t);

    const s = byStatusMap.get(r.status) || { count: 0, refund_amount: 0 };
    s.count += 1; s.refund_amount += amt;
    byStatusMap.set(r.status, s);
  }

  // Always surface both Type rows so the wallboard tile is stable even when one is empty.
  const by_type: CanxRefundReport['by_type'] = (['Canx automation', 'Agent led / form'] as CanxRefundType[])
    .map(type => ({ type, ...(byTypeMap.get(type) || { count: 0, refund_amount: 0 }) }));

  // Status order matches the query order so the UI is predictable.
  const by_status: CanxRefundReport['by_status'] = (STATUSES as readonly string[])
    .map(status => ({ status, ...(byStatusMap.get(status) || { count: 0, refund_amount: 0 }) }));

  return {
    generated_at: new Date().toISOString(),
    total_count:  rows.length,
    total_refund: totalRefund,
    by_type,
    by_status,
    rows,
  };
}

function csvEscape(value: any): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function reportToCsv(report: CanxRefundReport): string {
  const lines: string[] = [];
  lines.push(CSV_HEADERS.join(','));
  for (const r of report.rows) {
    lines.push([
      r.ticket_id,
      r.reference_number,
      r.refund_amount ?? '',
      r.status,
      r.created_date,
      r.type,
    ].map(csvEscape).join(','));
  }
  // CRLF for max-compatibility with Excel on Windows.
  return lines.join('\r\n') + '\r\n';
}

export function csvFilename(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `canx_refund_audit_${today}.csv`;
}
