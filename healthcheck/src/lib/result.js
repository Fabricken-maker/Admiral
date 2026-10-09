// Resultat från en kontroll. Agenter returnerar en lista av dessa.
//
//   ok        — kontrollen passerade
//   cause     — exakt orsak när den inte passerade (svensk text, fakta, inga förslag)
//   where     — var felet sitter (fil, tabell, system, kund/kampanj)
//   human     — kan inte repareras inom tillåtna ramar → "kräver människa"
//   action    — utförd reparation { kind, description, before, after, ok, error }
//   recheck   — async () => { ok, cause } som verifieraren kör efter reparation

export function pass(agent, id, extra = {}) {
  return { agent, id, ok: true, ...extra };
}

export function fail(agent, id, cause, { where = null, human = true, deviations, details, recheck } = {}) {
  return { agent, id, ok: false, cause, where, human, deviations, details, recheck };
}

export function skip(agent, id, reason) {
  return { agent, id, ok: true, skipped: true, cause: reason };
}
