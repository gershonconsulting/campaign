import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAuthLink,
  getAccount,
  getUser,
  sendInvitation,
  startChat,
  sendInChat,
  listChats,
  checkAccount,
  UnipileError,
} from '../supabase/functions/_shared/unipile-v2.ts';

// In-process fake HTTP server: every fetch is intercepted; no provider calls.
test('v2 provider contract with a fake server', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalDeno = (globalThis as any).Deno;
  const requests: { url: URL; init: RequestInit; body: any }[] = [];
  let response: unknown = {};
  let status = 200;
  let headers: Record<string, string> = {};
  (globalThis as any).Deno = {
    env: { get: (key: string) => (key === 'UNIPILE_API_KEY' ? 'fake-test-credential' : undefined) },
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.unipile.com');
    assert.equal(new Headers(init.headers).get('X-API-KEY'), 'fake-test-credential');
    requests.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(response, { status, headers });
  };
  const account = 'acc_fake123';
  const last = () => requests.at(-1)!;
  try {
    await t.test('hosted auth uses the platform route and v2 field names', async () => {
      response = { link: 'https://auth.unipile.com/session/fake' };
      const redirect = 'https://example.test/callback?request=fake-request';
      assert.equal(await createAuthLink('2030-01-01T00:00:00Z', redirect), (response as any).link);
      assert.equal(last().url.pathname, '/v2/auth/link');
      assert.equal(last().init.method, 'POST');
      assert.deepEqual(last().body, {
        providers: ['linkedin'],
        expires_on: '2030-01-01T00:00:00Z',
        redirect_uri: redirect,
      });
    });
    await t.test('account verification is not account-prefixed', async () => {
      response = { id: account, provider: 'linkedin', status: 'running', is_locked: false };
      assert.deepEqual(await getAccount(account), response);
      assert.equal(last().url.pathname, `/v2/accounts/${account}`);
    });
    await t.test('rejects malformed account IDs before fetching', async () => {
      const count = requests.length;
      assert.throws(() => getAccount('../other'), /account id/);
      assert.equal(requests.length, count);
    });
    await t.test('non-ASCII public identifiers are URL encoded', async () => {
      response = { id: 'ACoA_fake', specifics: { network_distance: 'FIRST_DEGREE' } };
      assert.deepEqual(await getUser(account, 'élise'), response);
      assert.equal(last().url.pathname, `/v2/${account}/users/%C3%A9lise`);
      assert.equal(last().url.searchParams.get('variant'), 'linkedin_classic');
    });
    await t.test('invites enforce 300 characters and preserve line breaks', async () => {
      assert.throws(() => sendInvitation(account, 'ACoA_fake', 'x'.repeat(301)), /300/);
      response = { id: 'SENT_fake' };
      await sendInvitation(account, 'ACoA_fake', 'Hello\nthere');
      assert.equal(last().url.pathname, `/v2/${account}/users/me/relation-requests`);
      assert.deepEqual(last().body, { user_id: 'ACoA_fake', message: 'Hello\nthere' });
    });
    await t.test('first messages use users_ids array; replies use chat route', async () => {
      response = { chat_id: 'chat_fake', message_id: 'msg_fake' };
      assert.deepEqual(await startChat(account, 'ACoA_fake', 'Hello'), response);
      assert.deepEqual(last().body, { text: 'Hello', users_ids: ['ACoA_fake'] });
      assert.equal(last().url.pathname, `/v2/${account}/inboxes/CLASSIC_PRIMARY/chats/send`);
      await sendInChat(account, 'chat_fake', 'Reply');
      assert.equal(last().url.pathname, `/v2/${account}/chats/chat_fake/messages/send`);
      assert.deepEqual(last().body, { text: 'Reply' });
    });
    await t.test('chat pagination uses data, next_cursor and a maximum of 25', async () => {
      response = { data: [{ id: 'chat_fake' }], next_cursor: 'next+page' };
      assert.deepEqual(await listChats(account, 'previous+page'), response);
      assert.equal(last().url.searchParams.get('limit'), '25');
      assert.equal(last().url.searchParams.get('cursor'), 'previous+page');
      assert.deepEqual(await checkAccount(account), { connected: true, sampleChats: 1 });
    });
    await t.test('429 exposes retry delay and retryable classification', async () => {
      status = 429;
      headers = { 'retry-after': '12' };
      response = {
        type: 'api/rate_limit',
        message: 'We only allow 10 requests. Retry in 12 seconds.',
      };
      await assert.rejects(
        listChats(account),
        (e: unknown) => e instanceof UnipileError && e.retryable && e.retryAfterSeconds === 12,
      );
    });
    await t.test(
      '403 access restriction is permanent; 5xx is retryable; errors redact provider text',
      async () => {
        headers = {};
        response = {
          type: 'provider/access_restricted',
          detail: 'private-message-text fake-test-credential',
        };
        status = 403;
        await assert.rejects(
          startChat(account, 'ACoA_fake', 'private-message-text'),
          (e: unknown) =>
            e instanceof UnipileError &&
            !e.retryable &&
            e.code === 'provider/access_restricted' &&
            !e.message.includes('private-message') &&
            !e.message.includes('fake-test-credential'),
        );
        status = 503;
        await assert.rejects(
          listChats(account),
          (e: unknown) => e instanceof UnipileError && e.retryable,
        );
      },
    );
    await t.test('hosted auth rejects non-HTTPS links', async () => {
      status = 200;
      response = { link: 'javascript:alert(1)' };
      await assert.rejects(createAuthLink('2030-01-01', 'https://example.test'), /Invalid hosted/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as any).Deno = originalDeno;
  }
});
