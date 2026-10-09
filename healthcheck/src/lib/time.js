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
