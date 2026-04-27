/**
 * Sales managers — exclude from every wallboard reading. They don't
 * compete with their reports on the leaderboard, and counting them in
 * office-vs-office stats would distort the per-agent average for
 * whichever team has more managers in seats on a given day.
 *
 * Source of truth — update this list when someone joins or leaves
 * the management team. The matcher normalises whitespace, case, and
 * any decorative emojis attached to a name in the source SQL, so a
 * row like "Hugo Blythman-Rowe 🥇" still matches.
 */

// Tracks the canonical reporting query plus any managers who've been
// promoted since that query was last touched. Kyle Millingham and Milan
// Stewart joined management this month and aren't in the Gecko exclude
// list yet; the showcase needs to know about them now so they don't
// appear on the agent leaderboards or skew per-agent stats.
export const SALES_MANAGERS: string[] = [
  'Cameron Nevins',
  'David LaBorde',
  'Hannah Burton',
  'Harry Cooper',
  'Ryan Pink',
  'Hugo Blythman-Rowe',
  'Mila Ilieva',
  'Anthony Peters',
  'Martin Dolan',
  'Jack Weir',
  'Kyle Millingham',
  'Milan Stewart',
];

import { normalizeAgentName } from './normalizeAgentName';

const MANAGER_KEYS: Set<string> = new Set(SALES_MANAGERS.map(normalizeAgentName));

export function isSalesManager(name: string): boolean {
  if (!name) return false;
  return MANAGER_KEYS.has(normalizeAgentName(name));
}
