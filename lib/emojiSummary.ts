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
 */

export function summarizeAgent(emojis: string[]): string {
  const set = new Set(emojis);
  const parts: string[] = [];

  // ── Monthly position (mutually exclusive) ────────────────────────────
  if      (set.has('🥇')) parts.push('leading the month for income');
  else if (set.has('🥈')) parts.push('sitting 2nd for income this month');
  else if (set.has('🥉')) parts.push('holding 3rd for income this month');
  else if (set.has('🍪')) parts.push('sneaking into 4th for income this month');

  // ── Today's awards (can stack) ───────────────────────────────────────
  const todayWins: string[] = [];
  if (set.has('🔥')) todayWins.push('top income');
  if (set.has('🎉')) todayWins.push('most policies');
  if (set.has('🍺')) todayWins.push('biggest single policy');
  if (todayWins.length === 1) parts.push(`${todayWins[0]} today`);
  else if (todayWins.length === 2) parts.push(`${todayWins[0]} and ${todayWins[1]} today`);
  else if (todayWins.length === 3) parts.push('every today award going');

  // ── MTD extras beyond position (can stack) ───────────────────────────
  const mtdExtras: string[] = [];
  if (set.has('🚐')) mtdExtras.push('most policies this month');
  if (set.has('🍾')) mtdExtras.push('biggest single policy this month');
  if (mtdExtras.length === 1) parts.push(mtdExtras[0]);
  else if (mtdExtras.length === 2) parts.push('most policies AND biggest policy this month');

  if (parts.length === 0) return '';

  // ── Prefix sets the energy level based on how many awards stack ──────
  const prefix = parts.length >= 3 ? 'On absolute fire — '
               : parts.length === 2 ? 'Having a belter — '
               :                      'Smashing it — ';

  // ── Natural "A, B, and C" join ───────────────────────────────────────
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
