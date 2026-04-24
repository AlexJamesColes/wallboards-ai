import { NextResponse } from 'next/server';
import { fetchZendesk } from '@/lib/zendesk';

/**
 * "Laziest Manager" endpoint.
 *
 * Compares the two candidate managers on Zendesk tickets they've updated
 * today, returns the one with the lower count in the shape the Celebration
 * overlay expects. If Zendesk is unreachable / user lookup fails, the
 * response still contains a fallback joke agent so the celebration never
 * looks broken.
 *
 * No auth — consumed by the public kiosk view alongside widget data.
 */

const CANDIDATES = ['Harry Cooper', 'Hugo Blythman-Rowe'];

// Zendesk user IDs are stable. Cache them for the lifetime of the process
// to avoid a user-search round trip on every refresh.
const managerIdCache = new Map<string, number | null>();

async function findManagerId(name: string): Promise<number | null> {
  if (managerIdCache.has(name)) return managerIdCache.get(name)!;
  try {
    const data = await fetchZendesk(`users/search.json?query=${encodeURIComponent(name)}`);
    // Prefer exact name match; fall back to case-insensitive
    const list: any[] = data.users || [];
    const exact = list.find(u => u?.name === name);
    const loose = list.find(u => u?.name?.toLowerCase?.() === name.toLowerCase());
    const id    = (exact || loose)?.id ?? null;
    managerIdCache.set(name, id);
    return id;
  } catch {
    return null;
  }
}

async function countUpdatesToday(userId: number): Promise<number> {
  const today = new Date();
  const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const query   = `type:ticket updated>=${isoDate} updater:${userId}`;
  try {
    const data = await fetchZendesk(`search/count.json?query=${encodeURIComponent(query)}`);
    return Number(data.count) || 0;
  } catch {
    return 0;
  }
}

const LAZY_EMOJIS = ['💤', '🛌', '🦥', '😴', '☕', '🫠', '🧘', '🙈', '💤', '💤'];

export async function GET() {
  // Resolve both candidates in parallel
  const results = await Promise.all(CANDIDATES.map(async name => {
    const id = await findManagerId(name);
    if (id === null) return { name, count: Number.POSITIVE_INFINITY };
    const count = await countUpdatesToday(id);
    return { name, count };
  }));

  // Laziest = fewest updates. On a tie, Hugo keeps the joke running.
  results.sort((a, b) => {
    if (a.count !== b.count) return a.count - b.count;
    return a.name === 'Hugo Blythman-Rowe' ? -1 : 1;
  });
  const laziest = results[0];
  const other   = results[1];

  // Skip the slide when we don't have a real signal:
  //   - Zendesk lookup failed for either manager → no meaningful comparison
  //   - Both at 0 updates (early morning / weekend) → don't call anyone lazy
  //     just because nobody's started work yet.
  const lookupFailed = laziest.count === Number.POSITIVE_INFINITY || other.count === Number.POSITIVE_INFINITY;
  const bothAtZero   = laziest.count === 0 && other.count === 0;
  if (lookupFailed || bothAtZero) {
    return NextResponse.json({ agent: null });
  }

  const gapN = Math.max(0, other.count - laziest.count);
  const gap  = String(gapN);

  const firstName = (name: string) => name.split(' ')[0];
  const otherFirst = firstName(other.name);

  // Pre-computed, deterministic sentence — no AI, just the right quip for
  // whichever of the handful of possible states we're in.
  const summary = laziest.count === 0 && other.count > 0
    ? `Not a single ticket touched today while ${otherFirst} knocked out ${other.count}.`
    : gapN === 0
      ? `Neck-and-neck with ${otherFirst} at ${laziest.count} updates — retaining the crown on tiebreak.`
      : gapN >= 10
        ? `Quietly coasting on ${laziest.count} updates while ${otherFirst} smashed out ${other.count} — behind by ${gapN}.`
        : `Just ${laziest.count} updates today — ${otherFirst} is ahead by ${gapN}.`;

  return NextResponse.json({
    agent: {
      widgetId: '__laziest__',
      name:     `${laziest.name} 💤💤💤`,
      emojis:   LAZY_EMOJIS,
      banner:   '😴  LAZIEST MANAGER  😴',
      stats: [
        { label: 'Updates Today', value: laziest.count === Number.POSITIVE_INFINITY ? '?' : String(laziest.count) },
        { label: 'vs. ' + otherFirst, value: other.count === Number.POSITIVE_INFINITY ? '?' : String(other.count) },
        { label: 'Behind by', value: gap },
      ],
      summary,
    },
  });
}
