/**
 * Showcase board catalogue — single source of truth.
 *
 * Each entry describes one board served by the bespoke ShowcaseView
 * (podium + cards + ticker + baseline chips). Two kinds of data source
 * are supported:
 *
 *   • `widget`   — the leaderboard SQL still lives in `wb_widgets` on
 *     the DB, attached to a real `wb_boards` row. Same model the
 *     legacy editor produced; we keep it because the SQL is non-trivial
 *     and not yet migrated into code.
 *
 *   • `combined` — a synthetic board that has no DB row of its own.
 *     The data endpoint fetches each `sources` slug's widget data and
 *     concatenates the rows so the showcase can rank everyone together
 *     (e.g. sales-group ranks London + Guildford in one list).
 *
 * Adding a new showcase board means appending one entry here. The browse
 * page, the route resolver, the data endpoint, and the baseline poller
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
    | { type: 'combined'; sources: string[] };            // concatenated from other showcase slugs
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
