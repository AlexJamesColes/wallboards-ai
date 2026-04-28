/**
 * Shared status registry for both the agent-states board and the
 * sales leaderboards. Keeps the seven canonical lanes + their visual
 * treatment in one place so a colour change ripples to every wallboard
 * surface in one edit.
 *
 * The leaderboards use `tint` as the avatar-rim colour to indicate
 * each agent's live state alongside their ranking. The agent-states
 * view uses `tier` to bucket lanes top-to-bottom.
 */

export type StatusTier = 'alert' | 'active' | 'away';

export interface StatusMeta {
  /** Short label shown in lane headers + status chips. */
  label:        string;
  /** Accent colour — also used as the avatar-rim tint on leaderboards. */
  tint:         string;
  /** Halo behind status dots / rims. */
  glow:         string;
  /** Tier driving layout placement on the agent-states board. */
  tier:         StatusTier;
  /** Optional "this is taking too long" threshold in seconds. Past this
   *  the tile gets a red rim regardless of its tier. */
  concernSec?:  number;
}

export const STATUS_META: Record<string, StatusMeta> = {
  'Hold':           { label: 'Hold',          tint: '#fb923c', glow: 'rgba(251,146,60,0.55)',  tier: 'alert',  concernSec: 60 },
  'Not Ready':      { label: 'Not Ready',     tint: '#f87171', glow: 'rgba(248,113,113,0.55)', tier: 'alert',  concernSec: 5 * 60 },
  'Talking':        { label: 'Talking',       tint: '#10b981', glow: 'rgba(16,185,129,0.45)',  tier: 'active' },
  'Wrap':           { label: 'Wrap',          tint: '#fbbf24', glow: 'rgba(251,191,36,0.45)',  tier: 'active', concernSec: 3 * 60 },
  'Waiting':        { label: 'Waiting',       tint: '#38bdf8', glow: 'rgba(56,189,248,0.45)',  tier: 'active' },
  'Lunch':          { label: 'Lunch',         tint: '#94a3b8', glow: 'rgba(148,163,184,0.35)', tier: 'away' },
  'Comfort Break':  { label: 'Comfort Break', tint: '#94a3b8', glow: 'rgba(148,163,184,0.35)', tier: 'away' },
  // Synthetic — server-padded for rostered agents not in the Noetica
  // feed at all. Distinct from Lunch/Break (those are signed in but
  // away) because nobody's even at the desk.
  'Not logged in':  { label: 'Not logged in', tint: '#475569', glow: 'rgba(71,85,105,0.25)',  tier: 'away' },
};

export const NEUTRAL_META: StatusMeta = {
  label: 'Unknown', tint: '#64748b', glow: 'rgba(100,116,139,0.35)', tier: 'active',
};

/** Every Noetica status collapses into one of the canonical buckets above. */
export const STATUS_ALIASES: Record<string, string> = {
  // Spelling / phrasing variants of "agent is signed in but unavailable"
  'NotReady':             'Not Ready',
  'Permitted Not Ready':  'Not Ready',
  'Pending Not Ready':    'Not Ready',
  // Active call activity → Talking
  'Dialling':    'Talking',
  'Consult':     'Talking',
  // Post-call admin → Wrap
  'Completed':   'Wrap',
  'Transferred': 'Wrap',
  // Idle / signed-in waiting → Waiting
  'Logged in':   'Waiting',
};

export function canonicalStatus(s: string): string {
  return STATUS_ALIASES[s] ?? s;
}

export function statusMetaFor(s: string): StatusMeta {
  return STATUS_META[canonicalStatus(s)] ?? NEUTRAL_META;
}
