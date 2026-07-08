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
