/**
 * Static celebration-sentence generator.
 *
 * Maps emoji awards used on the London Agents / sales wallboards to a one
 * liner. Deterministic — no API, no cost, no latency. Any agent with one or
 * more known emojis gets a polished sentence; unknown emojis are ignored
 * (so new awards added to the SQL don't break the summary, they just don't
 * contribute to it until we add a phrase here).
 *
 * Current legend (matches the legend widget on the London Agents board):
 *   🥇 🥈 🥉   Top 3 income MTD
 *   🍪           4th place income MTD
 *   🔥           Most income today
 *   🎉           Most policies today
 *   🍺           Biggest single policy today
 *   🚐           Most policies MTD
 *   🍾           Biggest single policy MTD
 *
 * Awards are merged across the today/MTD axis when an agent holds both
 * versions of the same record, so we don't end up saying "most policies
 * today, … most policies this month" — that reads as a duplicate even
 * though it's two distinct awards.
 */

export function summarizeAgent(emojis: string[]): string {
  const set = new Set(emojis);
  const parts: string[] = [];

  // ── Income: monthly position ± today's win ──────────────────────────
  let position: string | null = null;
  if      (set.has('🥇')) position = 'leading the month for income';
  else if (set.has('🥈')) position = 'sitting 2nd for income this month';
  else if (set.has('🥉')) position = 'holding 3rd for income this month';
  else if (set.has('🍪')) position = 'breaking into 4th for income this month';

  const dayIncome = set.has('🔥');
  if (position && dayIncome) parts.push(`${position} AND topping today's income`);
  else if (position)         parts.push(position);
  else if (dayIncome)        parts.push("topping today's income");

  // ── Policies records: today + MTD merged ────────────────────────────
  const dayPol = set.has('🎉');
  const mtdPol = set.has('🚐');
  if (dayPol && mtdPol) parts.push('most policies today AND for the month');
  else if (dayPol)      parts.push('most policies today');
  else if (mtdPol)      parts.push('most policies this month');

  // ── Biggest single policy: today + MTD merged ───────────────────────
  const daySingle = set.has('🍺');
  const mtdSingle = set.has('🍾');
  if (daySingle && mtdSingle) parts.push('biggest single policy today AND of the month');
  else if (daySingle)         parts.push('biggest single policy today');
  else if (mtdSingle)         parts.push('biggest single policy of the month');

  if (parts.length === 0) return '';

  // ── Prefix sets the energy level based on how many awards stack ─────
  const prefix = parts.length >= 3 ? 'On absolute fire — '
               : parts.length === 2 ? 'Having a belter — '
               :                      'Smashing it — ';

  // ── Natural "A, B, and C" join ──────────────────────────────────────
  let joined: string;
  if (parts.length === 1) {
    joined = parts[0];
  } else if (parts.length === 2) {
    joined = `${parts[0]} and ${parts[1]}`;
  } else {
    joined = `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  }

  return (prefix + joined).replace(/\s+/g, ' ').trim() + '.';
}
