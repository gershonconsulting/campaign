import { createClient } from 'npm:@supabase/supabase-js@2';
import { syncList } from '../_shared/list-intake.ts';
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const expected = Deno.env.get('CAMPAIGN_CRON_SECRET'),
    provided = req.headers.get('x-campaign-cron-secret') || '';
  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(expected || ''), digest(provided)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (!expected || expected.length < 32 || diff)
    return new Response('Unauthorized', { status: 401 });
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  let refreshed = 0,
    failed = 0;
  for (let i = 0; i < 8; i++) {
    try {
      const result = await syncList(db);
      if (!result) break;
      refreshed++;
    } catch {
      failed++;
    }
  }
  return Response.json({ refreshed, failed });
});
