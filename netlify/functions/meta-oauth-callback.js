import { createClient } from '@supabase/supabase-js';
import { storeToken } from './lib/token-store.js';
import { verifyState } from './lib/oauth-state.js';
import { modern } from './lib/modern.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const handler = async (event) => {
  const { code, state, error } = event.queryStringParameters || {};

  if (error) {
    return { statusCode: 302, headers: { Location: '/setup-wizard.html?meta_error=access_denied' } };
  }

  if (!code || !state) {
    return { statusCode: 302, headers: { Location: '/setup-wizard.html?meta_error=missing_params' } };
  }

  let userId;
  try {
    userId = verifyState(state, process.env.JWT_SECRET).userId; // signerad, högst 10 min gammal
  } catch {
    return { statusCode: 302, headers: { Location: '/setup-wizard.html?meta_error=invalid_state' } };
  }

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v25.0/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&redirect_uri=${process.env.BASE_URL}/api/meta/oauth/callback&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error.message);

    // Exchange for long-lived token (60 days)
    const longRes = await fetch(
      `https://graph.facebook.com/v25.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longRes.json();
    if (longData.error) throw new Error(longData.error.message);

    const accessToken = longData.access_token;
    const expiresAt = longData.expires_in
      ? new Date(Date.now() + longData.expires_in * 1000).toISOString()
      : null;

    // Get Meta user ID
    const meRes = await fetch(`https://graph.facebook.com/v25.0/me?access_token=${accessToken}`);
    const meData = await meRes.json();

    // Spara token krypterat (Supabase Vault) för denna användare
    await storeToken(supabase, { userId, accessToken, expiresAt, metaUserId: meData.id || null });

    return { statusCode: 302, headers: { Location: '/setup-wizard.html?meta_connected=1' } };
  } catch (err) {
    return { statusCode: 302, headers: { Location: `/setup-wizard.html?meta_error=${encodeURIComponent(err.message)}` } };
  }
};

export default modern(handler);
