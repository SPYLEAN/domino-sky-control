export const DAY = 1440;

export function parseHHMM(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid HH:MM time "${s}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid HH:MM time "${s}"`);
  return h * 60 + min;
}

/** Formats minutes-from-midnight in the dataset's single-day IST clock, flagging next-day rollover. */
export function fmt(t: number | null | undefined): string {
  if (t === null || t === undefined) return "—";
  const day = Math.floor(t / DAY);
  const m = ((t % DAY) + DAY) % DAY;
  const s = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return day > 0 ? `${s} +${day}d` : s;
}

export function fmtDur(mins: number): string {
  const sign = mins < 0 ? "-" : "";
  const a = Math.abs(mins);
  const h = Math.floor(a / 60);
  const m = a % 60;
  if (h === 0) return `${sign}${m}m`;
  return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}
