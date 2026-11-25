-- Additive M2 engine. Separate schema avoids collisions with Radar's tables.
-- No existing snapshots/data are rewritten. Public RPCs are service-role-only.
create schema campaign_engine;
revoke all on schema campaign_engine from public;
grant usage on schema campaign_engine to authenticated, service_role;

create table campaign_engine.sender_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.campaign_workspaces(id),
  unipile_account_id text not null,
  label text not null,
  timezone text not null default 'America/New_York',
  working_days int[] not null default array[1,2,3,4,5],
  working_hours_start time not null default '08:30',
  working_hours_end time not null default '18:00',
  daily_invite_limit int not null default 20 check (daily_invite_limit between 1 and 25),
  daily_message_limit int not null default 50 check (daily_message_limit between 1 and 80),
  status text not null default 'active' check (status in ('active','paused','disconnected')),
  paused_reason text,
  next_send_at timestamptz not null default '-infinity',
  -- M3 must explicitly introduce live mode. Simulation can never become live by env alone.
  execution_mode text not null default 'dry_run' check (execution_mode = 'dry_run'),
  unique (workspace_id,id), unique (workspace_id,unipile_account_id,execution_mode),
  check (working_hours_start < working_hours_end),
  check (cardinality(working_days) > 0 and working_days <@ array[1,2,3,4,5,6,7])
);
create table campaign_engine.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.campaign_workspaces(id),
  sender_account_id uuid not null,
  name text not null,
  status text not null default 'draft' check (status in ('draft','running','paused','completed','archived')),
  started_at timestamptz,
  settings jsonb not null default '{"accept_timeout_days":21}',
  unique (workspace_id,id), unique (workspace_id,id,sender_account_id),
  foreign key (workspace_id,sender_account_id) references campaign_engine.sender_accounts(workspace_id,id),
  check (jsonb_typeof(settings) = 'object'),
  check (coalesce((settings->>'accept_timeout_days')::int,21) between 1 and 365)
);
create table campaign_engine.campaign_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  position int not null check (position >= 0),
  type text not null check (type in ('visit','invite','message')),
  delay_days int not null default 0 check (delay_days between 0 and 365),
  body text not null default '',
  invite_note text,
  unique (workspace_id,campaign_id,id), unique (campaign_id,position),
  foreign key (workspace_id,campaign_id) references campaign_engine.campaigns(workspace_id,id)
);
create table campaign_engine.campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  -- Radar's ID type will be verified at M5; no FK to an assumed Radar table.
  radar_prospect_id text,
  linkedin_public_id text not null check (linkedin_public_id <> ''),
  provider_id text,
  first_name text not null default '', last_name text not null default '',
  company text not null default '', title text not null default '',
  state text not null default 'queued' check (state in (
    'queued','looked_up','invite_sent','connected','messaging','finished',
    'replied','failed','removed','invite_expired')),
  paused boolean not null default false,
  current_step int not null default -1,
  resume_step int,
  next_action_at timestamptz not null default now(),
  chat_id text, invite_id text, last_error text,
  connected_at timestamptz, invite_sent_at timestamptz, last_message_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  -- Explicit test input. Never passed to a provider or promoted to live mode.
  simulation_network_distance text not null default 'SECOND_DEGREE'
    check (simulation_network_distance in ('FIRST_DEGREE','SECOND_DEGREE','THIRD_DEGREE')),
  unique (workspace_id,campaign_id,id), unique (workspace_id,id),
  foreign key (workspace_id,campaign_id) references campaign_engine.campaigns(workspace_id,id)
);
create unique index campaign_contact_public_id on campaign_engine.campaign_contacts(campaign_id,lower(linkedin_public_id));
create table campaign_engine.campaign_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  contact_id uuid not null,
  sender_account_id uuid not null,
  type text not null check (type in ('lookup','visit','invite','message','reply')),
  step_id uuid,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','claimed','done','failed','skipped')),
  attempts int not null default 0 check (attempts >= 0),
  idempotency_key text not null unique,
  claimed_at timestamptz, claim_token uuid,
  result jsonb, error text,
  created_at timestamptz not null default now(),
  foreign key (workspace_id,campaign_id,contact_id) references campaign_engine.campaign_contacts(workspace_id,campaign_id,id),
  foreign key (workspace_id,campaign_id,sender_account_id) references campaign_engine.campaigns(workspace_id,id,sender_account_id),
  foreign key (workspace_id,campaign_id,step_id) references campaign_engine.campaign_steps(workspace_id,campaign_id,id),
  check ((type = 'lookup' and step_id is null) or type = 'reply' or step_id is not null)
);
create index campaign_action_due on campaign_engine.campaign_actions(scheduled_for,id) where status = 'pending';
create unique index campaign_one_claim_per_sender on campaign_engine.campaign_actions(sender_account_id) where status = 'claimed';
create unique index campaign_one_action_per_contact on campaign_engine.campaign_actions(contact_id) where status in ('pending','claimed');
create table campaign_engine.campaign_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.campaign_workspaces(id),
  contact_id uuid,
  unipile_event_id text not null unique,
  type text not null,
  raw jsonb not null default '{}',
  normalized jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (workspace_id,contact_id) references campaign_engine.campaign_contacts(workspace_id,id)
);
create table campaign_engine.sender_daily_counters (
  workspace_id uuid not null,
  sender_account_id uuid not null,
  date date not null,
  execution_mode text not null default 'dry_run' check (execution_mode = 'dry_run'),
  invites_sent int not null default 0 check (invites_sent >= 0),
  messages_sent int not null default 0 check (messages_sent >= 0),
  primary key (sender_account_id,date,execution_mode),
  foreign key (workspace_id,sender_account_id) references campaign_engine.sender_accounts(workspace_id,id)
);
create table campaign_engine.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  contact_id uuid not null,
  chat_id text not null,
  direction text not null check (direction in ('in','out')),
  text text not null,
  sent_at timestamptz not null,
  unipile_message_id text not null unique,
  foreign key (workspace_id,contact_id) references campaign_engine.campaign_contacts(workspace_id,id)
);
-- One enrollment owns each provider identity across completed and running campaigns.
-- Follow-ups inside that enrollment are allowed; cross-campaign repeats are not.
create table campaign_engine.provider_owners (
  workspace_id uuid not null,
  provider_id text not null,
  execution_mode text not null default 'dry_run' check (execution_mode = 'dry_run'),
  contact_id uuid not null,
  primary key (workspace_id,provider_id,execution_mode),
  foreign key (workspace_id,contact_id) references campaign_engine.campaign_contacts(workspace_id,id)
);
-- A conservative single bucket protects ALL configured keys. No secret is stored here.
-- Uses exact rolling-window timestamps, rather than a refill bucket that permits bursts.
create table campaign_engine.api_limiter (
  id text primary key check (id = 'unipile-shared'),
  requests timestamptz[] not null default '{}'
);
insert into campaign_engine.api_limiter(id) values ('unipile-shared');
alter table campaign_engine.api_limiter enable row level security;
revoke all on campaign_engine.api_limiter from public,anon,authenticated;

