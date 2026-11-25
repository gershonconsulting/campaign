import { createClient } from 'npm:@supabase/supabase-js@2';
import { getAccount } from '../_shared/unipile-v2.ts';
// The random, expiring request ID is bound to Unipile's redirect URI. The
// account is independently fetched from the provider; callback claims are not trusted.
Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  try {
    const params = new URL(req.url).searchParams;
    const id = params.get('request'),
      providerId = params.get('account_id');
    if (!id || !providerId || params.has('error_type'))
      return new Response('Connection failed. Generate a new connection link.', { status: 400 });
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
    const account = await getAccount(providerId);
    if (account.id !== providerId || account.provider !== 'linkedin')
      return new Response('LinkedIn account required', { status: 400 });
    if (account.status !== 'running' || account.is_locked !== false)
      return new Response('LinkedIn account is not connected. Retry authentication.', {
        status: 409,
      });
    const { data: workspace, error: wError } = await db
      .from('campaign_workspaces')
      .select('*')
      .eq('id', request.workspace_id)
      .single();
    if (wError) throw wError;
    const existing = workspace.data.senders.find(
      (s: { providerId?: string }) => s.providerId === account.id,
    );
    const redirect = () =>
      new Response(null, {
        status: 303,
        headers: {
          Location: `${Deno.env.get('APP_ORIGIN') || 'https://campaign.gershon.ai'}/#senders`,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    if (existing) return redirect();
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
      providerId: account.id,
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
    return redirect();
  } catch {
    return new Response(
      'Connection could not be completed. Generate a new connection link and retry.',
      { status: 500 },
    );
  }
});
