/**
 * Meta-token i Supabase Vault (krypterade). All läsning och skrivning av token går här.
 *
 * meta_token_get/meta_token_put är SECURITY DEFINER-funktioner som bara service role får köra.
 * Token som ännu inte flyttats till Vault läses från den gamla kolumnen meta_tokens.access_token
 * tills migrations/meta-tokens-to-vault.sql har körts.
 */
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';

export async function readToken(supabase, userId) {
  const { data, error } = await supabase.rpc('meta_token_get', { p_user_id: userId });
  if (error) throw new Error(`meta_token_get: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row?.access_token ? row : null;
}

export async function storeToken(supabase, { userId, accessToken, expiresAt = null, metaUserId = null }) {
  const { error } = await supabase.rpc('meta_token_put', {
    p_user_id: userId,
    p_token: accessToken,
    p_expires_at: expiresAt,
    p_meta_user_id: metaUserId,
  });
  if (error) throw new Error(`meta_token_put: ${error.message}`);
}

const expired = (row) => row?.expires_at && new Date(row.expires_at) < new Date();

// Token att använda för en kund: kundens eget först, sedan Fabrickens (admin) som har åtkomst
// till kundkontona. Utgångna token hoppas över. Ogiltiga token upptäcks vid anropet (felkod 190).
export async function tokensForCustomer(supabase, userId) {
  const { data: admin } = await supabase.from('users').select('id').eq('email', ADMIN_EMAIL).maybeSingle();
  const ids = [userId, admin?.id].filter((id, i, a) => id && a.indexOf(id) === i);
  const out = [];
  for (const id of ids) {
    const row = await readToken(supabase, id).catch(() => null);
    if (row && !expired(row)) out.push({ userId: id, token: row.access_token });
  }
  return out;
}
