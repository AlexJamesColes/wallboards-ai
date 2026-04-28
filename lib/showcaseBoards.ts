/**
 * Showcase board catalogue — single source of truth.
 *
 * Each entry describes one board served by either the bespoke
 * ShowcaseView (podium + cards + ticker) or AgentStatesView (live agent
 * status grid). Three kinds of data source are supported:
 *
 *   • `widget`        — the leaderboard SQL lives in `wb_widgets` on the
 *     DB, attached to a real `wb_boards` row. Same model the legacy
 *     editor produced; kept because the SQL is non-trivial and not yet
 *     migrated into code.
 *
 *   • `combined`      — a synthetic board with no DB row. The data
 *     endpoint fetches each `sources` slug's widget data and
 *     concatenates the rows so the showcase can rank everyone together
 *     (e.g. sales-group ranks London + Guildford in one list).
 *
 *   • `agent-states`  — also synthetic. Joins a Noetica-pushed dataset
 *     against per-office leaderboard SQL (used as the roster) and
 *     renders a live status grid rather than a leaderboard.
 *
 * Adding a new showcase board means appending one entry here. The browse
 * page, the route resolver, the data endpoints, and the baseline poller
 * all read from this list.
 */

export interface ShowcaseBoard {
  slug:           string;
  name:           string;
  department:     string;
  /** Default team-target the bar fills towards. Per-TV override via the
   *  `?target=` URL param still wins. Fall-through: 1.3M (single-office
   *  default). */
  defaultTarget?: number;
  data:
    | { type: 'widget' }                                  // resolved via wb_widgets row attached to this slug
    | { type: 'combined'; sources: string[] }             // concatenated from other showcase slugs
    | { type: 'agent-states'; dataset: string;
        rosters: { label: string; source: string }[];
        /** Optional team-ID filter. When set, only rows whose `team` field
         *  matches one of these IDs are kept; anything else is dropped at
         *  the API layer (Renewals, Customer Service, etc. sharing the same
         *  Noetica push). Stringly-typed because Noetica returns team as
         *  a string in the JSON payload. */
        teamFilter?: string[];
        /** Sibling rosters whose matches should drop entirely (rather than
         *  fall into "unmatched"). On a per-office board (London XOR
         *  Guildford), name this office's counterpart so its agents don't
         *  surface as orphans on the wrong screen. */
        excludeRosters?: string[];
        /** Optional inbound-call-queue summary surfaced as a strip at the
         *  top of the board. Pulls from a separate Noetica dataset and
         *  aggregates one or more queue groups (typically "Inbound Sales"
         *  spanning every customer-facing route). */
        queueDataset?: string;
        queueGroups?: { label: string; queues: string[] }[];
      };
    // ↑ live-state board: a Noetica dataset name plus per-office leaderboard slugs whose
    //   SQL doubles as the roster (so we can split a flat dataset by office without a
    //   second source of truth).
}

export const SHOWCASE_BOARDS: ShowcaseBoard[] = [
  {
    slug:       'london-agents',
    name:       'London Agents Leaderboard',
    department: 'Sales',
    data:       { type: 'widget' },
  },
  {
    slug:       'guildford-agents',
    name:       'Guildford Agents Leaderboard',
    department: 'Sales',
    data:       { type: 'widget' },
  },
  {
    slug:          'sales-group',
    name:          'Sales · Group Leaderboard',
    department:    'Sales',
    // London + Guildford combined NB budget. Override via ?target= per TV.
    defaultTarget: 2_590_000,
    data:          { type: 'combined', sources: ['london-agents', 'guildford-agents'] },
  },
  // ─── Per-office agent-state boards ──────────────────────────────────
  // Same Noetica feed, same queue summary, just a different roster +
  // department label per board. Both filter to Sales teams server-side
  // (15, 23, 24, 25, 26) so non-Sales rows can't leak in even if the
  // roster lookup misses someone.
  {
    slug:       'london-agent-states',
    name:       'London · Agent States',
    department: 'Sales',
    data:       {
      type:           'agent-states',
      dataset:        'noetica_agent_status',
      teamFilter:     ['15', '23', '24', '25', '26'],
      rosters:        [{ label: 'London', source: 'london-agents' }],
      excludeRosters: ['guildford-agents'],
      queueDataset:   'noetica_call_queues',
      queueGroups: [{
        label:  'Inbound Sales',
        queues: ['Sales', 'Sales Priority', 'Ancillary Sales', 'SME Sales', 'Sales Fallback', 'Sales Car'],
      }],
    },
  },
  {
    slug:       'guildford-agent-states',
    name:       'Guildford · Agent States',
    department: 'Sales',
    data:       {
      type:           'agent-states',
      dataset:        'noetica_agent_status',
      teamFilter:     ['15', '23', '24', '25', '26'],
      rosters:        [{ label: 'Guildford', source: 'guildford-agents' }],
      excludeRosters: ['london-agents'],
      queueDataset:   'noetica_call_queues',
      queueGroups: [{
        label:  'Inbound Sales',
        queues: ['Sales', 'Sales Priority', 'Ancillary Sales', 'SME Sales', 'Sales Fallback', 'Sales Car'],
      }],
    },
  },
];

/** Convenience — every showcase slug, in declaration order. Replaces the
 *  former `SHOWCASE_SLUGS` constant; routing code that just wants
 *  membership tests should import this. */
export const SHOWCASE_SLUGS = SHOWCASE_BOARDS.map(b => b.slug);

export function getShowcaseBoard(slug: string): ShowcaseBoard | undefined {
  return SHOWCASE_BOARDS.find(b => b.slug === slug);
}

/** True for synthetic (combined) boards — they have no `wb_boards` row,
 *  so the route resolver and browse listing must inject them manually. */
export function isSyntheticBoard(slug: string): boolean {
  const b = getShowcaseBoard(slug);
  return !!b && b.data.type !== 'widget';
}
