/**
 * Reference data for the Focus environment at vst-focus-seven.
 *
 * Focus is a broadcast-TV advertising yield / inventory-optimisation system.
 * These values are read from the server-rendered bootstrap JSON that every page
 * embeds (e.g. `focus_optimiser.createOptimiserRulesView({...})`).
 *
 * They are environment data, not constants: if the suite is pointed at another
 * Focus instance, re-capture them rather than assuming they still hold.
 */

export const APP_NAME = 'Focus';

/** Every route exposed by the top navigation, in menu order. */
export const ROUTES = {
  home: '/',
  // Reports
  inventorySummary: '/ProgramInventorySummary',
  bookingPaceSummary: '/BookingPaceSummary',
  bookingDiscountPace: '/BookingDiscountPace',
  programVsForecast: '/ProgramVsForecast',
  aboveBelowForecast: '/AboveBelowForecast',
  // Forecast
  forecast: '/Forecast',
  forecastBlacklists: '/ForecastBlackLists',
  forecastDiscountCurves: '/ForecastDiscountCurves',
  // Optimise
  optimiserRules: '/OptimiserRules',
  gridMaintenance: '/GridMaintenance',
  reOptimise: '/ReOptimise',
  bulkOverride: '/BulkOverride',
  // Top level
  recommendations: '/Recommendations',
} as const;

export type RouteKey = keyof typeof ROUTES;

/** Expected document title for each route. Focus uses "<Page> - Focus". */
export const PAGE_TITLES: Record<RouteKey, string> = {
  home: 'Home - Focus',
  inventorySummary: 'Inventory Summary - Focus',
  bookingPaceSummary: 'Booking Pace Summary - Focus',
  bookingDiscountPace: 'Booking / Discount Pace - Focus',
  programVsForecast: 'Program vs. Forecast Curves - Focus',
  aboveBelowForecast: 'Above Below Forecast - Focus',
  forecast: 'Create and View Forecasts - Focus',
  forecastBlacklists: 'Forecast Blacklists - Focus',
  forecastDiscountCurves: 'Forecast Discount Curves - Focus',
  optimiserRules: 'Optimiser Rules - Focus',
  gridMaintenance: 'Grid Maintenance - Focus',
  reOptimise: 'Re-Optimise - Focus',
  bulkOverride: 'Bulk Override Flag - Focus',
  recommendations: 'Recommendations - Focus',
};

/** The first on-page heading (`.page-title`) each route renders. */
export const PAGE_HEADINGS: Partial<Record<RouteKey, string>> = {
  inventorySummary: 'Inventory Summary',
  bookingPaceSummary: 'Booking Pace Summary',
  programVsForecast: 'Program vs. Forecast Curves',
  forecast: 'Create and View Forecasts',
  optimiserRules: 'Optimiser Rules',
  reOptimise: 'Re-Optimise',
  recommendations: 'Recommendations',
};

/** Per-page element id prefix. Focus namespaces every control as `<prefix>-...`. */
export const ID_PREFIX = {
  inventorySummary: 'pir',
  bookingPaceSummary: 'bps',
  bookingDiscountPace: 'bdp',
  programVsForecast: 'pvf',
  aboveBelowForecast: 'abf',
  forecast: 'cvf',
  optimiserRules: 'optimiser',
  reOptimise: 'rop',
  bulkOverride: 'bof',
  recommendations: 'rec',
} as const;

/** Channels (broadcast networks). `code` is what the pickers display. */
export const CHANNELS = [
  { id: 1, code: '7', name: 'Channel 7' },
  { id: 3, code: '72', name: '7TWO' },
  { id: 10, code: '74', name: '7food' },
  { id: 2, code: '7M', name: '7 mate' },
  { id: 7, code: '76', name: '76' },
  { id: 11, code: '75', name: '7Bravo' },
  { id: 12, code: '7F', name: '7Flix' },
  { id: 4, code: 'ES', name: 'ESPN' },
  { id: 5, code: 'E2', name: 'ESPN2' },
  { id: 6, code: 'AF', name: 'AFL7' },
  { id: 8, code: 'A3', name: '7AFL' },
  { id: 9, code: 'RC', name: 'Racing.com' },
] as const;

/**
 * Markets ("stations" in the API, labelled "Market" in the UI).
 * entityType: 0 = market, 2 = aggregate, 3 and 4 = group header.
 */
export const MARKETS = [
  { id: 7, code: 'Metro', name: '5 City Metro', entityType: 3 },
  { id: 1, code: 'SYD', name: 'Sydney', entityType: 0 },
  { id: 2, code: 'MEL', name: 'Melbourne', entityType: 0 },
  { id: 3, code: 'BRI', name: 'Brisbane', entityType: 0 },
  { id: 4, code: 'ADE', name: 'Adelaide', entityType: 0 },
  { id: 5, code: 'PER', name: 'Perth', entityType: 0 },
  { id: 73, code: 'REGNL', name: 'Regional', entityType: 4 },
  { id: 29, code: 'VIC', name: 'Victoria Agg', entityType: 2 },
  { id: 50, code: 'SUN', name: 'Sunshine Coast', entityType: 0 },
  { id: 51, code: 'WID', name: 'Wide Bay', entityType: 0 },
] as const;

/** The 7-bit day mask Focus sends as dayOfWeekId. Monday is bit 0. */
export const DAY_BITS = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 4,
  Thursday: 8,
  Friday: 16,
  Saturday: 32,
  Sunday: 64,
} as const;

/** Combines day names into the mask, e.g. Mon + Tue + Thu = 11. */
export function dayMask(...days: Array<keyof typeof DAY_BITS>): number {
  return days.reduce((mask, day) => mask | DAY_BITS[day], 0);
}

