/**
 * Sales · Board 1 widget specs.
 *
 * Captures every tile on the director's NB-CV overview board as a
 * declarative spec — source, query (or dataset filter), label, output
 * format. The /api/sales-board-1 endpoint reads this list, fans out
 * to MS-SQL / Noetica datasets / Zendesk in parallel, and returns one
 * unified payload. The view renders by id.
 *
 * Spec order matches the source-of-truth Geckoboard layout 1:1; the
 * SalesBoard1View groups them visually (KPI strip, hourly trend band,
 * etc.) but the spec list itself is the catalogue.
 *
 * Updating numbers monthly:
 *   • NB Earn MTD target lives in `SALES_BOARD_1_TARGETS` below.
 *     Bump it on the 1st of each month and redeploy.
 *
 * Two widgets are deferred — Google + MS Ads spend (7a) and Mixpanel
 * Radio Ads funnel (11) — and render as muted "Pending data source"
 * placeholders so the layout doesn't reflow when the connectors land.
 */

// ─── Widget spec types ───────────────────────────────────────────────────

/** Output formatting hint for the view. Each form is locale-aware via
 *  Intl.NumberFormat at render time, but the *shape* (suffix, decimals)
 *  is fixed here so spec authors don't have to pick CSS / templating
 *  every time. */
export type WidgetFormat =
  | 'count'      // 173        — comma-grouped integer
  | 'count-k'    // 13.9K      — k-suffix when ≥ 1,000
  | 'gbp'        // £52,575    — comma-grouped, no decimals
  | 'gbp-k'      // £35.54K    — k-suffix when ≥ 1,000, 2 decimals
  | 'gbp-m'      // £2.21M     — m-suffix when ≥ 1,000,000
  | 'gbp-2dp'    // £305.08    — 2 decimal places, no suffix
  | 'percent';   // 47%        — trailing percent, 0–1 decimals

interface BaseWidget {
  id:        string;
  label:     string;
  format:    WidgetFormat;
}

/** SQL-backed widget — runs `query` against MS-SQL via runQuery and
 *  reads the first column of the first row as a scalar (or the whole
 *  result for chart visuals). */
interface SqlWidget extends BaseWidget {
  source:    'sql';
  query:     string;
  visual?:   'big-number' | 'big-number-with-target' | 'bar-pair';
  /** For 'bar-pair': map result columns → series. */
  xKey?:     string;
  series?:   Array<{ key: string; label: string; tint: string }>;
  /** For 'big-number-with-target': key into the board's `targets` map. */
  targetKey?: string;
}

/** Dataset-backed widget — reads a Noetica-pushed dataset and applies
 *  an aggregation over a column with an optional filter. Mirrors the
 *  Geckoboard "Field / Aggregate / Filter" widget shape. */
interface DatasetWidget extends BaseWidget {
  source:    'dataset';
  dataset:   string;
  field:     string;
  agg:       'sum' | 'avg' | 'count';
  /** Equality or IN filter on row columns. Multiple keys → AND. Field
   *  lookups are case-insensitive so PascalCase ↔ UPPERCASE pushes both
   *  resolve. */
  where?:    Record<string, string | number | { in: string[] }>;
  visual?:   'big-number';
}

/** Zendesk-backed widget — wraps fetchZendeskMetric with a small
 *  declarative shim. Negation is supported via `negate: true` on each
 *  filter, lifting the previous limitation in the existing abstraction. */
interface ZendeskWidget extends BaseWidget {
  source:    'zendesk';
  /** Mirrors ZD_METRICS keys in lib/zendesk.ts (open_tickets, created_tickets, …). */
  metric:    string;
  /** Time preset (today / yesterday / mtd / all_time / …). Defaults to all_time. */
  time?:     string;
  zd_filters?: Array<{ field: string; value: string; negate?: boolean }>;
}

/** Placeholder for a tile whose data source isn't wired up yet. The
 *  view renders a muted "Pending data source" card so the layout slot
 *  stays stable when the connector eventually lands. */
interface PlaceholderWidget extends BaseWidget {
  source:    'placeholder';
  reason:    string;
}

export type WidgetSpec = SqlWidget | DatasetWidget | ZendeskWidget | PlaceholderWidget;

// ─── Hourly trend SQL ────────────────────────────────────────────────────
//
// The three trend charts (Earn v Yesterday, Earn v Last Week, IPP v Last
// Week) all share the same shape: hourly cumulative bar chart with
// carry-forward when a sample is missing, and NULL for hours past the
// max recorded so the chart doesn't draw misleading flat-lines into
// the future. Building the SQL via a small helper keeps the three
// queries in lockstep.

