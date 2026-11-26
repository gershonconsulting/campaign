import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { call, UnipileError } from './unipile-v2.ts';
import {
  listConfig,
  radarRow,
  salesRow,
  csvRows,
  salesNavigatorSource,
  type ListKind,
  type ListConfig,
} from './prospect-lists.ts';
import { importPeople, type Data } from '../../../src/model.ts';

export class IntakeError extends Error {
  constructor(
    message: string,
    public retrySeconds?: number,
  ) {
    super(message);
  }
}
export async function workspaceFor(db: SupabaseClient, userId: string) {
  const { data: member, error } = await db
    .from('campaign_members')
    .select('workspace_id,role')
    .eq('user_id', userId)
    .single();
  if (error || !member || !['owner', 'admin'].includes(member.role))
    throw new IntakeError('Workspace operator access required.');
  return member.workspace_id as string;
}
export async function snapshot(
  db: SupabaseClient,
  workspace: string,
  campaignId: string,
  requireDraft = true,
) {
  const { data, error } = await db
    .from('campaign_workspaces')
    .select('id,data,revision')
    .eq('id', workspace)
    .single();
  if (error || !data) throw new IntakeError('Workspace could not be read.');
  const campaign = (data.data as Data).campaigns.find((c) => c.id === campaignId);
  if (!campaign) throw new IntakeError('Campaign not found.');
  if (requireDraft && campaign.status !== 'Draft')
    throw new IntakeError('Add or refresh prospect lists while the campaign is a draft.');
  return { ...data, campaign, data: data.data as Data };
}
export async function readList(
  db: SupabaseClient,
  userId: string,
  workspace: string,
  campaignId: string,
  kind: ListKind,
  rawConfig: ListConfig,
  offset = 0,
  inputRows?: unknown,
) {
  const config = listConfig(kind, rawConfig);
  const w = await snapshot(db, workspace, campaignId);
  if (kind === 'csv') return { rows: csvRows(inputRows), nextOffset: 0, more: false };
  if (kind === 'radar') {
    const { data: auth, error: authError } = await db.auth.admin.getUserById(userId);
    if (authError || !auth.user?.email || !auth.user.email_confirmed_at)
      throw new IntakeError('A verified sign-in is required for Radar.');
    const { data: owners, error: ownerError } = await db
      .from('users')
      .select('owner_key')
      .eq('email', auth.user.email.toLowerCase())
      .limit(2);
    if (ownerError || owners?.length !== 1 || !owners[0].owner_key)
      throw new IntakeError(
        'Your Radar account needs to be linked to this workspace before importing.',
      );
    // Verified Radar schema: targets is keyed by owner_key + lead_id. Ownership
    // never comes from a browser-supplied filter or a guessed default owner.
    let query = db
      .from('targets')
      .select(
        'lead_id,first_name,last_name,title,company,linkedin_url,country,city,language,grade,selected',
      )
      .eq('owner_key', owners[0].owner_key)
      .or('selected.eq.true,selected.is.null')
      .order('lead_id')
      .range(offset, offset + 99);
    if (config.grade) query = query.eq('grade', config.grade);
    if (config.country) query = query.ilike('country', config.country);
    const { data, error } = await query;
    if (error || !Array.isArray(data))
      throw new IntakeError('Radar prospects could not be read. The schema mapping needs review.');
    return {
      rows: data.map(radarRow),
      nextOffset: offset + data.length,
      more: data.length === 100,
    };
  }
  const sender = w.data.senders.find(
    (s) => s.id === w.campaign.senderId && s.clientId === w.campaign.clientId,
  );
  if (!sender?.providerId?.startsWith('acc_'))
    throw new IntakeError('Assign a connected LinkedIn sender with Sales Navigator access first.');
  const { data: delay, error: limiterError } = await db.rpc('campaign_list_reserve_provider');
  if (limiterError) throw new IntakeError('The shared provider limiter is unavailable.');
  if (delay > 0)
    throw new IntakeError('Provider request limit reached. Refresh will retry shortly.', delay);
  const source = salesNavigatorSource(config.url!);
  const response = await call<{ data: Record<string, unknown>[]; total_count?: number }>(
    sender.providerId,
    `${source.path}?offset=${offset}&limit=25`,
    { method: 'POST', body: JSON.stringify(source.body) },
  );
  if (!Array.isArray(response.data))
    throw new IntakeError('Sales Navigator returned an unexpected response.');
  const nextOffset = offset + response.data.length;
  return {
    rows: response.data.map(salesRow),
    nextOffset,
    more:
      response.data.length > 0 &&
      (!source.path.endsWith('/search') || nextOffset < 2500) &&
      (response.total_count === undefined || nextOffset < response.total_count),
  };
}

export async function syncList(db: SupabaseClient, sourceId?: string, rows?: unknown) {
  const { data: source, error: claimError } = await db.rpc('campaign_list_claim', {
    p_source: sourceId || null,
  });
  if (claimError) throw new IntakeError('List refresh could not be claimed.');
  if (!source) return null;
  try {
    const workspace = await workspaceFor(db, source.created_by);
    if (workspace !== source.workspace_id)
      throw new IntakeError('The list owner no longer has access to this workspace.');
    const page = await readList(
      db,
      source.created_by,
      workspace,
      source.campaign_id,
      source.kind,
      source.config,
      source.offset_position,
      rows,
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      const w = await snapshot(db, workspace, source.campaign_id);
      const result = importPeople(w.data, w.campaign, page.rows);
      const { data: saved, error } = await db.rpc('campaign_list_apply', {
        p_source: source.id,
        p_token: source.lease_token,
        p_revision: w.revision,
        p_people: result.people,
        p_enrollments: result.enrollments,
        p_added: result.added,
        p_next_offset: page.nextOffset,
        p_more: page.more,
      });
      if (error) throw new IntakeError('The imported list could not be saved.');
      if (saved)
        return {
          sourceId: source.id,
          added: result.added,
          duplicate: result.duplicate,
          invalid: result.invalid,
          blocked: result.blocked,
          more: page.more,
        };
    }
    throw new IntakeError('The workspace changed during import. Retry the list refresh.', 60);
  } catch (error) {
    const message =
      error instanceof IntakeError
        ? error.message
        : error instanceof UnipileError
          ? error.status === 403
            ? 'This sender needs Sales Navigator access or reconnection.'
            : 'Sales Navigator could not be refreshed.'
          : 'List refresh failed.';
    const retry =
      error instanceof IntakeError
        ? error.retrySeconds
        : error instanceof UnipileError && error.retryable
          ? error.retryAfterSeconds || 300
          : undefined;
    await db.rpc('campaign_list_release', {
      p_source: source.id,
      p_token: source.lease_token,
      p_error: message,
      p_retry_seconds: retry || null,
    });
    throw new IntakeError(message, retry);
  }
}
