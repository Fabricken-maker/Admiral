-- Admiral Modul D — flytta befintliga Meta-token till Supabase Vault.
-- Kör FÖRST när Modul D är driftsatt i prod: den gamla koden läser meta_tokens.access_token
-- direkt och skulle annars se ett tomt token. (Hälsokollen gör samma flytt automatiskt när
-- den ser att /api/write-settings finns i prod.)
select public.meta_token_put(user_id, access_token, expires_at, meta_user_id)
from public.meta_tokens
where token_secret_id is null and access_token is not null;