function hourlyTrendQuery(opts: {
  metric:        'Earn' | 'IPP';
  comparisonDays: number;        // 1 = vs yesterday, 7 = vs last week
  comparisonLabel: 'Yesterday' | 'Last week';
  hourCeiling:   number;         // 23 for Earn-v-Yesterday, 22 for the rest
}): string {
  const { metric, comparisonDays, comparisonLabel, hourCeiling } = opts;
  const hours = Array.from({ length: hourCeiling - 8 + 1 }, (_, i) => 8 + i);
  const hourCte = hours
    .map((h, i) => (i === 0 ? `SELECT ${h} AS [Hour]` : `SELECT ${h}`))
    .join(' UNION ALL ');

  return `
SELECT
    RIGHT('0' + CAST(H.[Hour] AS varchar(2)), 2) AS [Hour],

    CASE
        WHEN H.[Hour] > CMax.MaxHour THEN NULL
        ELSE
            CASE
                WHEN COALESCE(C.${metric}, CPrev.${metric}, 0) < 0 THEN 0
                ELSE COALESCE(C.${metric}, CPrev.${metric}, 0)
            END
    END AS [${comparisonLabel}],

    CASE
        WHEN H.[Hour] > TMax.MaxHour THEN NULL
        ELSE
            CASE
                WHEN COALESCE(T.${metric}, TPrev.${metric}, 0) < 0 THEN 0
                ELSE COALESCE(T.${metric}, TPrev.${metric}, 0)
            END
    END AS [Today]

FROM ( ${hourCte} ) H

OUTER APPLY (
    SELECT MAX([Hour]) AS MaxHour
    FROM SalesBoardHistoryByHour
    WHERE CapturedDate = DATEADD(DAY, -${comparisonDays}, CAST(GETDATE() AS date))
      AND [Hour] BETWEEN 8 AND ${hourCeiling}
      AND ${metric} IS NOT NULL
) CMax

OUTER APPLY (
    SELECT MAX([Hour]) AS MaxHour
    FROM SalesBoardHistoryByHour
    WHERE CapturedDate = CAST(GETDATE() AS date)
      AND [Hour] BETWEEN 8 AND ${hourCeiling}
      AND ${metric} IS NOT NULL
) TMax

LEFT JOIN SalesBoardHistoryByHour C
    ON C.CapturedDate = DATEADD(DAY, -${comparisonDays}, CAST(GETDATE() AS date))
   AND C.[Hour] = H.[Hour]

LEFT JOIN SalesBoardHistoryByHour T
    ON T.CapturedDate = CAST(GETDATE() AS date)
   AND T.[Hour] = H.[Hour]

OUTER APPLY (
    SELECT TOP (1)
        CASE WHEN ${metric} < 0 THEN 0 ELSE ${metric} END AS ${metric}
    FROM SalesBoardHistoryByHour
    WHERE CapturedDate = DATEADD(DAY, -${comparisonDays}, CAST(GETDATE() AS date))
      AND [Hour] BETWEEN 8 AND ${hourCeiling}
      AND [Hour] < H.[Hour]
      AND ${metric} IS NOT NULL
    ORDER BY [Hour] DESC
) CPrev

OUTER APPLY (
    SELECT TOP (1)
        CASE WHEN ${metric} < 0 THEN 0 ELSE ${metric} END AS ${metric}
    FROM SalesBoardHistoryByHour
    WHERE CapturedDate = CAST(GETDATE() AS date)
      AND [Hour] BETWEEN 8 AND ${hourCeiling}
      AND [Hour] < H.[Hour]
      AND ${metric} IS NOT NULL
    ORDER BY [Hour] DESC
) TPrev

ORDER BY H.[Hour];
`.trim();
}

// ─── Targets ─────────────────────────────────────────────────────────────
//
// REVIEW MONTHLY — bump on the 1st of each month and redeploy.
// Mirrors the Gecko-side hardcoded target ("prompted each month").
// Eventually this should move into a wb_targets admin-edited table so
// non-engineers can update without a deploy.

export const SALES_BOARD_1_TARGETS: Record<string, number> = {
  'nb-earn-mtd': 2_370_000, // REVIEW MONTHLY
};

// ─── Division code lists ─────────────────────────────────────────────────
//
// Every NB CV division code maps to either the Direct or External
// channel. Direct + External should always sum to Z-ALL's BrokerageEarn;
// the API logs a warning if they drift > £1, surfacing any new code that
// landed in the dataset without being classified here.

