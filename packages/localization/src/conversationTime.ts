/**
 * How a conversation's last activity is worded in the conversation list.
 *
 * Built on `Intl.DateTimeFormat` alone: Hermes ships it and almost nothing else of `Intl` --
 * `RelativeTimeFormat` included -- so "Yesterday"-style wording is not available on mobile without
 * a polyfill, and the three tiers below are what can be said the same way on every platform.
 */

/** Which clock a time is read on. `system` is the locale's own convention. */
export type TimeFormat = 'system' | '12h' | '24h'

/**
 * The explicit date layouts the appearance settings offer, named by their pattern: `D` and `M`
 * unpadded, `DD` and `MM` padded to two digits, `YY` the last two digits of the year.
 */
export type ExplicitDateFormat =
  | 'M/D/YY'
  | 'D/M/YY'
  | 'DD/MM/YYYY'
  | 'DD.MM.YYYY'
  | 'DD-MM-YYYY'
  | 'YYYY/M/D'
  | 'YYYY.M.D'
  | 'YYYY-M-D'

/** How a date is laid out. `system` is the locale's short date. */
export type DateFormat = 'system' | ExplicitDateFormat

export interface ConversationTimeOptions {
  /** Defaults to `system`. */
  timeFormat?: TimeFormat | undefined
  /** Defaults to `system`. */
  dateFormat?: DateFormat | undefined
  /**
   * A BCP 47 tag for the words and the conventions. Absent means the runtime's default, which is
   * the device's locale with its region -- the region being what decides day-first or month-first.
   */
  locale?: string | undefined
}

/** Days before today that still read as a weekday; a week ago would repeat today's name. */
const WEEKDAY_SPAN_DAYS = 7

const MS_PER_DAY = 86_400_000

/**
 * A local calendar day as a whole number, so two timestamps compare by date rather than by elapsed
 * time. Counted through `Date.UTC` because local midnights are not a whole number of days apart
 * across a daylight-saving change.
 */
function localDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

const EXPLICIT_DATES: Record<ExplicitDateFormat, (date: Date) => string> = {
  'M/D/YY': (d) => `${d.getMonth() + 1}/${d.getDate()}/${pad2(d.getFullYear() % 100)}`,
  'D/M/YY': (d) => `${d.getDate()}/${d.getMonth() + 1}/${pad2(d.getFullYear() % 100)}`,
  'DD/MM/YYYY': (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`,
  'DD.MM.YYYY': (d) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`,
  'DD-MM-YYYY': (d) => `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`,
  'YYYY/M/D': (d) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
  'YYYY.M.D': (d) => `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`,
  'YYYY-M-D': (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/**
 * One formatter per locale and set of options, kept for the life of the process.
 *
 * Every row formats its time on every render, and building an `Intl` object is the expensive part:
 * reused, a call is about a hundred times cheaper on V8, and Hermes builds them slower still. The
 * options come from the few fixed shapes below, so the map stays a handful of entries.
 */
function formatter(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`
  let cached = formatters.get(key)
  if (cached === undefined) {
    cached = new Intl.DateTimeFormat(locale, options)
    formatters.set(key, cached)
  }
  return cached
}

/**
 * Whether the locale reads a 12-hour clock, or undefined where the runtime will not say.
 *
 * Asked rather than assumed from the language: en-US and en-GB share one and differ here.
 */
function localeUsesTwelveHours(locale: string | undefined): boolean | undefined {
  const resolved = formatter(locale, { hour: 'numeric' }).resolvedOptions()
  if (resolved.hourCycle !== undefined)
    return resolved.hourCycle === 'h11' || resolved.hourCycle === 'h12'
  return resolved.hour12
}

/**
 * The hour and minute fields for a clock.
 *
 * A 24-hour clock pads its hour and a 12-hour clock does not ("00:05", "12:05 am"). `numeric`
 * alone gives en-GB "0:05" at midnight and "18:00" in the evening, a width that changes with the
 * hour, which is why the system clock is asked which it is rather than left to `numeric`.
 */
function clockFields(
  locale: string | undefined,
  timeFormat: TimeFormat,
): Intl.DateTimeFormatOptions {
  if (timeFormat === '12h') return { hour: 'numeric', minute: '2-digit', hour12: true }
  if (timeFormat === '24h') return { hour: '2-digit', minute: '2-digit', hour12: false }
  // TODO: `Intl` knows the locale's clock and not the device's own setting, so an en-US phone with
  // the 24-hour switch on reads "6:00 PM" here beside "18:00" in its status bar. Prefer the
  // device's setting once a native read of it exists (expo-localization's `uses24hourClock`).
  const twelve = localeUsesTwelveHours(locale)
  return { hour: twelve === false ? '2-digit' : 'numeric', minute: '2-digit' }
}

/**
 * Today: the time alone. The six days before it: the weekday and the time. Anything older, or a
 * day ahead of `nowMs` from a sender's clock running fast: the date alone.
 */
export function formatConversationTime(
  timestampMs: number,
  nowMs: number,
  options: ConversationTimeOptions = {},
): string {
  const { locale, timeFormat = 'system', dateFormat = 'system' } = options
  const then = new Date(timestampMs)
  const daysAgo = localDayNumber(new Date(nowMs)) - localDayNumber(then)

  if (daysAgo === 0) return formatter(locale, clockFields(locale, timeFormat)).format(then)

  if (daysAgo > 0 && daysAgo < WEEKDAY_SPAN_DAYS)
    return formatter(locale, { weekday: 'short', ...clockFields(locale, timeFormat) }).format(then)

  if (dateFormat === 'system') return formatter(locale, { dateStyle: 'short' }).format(then)
  return EXPLICIT_DATES[dateFormat](then)
}
