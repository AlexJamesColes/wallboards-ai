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

export const SALES_MANAGERS: string[] = [
  'Hugo Blythman-Rowe',
  'Harry Cooper',
  'Milla Llieva',
  'Hannah Burton',
  'David LaBorde',
  'Cameron Nevins',
  'Milan Stewart',
  'Kyle Millingham',
  'Anthony Peters',
];

function normalize(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}(?:️)?/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MANAGER_KEYS: Set<string> = new Set(SALES_MANAGERS.map(normalize));

export function isSalesManager(name: string): boolean {
  if (!name) return false;
  return MANAGER_KEYS.has(normalize(name));
}
