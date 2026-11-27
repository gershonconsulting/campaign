-- Applied to the radar Supabase project (pkzeeqehwmtnqxdpdesl) on 2026-11-23.
-- The key itself lives in Supabase Vault as secret `unipile_api_key` (never in this repo).
create or replace function public.campaign_unipile_key()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'unipile_api_key' limit 1;
$$;
revoke all on function public.campaign_unipile_key() from public, anon, authenticated;
grant execute on function public.campaign_unipile_key() to service_role;
