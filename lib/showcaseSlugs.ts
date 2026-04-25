/** The set of board slugs that render the bespoke "showcase" view
 *  (podium + cards + ticker + baseline chips). Single source of truth so
 *  the route resolver and the server-side baseline poller agree on which
 *  boards qualify. Add a slug here AND nowhere else. */
export const SHOWCASE_SLUGS = ['london-agents', 'guildford-agents'] as const;
export type ShowcaseSlug = typeof SHOWCASE_SLUGS[number];
