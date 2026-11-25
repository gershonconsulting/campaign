import { createClient } from 'npm:@supabase/supabase-js@2';

/** Scheduler-only endpoints. A separate secret is not a user's Supabase token. */
export function engineHandler(task: 'planner' | 'worker') {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const expected = Deno.env.get('CAMPAIGN_CRON_SECRET');
    const supplied = req.headers.get('x-campaign-cron-secret') || '';
    if (!expected || expected.length < 32 || !(await equalSecret(expected, supplied)))
      return new Response('Unauthorized', { status: 401 });
    // M2 has no provider dispatch implementation, even if an operator flips this.
    if (Deno.env.get('CAMPAIGN_SENDING_ENABLED') === 'true')
      return Response.json({ error: 'Live sending is unavailable in M2.' }, { status: 503 });
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );
    const rpc = async (name: string, args = {}) => {
      const { data, error } = await db.rpc(name, args);
      if (error) throw new Error('Engine database operation failed');
      return data;
    };
    try {
      if (task === 'planner') {
        const planned = await rpc('campaign_engine_plan');
        return Response.json({ mode: 'dry_run', planned });
      }
      const results: { id: string; type: string; completed: boolean }[] = [];
      // Each claim uses the database limiter and a fenced, per-sender lease.
      // A bounded loop finishes well inside the function execution deadline.
      for (let i = 0; i < 8; i++) {
        const action = await rpc('campaign_engine_claim');
        if (!action) break;
        const completed = await rpc('campaign_engine_complete', {
          p_action: action.id,
          p_token: action.claim_token,
        });
        results.push({ id: action.id, type: action.type, completed });
      }
      // No bodies, prospect details, credentials or raw provider errors in logs.
      console.info('Campaign dry-run worker', { actions: results.length });
      return Response.json({ mode: 'dry_run', actions: results });
    } catch {
      console.error('Campaign engine database operation failed');
      return Response.json({ error: 'Engine database operation failed' }, { status: 500 });
    }
  };
}

async function equalSecret(a: string, b: string) {
  const encode = new TextEncoder();
  const [x, y] = await Promise.all(
    [a, b].map(
      async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(value))),
    ),
  );
  let mismatch = 0;
  for (let i = 0; i < x.length; i++) mismatch |= x[i] ^ y[i];
  return mismatch === 0;
}
