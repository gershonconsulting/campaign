import { createClient } from 'npm:@supabase/supabase-js@2';
import { listConfig, type ListKind } from '../_shared/prospect-lists.ts';
import { workspaceFor, snapshot, readList, syncList, IntakeError } from '../_shared/list-intake.ts';
const origin = Deno.env.get('APP_ORIGIN') || 'https://campaign.gershon.ai';
const cors = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (req.headers.get('origin') && req.headers.get('origin') !== origin)
    return json({ error: 'Origin not permitted' }, 403);
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const jwt = req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!jwt) return json({ error: 'Sign in required' }, 401);
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser(jwt);
  if (authError || !user) return json({ error: 'Invalid sign-in session' }, 401);
  try {
    const workspace = await workspaceFor(db, user.id);
    const body = await readBody(req);
    const { action, payload = {} } = body;
    const campaignId = String(payload.campaignId || '');
    await snapshot(db, workspace, campaignId, action !== 'lists');
    if (action === 'lists') {
      const { data, error } = await db
        .from('campaign_list_sources')
        .select(
          'id,kind,label,config,refresh_minutes,last_synced_at,next_sync_at,last_error,added_count,status',
        )
        .eq('workspace_id', workspace)
        .eq('campaign_id', campaignId)
        .order('created_at');
      if (error) throw new IntakeError('The list service is not available yet.');
      return json({ lists: data });
    }
    if (action === 'preview') {
      if (!['radar', 'sales_navigator'].includes(payload.kind))
        throw new IntakeError('Choose a dynamic list source.');
      const page = await readList(
        db,
        user.id,
        workspace,
        campaignId,
        payload.kind,
        payload.config || {},
      );
      return json({ prospects: page.rows, more: page.more });
    }
    if (action === 'sync') {
      const { data, error } = await db
        .from('campaign_list_sources')
        .select('id,kind')
        .eq('workspace_id', workspace)
        .eq('campaign_id', campaignId)
        .eq('id', payload.sourceId)
        .single();
      if (error || !data) return json({ error: 'List not found' }, 404);
      if (data.kind === 'csv')
        throw new IntakeError('CSV lists are fixed snapshots. Upload a new file to add prospects.');
      const result = await syncList(db, data.id);
      if (!result) return json({ error: 'This list is already refreshing.' }, 409);
      return json(result);
    }
    if (action === 'save') {
      const kind = payload.kind as ListKind;
      const config = listConfig(kind, payload.config || {});
      const id = String(payload.requestId || '');
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))
        throw new IntakeError('Invalid import request.');
      const record = {
        id,
        workspace_id: workspace,
        campaign_id: campaignId,
        created_by: user.id,
        kind,
        config,
        label:
          kind === 'radar'
            ? 'Radar prospects'
            : kind === 'csv'
              ? config.fileName!
              : 'Sales Navigator',
        refresh_minutes: kind === 'csv' ? 0 : 60,
      };
      const { error } = await db.from('campaign_list_sources').insert(record);
      if (error) {
        if (error.code !== '23505') throw new IntakeError('The list source could not be saved.');
        const { data: previous } = await db
          .from('campaign_list_sources')
          .select('id,kind,last_synced_at')
          .eq('id', id)
          .eq('workspace_id', workspace)
          .eq('campaign_id', campaignId)
          .eq('created_by', user.id)
          .single();
        if (!previous || previous.kind !== kind)
          throw new IntakeError('Import request belongs to another list.');
        if (kind === 'csv' && previous.last_synced_at)
          return json({ sourceId: id, added: 0, alreadyImported: true });
      }
      const result = await syncList(db, id, payload.rows);
      if (!result) return json({ error: 'This list is already refreshing.' }, 409);
      return json(result);
    }
    return json({ error: 'Unknown list action' }, 400);
  } catch (error) {
    if (error instanceof IntakeError)
      return json({ error: error.message }, error.retrySeconds ? 429 : 400);
    return json({ error: 'List request could not be completed.' }, 400);
  }
});

async function readBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new IntakeError('Request body required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 10_000_000) {
      await reader.cancel();
      throw new IntakeError('This import is too large. Split the CSV into smaller files.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
