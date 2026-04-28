import { NextResponse } from 'next/server';
import { ensureDbReady, getBoardBySlug, listDatasets, getDatasetData } from '@/lib/db';
import { runQuery } from '@/lib/mssql';
import { getShowcaseBoard } from '@/lib/showcaseBoards';
import { isSalesManager } from '@/lib/salesManagers';
import { normalizeAgentName } from '@/lib/normalizeAgentName';

export const dynamic = 'force-dynamic';

/**
 * Live agent-states feed for the Sales · Agent States board.
 *
 *   GET /api/agent-states/<slug>
 *     →  { offices: [{ label, agents: [...] }, ...], unmatched: [...],
 *          updated_at, dataset_name }
 *
 * Joins a Noetica-pushed dataset (rows of {agentname,status,timeinstate,team})
 * against the per-office leaderboard SQL — same source of truth the existing
 * London / Guildford boards use, so as agents are added or removed the
 * roster on this board updates with them. Names are matched after the
 * usual normalisation pass (lowercased, hyphen/punctuation/award-emoji
 * stripped) so cosmetic differences between Noetica and Gecko don't leave
 * agents in `unmatched`.
 *
 * Slug is a path param so the endpoint can serve any future agent-states
 * board (renewals, ops, etc.) without code changes — just add an entry to
 * SHOWCASE_BOARDS.
 */

interface AgentRow {
  name:           string;
  status:         string;
  time_in_state:  number;     // seconds
  team:           string | null;
}

interface OfficeBlock {
  label:    string;
  source:   string;
  agents:   AgentRow[];
}

async function getRosterNames(sourceSlug: string): Promise<string[]> {
  const board = await getBoardBySlug(sourceSlug);
  if (!board) return [];
  const tables = (board.widgets || []).filter(w =>
    w.type === 'table' && !(w.display_config as any)?.hide_header,
  );
  tables.sort((a, b) => (b.col_span * b.row_span) - (a.col_span * a.row_span));
  const main = tables[0];
  if (!main || main.data_source_type !== 'sql') return [];
  const query = (main.data_source_config as any)?.query;
  if (!query) return [];
  const result = await runQuery(query);
  const cols = result.columns || [];
  const nameCol = cols[0] || 'name';
  return (result.rows || [])
    .map((r: any) => String(r[nameCol] ?? ''))
    .filter(n => n && !isSalesManager(n));
}

function pickAgentField(row: any): { name: string; status: string; time: number; team: string | null } {
  // Be liberal in what we accept: Noetica's exact field names today are
  // agentname / status / timeinstate / team but we don't want a column
  // rename upstream to silently break the board.
  const name   = row.agentname ?? row.agent_name ?? row.name ?? row.agent ?? '';
  const status = row.status     ?? row.state      ?? row.agentstate ?? '';
  const team   = row.team       ?? row.team_id    ?? row.teamid     ?? null;
  const t = row.timeinstate ?? row.time_in_state ?? row.duration ?? row.seconds ?? 0;
  const time = Number(t);
  return {
    name:   String(name),
    status: String(status),
    team:   team == null ? null : String(team),
    time:   Number.isFinite(time) ? time : 0,
  };
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  await ensureDbReady();

  const config = getShowcaseBoard(params.slug);
  if (!config || config.data.type !== 'agent-states') {
    return NextResponse.json({ error: 'Unknown agent-states board' }, { status: 404 });
  }
  // Pull the discriminated variant into a local so TS narrows once and we
  // don't have to re-narrow at every property access below.
  const cfg = config.data;

  // ── Roster — names per office, derived from the leaderboard SQL.
  const rosterEntries = await Promise.all(
    cfg.rosters.map(async r => ({
      label:  r.label,
      source: r.source,
      names:  await getRosterNames(r.source),
    })),
  );
  const rosterByKey = new Map<string, { label: string; source: string; canonical: string }>();
  for (const entry of rosterEntries) {
    for (const n of entry.names) {
      rosterByKey.set(normalizeAgentName(n), {
        label:     entry.label,
        source:    entry.source,
        canonical: n,
      });
    }
  }

  // ── Dataset rows (Noetica push).
  const datasets = await listDatasets();
  const ds = datasets.find(d => d.name === cfg.dataset);
  if (!ds) {
    return NextResponse.json({
      error:        'Dataset not pushed yet',
      dataset_name: cfg.dataset,
    }, { status: 404 });
  }
  const dataRow = await getDatasetData(ds.id);
  const rows: any[]    = dataRow?.data       ?? [];
  const updatedAt: any = dataRow?.updated_at ?? null;

  // ── Bucket each Noetica row into its office (or 'unmatched').
  const offices: OfficeBlock[] = cfg.rosters.map(r => ({
    label: r.label, source: r.source, agents: [],
  }));
  const officeByLabel = new Map(offices.map(o => [o.label, o]));
  const unmatched: AgentRow[] = [];

  // Pre-compute a Set so the per-row team filter is a quick lookup. An
  // unset filter means "every team allowed" — same behaviour as before.
  const allowedTeams = cfg.teamFilter ? new Set(cfg.teamFilter) : null;

  for (const raw of rows) {
    const f = pickAgentField(raw);
    if (!f.name) continue;
    if (isSalesManager(f.name)) continue;
    // Drop rows whose team isn't part of the configured filter — keeps
    // Renewals / Ops / Customer Service agents off the Sales board even
    // when they share the same Noetica push.
    if (allowedTeams && (f.team == null || !allowedTeams.has(f.team))) continue;

    const hit = rosterByKey.get(normalizeAgentName(f.name));
    const agent: AgentRow = {
      // Prefer the canonical Gecko spelling (clean of Noetica's double
      // spaces / casing quirks) when we have a match; fall back to the
      // raw Noetica name otherwise.
      name:          hit ? hit.canonical : f.name.replace(/\s+/g, ' ').trim(),
      status:        f.status || 'Unknown',
      time_in_state: f.time,
      team:          f.team,
    };
    if (hit) officeByLabel.get(hit.label)!.agents.push(agent);
    else     unmatched.push(agent);
  }

  return NextResponse.json({
    slug:         params.slug,
    dataset_name: cfg.dataset,
    updated_at:   updatedAt,
    offices,
    unmatched,
  });
}
