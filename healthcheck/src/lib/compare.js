// Jämförelseregler: belopp och mått ±1 %, heltal exakt.

export function compareAmount(admiral, source, { relative = 0.01, absoluteFloor = 0.01 } = {}) {
  const a = Number(admiral) || 0;
  const s = Number(source) || 0;
  const diff = a - s;
  const allowed = Math.max(Math.abs(s) * relative, absoluteFloor);
  return { ok: Math.abs(diff) <= allowed + 1e-9, diff: round(diff, 4) };
}

export function compareInt(admiral, source) {
  const a = Math.round(Number(admiral) || 0);
  const s = Math.round(Number(source) || 0);
  return { ok: a === s, diff: a - s };
}

export function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

// metrics: { spend: 'amount', impressions: 'int', … }
// Returnerar en avvikelse per mått som ligger utanför tolerans.
export function compareMetrics({ customer, campaign, account }, admiralVals, sourceVals, metrics, tolerance) {
  const deviations = [];
  for (const [metric, kind] of Object.entries(metrics)) {
    if (admiralVals[metric] === undefined) continue; // måttet visas inte av Admiral
    const r = kind === 'int'
      ? compareInt(admiralVals[metric], sourceVals[metric])
      : compareAmount(admiralVals[metric], sourceVals[metric], tolerance);
    if (!r.ok) {
      deviations.push({
        customer: customer || null,
        account: account || null,
        campaign: campaign || null,
        metric,
        admiral: kind === 'int' ? Math.round(Number(admiralVals[metric]) || 0) : round(Number(admiralVals[metric]) || 0, 4),
        source: kind === 'int' ? Math.round(Number(sourceVals[metric]) || 0) : round(Number(sourceVals[metric]) || 0, 4),
        diff: r.diff,
      });
    }
  }
  return deviations;
}

// Lagrad kumulativ spend (budget-adjust ~06:00 UTC) måste ligga mellan
// spend t.o.m. föregående dygn och spend t.o.m. loggdygnet.
export function bracketCheck(stored, lower, upper, tolerance) {
  const lo = lower - Math.max(Math.abs(lower) * tolerance.relative, tolerance.absoluteFloor);
  const hi = upper + Math.max(Math.abs(upper) * tolerance.relative, tolerance.absoluteFloor);
  return { ok: stored >= lo - 1e-9 && stored <= hi + 1e-9, lower: round(lower), upper: round(upper) };
}
