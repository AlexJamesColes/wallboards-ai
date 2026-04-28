import { tokenize } from './emoji';

/**
 * Canonical "name + emojis to the right" rendering for every wallboard
 * surface.
 *
 * The leaderboard SQL stamps award emojis onto the agent's name string
 * with no consistent ordering — sometimes prefixed (🥈 Mitchell Crouch),
 * sometimes suffixed (Joshua Darby 🍺), sometimes both. That looked
 * fine on the leaderboard where every cell drew its emoji shelf the
 * same way, but on the agent-states tiles a leading 🥈 squashed the
 * name's left edge and made some rows read as "🥈 + name + 🚐" while
 * others read as "name + 🍪". This helper normalises every name to:
 *
 *   <clean name> <rank emoji?> <other emojis...>
 *
 * where rank emojis (🥇🥈🥉🍪) always come first after the name and
 * everything else trails behind.
 */

const RANK_EMOJIS: ReadonlySet<string> = new Set(['🥇', '🥈', '🥉', '🍪']);

export interface DisplayName {
  /** Plain name with award emojis stripped — used as the key for sorting / matching. */
  clean:        string;
  /** Rank emojis in the order they appeared in the source string. Always first after the name. */
  rankEmojis:   string[];
  /** Every other emoji in source order — fire / van / beer etc. */
  otherEmojis:  string[];
  /** Pre-joined "clean name + rank + others" string, ready to drop into a `<span>`. */
  display:      string;
}

export function parseAgentName(raw: string): DisplayName {
  const rankEmojis:  string[] = [];
  const otherEmojis: string[] = [];
  const textParts:   string[] = [];

  for (const t of tokenize(String(raw ?? ''))) {
    if (t.type === 'text') {
      textParts.push(t.value);
    } else if (RANK_EMOJIS.has(t.value)) {
      rankEmojis.push(t.value);
    } else {
      otherEmojis.push(t.value);
    }
  }

  const clean = textParts.join(' ').replace(/\s+/g, ' ').trim();
  const tail  = [...rankEmojis, ...otherEmojis].join(' ');
  const display = tail ? `${clean} ${tail}` : clean;
  return { clean, rankEmojis, otherEmojis, display };
}
