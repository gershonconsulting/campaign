import { readList } from '../_shared/list-intake.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

function assert(value: unknown, message = 'Assertion failed') {
  if (!value) throw new Error(message);
}
async function rejects(run: () => Promise<unknown>, pattern: RegExp) {
  try {
    await run();
  } catch (error) {
    assert(pattern.test((error as Error).message));
    return;
  }
  throw new Error('Expected rejection');
}

Deno.test(
  'real list readers scope Radar to the verified user and limit Sales Navigator requests',
  async () => {
    let email = 'owner@example.test',
      verified = true,
      delay = 0,
      totalCount = 100;
    const requests: { url: URL; body: unknown }[] = [];
    const originalFetch = globalThis.fetch,
      previousKey = Deno.env.get('UNIPILE_API_KEY');
    Deno.env.set('UNIPILE_API_KEY', 'fake-test-key-not-a-provider-credential');
    const data: Record<string, Record<string, any>[]> = {
      campaign_workspaces: [
        {
          id: 'workspace',
          revision: 0,
          data: {
            campaigns: [
              { id: 'campaign', status: 'Draft', clientId: 'client', senderId: 'sender' },
            ],
            senders: [{ id: 'sender', clientId: 'client', providerId: 'acc_test123' }],
          },
        },
      ],
      users: [
        { email: 'owner@example.test', owner_key: 'own-key' },
        { email: 'other@example.test', owner_key: 'other-key' },
      ],
      targets: [
        {
          owner_key: 'own-key',
          lead_id: 'lead4',
          selected: null,
          grade: 'A',
          country: 'France',
          linkedin_url: 'https://www.linkedin.com/in/legacy-selected',
        },
        {
          owner_key: 'own-key',
          lead_id: 'lead1',
          selected: true,
          first_name: 'Own',
          linkedin_url: 'https://www.linkedin.com/in/own',
          grade: 'A',
          country: 'France',
        },
        {
          owner_key: 'other-key',
          lead_id: 'lead2',
          selected: true,
          first_name: 'Other',
          linkedin_url: 'https://www.linkedin.com/in/other',
          grade: 'A',
          country: 'France',
        },
        {
          owner_key: 'own-key',
          lead_id: 'lead3',
          selected: false,
          linkedin_url: 'https://www.linkedin.com/in/unselected',
          grade: 'A',
          country: 'France',
        },
      ],
    };
    const db = {
      auth: {
        admin: {
          getUserById: () =>
            Promise.resolve({
              data: { user: { email, email_confirmed_at: verified ? '2026-01-01' : null } },
              error: null,
            }),
        },
      },
      rpc: (name: string) => {
        assert(name === 'campaign_list_reserve_provider');
        return Promise.resolve({ data: delay, error: null });
      },
      from: (table: string) => {
        let rows = [...(data[table] || [])];
        const query = {
          select: () => query,
          eq: (key: string, value: unknown) => {
            rows = rows.filter((row) => row[key] === value);
            return query;
          },
          or: (filter: string) => {
            assert(filter === 'selected.eq.true,selected.is.null');
            rows = rows.filter((row) => row.selected !== false);
            return query;
          },
          ilike: (key: string, value: string) => {
            rows = rows.filter((row) => String(row[key]).toLowerCase() === value.toLowerCase());
            return query;
          },
          order: () => query,
          range: (start: number, end: number) => {
            rows = rows.slice(start, end + 1);
            return query;
          },
          limit: (n: number) => {
            rows = rows.slice(0, n);
            return query;
          },
          single: () =>
            Promise.resolve({
              data: rows.length === 1 ? rows[0] : null,
              error: rows.length === 1 ? null : {},
            }),
          then: (resolve: any, reject: any) =>
            Promise.resolve({ data: rows, error: null }).then(resolve, reject),
        };
        return query;
      },
    } as unknown as SupabaseClient;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert(url.origin === 'https://api.unipile.com');
      assert(!url.pathname.includes('/messages') && !url.pathname.includes('/relation-requests'));
      requests.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({
        data: [
          {
            id: 'provider-id',
            profile_url: 'https://www.linkedin.com/in/real-result',
            first_name: 'Result',
          },
        ],
        total_count: totalCount,
      });
    };
    try {
      const radar = await readList(db, 'user', 'workspace', 'campaign', 'radar', {
        grade: 'A',
        country: 'France',
        owner_key: 'other-key',
      } as any);
      assert(radar.rows.length === 2);
      assert(radar.rows.some((row) => (row as any).firstName === 'Own'));
      assert(radar.rows.some((row) => (row as any).radarProspectId === 'lead1'));
      assert(radar.rows.some((row) => (row as any).radarProspectId === 'lead4'));
      assert(requests.length === 0);
      verified = false;
      await rejects(() => readList(db, 'user', 'workspace', 'campaign', 'radar', {}), /verified/);
      verified = true;
      email = 'unmapped@example.test';
      await rejects(() => readList(db, 'user', 'workspace', 'campaign', 'radar', {}), /linked/);
      email = 'owner@example.test';
      const search = 'https://www.linkedin.com/sales/search/people?query=owner';
      const sales = await readList(
        db,
        'user',
        'workspace',
        'campaign',
        'sales_navigator',
        { url: search },
        25,
      );
      assert(sales.rows.length === 1 && sales.more);
      assert(sales.nextOffset === 26);
      assert(requests[0].url.pathname === '/v2/acc_test123/linkedin/sales-navigator/search');
      assert(requests[0].url.searchParams.get('offset') === '25');
      assert((requests[0].body as any).url === search);
      await readList(db, 'user', 'workspace', 'campaign', 'sales_navigator', {
        url: 'https://www.linkedin.com/sales/lists/people/list123',
      });
      assert(requests[1].url.pathname.endsWith('/lead-lists/list123'));
      assert(JSON.stringify(requests[1].body) === '{}');
      delay = 12;
      await rejects(
        () => readList(db, 'user', 'workspace', 'campaign', 'sales_navigator', { url: search }),
        /limit/,
      );
      assert(requests.length === 2, 'Rate limiting must happen before any provider request');
      delay = 0;
      const csv = await readList(
        db,
        'user',
        'workspace',
        'campaign',
        'csv',
        { fileName: 'own.csv' },
        0,
        [{ linkedinUrl: 'https://www.linkedin.com/in/imported' }],
      );
      assert(csv.rows.length === 1 && !csv.more);
      assert(requests.length === 2);
      totalCount = 10000;
      const capped = await readList(
        db,
        'user',
        'workspace',
        'campaign',
        'sales_navigator',
        { url: search },
        2499,
      );
      const savedList = await readList(
        db,
        'user',
        'workspace',
        'campaign',
        'sales_navigator',
        { url: 'https://www.linkedin.com/sales/lists/people/list123' },
        2499,
      );
      assert(!capped.more && savedList.more, 'Only search results use the 2,500 cap');
      data.campaign_workspaces[0].data.senders[0].clientId = 'another-client';
      await rejects(
        () => readList(db, 'user', 'workspace', 'campaign', 'sales_navigator', { url: search }),
        /Assign/,
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) Deno.env.delete('UNIPILE_API_KEY');
      else Deno.env.set('UNIPILE_API_KEY', previousKey);
    }
  },
);
