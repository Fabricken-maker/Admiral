import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const handler = async (event) => {
  const { code, state, error } = event.queryStringParameters || {};

  if (error) {
    return { statusCode: 302, headers: { Location: '/setup-wizard.html?meta_error=access_denied' } };
  }

  if (!code || !state) {
    return { statusCode: 302, headers: { Location: '/setup-wizard.html?meta_error=missing_params' } };
  }

  let userId;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    userId = decoded.userId;
    // Reject stale states (>10 min)
    if (Date.now() - decoded.ts > 600000) throw new Error('State expired');
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

    // Upsert token for this user
    await supabase.from('meta_tokens').upsert({
      user_id: userId,
      access_token: accessToken,
      expires_at: expiresAt,
      meta_user_id: meData.id || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    return { statusCode: 302, headers: { Location: '/setup-wizard.html?meta_connected=1' } };
  } catch (err) {
    return { statusCode: 302, headers: { Location: `/setup-wizard.html?meta_error=${encodeURIComponent(err.message)}` } };
  }
};
