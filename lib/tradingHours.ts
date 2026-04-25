/**
 * Sales floor opening hours by day of week.
 *
 * Day index follows JavaScript's `Date.prototype.getDay()`:
 *   0 = Sun, 1 = Mon, …, 6 = Sat
 *
 * People do trade outside these windows (early starts, overtime), so
 * nothing breaks if a deal lands at 8:25 — but the wallboard's "live"
 * affordances (countdown copy, hourly celebration takeover) only
 * activate within these hours so a half-empty office at 7am doesn't
 * watch a celebration play to nobody.
 */

export interface TradingHours {
  openH:  number;
  openM:  number;
  closeH: number;
  closeM: number;
}

export function openingHoursFor(day: number): TradingHours {
  if (day === 0)            return { openH: 10, openM: 0,  closeH: 17, closeM: 0 };
  if (day === 6)            return { openH:  9, openM: 0,  closeH: 17, closeM: 0 };
  /* Mon–Fri */              return { openH:  8, openM: 30, closeH: 20, closeM: 0 };
}

/** True when `at` falls inside the day's trading window. Pass a Date
 *  (or omit for "now"). Local-clock based — fine for a UK-only office. */
export function isWithinTradingHours(at: Date = new Date()): boolean {
  const day = at.getDay();
  const { openH, openM, closeH, closeM } = openingHoursFor(day);
  const open  = new Date(at.getFullYear(), at.getMonth(), at.getDate(), openH,  openM,  0).getTime();
  const close = new Date(at.getFullYear(), at.getMonth(), at.getDate(), closeH, closeM, 0).getTime();
  const t = at.getTime();
  return t >= open && t < close;
}
