import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, migrateLocalDrafts } from '../src/workspace.ts';
import { demoData } from './fixtures/workspace.ts';
import { importPeople, metrics } from '../src/model.ts';
import {
  csvRows,
  listConfig,
  salesNavigatorSource,
  radarRow,
  salesRow,
} from '../supabase/functions/_shared/prospect-lists.ts';

test('new workspaces have no invented prospects, campaigns, senders, messages or activity', () => {
  const d = emptyWorkspace();
  for (const [key, value] of Object.entries(d))
    if (Array.isArray(value)) assert.equal(value.length, 0, key);
  assert.equal(d.settings.killSwitch, true);
  assert.equal(metrics(d).invited, 0);
  assert.equal(metrics(d).messages, 0);
  assert.equal(metrics(d).replies, 0);
});
test('the former browser seed is removed without mutating its recovery copy', () => {
  const previous = demoData(),
    copy = structuredClone(previous),
    clean = migrateLocalDrafts(previous);
  assert.equal(clean.people.length, 0);
  assert.equal(clean.campaigns.length, 0);
  assert.equal(clean.senders.length, 0);
  assert.equal(clean.conversations.length, 0);
  assert.equal(clean.activities.length, 0);
  assert.equal(clean.snippets.length, 0);
  assert.deepEqual(previous, copy);
});
test('legacy imports and user-authored drafts survive cleanup without fictional delivery progress', () => {
  const previous = demoData();
  previous.people.push({
    ...previous.people[0],
    id: 'real-import',
    linkedinUrl: 'https://www.linkedin.com/in/imported-contact',
    source: 'CSV',
  });
  previous.enrollments.push({
    id: 'real-enrollment',
    personId: 'real-import',
    campaignId: 'c1',
    state: 'queued',
    step: 0,
    nextAt: '',
    skipReason: '',
  });
  previous.clients.push({ id: 'user-client', name: 'User organization', key: 'USER' });
  previous.snippets.push({ id: 'user-snippet', title: 'User text', body: 'My own draft' });
  const clean = migrateLocalDrafts(previous);
  assert.equal(clean.people.length, 1);
  assert.equal(clean.people[0].id, 'real-import');
  assert.equal(clean.campaigns.length, 1);
  assert.equal(clean.campaigns[0].name, 'Recovered draft');
  assert.equal(clean.campaigns[0].status, 'Draft');
  assert.equal(clean.campaigns[0].startedAt, undefined);
  assert.equal(clean.enrollments.length, 1);
  assert.equal(clean.enrollments[0].state, 'queued');
  assert.equal(clean.activities.length, 0);
  assert.equal(clean.conversations.length, 0);
  assert.ok(clean.clients.some((c) => c.id === 'user-client'));
  assert.equal(clean.snippets[0].id, 'user-snippet');
});
test('CSV keeps only mapped real fields and cannot inject IDs or execution facts', () => {
  const rows = csvRows([
    {
      linkedinUrl: ' https://www.linkedin.com/in/imported-contact ',
      firstName: ' Name ',
      id: 'injected',
      state: 'finished',
      workspace_id: 'other',
      provider_id: 'fake',
      source: 'forged',
    },
  ]);
  assert.equal(rows[0].source, 'CSV');
  assert.equal(rows[0].firstName, 'Name');
  assert.equal(rows[0].id, undefined);
  assert.equal(rows[0].state, undefined);
  assert.throws(() => csvRows(Array.from({ length: 5001 }, () => ({}))), /5,000/);
});
test('Sales Navigator accepts search and saved lead lists but rejects account lists and lookalike hosts', () => {
  assert.equal(
    salesNavigatorSource('https://www.linkedin.com/sales/search/people?query=example').path,
    'linkedin/sales-navigator/search',
  );
  assert.deepEqual(
    salesNavigatorSource('https://www.linkedin.com/sales/lists/people/list123').body,
    {},
  );
  assert.equal(
    salesNavigatorSource('https://www.linkedin.com/sales/lists/people/list123').path,
    'linkedin/sales-navigator/lead-lists/list123',
  );
  for (const url of [
    'https://linkedin.com.evil.test/sales/search/people',
    'https://linkedin.com@evil.test/sales/search/people',
    'http://www.linkedin.com/sales/search/people',
    'https://www.linkedin.com/sales/lists/accounts/list123',
    'https://www.linkedin.com/in/person',
    'https://www.linkedin.com:444/sales/search/people',
  ])
    assert.throws(() => salesNavigatorSource(url));
});
test('Radar configuration ignores browser-supplied ownership and maps actual lead IDs', () => {
  assert.deepEqual(
    listConfig('radar', { grade: 'A', country: 'France', owner_key: 'another-owner' } as any),
    { grade: 'A', country: 'France' },
  );
  assert.deepEqual(
    radarRow({
      lead_id: 'lead-123',
      linkedin_url: 'https://www.linkedin.com/in/contact',
      first_name: 'Name',
    }).radarProspectId,
    'lead-123',
  );
  assert.throws(() => listConfig('radar', { grade: 'unknown' }), /grade/);
});
test('Sales Navigator data does not invent a name, company or title', () => {
  const row = salesRow({ profile_url: 'https://www.linkedin.com/in/contact' });
  assert.equal(row.firstName, '');
  assert.equal(row.lastName, '');
  assert.equal(row.company, '');
  assert.equal(row.title, '');
});
test('repeated dynamic matches are deduplicated across completed campaigns and clients', () => {
  const d = demoData();
  d.campaigns[0].status = 'Completed';
  d.campaigns[2].clientId = 'another-client';
  const result = importPeople(d, d.campaigns[2], [{ linkedinUrl: d.people[0].linkedinUrl }]);
  assert.equal(result.added, 0);
  assert.equal(result.duplicate, 1);
});
