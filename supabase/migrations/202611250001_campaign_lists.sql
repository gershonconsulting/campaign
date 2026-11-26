-- Additive intake only. No Radar tables or existing campaign data are rewritten.
create table public.campaign_list_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.campaign_workspaces(id),
  campaign_id text not null,
  created_by uuid not null references auth.users(id),
  kind text not null check(kind in ('radar','csv','sales_navigator')),
  label text not null,
  config jsonb not null check(jsonb_typeof(config)='object'),
  refresh_minutes int not null default 0 check(refresh_minutes in (0,60)),
  offset_position int not null default 0 check(offset_position >= 0),
  status text not null default 'ready' check(status in ('ready','syncing','error')),
  lease_token uuid, claimed_at timestamptz,
  last_synced_at timestamptz, next_sync_at timestamptz,
  last_error text,
  added_count int not null default 0 check(added_count>=0),
  created_at timestamptz not null default now(),
  check(kind<>'csv' or (refresh_minutes=0 and next_sync_at is null))
);
alter table public.campaign_list_sources enable row level security;
revoke all on public.campaign_list_sources from public,anon,authenticated;
grant select on public.campaign_list_sources to authenticated;
grant all on public.campaign_list_sources to service_role;
create policy list_workspace_read on public.campaign_list_sources for select to authenticated using (
  workspace_id in(select workspace_id from public.campaign_members where user_id=auth.uid()));
create index campaign_lists_due on public.campaign_list_sources(next_sync_at) where next_sync_at is not null;

create function public.campaign_list_claim(p_source uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare s public.campaign_list_sources; begin
  update public.campaign_list_sources set status='error',lease_token=null,claimed_at=null,last_error='Refresh interrupted'
    where status='syncing' and claimed_at<now()-interval '10 minutes';
  select * into s from public.campaign_list_sources where status<>'syncing'
    and (kind<>'csv' or last_synced_at is null)
    and ((p_source is not null and id=p_source) or (p_source is null and next_sync_at<=now()))
    order by next_sync_at nulls last,created_at limit 1 for update skip locked;
  if s.id is null then return null; end if;
  update public.campaign_list_sources set status='syncing',lease_token=gen_random_uuid(),claimed_at=now()
    where id=s.id returning * into s;
  return to_jsonb(s);
end $$;

create function public.campaign_list_apply(p_source uuid,p_token uuid,p_revision bigint,
  p_people jsonb,p_enrollments jsonb,p_added int,p_next_offset int,p_more boolean) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare s public.campaign_list_sources; w public.campaign_workspaces; next_data jsonb; begin
  select * into strict s from public.campaign_list_sources where id=p_source for update;
  if s.status<>'syncing' or s.lease_token is distinct from p_token or s.claimed_at<now()-interval '10 minutes' then return false; end if;
  select * into strict w from public.campaign_workspaces where id=s.workspace_id for update;
  if w.revision<>p_revision then return false; end if;
  if p_added<0 or (s.kind='csv' and p_more) then raise exception 'Invalid import progress'; end if;
  if not exists(select 1 from jsonb_array_elements(w.data->'campaigns') c where c->>'id'=s.campaign_id and c->>'status'='Draft') then
    raise exception 'List intake is available for draft campaigns';
  end if;
  if jsonb_typeof(p_people)<>'array' or jsonb_typeof(p_enrollments)<>'array' then raise exception 'Invalid intake data'; end if;
  next_data:=jsonb_set(jsonb_set(w.data,'{people}',p_people),'{enrollments}',p_enrollments);
  if pg_column_size(next_data)>10000000 then raise exception 'Workspace exceeds snapshot size limit'; end if;
  update public.campaign_workspaces set data=next_data,revision=revision+1,updated_at=now() where id=w.id;
  update public.campaign_list_sources set status='ready',lease_token=null,claimed_at=null,last_error=null,
    last_synced_at=now(),added_count=added_count+p_added,offset_position=case when p_more then p_next_offset else 0 end,
    next_sync_at=case when kind='csv' then null when p_more then now()+interval '1 minute'
      when refresh_minutes>0 then now()+make_interval(mins=>refresh_minutes) else null end where id=s.id;
  return true;
end $$;

create function public.campaign_list_release(p_source uuid,p_token uuid,p_error text,p_retry_seconds int default null) returns void
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$ begin
  update public.campaign_list_sources set status='error',lease_token=null,claimed_at=null,
    last_error=left(p_error,240),next_sync_at=case when kind<>'csv' and p_retry_seconds is not null then now()+make_interval(secs=>greatest(p_retry_seconds,60)) else null end
    where id=p_source and lease_token=p_token;
end $$;

create function public.campaign_list_reserve_provider() returns int
language plpgsql security definer set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare allowed timestamptz; at timestamptz:=clock_timestamp(); begin
  allowed:=campaign_engine.take_token(at);
  return greatest(0,ceil(extract(epoch from allowed-at)))::int;
end $$;
revoke all on function public.campaign_list_claim(uuid),
  public.campaign_list_apply(uuid,uuid,bigint,jsonb,jsonb,int,int,boolean),
  public.campaign_list_release(uuid,uuid,text,int), public.campaign_list_reserve_provider() from public,anon,authenticated;
grant execute on function public.campaign_list_claim(uuid),
  public.campaign_list_apply(uuid,uuid,bigint,jsonb,jsonb,int,int,boolean),
  public.campaign_list_release(uuid,uuid,text,int), public.campaign_list_reserve_provider() to service_role;
