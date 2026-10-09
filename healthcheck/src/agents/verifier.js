// Agent 5 — Verifierare.
// Kör om varje kontroll som felade (efter att agenterna reparerat) och bekräftar
// om felet är borta. Ändrar ingenting själv: den anropar bara kontrollernas recheck().
import { withTimeout } from '../lib/http.js';

export async function run(ctx, failed) {
  const verified = await Promise.all(failed.map(async (r) => {
    if (typeof r.recheck !== 'function') return { id: r.id, verified: null, cause: 'kontrollen kan inte köras om' };
    try {
      const v = await withTimeout(r.recheck(), ctx.config.timeouts.verifierMs, `verifiering ${r.id}`);
      return { id: r.id, verified: !!v.ok, cause: v.ok ? null : v.cause };
    } catch (e) {
      return { id: r.id, verified: false, cause: `verifieringen misslyckades: ${e.message}` };
    }
  }));
  return new Map(verified.map((v) => [v.id, v]));
}
