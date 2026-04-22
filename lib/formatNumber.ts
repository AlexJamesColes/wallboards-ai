/**
 * Shared number formatting utility.
 * Reads num_abbreviation, num_decimals, num_unit_type, num_unit from display_config.
 */

export interface NumFormatCfg {
  num_abbreviation?: 'auto' | 'none' | 'K' | 'M' | 'B';
  num_decimals?:     'auto' | number;
  num_unit_type?:    'auto' | 'prefix' | 'suffix';
  num_unit?:         string;
}

/**
 * Format a number according to display_config number-format settings.
 *
 * @param value  The raw numeric value
 * @param cfg    The display_config object (or a subset of it)
 */
export function formatNumber(value: number | null | undefined, cfg: NumFormatCfg = {}): string {
  if (value === null || value === undefined || isNaN(Number(value))) return '—';

  const n = Number(value);

  // ── Abbreviation ──────────────────────────────────────────────────────────
  const abbr = cfg.num_abbreviation ?? 'auto';

  let divisor  = 1;
  let abbrSuffix = '';

  if (abbr === 'auto') {
    const abs = Math.abs(n);
    if      (abs >= 1_000_000_000) { divisor = 1_000_000_000; abbrSuffix = 'B'; }
    else if (abs >= 1_000_000)     { divisor = 1_000_000;     abbrSuffix = 'M'; }
    else if (abs >= 10_000)        { divisor = 1_000;         abbrSuffix = 'K'; }
  } else if (abbr === 'K') { divisor = 1_000;         abbrSuffix = 'K'; }
  else if   (abbr === 'M') { divisor = 1_000_000;     abbrSuffix = 'M'; }
  else if   (abbr === 'B') { divisor = 1_000_000_000; abbrSuffix = 'B'; }
  // 'none' → divisor stays 1, no suffix

  const divided = n / divisor;

  // ── Decimal places ────────────────────────────────────────────────────────
  const decimals = cfg.num_decimals ?? 'auto';
  let formatted: string;

  if (decimals === 'auto') {
    // Show decimals only when abbreviated and the abbreviated value isn't a whole number
    if (divisor > 1 && divided % 1 !== 0) {
      formatted = divided.toFixed(1);
    } else {
      // Use locale formatting (thousands separators) for the full value
      formatted = divisor > 1
        ? divided.toLocaleString(undefined, { maximumFractionDigits: 1 })
        : n.toLocaleString();
    }
  } else {
    const dp = Number(decimals);
    formatted = divisor > 1
      ? divided.toFixed(dp)
      : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }

  // Append abbreviation suffix
  const withAbbr = formatted + abbrSuffix;

  // ── Unit (prefix / suffix) ────────────────────────────────────────────────
  const unitType = cfg.num_unit_type ?? 'auto';
  const unit     = cfg.num_unit ?? '';

  if (!unit || unitType === 'auto') return withAbbr;
  if (unitType === 'prefix') return unit + withAbbr;
  return withAbbr + unit;
}
