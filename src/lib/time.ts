// Sim-time helpers. The world counts in sim-days from genesis (day 0).
// Flavor epoch: genesis == Jan 1 of BASE_YEAR.

export const DAYS_PER_YEAR = 365;
export const BASE_YEAR = 2000;

export function ageOf(birthDay: number, currentDay: number): number {
  return Math.max(0, Math.floor((currentDay - birthDay) / DAYS_PER_YEAR));
}

export function simYear(day: number): number {
  return BASE_YEAR + Math.floor(day / DAYS_PER_YEAR);
}

/** Real-world "how long ago" — how long since this item was actually generated. */
export function humanizeAgo(date: Date | string): string {
  const then = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 45) return "just now";
  if (s < 90) return "1m ago";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

export function simDate(day: number): string {
  const year = simYear(day);
  const dayOfYear = ((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const month = Math.min(11, Math.floor(dayOfYear / 30));
  const dom = (dayOfYear % 30) + 1;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[month]} ${dom}, ${year}`;
}
