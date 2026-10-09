import { fetchJson } from './http.js';

export async function sendTelegram({ token, chatId }, text) {
  if (!token || !chatId) return { ok: false, error: 'TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID saknas' };
  const res = await fetchJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Ren text — inga parse_mode-tecken som kan förstöra meddelandet.
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
  return { ok: res.ok && res.json?.ok, error: res.json?.description || res.error };
}
