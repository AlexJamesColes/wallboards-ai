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

  // ── Exclude set — agents on a sibling office's roster get dropped
  // entirely instead of falling into "unmatched". On a single-office
  // board (London XOR Guildford) this keeps the other office's agents
  // off the screen rather than showing them as orphans.
  const excludeKeys = new Set<string>();
  if (cfg.excludeRosters && cfg.excludeRosters.length > 0) {
    const excludeNameLists = await Promise.all(cfg.excludeRosters.map(getRosterNames));
    for (const names of excludeNameLists) for (const n of names) {
      const key = normalizeAgentName(n);
      if (key) excludeKeys.add(key);
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
    // Drop agents who belong to a sibling office's roster on this board
    // (London board hides Guildford agents, vice versa). Stops them
    // from leaking into the unmatched bucket and showing up on the
    // wrong screen.
    const nameKey = normalizeAgentName(f.name);
    if (excludeKeys.has(nameKey)) continue;

    const hit = rosterByKey.get(nameKey);
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

  // ── Pad each office with rostered agents who didn't appear in the
  // Noetica feed at all — they're on the team but not currently signed
  // into the dialler. Showing them as "Not logged in" rather than
  // dropping them from the board means a missing tile reads as "they're
  // not at their desk" rather than "the system lost them", and gives
  // the floor manager a true count of Sales coverage.
  const seenKeys = new Set<string>();
  for (const o of offices) for (const a of o.agents) seenKeys.add(normalizeAgentName(a.name));
  for (const a of unmatched)                          seenKeys.add(normalizeAgentName(a.name));

  for (const entry of rosterEntries) {
    const office = officeByLabel.get(entry.label)!;
    for (const name of entry.names) {
      const key = normalizeAgentName(name);
      if (!key || seenKeys.has(key)) continue;
      office.agents.push({
        name,
        status:        'Not logged in',
        time_in_state: 0,
        team:          null,
      });
      seenKeys.add(key);
    }
  }

  // ── Inbound queue summary (optional). Aggregates one or more queue
  // groups from a separate Noetica dataset so the board can surface
  // "calls waiting / longest wait / today abandoned" alongside the
  // live agent grid. Each group sums offered/answered/abandoned across
  // its constituent queue names, takes the max for currentlongestwait,
  // and weights averagewait by offered.
  const queues: QueueSummary[] = [];
  if (cfg.queueDataset && cfg.queueGroups && cfg.queueGroups.length > 0) {
    const qDs = datasets.find(d => d.name === cfg.queueDataset);
    if (qDs) {
      const qData = await getDatasetData(qDs.id);
      const qRows: any[] = qData?.data ?? [];
      const byName = new Map<string, any>(qRows.map(r => [String(r.queue ?? r.name ?? ''), r]));
      for (const group of cfg.queueGroups) {
        let inQueue = 0, offered = 0, answered = 0, abandoned = 0;
        let longest = 0, weightedWait = 0;
        const matched: string[] = [];
        const missing: string[] = [];
        for (const qname of group.queues) {
          const r = byName.get(qname);
          if (!r) { missing.push(qname); continue; }
          matched.push(qname);
          inQueue   += Number(r.inqueue            ?? r.in_queue           ?? 0) || 0;
          offered   += Number(r.offered            ?? 0) || 0;
          answered  += Number(r.answered           ?? 0) || 0;
          abandoned += Number(r.abandoned          ?? 0) || 0;
          const w = Number(r.averagewait ?? r.average_wait ?? 0) || 0;
          weightedWait += w * (Number(r.offered ?? 0) || 0);
          const lw = Number(r.currentlongestwait ?? r.current_longest_wait ?? 0) || 0;
          if (lw > longest) longest = lw;
        }
        const averageWait = offered > 0 ? +(weightedWait / offered).toFixed(1) : 0;
        const abandonPct  = offered > 0 ? +((abandoned / offered) * 100).toFixed(1) : 0;
        queues.push({
          label:               group.label,
          in_queue:            inQueue,
          offered,
          answered,
          abandoned,
          abandon_pct:         abandonPct,
          average_wait:        averageWait,
          longest_wait:        longest,
          queues_matched:      matched,
          queues_missing:      missing,
          updated_at:          qData?.updated_at ?? null,
        });
      }
    }
  }

  return NextResponse.json({
    slug:         params.slug,
    dataset_name: cfg.dataset,
    updated_at:   updatedAt,
    offices,
    unmatched,
    queues,
  });
}

interface QueueSummary {
  label:           string;
  in_queue:        number;
  offered:         number;
  answered:        number;
  abandoned:       number;
  abandon_pct:     number;
  average_wait:    number;
  longest_wait:    number;
  queues_matched:  string[];
  queues_missing:  string[];
  updated_at:      string | null;
}
