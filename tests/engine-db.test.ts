import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const BASE = '2026-11-23T13:30:00Z'; // Monday, 08:30 New York.
const migration = await readFile(
  new URL('../supabase/migrations/202611240001_campaign_engine.sql', import.meta.url),
  'utf8',
);

test('normalized PostgreSQL execution engine', { timeout: 180_000 }, async (t) => {
  // Both paths execute the SAME migration and functions. CI also uses a real
  // PostgreSQL server to exercise multiple connections and SKIP LOCKED claims.
  const real = process.env.CAMPAIGN_TEST_DATABASE_URL;
  if (real) {
    const target = new URL(real);
    assert.ok(
      ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/campaign_test',
      'Database tests are restricted to the disposable local campaign_test database',
    );
  }
  let db: any;
  if (real) {
    const { default: pg } = await import('pg');
    db = new pg.Pool({ connectionString: real });
    db.exec = (sql: string) => db.query(sql);
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite();
  }
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
  const scalar = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]?.v;
  const plan = (now = BASE) => scalar('select public.campaign_engine_plan($1) v', [now]);
  const claim = (now = BASE) => scalar('select public.campaign_engine_claim($1) v', [now]);
  const finish = (a: any, now = BASE) =>
    scalar('select public.campaign_engine_complete($1,$2,$3) v', [a.id, a.claim_token, now]);
  const event = (contact: string, type: string, now = BASE, id = randomUUID()) =>
    scalar('select public.campaign_engine_event($1,$2,$3,$4,$5) v', [contact, type, id, '{}', now]);
  const retry = (a: any, status: number, seconds: number | null = null, now = BASE, code = '') =>
    scalar('select public.campaign_engine_retry($1,$2,$3,$4,$5,$6) v', [
      a.id,
      a.claim_token,
      status,
      code,
      seconds,
      now,
    ]);
  const state = (id: string) =>
    scalar('select state v from campaign_engine.campaign_contacts where id=$1', [id]);
  const advance = (iso: string, minutes: number) =>
    new Date(Date.parse(iso) + minutes * 60_000).toISOString();
  async function fixture(
    opts: {
      count?: number;
      first?: number;
      invites?: number;
      messages?: number;
      now?: string;
    } = {},
  ) {
    const workspace = randomUUID(),
      sender = randomUUID(),
      campaign = randomUUID();
    const contacts = Array.from({ length: opts.count ?? 1 }, () => randomUUID());
    const steps = Array.from({ length: 5 }, () => randomUUID());
    await q('insert into public.campaign_workspaces(id,name) values($1,$2)', [
      workspace,
      'Isolated test workspace',
    ]);
    await q(
      `insert into campaign_engine.sender_accounts(id,workspace_id,unipile_account_id,label,daily_invite_limit,daily_message_limit)
      values($1,$2,$3,'Fake sender',$4,$5)`,
      [sender, workspace, `dry-run:${sender}`, opts.invites ?? 20, opts.messages ?? 50],
    );
    await q(
      'insert into campaign_engine.campaigns(id,workspace_id,sender_account_id,name) values($1,$2,$3,$4)',
      [campaign, workspace, sender, 'Fake campaign'],
    );
    for (const [i, id] of contacts.entries()) {
      await q(
        `insert into campaign_engine.campaign_contacts(id,workspace_id,campaign_id,linkedin_public_id,first_name,company,simulation_network_distance)
        values($1,$2,$3,$4,$5,'Fake Company',$6)`,
        [
          id,
          workspace,
          campaign,
          `fake-prospect-${i}`,
          `Fake${i}`,
          i < (opts.first ?? 0) ? 'FIRST_DEGREE' : 'SECOND_DEGREE',
        ],
      );
    }
    for (let i = 0; i < 5; i++) {
      await q(
        `insert into campaign_engine.campaign_steps(id,workspace_id,campaign_id,position,type,delay_days,body,invite_note)
        values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          steps[i],
          workspace,
          campaign,
          i,
          i === 0 ? 'visit' : i === 1 ? 'invite' : 'message',
          i < 2 ? 0 : i === 2 ? 1 : i === 3 ? 2 : 3,
          i > 1 ? 'Hello {{first_name|there}}\nFrom {{company}}' : '',
          i === 1 ? 'Hello {{first_name|there}}' : null,
        ],
      );
    }
    await scalar('select public.campaign_engine_start($1,$2) v', [campaign, opts.now ?? BASE]);
    return { workspace, sender, campaign, contacts, steps };
  }
  async function only(f: any) {
    // Keep fixtures isolated while reusing one migrated database.
    // Each scenario has its own simulated clock; discard another scenario's tokens.
    await q(`update campaign_engine.api_limiter set requests='{}'`);
    await q(
      `update campaign_engine.campaigns set status='paused' where id<>$1 and status='running'`,
      [f.campaign],
    );
  }
  async function lookup(f: any, now = BASE) {
    await only(f);
    await plan(now);
    const a = await claim(now);
    assert.equal(a.type, 'lookup');
    await finish(a, now);
    return a;
  }
  async function visit(f: any, now = BASE) {
    await plan(now);
    const a = await claim(now);
    assert.equal(a.type, 'visit');
    await finish(a, now);
    return a;
  }
  async function invite(f: any, now = BASE) {
    await plan(now);
    const a = await claim(now);
    assert.equal(a.type, 'invite');
    await finish(a, now);
    return a;
  }
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      create table public.campaign_workspaces(id uuid primary key,name text not null);
      create table public.campaign_members(user_id uuid primary key,workspace_id uuid references public.campaign_workspaces(id));
      alter table public.campaign_members enable row level security;
      create policy own_membership on public.campaign_members for select to authenticated using(user_id=auth.uid());
      grant select on public.campaign_members to authenticated;
    `);
    await db.exec(migration);
    await t.test(
      'migration installs every normalized table with RLS and service-only RPCs',
      async () => {
        const tables =
          await q(`select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='campaign_engine' and c.relkind='r'`);
        assert.equal(tables.length, 10);
        assert.ok(tables.every((x: any) => x.relrowsecurity));
        assert.equal(
          await scalar(
            `select has_function_privilege('authenticated','public.campaign_engine_claim(timestamptz)','execute') v`,
          ),
          false,
        );
        assert.equal(
          await scalar(
            `select has_function_privilege('service_role','public.campaign_engine_claim(timestamptz)','execute') v`,
          ),
          true,
        );
      },
    );
    await t.test(
      'working window handles exact minutes, weekends, local dates and DST',
      async () => {
        const f = await fixture();
        const window = (time: string) =>
          scalar('select campaign_engine.next_window($1,$2)::text v', [f.sender, time]);
        assert.equal(Date.parse(await window('2026-11-23T13:29:00Z')), Date.parse(BASE));
        assert.equal(Date.parse(await window(BASE)), Date.parse(BASE));
        assert.equal(
          Date.parse(await window('2026-11-27T23:00:00Z')),
          Date.parse('2026-11-30T13:30:00Z'),
        );
        assert.equal(
          Date.parse(await window('2026-03-09T12:29:00Z')),
          Date.parse('2026-03-09T12:30:00Z'),
        );
        await assert.rejects(
          q('update campaign_engine.sender_accounts set timezone=$1 where id=$2', [
            'Unknown/Zone',
            f.sender,
          ]),
          /timezone/,
        );
        await assert.rejects(
          q('update campaign_engine.sender_accounts set daily_invite_limit=26 where id=$1', [
            f.sender,
          ]),
          /check constraint/,
        );
        await assert.rejects(
          q('update campaign_engine.sender_accounts set daily_message_limit=81 where id=$1', [
            f.sender,
          ]),
          /check constraint/,
        );
      },
    );
    await t.test(
      'database rolling limiter allows eight requests, then waits until the oldest expires',
      async () => {
        await q(`update campaign_engine.api_limiter set requests='{}'`);
        for (let i = 0; i < 8; i++)
          assert.equal(
            Date.parse(await scalar('select campaign_engine.take_token($1)::text v', [BASE])),
            Date.parse(BASE),
          );
        assert.equal(
          Date.parse(await scalar('select campaign_engine.take_token($1)::text v', [BASE])),
          Date.parse(advance(BASE, 1)),
        );
        assert.equal(
          Date.parse(
            await scalar('select campaign_engine.take_token($1)::text v', [advance(BASE, 1)]),
          ),
          Date.parse(advance(BASE, 1)),
        );
        await q(`update campaign_engine.api_limiter set requests='{}'`);
      },
    );
    await t.test(
      'first-degree contacts skip invitation; visits and lookup do not count as sends',
      async () => {
        const f = await fixture({ first: 1 });
        await lookup(f);
        await visit(f);
        assert.equal(await state(f.contacts[0]), 'connected');
        await plan();
        const rows = await q(
          `select type,scheduled_for from campaign_engine.campaign_actions where contact_id=$1 order by created_at,id`,
          [f.contacts[0]],
        );
        assert.deepEqual(rows.map((x: any) => x.type).sort(), ['lookup', 'message', 'visit']);
        assert.equal(await claim(), null); // First message waits one day from connection.
        assert.equal(
          await scalar(
            'select sum(invites_sent+messages_sent)::int v from campaign_engine.sender_daily_counters where sender_account_id=$1',
            [f.sender],
          ),
          0,
        );
        assert.equal(
          await scalar(
            `select status v from campaign_engine.campaign_actions where contact_id=$1 and type='message'`,
            [f.contacts[0]],
          ),
          'pending',
        );
      },
    );
    await t.test(
      'invitation acceptance schedules delayed messages; reply cancels work and is idempotent',
      async () => {
        const f = await fixture();
        await lookup(f);
        await visit(f);
        await invite(f);
        assert.equal(await state(f.contacts[0]), 'invite_sent');
        await plan();
        assert.equal(await claim(), null);
        const accepted = advance(BASE, 24 * 60);
        await event(f.contacts[0], 'accepted', accepted);
        assert.equal(await state(f.contacts[0]), 'connected');
        await plan(accepted);
        assert.equal(await claim(accepted), null);
        const sent = advance(accepted, 24 * 60);
        const a = await claim(sent);
        assert.equal(a.type, 'message');
        await finish(a, sent);
        await plan(sent);
        const id = randomUUID();
        assert.equal(await event(f.contacts[0], 'replied', sent, id), true);
        assert.equal(await event(f.contacts[0], 'replied', sent, id), false);
        assert.equal(await state(f.contacts[0]), 'replied');
        assert.equal(
          await scalar(
            `select count(*)::int v from campaign_engine.campaign_actions where contact_id=$1 and status in ('pending','claimed')`,
            [f.contacts[0]],
          ),
          0,
        );
      },
    );
    await t.test('acceptance timeout expires without withdrawing an invitation', async () => {
      const f = await fixture();
      await lookup(f);
      await visit(f);
      await invite(f);
      await plan(advance(BASE, 21 * 24 * 60));
      assert.equal(await state(f.contacts[0]), 'invite_expired');
      assert.equal(
        await scalar(`select status v from campaign_engine.campaigns where id=$1`, [f.campaign]),
        'completed',
      );
    });
    await t.test(
      'idempotency, stale claims and fencing prevent duplicate progress or counters',
      async () => {
        const f = await fixture();
        await only(f);
        await plan();
        await plan();
        const old = await claim();
        assert.ok(old);
        assert.equal(await claim(), null);
        const later = advance(BASE, 11);
        await plan(later);
        const current = await claim(later);
        assert.equal(current.id, old.id);
        assert.notEqual(current.claim_token, old.claim_token);
        assert.equal(await finish(old, later), false);
        assert.equal(await finish(current, later), true);
        assert.equal(await finish(current, later), false);
        assert.equal(
          await scalar(
            `select count(*)::int v from campaign_engine.campaign_actions where contact_id=$1 and type='lookup'`,
            [f.contacts[0]],
          ),
          1,
        );
      },
    );
    await t.test(
      'per-sender caps are shared by campaigns and reset at sender-local midnight',
      async () => {
        const f = await fixture({ invites: 1 });
        await lookup(f);
        await visit(f);
        await q(
          `insert into campaign_engine.sender_daily_counters(workspace_id,sender_account_id,date,invites_sent)
        values($1,$2,'2026-11-23',1) on conflict(sender_account_id,date,execution_mode) do update set invites_sent=1`,
          [f.workspace, f.sender],
        );
        await plan();
        assert.equal(await claim(), null);
        const next = await scalar(
          `select scheduled_for::text v from campaign_engine.campaign_actions where contact_id=$1 and type='invite'`,
          [f.contacts[0]],
        );
        assert.equal(Date.parse(next), Date.parse('2026-11-24T13:30:00Z'));
        const a = await claim(next);
        assert.equal(a.type, 'invite');
        await finish(a, next);
        assert.equal(
          await scalar(
            `select invites_sent v from campaign_engine.sender_daily_counters where sender_account_id=$1 and date='2026-11-24'`,
            [f.sender],
          ),
          1,
        );
      },
    );
    await t.test('message quotas are shared across campaigns on one sender', async () => {
      const f = await fixture({ first: 1, messages: 1 });
      await lookup(f);
      await visit(f);
      await plan();
      const tomorrow = advance(BASE, 24 * 60);
      const first = await claim(tomorrow);
      await finish(first, tomorrow);
      const campaign = randomUUID(),
        contact = randomUUID();
      await q(
        `insert into campaign_engine.campaigns(id,workspace_id,sender_account_id,name) values($1,$2,$3,'Shared sender')`,
        [campaign, f.workspace, f.sender],
      );
      await q(
        `insert into campaign_engine.campaign_contacts(id,workspace_id,campaign_id,linkedin_public_id,first_name,company,simulation_network_distance)
        values($1,$2,$3,'fake-second-campaign','Fake','Fake Co','FIRST_DEGREE')`,
        [contact, f.workspace, campaign],
      );
      await q(
        `insert into campaign_engine.campaign_steps(workspace_id,campaign_id,position,type,delay_days,body,invite_note)
        select workspace_id,$1,position,type,0,body,invite_note from campaign_engine.campaign_steps where campaign_id=$2`,
        [campaign, f.campaign],
      );
      await scalar('select public.campaign_engine_start($1,$2) v', [campaign, tomorrow]);
      await only({ campaign });
      await plan(tomorrow);
      const lookupAction = await claim(tomorrow);
      await finish(lookupAction, tomorrow);
      await plan(tomorrow);
      const visitAction = await claim(tomorrow);
      await finish(visitAction, tomorrow);
      const later = advance(tomorrow, 9);
      await plan(later);
      assert.equal(await claim(later), null);
      assert.equal(
        await scalar(
          `select messages_sent v from campaign_engine.sender_daily_counters where sender_account_id=$1 and date='2026-11-24'`,
          [f.sender],
        ),
        1,
      );
      assert.equal(
        Date.parse(
          await scalar(
            `select scheduled_for::text v from campaign_engine.campaign_actions where contact_id=$1 and type='message'`,
            [contact],
          ),
        ),
        Date.parse('2026-11-25T13:30:00Z'),
      );
    });
    await t.test(
      'spacing is reserved atomically and delays all sends from the same sender',
      async () => {
        const f = await fixture();
        await lookup(f);
        await visit(f);
        await invite(f);
        const next = Date.parse(
          await scalar(
            'select next_send_at::text v from campaign_engine.sender_accounts where id=$1',
            [f.sender],
          ),
        );
        assert.ok(next - Date.parse(BASE) >= 120_000 && next - Date.parse(BASE) <= 480_000);
        await event(f.contacts[0], 'accepted');
        await q('update campaign_engine.campaign_contacts set connected_at=$1 where id=$2', [
          advance(BASE, -24 * 60),
          f.contacts[0],
        ]);
        await plan();
        assert.equal(await claim(), null);
      },
    );
    await t.test(
      '429 preserves attempt budget; 5xx retries after 1, 5, 15 minutes then stops',
      async () => {
        const f = await fixture();
        await only(f);
        await plan();
        let now = BASE,
          a = await claim(now);
        assert.equal(await retry(a, 429, 12, now), true);
        let row = (
          await q(
            'select attempts,scheduled_for::text from campaign_engine.campaign_actions where id=$1',
            [a.id],
          )
        )[0];
        assert.equal(row.attempts, 0);
        assert.ok(Date.parse(row.scheduled_for) - Date.parse(now) >= 14_000);
        assert.ok(Date.parse(row.scheduled_for) - Date.parse(now) <= 22_000);
        now = row.scheduled_for;
        for (const minutes of [1, 5, 15]) {
          a = await claim(now);
          assert.ok(a);
          await retry(a, 503, null, now);
          row = (
            await q(
              'select attempts,scheduled_for::text from campaign_engine.campaign_actions where id=$1',
              [a.id],
            )
          )[0];
          assert.equal(Date.parse(row.scheduled_for) - Date.parse(now), minutes * 60_000);
          now = row.scheduled_for;
        }
        a = await claim(now);
        await retry(a, 503, null, now);
        assert.equal(await state(f.contacts[0]), 'failed');
      },
    );
    await t.test(
      '403 restriction returns to invite path and safely retries the same message after acceptance',
      async () => {
        const f = await fixture({ first: 1 });
        await lookup(f);
        await visit(f);
        await plan();
        const tomorrow = advance(BASE, 24 * 60);
        const a = await claim(tomorrow);
        assert.equal(a.type, 'message');
        await retry(a, 403, null, tomorrow, 'provider/access_restricted');
        assert.equal(await state(f.contacts[0]), 'looked_up');
        const later = advance(tomorrow, 9);
        await invite(f, later);
        await event(f.contacts[0], 'accepted', later);
        const next = advance(later, 24 * 60);
        const again = await claim(next);
        assert.equal(again.id, a.id);
        await finish(again, next);
        assert.equal(await state(f.contacts[0]), 'messaging');
      },
    );
    await t.test(
      'reply racing a claimed action invalidates the claim before completion',
      async () => {
        const f = await fixture({ first: 1 });
        await lookup(f);
        await visit(f);
        await plan();
        const tomorrow = advance(BASE, 24 * 60),
          a = await claim(tomorrow);
        await event(f.contacts[0], 'replied', tomorrow);
        assert.equal(await finish(a, tomorrow), false);
        assert.equal(await state(f.contacts[0]), 'replied');
      },
    );
    await t.test('duplicates across completed campaigns retain provider ownership', async () => {
      const f = await fixture();
      await lookup(f);
      await q(`update campaign_engine.campaigns set status='completed' where id=$1`, [f.campaign]);
      const other = randomUUID(),
        contact = randomUUID();
      await q(
        `insert into campaign_engine.campaigns(id,workspace_id,sender_account_id,name,status,started_at)
        values($1,$2,$3,'Second campaign','running',$4)`,
        [other, f.workspace, f.sender, BASE],
      );
      await q(
        `insert into campaign_engine.campaign_contacts(id,workspace_id,campaign_id,linkedin_public_id,next_action_at)
        values($1,$2,$3,'FAKE-PROSPECT-0',$4)`,
        [contact, f.workspace, other, BASE],
      );
      await q(
        `update campaign_engine.campaigns set status='paused' where id<>$1 and status='running'`,
        [other],
      );
      await plan();
      const a = await claim();
      await finish(a);
      assert.equal(await state(contact), 'removed');
    });
    await t.test(
      'started steps are locked and cross-workspace foreign keys reject mixing',
      async () => {
        const f = await fixture(),
          other = await fixture();
        await assert.rejects(
          q('update campaign_engine.campaign_steps set body=$1 where id=$2', [
            'Changed',
            f.steps[2],
          ]),
          /locked/,
        );
        await assert.rejects(
          q('delete from campaign_engine.campaign_steps where id=$1', [f.steps[2]]),
          /locked/,
        );
        await assert.rejects(
          q('update campaign_engine.campaigns set sender_account_id=$1 where id=$2', [
            other.sender,
            f.campaign,
          ]),
          /locked/,
        );
        await assert.rejects(
          q(
            `insert into campaign_engine.campaigns(workspace_id,sender_account_id,name) values($1,$2,'Invalid draft')`,
            [f.workspace, other.sender],
          ),
          /foreign key/,
        );
      },
    );
    await t.test(
      'contact pause/resume/remove and sender health prevent queued or claimed progress',
      async () => {
        const f = await fixture();
        await only(f);
        await plan();
        const control = (action: string) =>
          q('select public.campaign_engine_contact_control($1,$2,$3)', [
            f.contacts[0],
            action,
            BASE,
          ]);
        await control('pause');
        assert.equal(await claim(), null);
        await control('resume');
        const a = await claim();
        assert.ok(a);
        await control('remove');
        assert.equal(await finish(a), false);
        assert.equal(await state(f.contacts[0]), 'removed');
        const g = await fixture();
        await only(g);
        await plan();
        const b = await claim();
        assert.ok(b);
        await q('select public.campaign_engine_pause_sender($1,$2)', [g.sender, 'account.locked']);
        assert.equal(await finish(b), false);
        assert.equal(
          await scalar('select status v from campaign_engine.campaigns where id=$1', [g.campaign]),
          'paused',
        );
        assert.equal(
          await scalar('select paused_reason v from campaign_engine.sender_accounts where id=$1', [
            g.sender,
          ]),
          'account.locked',
        );
      },
    );
    await t.test(
      'RLS exposes only the current workspace and browser roles cannot mutate execution',
      async () => {
        const f = await fixture(),
          user = randomUUID();
        await q('insert into public.campaign_members(user_id,workspace_id) values($1,$2)', [
          user,
          f.workspace,
        ]);
        await q(`select set_config('request.jwt.claim.sub',$1,false)`, [user]);
        await db.exec('set role authenticated');
        try {
          const rows = await q(
            'select distinct workspace_id from campaign_engine.campaign_contacts',
          );
          assert.deepEqual(rows, [{ workspace_id: f.workspace }]);
          await assert.rejects(
            q('update campaign_engine.campaign_contacts set state=$1 where id=$2', [
              'finished',
              f.contacts[0],
            ]),
            /permission denied/,
          );
          await assert.rejects(claim(), /permission denied/);
        } finally {
          await db.exec('reset role');
        }
      },
    );
    await t.test(
      'templates validate real values, fallbacks, unknown variables and line breaks',
      async () => {
        assert.equal(
          await scalar(`select campaign_engine.render_template($1,$2) v`, [
            'Hi {{first_name|there}}\n{{company}}',
            '{"company":"Fake Co"}',
          ]),
          'Hi there\nFake Co',
        );
        await assert.rejects(
          q('select campaign_engine.render_template($1,$2)', ['{{unknown}}', '{}']),
          /Unknown/,
        );
        await assert.rejects(
          q('select campaign_engine.render_template($1,$2)', ['{{first_name}}', '{}']),
          /Missing/,
        );
        const f = await fixture();
        const draft = randomUUID();
        await q(
          `insert into campaign_engine.campaigns(id,workspace_id,sender_account_id,name) values($1,$2,$3,'Invalid draft')`,
          [draft, f.workspace, f.sender],
        );
        await q(
          `insert into campaign_engine.campaign_contacts(workspace_id,campaign_id,linkedin_public_id,first_name) values($1,$2,'fake-long',$3)`,
          [f.workspace, draft, 'X'.repeat(301)],
        );
        await assert.rejects(
          q(
            `insert into campaign_engine.campaign_steps(workspace_id,campaign_id,position,type,invite_note) values($1,$2,0,'invite','{{first_name}}')`,
            [f.workspace, draft],
          ),
          /300/,
        );
        await assert.rejects(
          q(
            `insert into campaign_engine.campaign_steps(workspace_id,campaign_id,position,type,invite_note) values($1,$2,0,'invite','Visit https://example.test')`,
            [f.workspace, draft],
          ),
          /link/,
        );
        await q(
          `update campaign_engine.campaign_contacts set first_name='Fake' where campaign_id=$1`,
          [draft],
        );
        await q(
          `insert into campaign_engine.campaign_steps(workspace_id,campaign_id,position,type,invite_note) values($1,$2,0,'invite','{{first_name}}')`,
          [f.workspace, draft],
        );
        await q(
          `insert into campaign_engine.campaign_steps(workspace_id,campaign_id,position,type,body) values($1,$2,1,'message','Hello')`,
          [f.workspace, draft],
        );
        await q(`update campaign_engine.campaign_contacts set first_name=$1 where campaign_id=$2`, [
          'X'.repeat(301),
          draft,
        ]);
        await assert.rejects(
          scalar('select public.campaign_engine_start($1,$2) v', [draft, BASE]),
          /300/,
        );
      },
    );
    await t.test(
      'waiting invitees do not starve other contacts in a bounded planner batch',
      async () => {
        const f = await fixture({ count: 2 });
        await only(f);
        await q(
          `update campaign_engine.campaign_contacts set state='invite_sent',invite_sent_at=$1,next_action_at=$2 where id=$3`,
          [BASE, advance(BASE, -24 * 60), f.contacts[0]],
        );
        assert.equal(await scalar('select public.campaign_engine_plan($1,1) v', [BASE]), 1);
        assert.equal(
          await scalar(
            'select contact_id v from campaign_engine.campaign_actions where campaign_id=$1',
            [f.campaign],
          ),
          f.contacts[1],
        );
      },
    );
    await t.test(
      '20 fake contacts progress over simulated days with redacted dry-run logs',
      async () => {
        await q(`update campaign_engine.api_limiter set requests='{}'`);
        const f = await fixture({ count: 20, first: 8 });
        await only(f);
        const logs: any[] = [];
        let now = BASE,
          acceptanceInjected = false;
        const acceptAt = advance(BASE, 2 * 24 * 60);
        const replyContacts = new Set([f.contacts[0], f.contacts[1], f.contacts[8]]);
        const replied = new Set<string>();
        // Event-driven clock jumps over idle periods, still using actual planner,
        // claim, limiter, counters and completion SQL for every single action.
        for (let tick = 0; tick < 3000; tick++) {
          if (!acceptanceInjected && Date.parse(now) >= Date.parse(acceptAt)) {
            for (const id of f.contacts.slice(8, 19)) await event(id, 'accepted', now);
            acceptanceInjected = true;
          }
          await plan(now);
          for (let i = 0; i < 8; i++) {
            const a = await claim(now);
            if (!a) break;
            assert.equal(await finish(a, now), true);
            logs.push({
              at: now,
              contact: f.contacts.indexOf(a.contact_id),
              type: a.type,
              dry_run: true,
            });
            if (
              a.type === 'message' &&
              replyContacts.has(a.contact_id) &&
              !replied.has(a.contact_id)
            ) {
              await event(a.contact_id, 'replied', now);
              replied.add(a.contact_id);
            }
          }
          await plan(now);
          if (
            (await scalar(`select status v from campaign_engine.campaigns where id=$1`, [
              f.campaign,
            ])) === 'completed'
          )
            break;
          let next = await scalar(
            `select min(candidate)::text v from (
          select greatest(a.scheduled_for,case when a.type in ('invite','message','reply') then s.next_send_at else a.scheduled_for end) candidate
            from campaign_engine.campaign_actions a join campaign_engine.sender_accounts s on s.id=a.sender_account_id
            where a.campaign_id=$1 and a.status='pending'
          union all select invite_sent_at+interval '21 days' from campaign_engine.campaign_contacts where campaign_id=$1 and state='invite_sent'
        ) x`,
            [f.campaign],
          );
          if (!acceptanceInjected && (!next || Date.parse(acceptAt) < Date.parse(next)))
            next = acceptAt;
          assert.ok(next, 'Active campaign must have a next scheduled action');
          // Production cron runs each minute. Round up to its next tick.
          now = new Date(
            Math.max(Date.parse(now) + 60_000, Math.ceil(Date.parse(next) / 60_000) * 60_000),
          ).toISOString();
        }
        const states = await q(
          `select state,count(*)::int count from campaign_engine.campaign_contacts where campaign_id=$1 group by state order by state`,
          [f.campaign],
        );
        assert.deepEqual(states, [
          { state: 'finished', count: 16 },
          { state: 'invite_expired', count: 1 },
          { state: 'replied', count: 3 },
        ]);
        assert.equal(logs.filter((x) => x.type === 'lookup').length, 20);
        assert.equal(logs.filter((x) => x.type === 'visit').length, 20);
        assert.equal(logs.filter((x) => x.type === 'invite').length, 12);
        assert.equal(logs.filter((x) => x.type === 'message').length, 51);
        const counters = await q(
          `select date::text,invites_sent,messages_sent from campaign_engine.sender_daily_counters where sender_account_id=$1 order by date`,
          [f.sender],
        );
        assert.ok(counters.every((x: any) => x.invites_sent <= 20 && x.messages_sent <= 50));
        assert.equal(
          counters.reduce((n: number, x: any) => n + x.messages_sent, 0),
          51,
        );
        const sends = logs.filter((x) => ['invite', 'message'].includes(x.type));
        for (let i = 1; i < sends.length; i++)
          assert.ok(Date.parse(sends[i].at) - Date.parse(sends[i - 1].at) >= 120_000);
        assert.equal(
          await scalar(
            `select count(*)::int v from campaign_engine.campaign_actions where campaign_id=$1 and not (result->>'dry_run')::boolean`,
            [f.campaign],
          ),
          0,
        );
        const report = { mode: 'dry_run', contacts: 20, states, counters, actions: logs };
        if (process.env.CAMPAIGN_SIMULATION_LOG)
          await writeFile(
            process.env.CAMPAIGN_SIMULATION_LOG,
            JSON.stringify(report, null, 2) + '\n',
          );
        t.diagnostic(
          `Simulation: 20 contacts; 20 lookups; 20 visits; 12 invites; 51 messages; 16 finished; 3 replied; 1 invite_expired. No provider calls.`,
        );
      },
    );
    await t.test(
      'overlapping workers use SKIP LOCKED without double-claiming',
      { skip: !real },
      async () => {
        const f = await fixture(),
          g = await fixture();
        await q(
          `update campaign_engine.campaigns set status='paused' where id not in ($1,$2) and status='running'`,
          [f.campaign, g.campaign],
        );
        await q(`update campaign_engine.api_limiter set requests='{}'`);
        await plan();
        const left = await db.connect(),
          right = await db.connect();
        try {
          await left.query('begin');
          await right.query('begin');
          await right.query(`set local statement_timeout='2s'`);
          const a = (await left.query('select public.campaign_engine_claim($1) v', [BASE])).rows[0]
            .v;
          assert.ok(a);
          // The limiter is intentionally global and serializes reservations. Hold
          // the sender lock without the limiter lock to isolate SKIP LOCKED.
          await left.query('rollback');
          await left.query('begin');
          await left.query('select 1 from campaign_engine.sender_accounts where id=$1 for update', [
            f.sender,
          ]);
          const b = (await right.query('select public.campaign_engine_claim($1) v', [BASE])).rows[0]
            .v;
          assert.ok(b);
          assert.equal(b.contact_id, g.contacts[0]);
          await right.query('commit');
          await left.query('commit');
          await finish(b);
          const c = await claim();
          assert.equal(c.contact_id, f.contacts[0]);
          assert.notEqual(c.id, b.id);
          await finish(c);
        } finally {
          await left.query('rollback');
          await right.query('rollback');
          left.release();
          right.release();
        }
      },
    );
    await t.test(
      'concurrent claims for one sender and global token reservations remain serialized',
      { skip: !real },
      async () => {
        const f = await fixture({ count: 2 });
        await only(f);
        await q(`update campaign_engine.api_limiter set requests='{}'`);
        await plan();
        const left = await db.connect(),
          right = await db.connect();
        try {
          await left.query('begin');
          await right.query('begin');
          await right.query(`set local statement_timeout='2s'`);
          const a = (await left.query('select public.campaign_engine_claim($1) v', [BASE])).rows[0]
            .v;
          assert.ok(a);
          const b = (await right.query('select public.campaign_engine_claim($1) v', [BASE])).rows[0]
            .v;
          assert.equal(b, null);
          await right.query('commit');
          await left.query('commit');
          await finish(a);
        } finally {
          await left.query('rollback');
          await right.query('rollback');
          left.release();
          right.release();
        }
        await q(`update campaign_engine.api_limiter set requests='{}'`);
        const reservations = await Promise.all(
          Array.from({ length: 12 }, () =>
            scalar('select campaign_engine.take_token($1)::text v', [BASE]),
          ),
        );
        assert.equal(reservations.filter((x) => Date.parse(x) === Date.parse(BASE)).length, 8);
        assert.equal(
          await scalar('select cardinality(requests) v from campaign_engine.api_limiter'),
          8,
        );
      },
    );
  } finally {
    if (real) await db.end();
    else await db.close();
  }
});
