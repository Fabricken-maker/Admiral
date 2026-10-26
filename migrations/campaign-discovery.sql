-- Kampanjupptäckt: skyddsnät mot dubbletter.
--
-- Koden är redan idempotent (campaign-discovery dubbelkollar öppna planer före insert),
-- men indexet gör att två samtidiga körningar aldrig kan skapa två öppna planer för
-- samma kampanj på samma konto. Avslutade planer (completed) undantas: en ny plan per
-- månad för samma kampanj är normalflödet.
--
-- OBS: körs först efter Eriks godkännande. Misslyckas indexet finns redan dubbletter:
--   select user_id, ad_account_id, campaign_id, count(*) from budget_plans
--   where status <> 'completed' group by 1,2,3 having count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_budget_plans_open_campaign
  ON budget_plans (user_id, ad_account_id, campaign_id)
  WHERE status <> 'completed';
