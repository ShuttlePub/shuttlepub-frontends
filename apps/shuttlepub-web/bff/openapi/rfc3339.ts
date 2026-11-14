// RFC 3339 date-time: validated down to the calendar day and compared as an exact instant.
// Date.parse keeps milliseconds only, so two timestamps that differ below a millisecond
// would tie (or flip) when ordered with it; the producer orders by the full fractional
// seconds with the offset applied.

export type Instant = {
  /** Whole seconds since the Unix epoch (UTC, offset applied). */
  seconds: number;
  /** Fractional digits of the second, without trailing zeros ("" for a whole second). */
  fraction: string;
};

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** The instant a valid RFC 3339 date-time denotes, or null when it is not one (including an impossible calendar day). */
export function parseRfc3339(value: string): Instant | null {
  const match = DATE_TIME.exec(value);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  // 60 is the leap second RFC 3339 allows.
  if (hour > 23 || minute > 59 || second > 60) return null;
  const offsetSign = match[8];
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  if (offsetHour > 23 || offsetMinute > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, Math.min(second, 59), 0);
  const offset = (offsetHour * 60 + offsetMinute) * 60 * (offsetSign === "-" ? -1 : 1);
  const seconds = Math.floor(date.getTime() / 1000) + (second === 60 ? 1 : 0) - offset;
  return { seconds, fraction: (match[7] ?? "").replace(/0+$/, "") };
}

/** Negative when `a` is earlier than `b`, positive when later, 0 when they denote the same instant. */
export function compareInstants(a: Instant, b: Instant): number {
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const left = a.fraction.padEnd(width, "0");
  const right = b.fraction.padEnd(width, "0");
  return left < right ? -1 : left > right ? 1 : 0;
}