const DIRECT_DIVISIONS:   string[] = ['NCOM','VANI','VCOL','VCOM','CLD','NV','AI','VLD','BUSC','CCOM','VANL'];
const EXTERNAL_DIVISIONS: string[] = ['VICN','VLDX','VICX','NVLD'];

export const SALES_BOARD_1_DIVISIONS = {
  direct:   DIRECT_DIVISIONS,
  external: EXTERNAL_DIVISIONS,
  all:      [...DIRECT_DIVISIONS, ...EXTERNAL_DIVISIONS],
};

// ─── Widget specs ────────────────────────────────────────────────────────

export const SALES_BOARD_1_WIDGETS: WidgetSpec[] = [
  // 1. Earn (headline brokerage earn)
  { id: 'earn-today', label: 'Earn',
    source: 'dataset', dataset: 'division',
    field: 'BrokerageEarn', agg: 'sum',
    where: { Division: 'Z-ALL' },
    format: 'gbp-k', visual: 'big-number' },

  // 2. Webbys — Zendesk open tickets, online-purchase tag, excluding 4 failure tags
  { id: 'webbys', label: 'Webbys',
    source: 'zendesk', metric: 'open_tickets',
    zd_filters: [
      { field: 'tag', value: 'onlinepurchase' },
      { field: 'tag', value: 'failedatvalidation',  negate: true },
      { field: 'tag', value: 'debtwebby',           negate: true },
      { field: 'tag', value: 'nsfailedatvalidation', negate: true },
      { field: 'tag', value: 'overdueapproval',     negate: true },
    ],
    format: 'count' },

  // 3a. WEBCNX Today — created tickets today tagged webcanref
  { id: 'webcnx-today', label: 'WEBCNX Today',
    source: 'zendesk', metric: 'created_tickets', time: 'today',
    zd_filters: [{ field: 'tag', value: 'webcanref' }],
    format: 'count' },

  // 3b. Manual Wrap Ups — open tickets tagged manualwrap
  { id: 'manual-wrap-ups', label: 'Manual Wrap Ups',
    source: 'zendesk', metric: 'open_tickets',
    zd_filters: [{ field: 'tag', value: 'manualwrap' }],
    format: 'count' },

  // 4a-4d. Today + MTD volume — all from SalesBoard, Team='All'
  { id: 'quotes-today', label: 'Quotes Today',
    source: 'sql',
    query: "SELECT Quotes FROM SalesBoard WHERE Date = CONVERT(DATE, GETDATE()) AND Team = 'All'",
    format: 'count' },
  { id: 'sales-today', label: 'Sales Today',
    source: 'sql',
    query: "SELECT Sales FROM SalesBoard WHERE Date = CONVERT(DATE, GETDATE()) AND Team = 'All'",
    format: 'count' },
  { id: 'quotes-mtd', label: 'Quotes MTD',
    source: 'sql',
    query: "SELECT SUM(Quotes) FROM SalesBoard WHERE Date BETWEEN DATEADD(M, DATEDIFF(M, 0, GETDATE()), 0) AND CONVERT(DATE, GETDATE()) AND Team = 'All'",
    format: 'count-k' },
  { id: 'sales-mtd', label: 'Sales MTD',
    source: 'sql',
    query: "SELECT SUM(Sales) FROM SalesBoard WHERE Date BETWEEN DATEADD(M, DATEDIFF(M, 0, GETDATE()), 0) AND CONVERT(DATE, GETDATE()) AND Team = 'All'",
    format: 'count' },

  // 5a, 5b. Direct v External — same dataset, complement filters
  { id: 'direct-earn', label: 'Direct',
    source: 'dataset', dataset: 'division',
    field: 'BrokerageEarn', agg: 'sum',
    where: { Division: { in: DIRECT_DIVISIONS } },
    format: 'gbp-k', visual: 'big-number' },
  { id: 'external-earn', label: 'External',
    source: 'dataset', dataset: 'division',
    field: 'BrokerageEarn', agg: 'sum',
    where: { Division: { in: EXTERNAL_DIVISIONS } },
    format: 'gbp-k', visual: 'big-number' },

  // 6a. NB Units Today — Sales count from division dataset (NB-CV scope only)
  { id: 'nb-units-today', label: 'NB Units Today',
    source: 'dataset', dataset: 'division',
    field: 'Sales', agg: 'sum',
    where: { Division: 'Z-ALL' },
    format: 'count' },

  // 6b, 6c. IPP today + MTD avg
  { id: 'ipp-today', label: 'IPP Today',
    source: 'sql',
    query: "SELECT IPP FROM SalesBoard WHERE Date = CONVERT(DATE, GETDATE()) AND Team = 'All'",
    format: 'gbp-2dp' },
  { id: 'avg-ipp-mtd', label: 'Average IPP MTD',
    source: 'sql',
    query: "SELECT AVG(IPP) FROM SalesBoard WHERE Date BETWEEN DATEADD(M, DATEDIFF(M, 0, GETDATE()), 0) AND CONVERT(DATE, GETDATE()) AND Team = 'All'",
    format: 'gbp-2dp' },

  // 7a. VC Google + MS Ads spend — deferred
  { id: 'vc-spend-today', label: 'Spent Today · Ads',
    source: 'placeholder',
    reason: 'Awaiting Google Ads + Microsoft Ads API connectors',
    format: 'gbp-k' },

  // 7b. TradePoint Signups — latest snapshot
  { id: 'tradepoint-signups', label: 'TradePoint Signups',
    source: 'sql',
    query: 'SELECT TOP 1 ConsentCount FROM TradepointConsentCount ORDER BY TradepointConsentCountId DESC',
    format: 'count' },

  // 7c. QTS% Today — quote-to-sale conversion %
  { id: 'qts-today', label: 'QTS% Today',
    source: 'sql',
    query: "SELECT CAST((SUM(Sales) * 100.0) / NULLIF(SUM(Quotes), 0) AS DECIMAL(6,2)) AS QuoteToSalePercent FROM SalesBoard WHERE [Date] = CONVERT(date, GETDATE()) AND Team = 'All'",
    format: 'percent' },

  // 8. Earn v Yesterday — hourly cumulative bar chart, hours 08-23
  { id: 'earn-vs-yesterday', label: 'Earn v Yesterday',
    source: 'sql',
    query: hourlyTrendQuery({ metric: 'Earn', comparisonDays: 1, comparisonLabel: 'Yesterday', hourCeiling: 23 }),
    format: 'gbp-k',
    visual: 'bar-pair', xKey: 'Hour',
    series: [
      { key: 'Yesterday', label: 'Yesterday', tint: '#475569' },
      { key: 'Today',     label: 'Today',     tint: '#38bdf8' },
    ] },

  // 9. NB Earn MTD — biggest tile, with target progress bar
  { id: 'nb-earn-mtd', label: 'NB Earn MTD',
    source: 'sql',
    query: "SELECT SUM(SB.Earn + ISNULL(MTD.Earn, 0)) FROM SalesBoard SB LEFT JOIN SalesBoardMTD MTD ON DATEADD(DD, -1, SB.Date) = MTD.Date AND DATEPART(DD, CONVERT(DATE, GETDATE())) != 1 AND SB.Team = MTD.Team WHERE SB.Team = 'All' AND SB.Date = CONVERT(DATE, GETDATE())",
    format: 'gbp-m',
    visual: 'big-number-with-target', targetKey: 'nb-earn-mtd' },

  // 10. Earn v Last Week — hourly, hours 08-22
  { id: 'earn-vs-last-week', label: 'Earn v Last Week',
    source: 'sql',
    query: hourlyTrendQuery({ metric: 'Earn', comparisonDays: 7, comparisonLabel: 'Last week', hourCeiling: 22 }),
    format: 'gbp-k',
    visual: 'bar-pair', xKey: 'Hour',
    series: [
      { key: 'Last week', label: 'Last week', tint: '#475569' },
      { key: 'Today',     label: 'Today',     tint: '#38bdf8' },
    ] },

  // 11. Radio Ads (30 Days) funnel — deferred
  { id: 'radio-ads-funnel', label: 'Radio Ads (30 Days)',
    source: 'placeholder',
    reason: 'Awaiting Mixpanel API connector',
    format: 'count' },

  // 12. IPP v Last Week — hourly, hours 08-22
  { id: 'ipp-vs-last-week', label: 'IPP v Last Week',
    source: 'sql',
    query: hourlyTrendQuery({ metric: 'IPP', comparisonDays: 7, comparisonLabel: 'Last week', hourCeiling: 22 }),
    format: 'gbp-2dp',
    visual: 'bar-pair', xKey: 'Hour',
    series: [
      { key: 'Last week', label: 'Last week', tint: '#475569' },
      { key: 'Today',     label: 'Today',     tint: '#38bdf8' },
    ] },
];
