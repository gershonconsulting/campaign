/**
 * Unipile API v2 client (LinkedIn Classic). Server-side only.
 * Endpoints below were tested live on 2026-11-23 (see project note "unipile-api-notes").
 *
 * Secrets (Supabase Edge Function secrets, never VITE_ variables):
 *   UNIPILE_API_KEY     – X-API-KEY credential
 *   UNIPILE_ACCOUNT_ID  – default sender account (acc_…); campaigns pass their own sender id
 */
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
  const id = override || Deno.env.get('UNIPILE_ACCOUNT_ID');
  if (!id || !/^acc_[a-z0-9]+$/i.test(id)) throw new Error('Unipile account id is not configured.');
  return id;
}

export async function call<T = unknown>(
  account: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const key = Deno.env.get('UNIPILE_API_KEY'); // Edge Function secret only — never commit it
  if (!key) throw new Error('Unipile is not configured. Set UNIPILE_API_KEY.');
  const res = await fetch(`${BASE}/${encodeURIComponent(account)}/${path.replace(/^\//, '')}`, {
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
    const retry = Number(res.headers.get('retry-after')) || undefined;
    // Never echo request bodies or credentials into errors.
    throw new UnipileError(
      res.status,
      String(body.type || body.code || 'provider/error'),
      `Unipile ${res.status}: ${String(body.title || body.detail || body.message || 'request failed').slice(0, 200)}`,
      retry,
    );
  }
  return body as T;
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
