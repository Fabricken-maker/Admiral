/**
 * Admiral Modul A (enkel version) — dagligen 04:45 UTC.
 * Hämtar Metas rekommendationer (GET /act_<id>/recommendations) för kundernas konton, ger varje
 * rekommendation ett utlåtande från Admirals egen data (Gör / Avvakta / Avstå / För lite data)
 * och sparar dem i meta_recommendations. Rekommendationer med utlåtandet Gör som går att
 * applicera och ångra blir förslag i Modul D:s godkännandeflöde. Inget skrivs till Meta här.
 */
import { createClient } from '@supabase/supabase-js';
import { modern } from './lib/modern.js';
import { createRepo } from './lib/write-repo.js';
import { tokensForCustomer } from './lib/token-store.js';
import { graphGet, objectStats, withTokens } from './lib/meta-graph.js';
import { judgeRecommendation, APPLICABLE_RECOMMENDATIONS } from './lib/judge.js';
import { buildRecommendationProposal, customerContext, ProposalRejected } from './lib/build-proposal.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const handler = async () => {
  const repo = createRepo(supabase);
  const [{ data: ws }, { data: weekly }] = await Promise.all([
    supabase.from('write_settings').select('user_id, ad_account_ids'),
    supabase.from('weekly_settings').select('user_id, ad_account_ids').eq('active', true),
  ]);
  const accounts = new Map();
  for (const r of [...(ws || []), ...(weekly || [])]) {
    for (const a of r.ad_account_ids || []) accounts.set(`${r.user_id}|${a}`, { userId: r.user_id, account: a });
  }
  const out = [];
  for (const { userId, account } of accounts.values()) {
    try {
      const tokens = await tokensForCustomer(supabase, userId);
      const ctx = await customerContext(supabase, userId);
      const recs = await withTokens(tokens, (t) => graphGet(`${account}/recommendations`, {
        fields: 'type,recommendation_signature,recommendation_stage,recommendation_time,object_ids,recommendation_content,url',
      }, t));
      let proposals = 0;
      for (const rec of recs.data || []) {
        const objectId = (rec.object_ids || [])[0];
        const stats = objectId ? await withTokens(tokens, (t) => objectStats(String(objectId), 14, ctx.resultTypes, t)).catch(() => null) : null;
        const judged = judgeRecommendation(rec, stats || { days: 14, spend: 0, results: 0, revenue: 0 }, ctx.goals);
        const row = {
          // Utan signatur går rekommendationen inte att applicera via API; nyckeln hindrar dubbletter.
          user_id: userId, ad_account_id: account, type: rec.type,
          recommendation_signature: rec.recommendation_signature || `ej-api:${rec.type}:${(rec.object_ids || []).join(',')}`,
          object_ids: rec.object_ids || [], body: rec.recommendation_content?.body || null,
          opportunity_score_lift: rec.recommendation_content?.opportunity_score_lift ?? null, url: rec.url || null, raw: rec,
          verdict: judged.verdict, verdict_reason: judged.reason, support: judged.support, fetched_at: new Date().toISOString(),
        };
        const { data: saved } = await supabase.from('meta_recommendations')
          .upsert(row, { onConflict: 'ad_account_id,type,recommendation_signature' }).select('id, proposal_id').single();
        if (judged.verdict === 'gor' && APPLICABLE_RECOMMENDATIONS.includes(rec.type) && rec.recommendation_signature && !saved?.proposal_id) {
          try {
            const p = await buildRecommendationProposal({ supabase, repo, userId, rec: { ...rec, ad_account_id: account }, judged, tokens });
            await supabase.from('meta_recommendations').update({ proposal_id: p.id }).eq('id', saved.id);
            proposals += 1;
          } catch (e) {
            if (!(e instanceof ProposalRejected)) throw e;
          }
        }
      }
      out.push({ userId, account, recommendations: (recs.data || []).length, proposals });
    } catch (e) {
      out.push({ userId, account, error: e.message });
    }
  }
  return { statusCode: 200, body: JSON.stringify({ synced: out }) };
};

export default modern(handler);
