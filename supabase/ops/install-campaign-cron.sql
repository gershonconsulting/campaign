-- Reviewed, opt-in install at deployment. Not run by M2 and never run against
-- production before M6. Vault secrets must exist before scheduling jobs:
-- campaign_engine_base_url = https://<project>.supabase.co/functions/v1
-- campaign_engine_cron_secret = same 32+ character secret as CAMPAIGN_CRON_SECRET.
-- An administrator supplies both; Olivier does not run setup steps.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='campaign_engine_base_url') or
     not exists(select 1 from vault.decrypted_secrets where name='campaign_engine_cron_secret' and length(decrypted_secret)>=32) then
    raise exception 'Campaign scheduler Vault configuration missing';
  end if;
end $$;
select cron.schedule('campaign-planner','* * * * *',$job$
  select net.http_post(
    url := (select rtrim(decrypted_secret,'/') from vault.decrypted_secrets where name='campaign_engine_base_url')||'/campaign-planner',
    headers := jsonb_build_object('Content-Type','application/json','x-campaign-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='campaign_engine_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 15000);
$job$);
-- Source records retain their own hourly due time; minute ticks also drain
-- remaining pages without re-reading already imported pages on every tick.
select cron.schedule('campaign-list-sync','* * * * *',$job$
  select net.http_post(
    url := (select rtrim(decrypted_secret,'/') from vault.decrypted_secrets where name='campaign_engine_base_url')||'/campaign-list-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-campaign-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='campaign_engine_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 15000);
$job$);
select cron.schedule('campaign-worker','* * * * *',$job$
  select net.http_post(
    url := (select rtrim(decrypted_secret,'/') from vault.decrypted_secrets where name='campaign_engine_base_url')||'/campaign-worker',
    headers := jsonb_build_object('Content-Type','application/json','x-campaign-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='campaign_engine_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 15000);
$job$);
