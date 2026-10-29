# Admiral

Fabrickens tjänst för att följa och förbättra kunders Meta-annonser. Live på https://admiralai.se.

## Delar
| Del | Var |
|---|---|
| API och schemalagda jobb (Netlify Functions, modernt format via `lib/modern.js`) | `netlify/functions/` |
| Sidor (statisk HTML) | `public/` (dashboard, granskning, admin, inloggning, installationsguide) |
| Veckans hälsokoll (körs på VPS:en måndagar 03:00) | `healthcheck/` |
| Databasändringar (Supabase), körda i ordning med datum i commit-historiken | `migrations/` |
| Tester | `test/` och `healthcheck/test/` |

## Moduler
- **Kampanjupptäckt:** hittar kundernas Meta-kampanjer nattligen (och direkt efter Meta-omkoppling) och speglar budget från Meta i `budget_plans`, så att kampanjer syns utan manuell plan (`campaign-discovery`, `lib/campaign-discovery.js`).
- **C, Veckoutveckling:** veckokortet på dashboarden (`weekly`, `weekly-sync`).
- **D, Godkännandeflöde:** förslag, godkännande, skrivgrinden `lib/meta-write.js` (enda koden som skriver till Meta), Ångra (`proposals`, `write-settings`).
- **B, Granskning av annonsmaterial:** `granskning.html`, `reviews`, `brand-profile`, `reviews-sync`, `reviews-run-background`.
- **E, Kreativ trötthet:** `fatigue-sync` och förslagstypen `creative_swap` i skrivgrinden.

## Utveckling
```bash
npm ci
npm test                      # funktionernas tester
cd healthcheck && npm ci && npm test
netlify dev                   # lokalt; hemliga värden måste ligga i en lokal .env (se .env.example)
```

## Driftsättning
- En merge till `main` publiceras automatiskt av Netlify.
- GitHub Actions kör testerna och letar efter hemligheter vid varje PR och push.
- Hälsokollen på VPS:en uppdateras manuellt efter merge:
  `rsync -a --delete --exclude node_modules --exclude .env --exclude state healthcheck/ root@<vps>:/opt/admiral-healthcheck/`

## Principer
- Allt kundvänt på svenska. Siffror kommer från källdata, aldrig från en språkmodell.
- Admiral ändrar aldrig något i Meta utan ett registrerat godkännande för just den ändringen.
- Varje inloggad begäran kontrolleras mot databasen (`lib/auth-guard.js`).
