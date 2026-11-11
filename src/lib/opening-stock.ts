export type OpeningExpiryPrecision = "month" | "day";

/** Calendar dates, not instants. PostgreSQL has no year zero. */
export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Pharmacy business date irrespective of browser/server timezone. */
export function lagosToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isValidPhysicalCountDate(value: string, today: string = lagosToday()): boolean {
  return isValidCalendarDate(value) && isValidCalendarDate(today) && value <= today;
}

/** Exclusive Lagos calendar cutoff. Month labels are never converted to a fake printed day. */
export function expiryCutoff(precision: OpeningExpiryPrecision, originalLabel: string): string {
  const label = originalLabel.trim();
  if (precision === "day" && isValidCalendarDate(label)) return label;
  if (precision === "month") {
    const slash = /^(\d{2})\/(\d{4})$/.exec(label);
    const iso = /^(\d{4})-(\d{2})$/.exec(label);
    const year = Number(slash?.[2] ?? iso?.[1]);
    const month = Number(slash?.[1] ?? iso?.[2]);
    if (
      year >= 1 &&
      year <= 9999 &&
      month >= 1 &&
      month <= 12 &&
      !(year === 9999 && month === 12)
    ) {
      const nextYear = month === 12 ? year + 1 : year;
      const nextMonth = month === 12 ? 1 : month + 1;
      return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
    }
  }
  throw new Error("A valid known month or day expiry is required.");
}

export function describeOpeningExpiry(precision: OpeningExpiryPrecision, label: string): string {
  const cutoff = expiryCutoff(precision, label);
  return precision === "month"
    ? `${label.trim()} — valid through the labelled month; unavailable from ${cutoff} (Lagos).`
    : `${label.trim()} — unavailable on this date (exclusive cutoff, Lagos).`;
}