do $$ declare t text; begin
  foreach t in array array['sender_accounts','campaigns','campaign_steps','campaign_contacts',
    'campaign_actions','campaign_events','sender_daily_counters','inbox_messages','provider_owners'] loop
    execute format('alter table campaign_engine.%I enable row level security',t);
    execute format('revoke all on campaign_engine.%I from public,anon,authenticated',t);
    execute format('grant select on campaign_engine.%I to authenticated',t);
    execute format('create policy own_workspace on campaign_engine.%I for select to authenticated using
      (workspace_id in (select workspace_id from public.campaign_members where user_id=auth.uid()))',t);
  end loop;
end $$;
grant all on all tables in schema campaign_engine to service_role;

create function campaign_engine.validate_sender() returns trigger language plpgsql
set search_path=pg_catalog,campaign_engine,pg_temp as $$ begin
  if not exists (select 1 from pg_timezone_names where name=new.timezone) then
    raise exception 'Unknown sender timezone';
  end if;
  if TG_OP = 'UPDATE' and (new.workspace_id,new.unipile_account_id,new.execution_mode)
    is distinct from (old.workspace_id,old.unipile_account_id,old.execution_mode) then
    raise exception 'Sender identity is immutable';
  end if;
  return new;
end $$;
create trigger validate_sender before insert or update on campaign_engine.sender_accounts
  for each row execute function campaign_engine.validate_sender();

create function campaign_engine.lock_steps() returns trigger language plpgsql
set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare c campaigns; begin
  select * into c from campaigns where id=case when TG_OP='DELETE' then old.campaign_id else new.campaign_id end for update;
  if c.started_at is not null then raise exception 'Started campaign steps are locked'; end if;
  if TG_OP='UPDATE' and (new.campaign_id,new.workspace_id) is distinct from (old.campaign_id,old.workspace_id) then
    raise exception 'Step ownership is immutable';
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;
create trigger lock_steps before insert or update or delete on campaign_engine.campaign_steps
  for each row execute function campaign_engine.lock_steps();

create function campaign_engine.lock_campaign() returns trigger language plpgsql
set search_path=pg_catalog,campaign_engine,pg_temp as $$ begin
  if old.started_at is not null and (new.sender_account_id,new.workspace_id,new.started_at,new.settings)
    is distinct from (old.sender_account_id,old.workspace_id,old.started_at,old.settings) then
    raise exception 'Started campaign configuration is locked';
  end if;
  return new;
end $$;
create trigger lock_campaign before update on campaign_engine.campaigns
  for each row execute function campaign_engine.lock_campaign();

create function campaign_engine.render_template(p_body text,p_contact jsonb) returns text
language plpgsql immutable set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare m text[]; value text; rendered text := coalesce(p_body,''); begin
  for m in select regexp_matches(coalesce(p_body,''),'\{\{([^{}]*)\}\}','g') loop
    if split_part(m[1],'|',1) not in ('first_name','last_name','company','title') then
      raise exception 'Unknown template variable';
    end if;
    value := coalesce(nullif(p_contact->>split_part(m[1],'|',1),''),
      case when strpos(m[1],'|')>0 then substring(m[1] from strpos(m[1],'|')+1) else '' end);
    if value='' then raise exception 'Missing template value'; end if;
    rendered := replace(rendered,'{{'||m[1]||'}}',value);
  end loop;
  if rendered ~ '\{\{|\}\}' then raise exception 'Malformed template'; end if;
  return rendered;
end $$;

create function campaign_engine.next_window(p_sender uuid,p_at timestamptz) returns timestamptz
language plpgsql stable set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare s sender_accounts; local_at timestamp; d date; candidate timestamptz; i int; begin
  select * into strict s from sender_accounts where id=p_sender;
  local_at := p_at at time zone s.timezone;
  for i in 0..14 loop
    d := local_at::date+i;
    if extract(isodow from d)::int=any(s.working_days) then
      candidate := (d+s.working_hours_start) at time zone s.timezone;
      if i=0 then candidate := greatest(candidate,p_at); end if;
      if (candidate at time zone s.timezone)::time < s.working_hours_end then return candidate; end if;
    end if;
  end loop;
  raise exception 'No sender working window';
end $$;

create function campaign_engine.longest_values(p_campaign uuid) returns jsonb language sql stable
set search_path=pg_catalog,campaign_engine,pg_temp as $$
  -- Use the longest real value for EACH variable, not an average contact.
  select jsonb_build_object(
    'first_name',coalesce((array_agg(first_name order by length(first_name) desc))[1],'Example'),
    'last_name',coalesce((array_agg(last_name order by length(last_name) desc))[1],'Example'),
    'company',coalesce((array_agg(company order by length(company) desc))[1],'Example'),
    'title',coalesce((array_agg(title order by length(title) desc))[1],'Example'))
    from campaign_contacts where campaign_id=p_campaign;
$$;

create function campaign_engine.validate_step_template() returns trigger language plpgsql
set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare sample jsonb; rendered text; begin
  sample:=longest_values(new.campaign_id);
  rendered:=render_template(case when new.type='invite' then new.invite_note else new.body end,sample);
  if new.type='invite' and (char_length(rendered)>300 or rendered ~* '(https?://|www\.|[[:alnum:]-]+\.[[:alpha:]]{2,}([[:punct:][:space:]]|$))') then
    raise exception 'Invite note exceeds 300 characters or contains a link';
  end if;
  if new.type='message' and btrim(rendered)='' then raise exception 'Message cannot be blank'; end if;
  return new;
end $$;
create trigger validate_step_template before insert or update on campaign_engine.campaign_steps
  for each row execute function campaign_engine.validate_step_template();

create function campaign_engine.take_token(p_at timestamptz) returns timestamptz
language plpgsql set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare used timestamptz[]; begin
  select requests into used from api_limiter where id='unipile-shared' for update;
  select coalesce(array_agg(x order by x),'{}') into used from unnest(used) x where x>p_at-interval '60 seconds';
  if cardinality(used)>=8 then return used[1]+interval '60 seconds'; end if;
  update api_limiter set requests=array_append(used,p_at) where id='unipile-shared';
  return p_at;
end $$;

create function public.campaign_engine_start(p_campaign uuid,p_now timestamptz default now()) returns void
language plpgsql security definer set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare c campaigns; st campaign_steps; ct campaign_contacts; note text; begin
  select * into strict c from campaigns where id=p_campaign for update;
  if c.status<>'draft' or c.started_at is not null then raise exception 'Only drafts can start'; end if;
  if not exists(select 1 from campaign_contacts where campaign_id=c.id) then raise exception 'Campaign needs contacts'; end if;
  if not exists(select 1 from campaign_steps where campaign_id=c.id and type='message') or
    (select count(*) from campaign_steps where campaign_id=c.id and type='invite')>1 or
    (select count(*) from campaign_steps where campaign_id=c.id and type='visit')>1 or
    exists(select 1 from campaign_steps a join campaign_steps b on a.campaign_id=b.campaign_id
      where a.campaign_id=c.id and ((a.type='message' and b.type in ('visit','invite')) or (a.type='invite' and b.type='visit'))
      and a.position<b.position) then raise exception 'Invalid sequence order'; end if;
  for st in select * from campaign_steps where campaign_id=c.id loop
    note:=render_template(case when st.type='invite' then st.invite_note else st.body end,longest_values(c.id));
    if st.type='invite' and char_length(note)>300 then raise exception 'Invite note exceeds 300 characters'; end if;
    for ct in select * from campaign_contacts where campaign_id=c.id loop
      note := render_template(case when st.type='invite' then st.invite_note else st.body end,to_jsonb(ct));
      if st.type='invite' and (char_length(note)>300 or note ~* '(https?://|www\.|[[:alnum:]-]+\.[[:alpha:]]{2,}([/[:space:]]|$))') then
        raise exception 'Invite note exceeds 300 characters or contains a link';
      end if;
      if st.type='message' and btrim(note)='' then raise exception 'Message cannot be blank'; end if;
    end loop;
  end loop;
  update campaigns set status='running',started_at=p_now where id=c.id;
  update campaign_contacts set next_action_at=p_now,updated_at=p_now where campaign_id=c.id;
end $$;

create function public.campaign_engine_plan(p_now timestamptz default now(),p_limit int default 200) returns int
language plpgsql security definer set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare ct campaign_contacts; c campaigns; st campaign_steps; due timestamptz; kind text; step uuid; n int:=0; begin
  -- Recover abandoned dry-run claims. A fresh token fences out the former worker.
  update campaign_actions set status='pending',claimed_at=null,claim_token=null
    where status='claimed' and claimed_at<=p_now-interval '10 minutes';
  for ct in select x.* from campaign_contacts x join campaigns pc on pc.id=x.campaign_id
    where pc.status='running' and not x.paused and x.state not in ('finished','replied','failed','removed','invite_expired')
    and not exists(select 1 from campaign_actions qa where qa.contact_id=x.id and qa.status in ('pending','claimed'))
    and (x.state<>'invite_sent' or x.invite_sent_at+make_interval(days=>coalesce((pc.settings->>'accept_timeout_days')::int,21))<=p_now)
    order by x.next_action_at,x.id limit least(greatest(p_limit,1),1000) for update of x skip locked loop
    select * into c from campaigns where id=ct.campaign_id;
    if ct.state='invite_sent' then
      if ct.invite_sent_at+make_interval(days=>coalesce((c.settings->>'accept_timeout_days')::int,21))<=p_now then
        update campaign_contacts set state='invite_expired',updated_at=p_now where id=ct.id;
      end if;
      continue;
    end if;
    if exists(select 1 from campaign_actions where contact_id=ct.id and status in ('pending','claimed')) then continue; end if;
    step:=null; due:=ct.next_action_at;
    if ct.state='queued' then kind:='lookup';
    else
      select * into st from campaign_steps where campaign_id=c.id and position>ct.current_step
        and not (type='invite' and ct.state in ('connected','messaging')) order by position limit 1;
      if st.id is null then
        update campaign_contacts set state='finished',updated_at=p_now where id=ct.id;
        continue;
      end if;
      if st.type='message' and ct.state not in ('connected','messaging') then
        update campaign_contacts set state='failed',last_error='Connection required; sequence has no invitation',updated_at=p_now where id=ct.id;
        continue;
      end if;
      kind:=st.type; step:=st.id;
      if kind='message' then due:=greatest(due,coalesce(ct.last_message_at,ct.connected_at)+make_interval(days=>st.delay_days));
      else due:=due+make_interval(days=>st.delay_days); end if;
    end if;
    insert into campaign_actions(workspace_id,campaign_id,contact_id,sender_account_id,type,step_id,scheduled_for,idempotency_key)
      values(ct.workspace_id,c.id,ct.id,c.sender_account_id,kind,step,next_window(c.sender_account_id,due),
        ct.id::text||':'||coalesce(step::text,'lookup')||':'||kind) on conflict (idempotency_key) do nothing;
    if found then n:=n+1; end if;
  end loop;
  update campaigns pc set status='completed' where pc.status='running' and exists(select 1 from campaign_contacts where campaign_id=pc.id)
    and not exists(select 1 from campaign_contacts where campaign_id=pc.id and state not in ('finished','replied','failed','removed','invite_expired'));
  return n;
end $$;

create function public.campaign_engine_claim(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare a campaign_actions; s sender_accounts; ct campaign_contacts; usage sender_daily_counters;
  due timestamptz; day date; token uuid; begin
  -- Lock sender first. No two workers can claim work for a sender concurrently.
  for s in select x.* from sender_accounts x where x.status='active' and exists(
      select 1 from campaign_actions qa join campaigns c on c.id=qa.campaign_id
      join campaign_contacts cc on cc.id=qa.contact_id where qa.sender_account_id=x.id and qa.status='pending'
      and qa.scheduled_for<=p_now and c.status='running' and not cc.paused)
    order by x.next_send_at,x.id for update of x skip locked loop
    if exists(select 1 from campaign_actions where sender_account_id=s.id and status='claimed') then continue; end if;
    select a0.* into a from campaign_actions a0 join campaigns c0 on c0.id=a0.campaign_id
      join campaign_contacts ct0 on ct0.id=a0.contact_id
      where a0.sender_account_id=s.id and a0.status='pending' and a0.scheduled_for<=p_now
      and c0.status='running' and not ct0.paused order by a0.scheduled_for,a0.id limit 1 for update of a0 skip locked;
    if a.id is null then continue; end if;
    select * into ct from campaign_contacts where id=a.contact_id for update;
    if ct.state in ('finished','replied','failed','removed','invite_expired') then
      update campaign_actions set status='skipped',error='Contact stopped' where id=a.id; continue;
    end if;
    due:=next_window(s.id,p_now);
    if a.type in ('invite','message','reply') then due:=next_window(s.id,greatest(due,s.next_send_at)); end if;
    if due>p_now then update campaign_actions set scheduled_for=due where id=a.id; continue; end if;
    day:=(p_now at time zone s.timezone)::date;
    insert into sender_daily_counters(workspace_id,sender_account_id,date) values(s.workspace_id,s.id,day)
      on conflict do nothing;
    select * into usage from sender_daily_counters where sender_account_id=s.id and date=day for update;
    if (a.type='invite' and usage.invites_sent>=s.daily_invite_limit) or
       (a.type in ('message','reply') and usage.messages_sent>=s.daily_message_limit) then
      update campaign_actions set scheduled_for=next_window(s.id,((day+1)+time '00:00') at time zone s.timezone) where id=a.id;
      continue;
    end if;
    due:=take_token(p_now);
    if due>p_now then update campaign_actions set scheduled_for=due where id=a.id; continue; end if;
    token:=gen_random_uuid();
    update campaign_actions set status='claimed',claimed_at=p_now,claim_token=token where id=a.id;
    if a.type in ('invite','message','reply') then
      update sender_accounts set next_send_at=p_now+make_interval(secs=>120+floor(random()*361)::int) where id=s.id;
    end if;
    return jsonb_build_object('id',a.id,'claim_token',token,'type',a.type,'contact_id',a.contact_id,'mode','dry_run');
  end loop;
  return null;
end $$;

create function public.campaign_engine_complete(p_action uuid,p_token uuid,p_now timestamptz default now()) returns boolean
language plpgsql security definer set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare a campaign_actions; ct campaign_contacts; s sender_accounts; st campaign_steps; owner uuid; rendered text; begin
  -- Sender -> action -> contact lock order matches claim/retry.
  select s0.* into s from sender_accounts s0 join campaign_actions a0 on a0.sender_account_id=s0.id where a0.id=p_action for update of s0;
  select * into a from campaign_actions where id=p_action for update;
  if a.status is distinct from 'claimed' or a.claim_token is distinct from p_token or a.claimed_at<=p_now-interval '10 minutes' then return false; end if;
  select * into ct from campaign_contacts where id=a.contact_id for update;
  if s.status<>'active' or ct.paused or next_window(s.id,p_now)>p_now or not exists(select 1 from campaigns where id=a.campaign_id and status='running') then
    update campaign_actions set status='pending',claim_token=null,claimed_at=null where id=a.id; return false;
  end if;
  if ct.state in ('finished','replied','failed','removed','invite_expired') then
    update campaign_actions set status='skipped',claim_token=null,error='Contact stopped' where id=a.id; return false;
  end if;
  if a.type='lookup' then
    -- Deterministic fake identity; never a real LinkedIn provider ID.
    ct.provider_id:='dry-run:'||lower(ct.linkedin_public_id);
    insert into provider_owners(workspace_id,provider_id,contact_id) values(ct.workspace_id,ct.provider_id,ct.id) on conflict do nothing;
    select contact_id into owner from provider_owners where workspace_id=ct.workspace_id and provider_id=ct.provider_id;
    if owner<>ct.id then
      update campaign_contacts set state='removed',last_error='Provider already enrolled in this workspace',updated_at=p_now where id=ct.id;
      update campaign_actions set status='skipped',result='{"dry_run":true,"reason":"duplicate_provider"}' where id=a.id;
      return true;
    end if;
    update campaign_contacts set provider_id=ct.provider_id,
      state=case when simulation_network_distance='FIRST_DEGREE' then 'connected' else 'looked_up' end,
      connected_at=case when simulation_network_distance='FIRST_DEGREE' then p_now else null end,
      next_action_at=p_now,updated_at=p_now where id=ct.id;
  else
    select * into st from campaign_steps where id=a.step_id;
    -- Validate at execution too; only metadata, never message text, enters action logs.
    begin
      rendered:=render_template(case when a.type='invite' then st.invite_note else st.body end,to_jsonb(ct));
      if a.type='invite' and (char_length(rendered)>300 or rendered ~* '(https?://|www\.|[[:alnum:]-]+\.[[:alpha:]]{2,}([[:punct:][:space:]]|$))') then
        raise exception 'Invalid rendered invitation';
      end if;
      if a.type in ('message','reply') and btrim(rendered)='' then raise exception 'Empty message'; end if;
    exception when others then
      update campaign_actions set status='failed',error='Template validation failed',claim_token=null where id=a.id;
      update campaign_contacts set state='failed',last_error='Template validation failed',updated_at=p_now where id=ct.id;
      return true;
    end;
    if a.type='invite' then
      update campaign_contacts set state='invite_sent',invite_id='dry-run:'||a.id,invite_sent_at=p_now,
        current_step=st.position,next_action_at=p_now,updated_at=p_now where id=ct.id;
    elsif a.type in ('message','reply') then
      if ct.state not in ('connected','messaging') then raise exception 'Connection required'; end if;
      update campaign_contacts set state='messaging',chat_id=coalesce(chat_id,'dry-run:'||ct.id),last_message_at=p_now,
        current_step=st.position,next_action_at=p_now,updated_at=p_now where id=ct.id;
    elsif a.type='visit' then
      update campaign_contacts set current_step=st.position,next_action_at=p_now,updated_at=p_now where id=ct.id;
    end if;
    if a.type in ('invite','message','reply') then
      update sender_daily_counters set invites_sent=invites_sent+case when a.type='invite' then 1 else 0 end,
        messages_sent=messages_sent+case when a.type in ('message','reply') then 1 else 0 end
        where sender_account_id=s.id and date=(a.claimed_at at time zone s.timezone)::date;
      update sender_accounts set next_send_at=next_send_at+(p_now-a.claimed_at) where id=s.id;
    end if;
  end if;
  update campaign_actions set status='done',result=jsonb_build_object('dry_run',true,'type',a.type,'completed_at',p_now),error=null
    where id=a.id;
  return true;
end $$;

create function public.campaign_engine_retry(p_action uuid,p_token uuid,p_status int,p_code text default '',
  p_retry_seconds int default null,p_now timestamptz default now()) returns boolean
language plpgsql security definer set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare a campaign_actions; ct campaign_contacts; st campaign_steps; delays int[]:=array[60,300,900]; begin
  perform 1 from sender_accounts s join campaign_actions qa on qa.sender_account_id=s.id where qa.id=p_action for update of s;
  select * into a from campaign_actions where id=p_action for update;
  if a.status is distinct from 'claimed' or a.claim_token is distinct from p_token then return false; end if;
  select * into ct from campaign_contacts where id=a.contact_id for update;
  if p_status=429 then
    update campaign_actions set status='pending',claim_token=null,claimed_at=null,
      scheduled_for=p_now+make_interval(secs=>greatest(coalesce(p_retry_seconds,60),1)::double precision+2+floor(random()*9)::int),
      error='Provider rate limited' where id=a.id;
  elsif p_status>=500 and a.attempts<3 then
    update campaign_actions set status='pending',attempts=attempts+1,claim_token=null,claimed_at=null,
      scheduled_for=p_now+make_interval(secs=>delays[a.attempts+1]),error='Provider temporarily unavailable' where id=a.id;
  elsif p_status=403 and p_code='provider/access_restricted' and a.type='message' then
    select * into st from campaign_steps where campaign_id=a.campaign_id and type='invite';
    update campaign_actions set status='skipped',claim_token=null,error='Connection required' where id=a.id;
    if st.id is null then
      update campaign_contacts set state='failed',last_error='Connection required; sequence has no invitation',updated_at=p_now where id=ct.id;
    else
      update campaign_contacts set state=case when invite_sent_at is null then 'looked_up' else 'invite_sent' end,
        resume_step=ct.current_step,current_step=st.position-1,connected_at=null,next_action_at=p_now,updated_at=p_now where id=ct.id;
    end if;
  else
    update campaign_actions set status='failed',attempts=attempts+1,claim_token=null,error='Provider action failed' where id=a.id;
    update campaign_contacts set state='failed',last_error='Provider action failed',updated_at=p_now where id=ct.id;
  end if;
  return true;
end $$;

-- M4 ingress will call this service-only reducer after authenticating provider events.
create function public.campaign_engine_event(p_contact uuid,p_type text,p_event_id text,
  p_raw jsonb default '{}',p_now timestamptz default now()) returns boolean
language plpgsql security definer set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare ct campaign_contacts; begin
  perform 1 from sender_accounts s join campaigns c on c.sender_account_id=s.id
    join campaign_contacts cc on cc.campaign_id=c.id where cc.id=p_contact for update of s;
  select * into strict ct from campaign_contacts where id=p_contact for update;
  if p_type not in ('accepted','replied') then raise exception 'Unsupported contact event'; end if;
  insert into campaign_events(workspace_id,contact_id,unipile_event_id,type,raw,normalized,created_at)
    values(ct.workspace_id,ct.id,p_event_id,p_type,p_raw,jsonb_build_object('type',p_type),p_now) on conflict do nothing;
  if not found then return false; end if;
  if p_type='replied' then
    update campaign_contacts set state='replied',updated_at=p_now where id=ct.id;
    update campaign_actions set status='skipped',claim_token=null,error='Reply received' where contact_id=ct.id and status in ('pending','claimed');
  elsif ct.state='invite_sent' then
    update campaign_contacts set state='connected',connected_at=p_now,next_action_at=p_now,
      current_step=greatest(current_step,coalesce(resume_step,-1)),resume_step=null,updated_at=p_now where id=ct.id;
    -- A confirmed 403 did not send. Reuse its idempotency key after acceptance.
    update campaign_actions a set status='pending',error=null,scheduled_for=next_window(a.sender_account_id,p_now+make_interval(days=>st.delay_days))
      from campaign_steps st where a.contact_id=ct.id and a.step_id=st.id and a.status='skipped' and a.error='Connection required';
  end if;
  return true;
end $$;

create function public.campaign_engine_contact_control(p_contact uuid,p_action text,p_now timestamptz default now()) returns void
language plpgsql security definer set search_path=pg_catalog,campaign_engine,pg_temp as $$
declare ct campaign_contacts; begin
  perform 1 from sender_accounts s join campaigns c on c.sender_account_id=s.id
    join campaign_contacts cc on cc.campaign_id=c.id where cc.id=p_contact for update of s;
  select * into strict ct from campaign_contacts where id=p_contact for update;
  if p_action not in ('pause','resume','remove') then raise exception 'Unknown contact control'; end if;
  update campaign_contacts set paused=case when p_action='pause' then true when p_action='resume' then false else paused end,
    state=case when p_action='remove' then 'removed' else state end,updated_at=p_now where id=ct.id;
  if p_action='remove' then
    update campaign_actions set status='skipped',claim_token=null,error='Contact removed' where contact_id=ct.id and status in ('pending','claimed');
  end if;
end $$;

create function public.campaign_engine_pause_sender(p_sender uuid,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog,campaign_engine,pg_temp as $$ begin
  if p_reason not in ('manual','account.status.disconnected','account.status.errored','account.locked') then
    raise exception 'Unknown sender pause reason';
  end if;
  perform 1 from sender_accounts where id=p_sender for update;
  update sender_accounts set status=case when p_reason='account.status.disconnected' then 'disconnected' else 'paused' end,
    paused_reason=p_reason where id=p_sender;
  update campaigns set status='paused' where sender_account_id=p_sender and status='running';
end $$;

-- Internal helpers cannot be invoked directly by browser roles.
revoke all on all functions in schema campaign_engine from public,anon,authenticated;
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'campaign_engine_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