/**
 * Demand flags, ordered least to most discountable.
 * `maxDiscount` is the ceiling the optimiser may apply for that flag.
 */
export const DEMAND_FLAGS = [
  { id: 1, description: 'RED', maxDiscount: 0.35 },
  { id: 2, description: 'ORANGE', maxDiscount: 0.5 },
  { id: 3, description: 'YELLOW', maxDiscount: 0.6 },
  { id: 4, description: 'GREEN', maxDiscount: 0.7 },
  { id: 5, description: 'PURPLE', maxDiscount: 0.8 },
  { id: 6, description: 'BLUE', maxDiscount: 1 },
] as const;

export const DAYS_OF_WEEK = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const;

/** `dayOfWeekId` is a 7-bit mask; 127 selects every day. */
export const ALL_DAYS_MASK = 127;

/** UI vocabulary is configurable per deployment; here it is Channel / Market. */
export const TERMS = { channel: 'Channel', station: 'Market' } as const;

/** Read-only API endpoints, safe to exercise in the default suite. */
export const READ_API = {
  programInventory: '/api/ProgramInventory',
  inventoryBookingPace: '/api/InventoryBookingPace',
  bookingPaceSummary: '/api/BookingPaceSummary',
  bookingDiscountPace: '/api/BookingDiscountPace',
  programVsForecast: '/api/ProgramVsForecast',
  aboveBelowForecast: '/api/AboveBelowForecast',
  recommendations: '/api/Recommendations',
  optimiserRule: '/api/OptimiserRule',
  gapsAndOverlaps: '/api/GapsAndOverlaps',
  forecastDiscountBands: '/api/ForecastDiscountBands',
} as const;

/**
 * Endpoints with mutating verbs, or that kick off long-running server jobs.
 * Nothing in the default suite may call these.
 */
export const MUTATING_API = [
  '/api/ReOptimise',        // POST only; GET sub-routes are read-only
  '/api/BulkOverrideFlags', // POST only; GET on the same path polls progress
  '/api/Recommendations',   // POST / PUT
  '/api/OptimiserRule',     // DELETE
  '/api/Blacklist',         // DELETE
  '/api/forecast',          // POST / PUT / DELETE
  '/api/gridmaintenance',   // POST / PUT
] as const;

/**
 * The standard query contract shared by every report endpoint.
 * Focus sends all of these on every call, even when a page ignores some.
 */
export interface ReportQuery {
  channelId: number;
  stationId: number;
  dayOfWeekId: number;
  startTime: number;   // HHmm as an integer, e.g. 1800
  endTime: number;     // HHmm as an integer, e.g. 2230
  midPoint: number;
  startDate: string;   // yyyy-MM-dd
  week: string;        // yyyy-MM-dd, the Sunday of the week
  endDate: string;     // yyyy-MM-dd
  sortBy: string;
  sortOrder: string;
  selectedItemId: number;
  periodStyle: string;
  comparativeForecastId: number;
  comparativeIsProgramSpecific: boolean;
  comparativeForecastModifier: number;
  selectedChannels: string;
  selectedStations: string;
  summaryType: number;
  itemDate: string;
}

/** A known-good query against real data in this environment. */
export function defaultReportQuery(overrides: Partial<ReportQuery> = {}): ReportQuery {
  const { start, end } = currentBroadcastWeek();
  return {
    channelId: 1,
    stationId: 1,
    dayOfWeekId: ALL_DAYS_MASK,
    startTime: 1800,
    endTime: 2230,
    midPoint: 0,
    startDate: start,
    week: start,
    endDate: end,
    sortBy: 'Week',
    sortOrder: 'Desc',
    selectedItemId: -1,
    periodStyle: 'Weeks',
    comparativeForecastId: 0,
    comparativeIsProgramSpecific: false,
    comparativeForecastModifier: 0,
    selectedChannels: '1',
    selectedStations: '1',
    summaryType: 0,
    itemDate: '',
    ...overrides,
  };
}

/**
 * A week that is populated across every report endpoint in this environment.
 *
 * The data snapshot is older than "today", and coverage is patchy: as of
 * 25 Aug 2026, /api/AboveBelowForecast returns 404 (no rows) for the current
 * week but 200 for this one. Use this whenever a test needs populated data, and
 * reserve the current week for tests about default behaviour.
 *
 * A widened time window matters just as much -- see WIDE_TIME_WINDOW.
 */
export const DATA_RICH_WEEK = { start: '2026-06-21', end: '2026-06-27' } as const;

/**
 * Broad enough to catch inventory outside the default evening window.
 * /api/Recommendations returns 404 for 1800-2230 but 200 for 0600-2359 in the
 * same week, so a narrow window reads as "no data" when data exists.
 */
export const WIDE_TIME_WINDOW = { startTime: 600, endTime: 2359 } as const;

/** A query against the known-populated week, for tests that need real rows. */
export function dataRichQuery(overrides: Partial<ReportQuery> = {}): ReportQuery {
  return defaultReportQuery({
    startDate: DATA_RICH_WEEK.start,
    week: DATA_RICH_WEEK.start,
    endDate: DATA_RICH_WEEK.end,
    ...WIDE_TIME_WINDOW,
    ...overrides,
  });
}

/** Focus weeks run Sunday to Saturday. Returns ISO dates for the week of `ref`. */
export function currentBroadcastWeek(ref: Date = new Date()): { start: string; end: string } {
  const d = new Date(Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // back to Sunday
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: iso(d), end: iso(end) };
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Focus renders dates as dd/MM/yyyy. */
export function toFocusDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return [p(d.getDate()), p(d.getMonth() + 1), d.getFullYear()].join('/');
}
