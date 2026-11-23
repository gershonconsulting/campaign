-- Initial internal-workspace persistence. Client-scoped member/viewer access is
-- intentionally not enabled: only explicitly provisioned workspace operators.
create table public.campaign_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  revision bigint not null default 0,
  data jsonb not null default '{"clients":[],"campaigns":[],"people":[],"enrollments":[],"senders":[],"conversations":[],"activities":[],"blacklist":[],"snippets":[],"templates":[],"settings":{"timezone":"Europe/Paris","digest":false,"notifications":true,"killSwitch":true}}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.campaign_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.campaign_workspaces(id) on delete cascade,
  role text not null check (role in ('owner','admin','viewer'))
);
create table public.campaign_connect_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.campaign_workspaces(id) on delete cascade,
  client_id text not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz
);
create table public.campaign_audit (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.campaign_workspaces(id),
  actor_id uuid,
  event text not null,
  created_at timestamptz not null default now()
);
alter table public.campaign_workspaces enable row level security;
alter table public.campaign_members enable row level security;
alter table public.campaign_connect_requests enable row level security;
alter table public.campaign_audit enable row level security;
create policy own_membership on public.campaign_members for select to authenticated using (user_id=auth.uid());
create policy workspace_read on public.campaign_workspaces for select to authenticated using (id in (select workspace_id from public.campaign_members where user_id=auth.uid()));
revoke all on public.campaign_workspaces,public.campaign_members,public.campaign_connect_requests,public.campaign_audit from anon,authenticated;
grant select on public.campaign_workspaces,public.campaign_members to authenticated;

create function public.campaign_snapshot() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.campaign_workspaces;
begin
  select cw.* into w from public.campaign_workspaces cw join public.campaign_members m on m.workspace_id=cw.id where m.user_id=auth.uid();
  if w.id is null then raise exception 'No Campaign workspace membership. Ask an administrator to provision access.' using errcode='42501'; end if;
  return jsonb_build_object('data',w.data,'revision',w.revision);
end $$;

