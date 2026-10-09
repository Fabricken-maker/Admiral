// Datum i Europe/Stockholm (samma tidszon som alla Admirals Meta-konton).
const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' });

export function stockholmDate(d = new Date()) {
  return fmt.format(d); // YYYY-MM-DD
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function monthStart(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

export function isoWeekKey(d = new Date()) {
  const [y, m, day] = stockholmDate(d).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
}

// ── Veckor (Modul C): måndag–söndag i Stockholm ──
export function mondayOf(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay() || 7;
  return addDays(dateStr, 1 - dow);
}

export function completedWeekStarts(n, now = new Date()) {
  const last = addDays(mondayOf(stockholmDate(now)), -7);
  return Array.from({ length: n }, (_, i) => addDays(last, -7 * (n - 1 - i)));
}

// UTC-ögonblicket för 00:00 Stockholmstid ett visst datum.
export function stockholmMidnight(dateStr) {
  const guess = new Date(`${dateStr}T00:00:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Stockholm', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(guess).map((x) => [x.type, x.value]));
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - guess.getTime();
  return new Date(guess.getTime() - offset);
}

// Meta justerar siffror 24–72 h i efterhand: veckan är slutlig 72 h efter veckoslut.
export function weekFinalAfter(weekStart) {
  return new Date(stockholmMidnight(addDays(weekStart, 7)).getTime() + 72 * 3600_000);
}
