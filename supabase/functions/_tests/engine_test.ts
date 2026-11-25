import { engineHandler } from '../_shared/campaign-engine.ts';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('scheduler authentication, kill switch and database-only dry-run execution', async () => {
  const keys = [
    'CAMPAIGN_CRON_SECRET',
    'CAMPAIGN_SENDING_ENABLED',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const original = keys.map((key) => Deno.env.get(key));
  const fetchOriginal = globalThis.fetch;
  const token = 'fake-scheduler-secret-for-isolated-tests-only';
  let calls: string[] = [];
  let claimed = false;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    // Any attempted provider access fails the test.
    assert(url.origin === 'https://database.example.test');
    const rpc = url.pathname.split('/').at(-1)!;
    calls.push(rpc);
    assert(new Headers(init?.headers).get('authorization') === 'Bearer fake-service-key');
    let body: unknown;
    if (rpc === 'campaign_engine_plan') body = 20;
    else if (rpc === 'campaign_engine_claim') {
      body = claimed ? null : { id: 'fake-action', claim_token: 'fake-claim', type: 'invite' };
      claimed = true;
    } else if (rpc === 'campaign_engine_complete') {
      assert(JSON.parse(String(init?.body)).p_token === 'fake-claim');
      body = true;
    } else throw new Error('Unexpected RPC');
    return Promise.resolve(Response.json(body));
  };
  const request = (secret = token, method = 'POST') =>
    new Request('https://engine.example.test', {
      method,
      headers: { 'x-campaign-cron-secret': secret },
    });
  try {
    Deno.env.delete('CAMPAIGN_CRON_SECRET');
    assert((await engineHandler('worker')(request())).status === 401);
    Deno.env.set('CAMPAIGN_CRON_SECRET', token);
    Deno.env.set('SUPABASE_URL', 'https://database.example.test');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-key');
    Deno.env.delete('CAMPAIGN_SENDING_ENABLED');
    assert((await engineHandler('worker')(request('', 'GET'))).status === 405);
    assert((await engineHandler('worker')(request('wrong'))).status === 401);
    Deno.env.set('CAMPAIGN_SENDING_ENABLED', 'true');
    assert((await engineHandler('worker')(request())).status === 503);
    assert(calls.length === 0, 'Live mode must be rejected before database or provider access');
    Deno.env.delete('CAMPAIGN_SENDING_ENABLED'); // Default is false.
    const planner = await engineHandler('planner')(request());
    assert((await planner.json()).planned === 20);
    const worker = await engineHandler('worker')(request());
    const result = await worker.json();
    assert(result.mode === 'dry_run' && result.actions.length === 1);
    assert(result.actions[0].completed === true);
    assert(
      calls.join(',') ===
        'campaign_engine_plan,campaign_engine_claim,campaign_engine_complete,campaign_engine_claim',
    );
    calls = [];
    globalThis.fetch = () =>
      Promise.resolve(Response.json({ message: 'private provider text' }, { status: 500 }));
    const failed = await engineHandler('planner')(request());
    assert(failed.status === 500);
    assert(!(await failed.text()).includes('private provider text'));
  } finally {
    globalThis.fetch = fetchOriginal;
    keys.forEach((key, i) =>
      original[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, original[i]!),
    );
  }
});
