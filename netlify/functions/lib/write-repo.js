/**
 * Databaslagret för skrivgrinden (Supabase). Grinden använder bara dessa metoder,
 * så att den kan testas med ett minnesrepo (test/approvals.test.mjs).
 */
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

export function createRepo(supabase) {
  return {
    async getProposal(id) {
      return must(await supabase.from('proposals').select('*').eq('id', id).maybeSingle(), 'proposals');
    },
    async getApproval(proposalId) {
      return must(await supabase.from('approvals').select('*').eq('proposal_id', proposalId).maybeSingle(), 'approvals');
    },
    async getWriteSettings(userId) {
      return must(await supabase.from('write_settings').select('*').eq('user_id', userId).maybeSingle(), 'write_settings');
    },
    // Atomärt: bara ett anrop kan sätta consumed_at.
    async claimApproval(id, nowIso) {
      const rows = must(await supabase.from('approvals').update({ consumed_at: nowIso }).eq('id', id).is('consumed_at', null).select('id'), 'approvals');
      return rows.length === 1;
    },
    async writesSince(userId, sinceIso) {
      const rows = must(await supabase.from('meta_write_log').select('id,action,status,request,created_at').eq('user_id', userId).gte('created_at', sinceIso), 'meta_write_log');
      return rows.map((r) => ({ ...r, monthly_delta_sek: Number(r.request?.monthly_delta_sek || 0) }));
    },
    async insertWriteLog(row) {
      return must(await supabase.from('meta_write_log').insert(row).select().single(), 'meta_write_log');
    },
    async updateWriteLog(id, patch) {
      must(await supabase.from('meta_write_log').update(patch).eq('id', id), 'meta_write_log');
    },
    async getWriteLog(id) {
      return must(await supabase.from('meta_write_log').select('*').eq('id', id).maybeSingle(), 'meta_write_log');
    },
    async latestWriteForObject(objectId) {
      const rows = must(await supabase.from('meta_write_log').select('id').eq('object_id', objectId).neq('status', 'failed').order('created_at', { ascending: false }).limit(1), 'meta_write_log');
      return rows[0] || null;
    },
    async updateProposal(id, patch) {
      must(await supabase.from('proposals').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id), 'proposals');
    },
    async insertProposal(row) {
      return must(await supabase.from('proposals').insert(row).select().single(), 'proposals');
    },
    async insertApproval(row) {
      return must(await supabase.from('approvals').insert(row).select().single(), 'approvals');
    },
  };
}
