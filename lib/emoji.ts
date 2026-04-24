/**
 * Emoji helpers for gamified cell rendering.
 *
 * We split a cell string into plain-text and emoji tokens so the emoji spans
 * can be animated independently — pop-in when a new award appears, fade-out
 * when it's lost.
 */

// \p{Extended_Pictographic} catches emoji codepoints including modifiers.
// The `u` flag enables unicode property escapes.
const EMOJI_RE = /\p{Extended_Pictographic}(?:\uFE0F)?/gu;

export type Token =
  | { type: 'text';  value: string }
  | { type: 'emoji'; value: string };

/** Split a string into alternating text / emoji tokens (order preserved). */
export function tokenize(s: string): Token[] {
  if (!s) return [];
  const tokens: Token[] = [];
  let lastIndex = 0;
  for (const m of s.matchAll(EMOJI_RE)) {
    const i = m.index ?? 0;
    if (i > lastIndex) tokens.push({ type: 'text', value: s.slice(lastIndex, i) });
    tokens.push({ type: 'emoji', value: m[0] });
    lastIndex = i + m[0].length;
  }
  if (lastIndex < s.length) tokens.push({ type: 'text', value: s.slice(lastIndex) });
  return tokens;
}

/** Return the set of unique emoji characters in a string. */
export function extractEmojis(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of (s || '').matchAll(EMOJI_RE)) out.add(m[0]);
  return out;
}
