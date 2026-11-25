/**
 * Unipile API v2 client (LinkedIn Classic). Server-side only.
 * Endpoints below were tested live on 2026-11-23 (see project note "unipile-api-notes").
 *
 * Key resolution (never in code, never in a VITE_ variable):
 *   1. Edge Function secret UNIPILE_API_KEY, if set
 *   2. else Supabase Vault secret `unipile_api_key`, read through the service-role-only
 *      RPC public.campaign_unipile_key() (radar project, 2026-11-23)
 * UNIPILE_ACCOUNT_ID overrides the default sender account (Olivier's).
 */
const DEFAULT_ACCOUNT = 'acc_01m84yrp1bfzxv230q672gh957';
let cachedKey: string | undefined;

async function apiKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const env = Deno.env.get('UNIPILE_API_KEY');
  if (env) return (cachedKey = env);
  const url = Deno.env.get('SUPABASE_URL'),
    service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) throw new Error('Unipile is not configured.');
  const res = await fetch(`${url}/rest/v1/rpc/campaign_unipile_key`, {
    method: 'POST',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(10000),
  });
  const key = res.ok ? await res.json() : null;
  if (typeof key !== 'string' || !key) throw new Error('Unipile key not found in Vault.');
  return (cachedKey = key);
}
const BASE = 'https://api.unipile.com/v2';
const INBOX = 'CLASSIC_PRIMARY';

export class UnipileError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
  /** 429 and 5xx are worth retrying with backoff; 4xx are permanent for that action. */
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

export function accountId(override?: string) {
  const id = override || Deno.env.get('UNIPILE_ACCOUNT_ID') || DEFAULT_ACCOUNT;
  if (!id || !/^acc_[a-z0-9]+$/i.test(id)) throw new Error('Unipile account id is not configured.');
  return id;
}

export async function call<T = unknown>(
  account: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return request<T>(`${encodeURIComponent(account)}/${path.replace(/^\//, '')}`, init);
}

/** Platform endpoints (accounts and hosted auth) are not account-prefixed. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = await apiKey();
  const res = await fetch(`${BASE}/${path}`, {
    ...init,
    headers: {
      'X-API-KEY': key,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const header = res.headers.get('retry-after');
    const seconds =
      header && /^\d+$/.test(header)
        ? Number(header)
        : header && Number.isFinite(Date.parse(header))
          ? Math.ceil((Date.parse(header) - Date.now()) / 1000)
          : 0;
    const detail = String(body.detail || body.message || body.title || '');
    const retry =
      Math.max(0, seconds) || Number(detail.match(/Retry in (\d+) seconds?/i)?.[1]) || undefined;
    // Never echo request bodies or credentials into errors.
    throw new UnipileError(
      res.status,
      String(body.type || body.code || 'provider/error'),
      `Unipile request failed (${res.status}).`,
      retry,
    );
  }
  return body as T;
}

export interface ProviderAccount {
  id: string;
  provider: string;
  name?: string;
  status: string;
  is_locked: boolean;
}

export const getAccount = (id: string) =>
  request<ProviderAccount>(`accounts/${encodeURIComponent(accountId(id))}`);

export async function createAuthLink(expiresOn: string, redirectUri: string) {
  const result = await request<{ link: string }>('auth/link', {
    method: 'POST',
    body: JSON.stringify({
      providers: ['linkedin'],
      expires_on: expiresOn,
      redirect_uri: redirectUri,
    }),
  });
  if (typeof result.link !== 'string' || new URL(result.link).protocol !== 'https:')
    throw new Error('Invalid hosted authentication link.');
  return result.link;
}

export type NetworkDistance = 'FIRST_DEGREE' | 'SECOND_DEGREE' | 'THIRD_DEGREE' | string;
export interface LinkedInUser {
  id: string; // ACoA… provider id
  first_name?: string;
  last_name?: string;
  headline?: string;
  public_identifier?: string;
  specifics?: { network_distance?: NetworkDistance; can_send_inmail?: boolean };
}

/** Public id from a LinkedIn profile URL, e.g. https://www.linkedin.com/in/jane-doe/ → jane-doe */
export function publicIdFromUrl(url: string) {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m) throw new Error('Not a LinkedIn profile URL.');
  return decodeURIComponent(m[1]);
}

/** Cheap health check: proves the key and the account session both work. */
export async function checkAccount(account: string) {
  // v2 list responses use `data` (verified live 2026-11-23).
  const r = await call<{ data?: unknown[] }>(account, `inboxes/${INBOX}/chats?limit=1`);
  return { connected: true, sampleChats: Array.isArray(r.data) ? r.data.length : 0 };
}

export const getUser = (account: string, publicId: string) =>
  call<LinkedInUser>(account, `users/${encodeURIComponent(publicId)}?variant=linkedin_classic`);

/** Connection request. LinkedIn caps the note at 300 characters. */
export function sendInvitation(account: string, providerId: string, note?: string) {
  if (note && note.length > 300) throw new Error('Invitation note exceeds 300 characters.');
  return call<{ object: string; id: string }>(account, 'users/me/relation-requests', {
    method: 'POST',
    body: JSON.stringify({ user_id: providerId, ...(note ? { message: note } : {}) }),
  });
}

/** First message to a 1st-degree connection. users_ids MUST be an array. */
export const startChat = (account: string, providerId: string, text: string) =>
  call<{ chat_id: string; message_id: string }>(account, `inboxes/${INBOX}/chats/send`, {
    method: 'POST',
    body: JSON.stringify({ text, users_ids: [providerId] }),
  });

/** Reply in an existing chat (documented, not yet live-tested). */
export const sendInChat = (account: string, chatId: string, text: string) =>
  call(account, `chats/${encodeURIComponent(chatId)}/messages/send`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });

export const listChats = (account: string, cursor?: string) =>
  call<{ data: unknown[]; next_cursor?: string }>(
    account,
    `inboxes/${INBOX}/chats?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