create function public.campaign_save(p_data jsonb,p_revision bigint) returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.campaign_workspaces; membership public.campaign_members; c jsonb; old_c jsonb; s jsonb; old_s jsonb; e jsonb; old_e jsonb; k text; next_revision bigint;
begin
  select * into membership from public.campaign_members where user_id=auth.uid();
  if membership.role is null or membership.role not in ('owner','admin') then raise exception 'Workspace operator access required.' using errcode='42501'; end if;
  select * into w from public.campaign_workspaces where id=membership.workspace_id for update;
  if w.revision<>p_revision then raise exception 'Workspace changed in another session. Reload to avoid overwriting newer data.' using errcode='40001'; end if;
  if pg_column_size(p_data)>10000000 then raise exception 'Workspace exceeds snapshot size limit. Archive/export before continuing.'; end if;
  foreach k in array array['clients','campaigns','people','enrollments','senders','conversations','activities','blacklist','snippets','templates'] loop
    if jsonb_typeof(p_data->k) is distinct from 'array' then raise exception 'Invalid workspace collection: %',k; end if;
    if exists(select 1 from jsonb_array_elements(p_data->k) item group by item->>'id' having count(*)>1) then raise exception 'Duplicate entity IDs in %',k; end if;
  end loop;
  if jsonb_typeof(p_data->'settings') is distinct from 'object' then raise exception 'Invalid settings.'; end if;
  -- Provider and execution facts are server-owned, never accepted from a browser.
  if p_data->'activities' is distinct from w.data->'activities' then raise exception 'Activity history is server-owned.'; end if;
  for s in select value from jsonb_array_elements(p_data->'senders') loop
    select value into old_s from jsonb_array_elements(w.data->'senders') where value->>'id'=s->>'id';
    if old_s is null or (s - 'limits' - 'timezone') is distinct from (old_s - 'limits' - 'timezone') then raise exception 'Sender connection facts are server-owned.'; end if;
    for k in select jsonb_object_keys(s->'limits') loop
      if k not in ('invite','visit','message','inmail','company','react') or (s->'limits'->>k)::int < 1 or (s->'limits'->>k)::int > case k when 'invite' then 40 when 'visit' then 150 when 'message' then 120 when 'inmail' then 30 when 'company' then 100 else 40 end then raise exception 'Invalid sender limit.'; end if;
    end loop;
  end loop;
  if jsonb_array_length(p_data->'senders')<>jsonb_array_length(w.data->'senders') then raise exception 'Sender removal requires the provider disconnect flow.'; end if;
  for c in select value from jsonb_array_elements(p_data->'campaigns') loop
    select value into old_c from jsonb_array_elements(w.data->'campaigns') where value->>'id'=c->>'id';
    if c->>'status' not in ('Draft','Running','Paused','Completed','Archived') then raise exception 'Invalid campaign state.'; end if;
    if c->>'status'='Running' and coalesce(old_c->>'status','')<>'Running' then raise exception 'Start campaigns through the execution API.'; end if;
    if c->'startedAt' is distinct from old_c->'startedAt' then raise exception 'Campaign start timestamp is server-owned.'; end if;
    if old_c->>'startedAt' is not null and (
      c->>'senderId' is distinct from old_c->>'senderId' or c->>'clientId' is distinct from old_c->>'clientId' or
      (select jsonb_agg(jsonb_build_object('id',v->'id','type',v->'type')) from jsonb_array_elements(c->'steps') v) is distinct from
      (select jsonb_agg(jsonb_build_object('id',v->'id','type',v->'type')) from jsonb_array_elements(old_c->'steps') v)
    ) then raise exception 'Started campaigns have a frozen sender and step structure.'; end if;
  end loop;
  for e in select value from jsonb_array_elements(p_data->'enrollments') loop
    select value into old_e from jsonb_array_elements(w.data->'enrollments') where value->>'id'=e->>'id';
    if old_e is null and (e->>'state'<>'queued' or (e->>'step')::int<>0 or coalesce(e->>'nextAt','')<>'') then raise exception 'New enrollments must be queued.'; end if;
    if old_e is not null and (e->>'step' is distinct from old_e->>'step' or e->>'personId' is distinct from old_e->>'personId' or e->>'campaignId' is distinct from old_e->>'campaignId') then raise exception 'Enrollment progress is server-owned.'; end if;
    if old_e is not null and e->>'state' is distinct from old_e->>'state' and e->>'state' not in ('skipped','finished') then raise exception 'Browser may stop, but not advance, a sequence.'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_data->'conversations') t where not exists(select 1 from jsonb_array_elements(w.data->'conversations') old_t where old_t->>'id'=t->>'id' and old_t->'messages'=t->'messages' and old_t->>'personId'=t->>'personId' and old_t->>'senderId'=t->>'senderId' and old_t->>'campaignId'=t->>'campaignId')) then raise exception 'Messages must use the delivery API.'; end if;
  if jsonb_array_length(p_data->'conversations')<>jsonb_array_length(w.data->'conversations') then raise exception 'Conversations are server-owned.'; end if;
  -- Never delete started campaigns via a browser snapshot; archive instead.
  if exists(select 1 from jsonb_array_elements(w.data->'campaigns') old_c where old_c->>'startedAt' is not null and not exists(select 1 from jsonb_array_elements(p_data->'campaigns') new_c where new_c->>'id'=old_c->>'id')) then raise exception 'Archive started campaigns instead of deleting them.'; end if;
  update public.campaign_workspaces set data=p_data,revision=revision+1,updated_at=now() where id=w.id returning revision into next_revision;
  insert into public.campaign_audit(workspace_id,actor_id,event) values(w.id,auth.uid(),'workspace.saved');
  return next_revision;
end $$;
revoke all on function public.campaign_snapshot(),public.campaign_save(jsonb,bigint) from public,anon;
grant execute on function public.campaign_snapshot(),public.campaign_save(jsonb,bigint) to authenticated;
