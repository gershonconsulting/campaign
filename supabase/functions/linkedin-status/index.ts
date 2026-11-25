import { accountId, checkAccount, UnipileError } from '../_shared/unipile-v2.ts';
// Read-only health check of the configured LinkedIn sender through Unipile v2.
// Returns no prospect data. Requires a Supabase JWT (verify_jwt = true).
const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  try {
    const account = accountId();
    const r = await checkAccount(account);
    return json({
      provider: 'unipile',
      api: 'v2',
      account: account.slice(0, 8) + '…',
      ...r,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof UnipileError)
      return json(
        {
          provider: 'unipile',
          connected: false,
          status: e.status,
          code: e.code,
          retryable: e.retryable,
        },
        502,
      );
    return json({ provider: 'unipile', connected: false, error: (e as Error).message }, 500);
  }
});
