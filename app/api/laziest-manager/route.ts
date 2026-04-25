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

  // Sort by fewest updates (the laziest)
  results.sort((a, b) => a.count - b.count);
  const laziest = results[0];
  const other   = results[1];

  // Skip the slide unless ALL of these hold:
  //   1. Both managers' Zendesk lookups succeeded.
  //   2. BOTH have ≥1 update today (proves both are actually working —
  //      we don't want to mock someone who's on leave or hasn't logged
  //      in yet).
  //   3. There's a clear winner — equal counts skip (no laziest to crown).
  const lookupFailed = laziest.count === Number.POSITIVE_INFINITY || other.count === Number.POSITIVE_INFINITY;
  const eitherIdle   = laziest.count === 0 || other.count === 0;
  const tied         = laziest.count === other.count;
  if (lookupFailed || eitherIdle || tied) {
    return NextResponse.json({ agent: null });
  }

  const gapN = other.count - laziest.count;   // always > 0 here
  const gap  = String(gapN);

  const firstName = (name: string) => name.split(' ')[0];
  const otherFirst = firstName(other.name);

  // Pre-computed, deterministic quip — both have updates, the gap tells
  // the story.
  const summary = gapN >= 10
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
