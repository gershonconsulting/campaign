import { createClient } from 'npm:@supabase/supabase-js@2';
import { unipile } from '../_shared/provider.ts';
// The random, expiring request ID is sent only to Unipile's notify URL. The
// account is independently fetched from the provider; callback claims are not trusted.
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const id = new URL(req.url).searchParams.get('request');
    if (!id) return new Response('Invalid callback', { status: 400 });
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: request, error } = await db
      .from('campaign_connect_requests')
      .update({ used_at: new Date().toISOString() })
      .eq('id', id)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select()
      .single();
    if (error || !request) return new Response('Expired callback', { status: 403 });
    const payload = await req.json();
    if (
      payload.name !== id ||
      !payload.account_id ||
      !['CREATION_SUCCESS', 'RECONNECTED'].includes(payload.status)
    )
      return new Response('Invalid callback', { status: 400 });
    const account = await unipile(`accounts/${encodeURIComponent(payload.account_id)}`);
    if (account.type !== 'LINKEDIN')
      return new Response('LinkedIn account required', { status: 400 });
    const { data: workspace, error: wError } = await db
      .from('campaign_workspaces')
      .select('*')
      .eq('id', request.workspace_id)
      .single();
    if (wError) throw wError;
    const existing = workspace.data.senders.find(
      (s: { providerId?: string }) => s.providerId === payload.account_id,
    );
    if (existing) return new Response('Already linked', { status: 200 });
    const name = account.name || 'LinkedIn sender';
    workspace.data.senders.push({
      id: crypto.randomUUID(),
      clientId: request.client_id,
      name,
      initials: name
        .split(' ')
        .map((s: string) => s[0])
        .slice(0, 2)
        .join(''),
      status: 'Connected',
      providerId: payload.account_id,
      accountType: 'LinkedIn',
      timezone: 'Europe/Paris',
      health: 50,
      limits: { invite: 10, visit: 30, message: 25, inmail: 7, company: 15, react: 10 },
    });
    const { data: updated, error: uError } = await db
      .from('campaign_workspaces')
      .update({
        data: workspace.data,
        revision: workspace.revision + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', workspace.id)
      .eq('revision', workspace.revision)
      .select('id');
    if (uError || !updated?.length)
      throw new Error('Workspace changed. Reconnect the account to retry.');
    return new Response('Connected', { status: 200 });
  } catch {
    return new Response(
      'Connection could not be completed. Generate a new connection link and retry.',
      { status: 500 },
    );
  }
});
