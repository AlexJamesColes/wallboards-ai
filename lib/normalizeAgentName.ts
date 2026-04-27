/**
 * Canonical agent-name key used for matching across data sources.
 *
 * Agent names show up with cosmetic differences depending on origin:
 *   • Gecko SQL: "Hugo Blythman-Rowe" / "Hugo Blythman‑Rowe" (non-ASCII)
 *   • Showcase row after award stamping: "🥇 Hugo Blythman-Rowe 🔥"
 *   • Noetica dataset push: "Hugo  Blythman-Rowe" (double space)
 *
 * Normalising both sides to bare lowercase letters + single spaces means
 * the matcher (managers, agent states, future joins) can compare them
 * with a plain Set lookup. Anything that isn't a letter or space is
 * thrown away — emojis, punctuation, hyphens, BOM, etc.
 */
export function normalizeAgentName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}(?:️)?/gu, '')   // emoji
    .replace(/[‐-―\-_]/g, ' ')                          // hyphen variants → space
    .replace(/['’`]/g, '')                              // apostrophes drop entirely
    .replace(/[^a-z\s]/g, '')                           // strip anything not a letter / space
    .replace(/\s+/g, ' ')
    .trim();
}
