-- En e-postadress kan bara finnas en gång, oavsett stora och små bokstäver.
-- Inloggning och registrering normaliserar adressen (trim + små bokstäver) och jämför exakt.
create unique index if not exists users_email_lower_uniq on public.users (lower(email));
