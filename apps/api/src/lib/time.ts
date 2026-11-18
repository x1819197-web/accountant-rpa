export const TASHKENT_OFFSET_MINUTES = 5 * 60;

export function tashkentDayKey(date: Date = new Date()): string {
  return new Date(date.getTime() + TASHKENT_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

export function tashkentDayStart(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00+05:00`);
}

export function tashkentDayEnd(dayKey: string): Date {
  return new Date(tashkentDayStart(dayKey).getTime() + 86_400_000);
}

export function shiftDayKey(dayKey: string, days: number): string {
  const shifted = tashkentDayStart(dayKey).getTime() + days * 86_400_000 + TASHKENT_OFFSET_MINUTES * 60_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

export function tashkentDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const iso = new Date(date.getTime() + TASHKENT_OFFSET_MINUTES * 60_000).toISOString();
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} ${iso.slice(11, 19)}`;
}
