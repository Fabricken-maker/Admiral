/**
 * Målgruppen i dashboarden: visningar per åldersgrupp (Meta insights, breakdowns=age).
 * Andelarna räknas här av Metas siffror. Under MIN_IMPRESSIONS visas "För lite data".
 */
export const MIN_IMPRESSIONS = 100;
const ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

export function aggregateAge(rows = []) {
  const byAge = new Map();
  for (const r of rows) {
    const age = r.age || 'Okänd';
    const e = byAge.get(age) || { age, impressions: 0, spend: 0 };
    e.impressions += Number(r.impressions || 0);
    e.spend += Number(r.spend || 0);
    byAge.set(age, e);
  }
  const total = [...byAge.values()].reduce((s, g) => s + g.impressions, 0);
  const rank = (a) => (ORDER.includes(a) ? ORDER.indexOf(a) : ORDER.length);
  const groups = [...byAge.values()]
    .filter((g) => g.impressions > 0)
    .sort((a, b) => rank(a.age) - rank(b.age))
    .map((g) => ({ ...g, spend: Math.round(g.spend * 100) / 100, share: total > 0 ? g.impressions / total : 0 }));
  return { total_impressions: total, enough: total >= MIN_IMPRESSIONS, groups };
}
