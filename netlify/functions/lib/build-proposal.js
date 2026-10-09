/**
 * Admiral Modul D — skapar förslag. Läser nuvarande värde och egna siffror från Meta (GET),
 * hämtar skälet från Modul A (judge.js) och förväntat utfall från budgetsimulatorn
 * (simulate.js), och prövar gränserna innan förslaget sparas.
 */
import { graphGet, objectStats, withTokens } from './meta-graph.js';
import { checkLimits, confirmationText, describe, normalizeWriteSettings } from './proposals.js';
import { deliveryInfo } from './meta-write.js';
import { judgeBudgetChange, judgeAdPause, judgeAdResume } from './judge.js';
import { simulateBudget, simulateAdStatus, monthlyFromDailyCents } from './simulate.js';
import { PURCHASE_TYPES } from './weekly.js';

export class ProposalRejected extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.name = 'ProposalRejected';
    this.errors = errors;
  }
}

async function customerContext(supabase, userId) {
  const [{ data: ws }, { data: weekly }] = await Promise.all([
    supabase.from('write_settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('weekly_settings').select('*').eq('user_id', userId).maybeSingle(),
  ]);
  return {
    settings: normalizeWriteSettings(ws),
    goals: {
      target_cpa: weekly?.target_cpa ? Number(weekly.target_cpa) : null,
      target_roas: weekly?.target_roas ? Number(weekly.target_roas) : null,
      min_results: weekly?.min_results ?? 3,
      min_spend_sek: weekly?.min_spend_sek ? Number(weekly.min_spend_sek) : 300,
    },
    resultTypes: weekly?.result_action_types?.length ? weekly.result_action_types : PURCHASE_TYPES,
  };
}

/**
 * spec: { userId, type: 'budget_change'|'ad_status', objectType: 'adset'|'campaign'|'ad',
 *         objectId, dailyBudgetSek?, status?, source, createdBy }
 */
export async function buildProposal({ supabase, repo, spec, tokens, now = new Date(), fetchImpl = fetch }) {
  const ctx = await customerContext(supabase, spec.userId);
  if (!ctx.settings.writes_enabled) throw new ProposalRejected(['Kunden har inte gett Admiral skrivbehörighet.']);
  if (ctx.settings.kill_switch) throw new ProposalRejected(['Alla ändringar i Meta är stoppade för kunden (nödstopp).']);

  return withTokens(tokens, async (token) => {
    const fields = spec.type === 'ad_status' ? 'name,status,account_id,adset_id' : 'name,daily_budget,lifetime_budget,account_id';
    const obj = await graphGet(spec.objectId, { fields }, token, fetchImpl);
    const adAccountId = `act_${obj.account_id}`;
    if (!ctx.settings.ad_account_ids.includes(adAccountId)) throw new ProposalRejected(['Annonskontot är inte godkänt för ändringar.']);

    let p;
    if (spec.type === 'budget_change') {
      if (!obj.daily_budget) throw new ProposalRejected([obj.lifetime_budget ? 'Objektet har en totalbudget. Bara dagsbudget kan ändras i den här versionen.' : 'Objektet har ingen egen dagsbudget.']);
      const newCents = Math.round(Number(spec.dailyBudgetSek) * 100);
      if (!(newCents > 0)) throw new ProposalRejected(['Ny dagsbudget saknas.']);
      const current = { budgets: { [spec.objectId]: Number(obj.daily_budget) } };
      const proposed = { budgets: { [spec.objectId]: newCents } };
      const [s14, s28] = await Promise.all([14, 28].map((d) => objectStats(spec.objectId, d, ctx.resultTypes, token, fetchImpl)));
      const judged = judgeBudgetChange(newCents > Number(obj.daily_budget) ? 'up' : 'down', s14, ctx.goals);
      p = {
        current_value: current, proposed_value: proposed,
        reason: judged.reason, reason_data: { verdict: judged.verdict, support: judged.support },
        expected_outcome: simulateBudget({ before: current.budgets, after: proposed.budgets, stats: s28, settings: ctx.goals }),
      };
    } else if (spec.type === 'ad_status') {
      if (!['ACTIVE', 'PAUSED'].includes(spec.status)) throw new ProposalRejected(['Status måste vara ACTIVE eller PAUSED.']);
      const [ad14, adset14, ad28, adsetObj] = await Promise.all([
        objectStats(spec.objectId, 14, ctx.resultTypes, token, fetchImpl),
        objectStats(obj.adset_id, 14, ctx.resultTypes, token, fetchImpl),
        objectStats(spec.objectId, 28, ctx.resultTypes, token, fetchImpl),
        graphGet(obj.adset_id, { fields: 'daily_budget' }, token, fetchImpl),
      ]);
      const judged = spec.status === 'PAUSED' ? judgeAdPause(ad14, adset14, ctx.goals) : judgeAdResume(ad14);
      p = {
        current_value: { status: obj.status }, proposed_value: { status: spec.status },
        reason: judged.reason, reason_data: { verdict: judged.verdict, support: judged.support },
        expected_outcome: simulateAdStatus({ to: spec.status, adStats: ad28, adsetMonthlySek: adsetObj.daily_budget ? monthlyFromDailyCents(adsetObj.daily_budget) : null }),
      };
    } else {
      throw new ProposalRejected([`Åtgärdstypen ${spec.type} stöds inte.`]);
    }

    Object.assign(p, {
      user_id: spec.userId, ad_account_id: adAccountId, type: spec.type, kind: 'change',
      object_type: spec.objectType, object_id: spec.objectId, object_name: obj.name,
      meta: {}, source: spec.source, created_by: spec.createdBy ?? null,
      valid_until: new Date(now.getTime() + ctx.settings.approval_ttl_hours * 3600000).toISOString(),
    });
    p.confirmation_text = confirmationText(p);

    const since = new Date(now.getTime() - ctx.settings.period_days * 86400000).toISOString();
    const periodWrites = (await repo.writesSince(spec.userId, since)).filter((w) => w.status !== 'failed' && w.action === 'apply');
    const limits = checkLimits({
      type: p.type, current: p.current_value, proposed: p.proposed_value, settings: ctx.settings,
      periodWrites, delivery: await deliveryInfo({ ...p }, token, fetchImpl),
    });
    if (!limits.ok) throw new ProposalRejected(limits.errors);

    // Ett nytt förslag på samma objekt ersätter ett väntande.
    await supabase.from('proposals').update({ status: 'superseded', updated_at: now.toISOString() })
      .eq('user_id', spec.userId).eq('object_id', spec.objectId).eq('type', spec.type).eq('status', 'pending');
    const created = await repo.insertProposal({ ...p, status: 'pending' });
    return { ...created, title: describe(created) };
  });
}

/**
 * Metas rekommendation SCALE_GOOD_CAMPAIGN (öka budgeten för en kampanj som presterar)
 * blir ett förslag att applicera rekommendationen via API. Admiral föreslår +20 % av
 * nuvarande dagsbudget per objekt, avrundat nedåt till hela kronor och inom kundens gränser.
 * Före-värdena sparas så att ändringen kan ångras.
 */
export const RECOMMENDED_INCREASE = 0.2;

export async function buildRecommendationProposal({ supabase, repo, userId, rec, judged, tokens, now = new Date(), fetchImpl = fetch }) {
  const ctx = await customerContext(supabase, userId);
  if (!ctx.settings.writes_enabled || ctx.settings.kill_switch) throw new ProposalRejected(['Skrivningar är inte tillåtna för kunden.']);
  return withTokens(tokens, async (token) => {
    const ids = (rec.object_ids || []).map(String);
    if (!ids.length) throw new ProposalRejected(['Rekommendationen saknar objekt.']);
    const objs = await Promise.all(ids.map((id) => graphGet(id, { fields: 'name,daily_budget' }, token, fetchImpl)));
    const level = rec.level === 'CAMPAIGN' || rec.object_type === 'campaign' ? 'campaigns' : 'adsets';
    const current = { budgets: {} };
    const proposed = { budgets: {} };
    const extra = [];
    objs.forEach((o, i) => {
      if (!o.daily_budget) return;
      const add = Math.floor((Number(o.daily_budget) * RECOMMENDED_INCREASE) / 100) * 100;
      current.budgets[ids[i]] = Number(o.daily_budget);
      proposed.budgets[ids[i]] = Number(o.daily_budget) + add;
      extra.push({ ad_object_id: ids[i], additional_budget: add });
    });
    if (!extra.length) throw new ProposalRejected(['Objekten har ingen dagsbudget.']);
    const s28 = await objectStats(ids[0], 28, ctx.resultTypes, token, fetchImpl);
    const p = {
      user_id: userId, ad_account_id: rec.ad_account_id, type: 'apply_recommendation', kind: 'change',
      object_type: level === 'campaigns' ? 'campaign' : 'adset', object_id: ids[0], object_name: objs[0].name,
      current_value: current, proposed_value: proposed,
      meta: { recommendation_signature: rec.recommendation_signature, recommendation_type: rec.type, extra_data: { [level]: extra } },
      reason: judged.reason, reason_data: { verdict: judged.verdict, support: judged.support },
      expected_outcome: simulateBudget({ before: current.budgets, after: proposed.budgets, stats: s28, settings: ctx.goals }),
      source: 'modul_a', created_by: null,
      valid_until: new Date(now.getTime() + ctx.settings.approval_ttl_hours * 3600000).toISOString(),
    };
    p.confirmation_text = confirmationText(p);
    const since = new Date(now.getTime() - ctx.settings.period_days * 86400000).toISOString();
    const periodWrites = (await repo.writesSince(userId, since)).filter((w) => w.status !== 'failed' && w.action === 'apply');
    const limits = checkLimits({ type: p.type, current, proposed, settings: ctx.settings, periodWrites, delivery: await deliveryInfo(p, token, fetchImpl) });
    if (!limits.ok) throw new ProposalRejected(limits.errors);
    await supabase.from('proposals').update({ status: 'superseded', updated_at: now.toISOString() })
      .eq('user_id', userId).eq('object_id', p.object_id).eq('type', p.type).eq('status', 'pending');
    return repo.insertProposal({ ...p, status: 'pending' });
  });
}

export { customerContext };
