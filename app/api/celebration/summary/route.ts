import { NextResponse } from 'next/server';

/**
 * Claude-powered one-sentence celebration summary for the Hall of Fame
 * overlay. Takes the agent's name, their current emojis, and their stat
 * lines — returns an upbeat one-liner summarising why they're being
 * celebrated. Optional `legend` string provides board-specific context
 * (what each emoji actually means) for richer output.
 *
 * No auth — consumed by the public kiosk view.
 *
 * Responses are cached in-process for 10 minutes keyed by
 * (name + sorted emojis + sorted stats), so repeat celebrations cost
 * nothing and Claude is only hit when something actually changes.
 *
 * If ANTHROPIC_API_KEY isn't set the endpoint returns { summary: null }
 * and the overlay simply renders without a summary line.
 */

interface Body {
  name:    string;
  emojis:  string[];
  stats:   Array<{ label: string; value: string }>;
  legend?: string;
}

interface CacheEntry { summary: string | null; expires: number; }
const cache = new Map<string, CacheEntry>();
const TTL   = 10 * 60 * 1000;

function cacheKey(b: Body): string {
  const e = [...b.emojis].sort().join('');
  const s = [...b.stats].map(x => `${x.label}=${x.value}`).sort().join('|');
  return `${b.name}||${e}||${s}`;
}

async function generate(b: Body): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const lines: string[] = [];
  lines.push(`Agent: ${b.name}`);
  lines.push(`Achievement emojis: ${b.emojis.join(' ')}`);
  if (b.stats.length > 0) {
    lines.push(`Stats: ${b.stats.map(s => `${s.label}=${s.value}`).join(', ')}`);
  }
  if (b.legend) {
    lines.push(``);
    lines.push(`Legend (what each emoji means on this board):`);
    lines.push(b.legend);
  }

  const userPrompt = lines.join('\n') + `

Write ONE short, upbeat, celebratory sentence (max 18 words) announcing this agent's achievements for display on a sales-floor TV wallboard. Be specific about the awards — name them if the legend lets you. Do not include any emojis in your response. Do not include the agent's name. Start with a strong verb or adjective.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':        apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':     'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 80,
        system:     'You write one-sentence celebratory announcements for a UK sales leaderboard TV wallboard. Be upbeat, punchy, and specific.',
        messages:  [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const text = data?.content?.[0]?.text;
    if (typeof text !== 'string') return null;
    // One sentence only; strip stray trailing whitespace
    return text.trim().replace(/^["']|["']$/g, '').slice(0, 240);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ summary: null }, { status: 400 }); }
  if (!body?.name || !Array.isArray(body.emojis)) {
    return NextResponse.json({ summary: null }, { status: 400 });
  }

  const key = cacheKey(body);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return NextResponse.json({ summary: hit.summary, cached: true });
  }

  const summary = await generate(body);
  cache.set(key, { summary, expires: Date.now() + TTL });
  return NextResponse.json({ summary });
}
