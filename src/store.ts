import { createClient } from '@supabase/supabase-js';
import type { Data } from './model';
import { emptyWorkspace, migrateLocalDrafts } from './workspace';
const env = (import.meta as ImportMeta & { env: Record<string, string> }).env;
export const supabase =
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY
    ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
    : null;
export const isLocal = !supabase;
const key = 'gershon-campaign-drafts-v2';
export async function loadData(): Promise<{ data: Data; revision: number }> {
  if (!supabase) {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return { data: JSON.parse(saved), revision: 0 };
      const previous = localStorage.getItem('gershon-campaign-demo-v1');
      if (previous) {
        const data = migrateLocalDrafts(JSON.parse(previous));
        localStorage.setItem(key, JSON.stringify(data));
        return { data, revision: 0 };
      }
    } catch {}
    return { data: emptyWorkspace(), revision: 0 };
  }
  const { data, error } = await supabase.rpc('campaign_snapshot');
  if (error) throw error;
  return data;
}
export async function saveData(data: Data, revision: number): Promise<number> {
  if (!supabase) {
    localStorage.setItem(key, JSON.stringify(data));
    return revision;
  }
  const { data: next, error } = await supabase.rpc('campaign_save', {
    p_data: data,
    p_revision: revision,
  });
  if (error) throw error;
  return next;
}
async function invokeAction(endpoint: string, action: string, payload: unknown) {
  if (!supabase) throw new Error('Sign in to the connected workspace to use this action.');
  const { data, error } = await supabase.functions.invoke(endpoint, {
    body: { action, payload },
  });
  if (error) {
    if (error.context instanceof Response) {
      const body = await error.context.json().catch(() => null);
      if (body?.error) throw new Error(body.error);
    }
    throw error;
  }
  if (data.error) throw new Error(data.error);
  return data;
}
export const providerAction = (action: string, payload: unknown) =>
  invokeAction('campaign-api', action, payload);
export const listAction = (action: string, payload: unknown) =>
  invokeAction('campaign-lists', action, payload);

/** Read-only connection health. This does not create or assign a workspace sender. */
export type LinkedInStatus = {
  connected: boolean;
  account?: string;
  checkedAt?: string;
  status?: number;
};
export async function linkedinStatus(): Promise<LinkedInStatus | null> {
  const url = env.VITE_LINKEDIN_STATUS_URL,
    key = env.VITE_LINKEDIN_STATUS_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
    return (await r.json()) as LinkedInStatus;
  } catch {
    return { connected: false };
  }
}
