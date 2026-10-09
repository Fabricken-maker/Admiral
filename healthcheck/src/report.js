// Rapporttext (svenska). Överst status, sedan bara avvikelser.
// Innehåller aldrig förslag på nya funktioner, förbättringar eller design —
// bara vad som var fel, var det sitter, vad som gjordes och om det verifierades.

export const STATUS = { GREEN: 'GRÖN', YELLOW: 'GUL', RED: 'RÖD' };
const ICON = { GRÖN: '🟢', GUL: '🟡', RÖD: '🔴' };
const AGENT_SV = { infra: 'infra', data: 'data', ui: 'grafik', jobs: 'jobb', orchestrator: 'modul' };

export function decideStatus(issues) {
  if (issues.some((i) => i.human || i.verified !== true)) return STATUS.RED;
  if (issues.length) return STATUS.YELLOW;
  return STATUS.GREEN;
}

export function buildReport({ status, startedAt, weekKey, trigger, dryRun, totals, issues }) {
  const lines = [];
  const when = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short' }).format(startedAt);
  const tag = [trigger !== 'scheduled' ? trigger === 'manual' ? 'manuell' : trigger : null, dryRun ? 'torrkörning' : null].filter(Boolean).join(', ');
  lines.push(`${ICON[status]} ${status} — Admiral veckokontroll ${weekKey} (${when}${tag ? `, ${tag}` : ''})`);

  const human = issues.filter((i) => i.human || i.verified !== true);
  const repaired = issues.filter((i) => !(i.human || i.verified !== true));
  const summary = [`${totals.checks} kontroller`, `${totals.ok} ok`];
  if (repaired.length) summary.push(`${repaired.length} reparerade`);
  if (human.length) summary.push(`${human.length} kräver människa`);
  if (totals.skipped) summary.push(`${totals.skipped} kunde inte köras`);
  lines.push(`${summary.join(', ')}.`);

  if (human.length) {
    lines.push('', 'KRÄVER MÄNNISKA');
    for (const i of human) lines.push(...issueLines(i));
  }
  if (repaired.length) {
    lines.push('', 'REPARERAT');
    for (const i of repaired) lines.push(...issueLines(i));
  }
  if (totals.skippedList?.length) {
    lines.push('', 'KUNDE INTE KÖRAS');
    for (const s of totals.skippedList) lines.push(`• ${s.cause} [${AGENT_SV[s.agent] || s.agent}]`);
  }
  return lines.join('\n');
}

function issueLines(i) {
  const out = [`• ${i.cause} [${AGENT_SV[i.agent] || i.agent}]`];
  if (i.where) out.push(`  Plats: ${i.where}`);
  for (const d of (i.deviations || []).slice(0, 5)) out.push(`  – ${formatDeviation(d)}`);
  if ((i.deviations || []).length > 5) out.push(`  – … och ${i.deviations.length - 5} till (se admiral_healthchecks)`);
  if (i.action) {
    const a = i.action;
    if (a.skipped) out.push(`  Åtgärd: ingen (${a.skipped})`);
    else if (a.ok) out.push(`  Åtgärd: ${a.description}${a.before && a.after ? ` (${fmtState(a.before)} → ${fmtState(a.after)})` : ''}`);
    else out.push(`  Åtgärd misslyckades: ${a.error}`);
  }
  if (i.verified === true) out.push('  Verifierad: felet är borta ✓');
  else if (i.action?.ok && i.verified === false) out.push(`  Verifierad: NEJ — ${i.verifyCause || 'felet kvarstår'}`);
  return out;
}

export function formatDeviation(d) {
  const who = [d.customer, d.campaign || d.account].filter(Boolean).join(' / ');
  const diff = d.diff === null || d.diff === undefined ? '' : `, diff ${d.diff > 0 ? '+' : ''}${num(d.diff)}`;
  return `${who}: ${d.metric} Admiral ${num(d.admiral)}, Meta ${num(d.source)}${diff}`;
}

const num = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const fmtState = (s) => Object.entries(s).map(([k, v]) => `${k} ${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`).join(', ');

// Ord som skulle göra rapporten till ett utvecklingsförslag. Används av testerna.
export const FORBIDDEN_WORDS = [
  'bör', 'borde', 'föreslår', 'förslag', 'rekommender', 'förbättr', 'överväg', 'skulle kunna',
  'refaktor', 'ny funktion', 'nya funktioner', 'vidareutveckl', 'tips', 'idé', 'design',
];
