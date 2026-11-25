import { createClient } from 'npm:@supabase/supabase-js@2';
import { createAuthLink } from '../_shared/unipile-v2.ts';
const origin = Deno.env.get('APP_ORIGIN') || 'https://campaign.gershon.ai';
const cors = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (req.headers.get('origin') && req.headers.get('origin') !== origin)
    return json({ error: 'Origin not permitted' }, 403);
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer /, '');
    if (!token) return json({ error: 'Sign in required' }, 401);
    const db = admin();
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(token);
    if (authError || !user) return json({ error: 'Invalid sign-in session' }, 401);
    const { data: member, error: memberError } = await db
      .from('campaign_members')
      .select('*')
      .eq('user_id', user.id)
      .single();
    if (memberError || !member || !['owner', 'admin'].includes(member.role))
      return json({ error: 'Workspace operator access required' }, 403);
    if (Number(req.headers.get('content-length') || 0) > 100000)
      return json({ error: 'Request too large' }, 413);
    const { action, payload } = await req.json();
    const { data: workspace, error: wError } = await db
      .from('campaign_workspaces')
      .select('*')
      .eq('id', member.workspace_id)
      .single();
    if (wError) throw wError;
    if (action === 'connect-sender') {
      if (!workspace.data.clients.some((c: { id: string }) => c.id === payload.clientId))
        return json({ error: 'Unknown client' }, 400);
      const { data: request, error } = await db
        .from('campaign_connect_requests')
        .insert({ workspace_id: workspace.id, client_id: payload.clientId })
        .select()
        .single();
      if (error) throw error;
      const url = await createAuthLink(
        request.expires_at,
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/linkedin-connect?request=${request.id}`,
      );
      return json({ url });
    }
    if (action === 'radar-prospects') {
      if (!workspace.data.clients.some((c: { id: string }) => c.id === payload.clientId))
        return json({ error: 'Unknown client' }, 400);
      const endpoint = Deno.env.get('RADAR_IMPORT_URL'),
        secret = Deno.env.get('RADAR_IMPORT_SECRET');
      if (!endpoint || !secret)
        return json(
          {
            error: 'Radar import is not configured. Set the server-side Radar endpoint and secret.',
          },
          503,
        );
      const url = new URL(endpoint);
      if (url.protocol !== 'https:') throw new Error('Radar endpoint must use HTTPS');
      url.searchParams.set('client_id', payload.clientId);
      const result = await fetch(url, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) throw new Error(`Radar returned ${result.status}`);
      const prospects = await result.json();
      if (!Array.isArray(prospects) || prospects.length > 5000)
        throw new Error('Radar must return an array of at most 5,000 prospects.');
      return json({ prospects });
    }
    // The planner is implemented and tested, but the execution worker and event
    // reconciler are deliberately gated until provider acceptance tests pass.
    if (action === 'start-campaign')
      return json(
        {
          error:
            'Live campaign execution is not commissioned yet. Complete provider webhook mapping and the test-sender acceptance checks before starting.',
        },
        503,
      );
    if (action === 'reply')
      return json(
        {
          error:
            'Live inbox delivery is not commissioned yet. Reply in LinkedIn until provider synchronization has passed acceptance checks.',
        },
        503,
      );
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('Campaign API request failed', error instanceof Error ? error.name : 'Error');
    return json({ error: error instanceof Error ? error.message : 'Request failed' }, 500);
  }
});
