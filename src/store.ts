import { createClient } from '@supabase/supabase-js';
import type { Data } from './model';
import { demoData } from './demo';
const env = (import.meta as ImportMeta & { env: Record<string, string> }).env;
export const supabase =
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY
    ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
    : null;
export const isDemo = !supabase;
const key = 'gershon-campaign-demo-v1';
export async function loadData(): Promise<{ data: Data; revision: number }> {
  if (!supabase) {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return { data: JSON.parse(saved), revision: 0 };
    } catch {}
    return { data: demoData(), revision: 0 };
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
export async function providerAction(action: string, payload: unknown) {
  if (!supabase) throw new Error('Connect the database and LinkedIn provider to use this action.');
  const { data, error } = await supabase.functions.invoke('campaign-api', {
    body: { action, payload },
  });
  if (error) throw error;
  if (data.error) throw new Error(data.error);
  return data;
}

/** Live LinkedIn (Unipile) health from the linkedin-status Edge Function. Works in demo mode too. */
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
