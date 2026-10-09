# Admiral Weekly Health Check

Kontrollerar varje vecka att Admiral fungerar och att siffror och grafik stämmer med Meta.
Reparerar inom fasta ramar och rapporterar. Föreslår aldrig nya funktioner eller förbättringar.

## Agenter (körs parallellt, 3 min tidsgräns var)

| Agent | Kontrollerar | Får reparera |
|---|---|---|
| infra | sidor, endpoints (401/200), JWT och inloggning, Supabase-tabeller, Meta-tokens (giltiga och krypterade i Vault), Netlify-deploy/schema/env | förnya Meta-token som går ut inom 14 dagar; flytta okrypterat token till Vault (först när driftsatt Admiral läser via Vault) |
| data | Admirals siffror per konto och kampanj mot Meta (spend, visningar, klick, CPM, konverteringar, intäkt, ROAS); lagrad `spend_log`/`total_spent` för dygn äldre än 3 dagar; veckovyn (`weekly_metrics`) per vecka, konto och kampanj mot Meta när 72 h passerat, och `/api/weekly` mot `weekly_metrics` | omsynk av `spend_log`-rad, `total_spent` och `weekly_metrics`-rad från Meta |
| ui | dashboarden i headless Chrome: KPI-kort, kampanjtabell, veckokortet och Chart.js-data mot API-svaren, konsolfel, trasiga laddningar, tomma/hårdkodade värden | inget |
| jobs | nightly-health-check, budget-adjust, weekly-sync (senaste veckan hämtad, inga synkfel), godkännandeflödet (godkännanden som fastnat, overifierade skrivningar, skrivningar utan godkännande, Admiral-ändringar i Metas aktivitetslogg som saknas i `meta_write_log`), GA4, ChromaDB | omstart av ChromaDB-containern |
| verifierare | kör om allt som felade efter reparation | inget |

Status: **GRÖN** allt ok · **GUL** allt reparerat och verifierat · **RÖD** kräver människa.

## Skyddsräcken

- `src/lib/guard.js` lindar `fetch`: Meta är helt skrivskyddat (även `?method=` och batch), Admiral bara GET
  (utom inloggningsprob med påhittat konto), Supabase aldrig DELETE/SQL/RPC och bara skrivning till
  `admiral_healthchecks`, `spend_log`, `budget_plans`, `meta_tokens`, `weekly_metrics`. Testat i `test/guard.test.mjs`
  och `test/weekly.test.mjs`. Enda RPC-skrivningen som tillåts är `meta_token_put` (krypterad tokenlagring).
- Webbläsaren avbryter alla anrop som inte är GET.
- `budget-adjust` och `nightly-health-check` startas aldrig om (de ändrar Meta-budgetar / skickar mejl).
- Föregående värden sparas i `admiral_healthchecks.actions` (data) och `state/rollback/` (token, chmod 600).

## Köra

```bash
npm test
node bin/run.mjs --trigger=manual --dry-run --no-notify --no-persist   # torrkörning
node bin/run.mjs --trigger=manual                                       # skarp manuell körning
node scripts/provocation.mjs --account=<act_id> --plan=<id> --date=<YYYY-MM-DD>  # provokationstest (återställer efteråt)
```

## Drift (VPS)

```
0 1,2 * * 1  /opt/admiral-healthcheck/deploy/run-weekly.sh  >/dev/null 2>&1
30 7 * * *   cd /opt/admiral-healthcheck && /usr/bin/node bin/watchdog.mjs >> /var/log/admiral-healthcheck-watchdog.log 2>&1
```

`run-weekly.sh` kör måndagar bara när klockan är 03 i Stockholm (täcker sommar- och vintertid) och larmar i
Telegram om modulen kraschar eller hänger. Vakthunden larmar om ingen schemalagd körning sparats på 8 dygn.

## Återställa en reparation

- `spend_log`/`budget_plans`/`weekly_metrics`: värdena före ändringen finns i `admiral_healthchecks.actions[].before`.
- Meta-token: `state/rollback/<run_id>-meta-token-user-<id>.json` innehåller föregående token och utgångsdatum.
