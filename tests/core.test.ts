import test from 'node:test';
import assert from 'node:assert/strict';
import {
  importPeople,
  normalizeUrl,
  renderVariables,
  validateCampaign,
  templateSteps,
} from '../src/model.ts';
import { demoData } from '../src/demo.ts';
import {
  isWorking,
  plan,
  quotaAvailable,
  completeAction,
  sendConditionAllows,
} from '../src/engine.ts';
test('normalizes profile URLs and rejects unrelated destinations', () => {
  assert.equal(
    normalizeUrl('https://linkedin.com/in/Test/?trk=abc'),
    'https://www.linkedin.com/in/test',
  );
  for (const url of [
    'https://linkedin.com.evil.test/in/test',
    'https://example.com/in/test',
    'javascript:alert(1)',
    'https://linkedin.com/company/test',
  ])
    assert.equal(normalizeUrl(url), '');
});
test('variables resolve fallbacks and report missing values', () => {
  assert.deepEqual(renderVariables('Hi {{firstName | there}} at {{company}}', {}), {
    text: 'Hi there at [company missing]',
    missing: ['company'],
  });
  assert.equal(
    renderVariables('{{fullName}}', { firstName: 'Alex', lastName: 'Kim' }).text,
    'Alex Kim',
  );
});
test('imports reject duplicates within the same batch and active client campaigns', () => {
  const d = demoData(),
    c = d.campaigns[2];
  const r = importPeople(d, c, [
    { linkedinUrl: d.people[0].linkedinUrl },
    { linkedinUrl: 'https://linkedin.com/in/new' },
    { linkedinUrl: 'https://linkedin.com/in/new/' },
    { linkedinUrl: 'bad' },
  ]);
  assert.equal(r.added, 1);
  assert.equal(r.duplicate, 2);
  assert.equal(r.invalid, 1);
});
test('blacklist rules are scoped to the relevant client', () => {
  const d = demoData(),
    c = d.campaigns[2];
  d.blacklist = [
    { id: 'b', clientId: 'other', kind: 'company', value: 'Acme' },
    { id: 'b2', clientId: '', kind: 'keyword', value: 'Recruiter' },
  ];
  const r = importPeople(d, c, [
    { linkedinUrl: 'https://linkedin.com/in/new', company: 'Acme', title: 'CEO' },
    { linkedinUrl: 'https://linkedin.com/in/other', title: 'Senior Recruiter' },
  ]);
  assert.equal(r.added, 1);
  assert.equal(r.blocked, 1);
});
test('start validation catches missing sender, prospect and variable data', () => {
  const d = demoData(),
    c = d.campaigns[2];
  assert.match(validateCampaign(c, d).join(' '), /prospect/);
  d.enrollments.push({
    id: 'e9',
    campaignId: c.id,
    personId: 'p0',
    state: 'queued',
    step: 0,
    nextAt: '',
    skipReason: '',
  });
  c.steps[4].body = '{{unknown}}';
  assert.match(validateCampaign(c, d).join(' '), /fallback/);
  d.senders[0].status = 'Disconnected';
  assert.match(validateCampaign(c, d).join(' '), /Connect a LinkedIn sender/);
});
test('working hours respect timezone, weekends and daylight saving', () => {
  const c = demoData().campaigns[0];
  assert.equal(isWorking(c, new Date('2026-11-23T08:00:00Z')), true);
  assert.equal(isWorking(c, new Date('2026-11-23T17:00:00Z')), false);
  assert.equal(isWorking(c, new Date('2026-11-22T10:00:00Z')), false);
  assert.equal(isWorking(c, new Date('2026-07-20T07:00:00Z')), true);
});
test('reply, blacklist, kill switch and disconnection prevent sending', () => {
  for (const rule of ['reply', 'blacklist', 'kill', 'disconnected']) {
    const d = demoData();
    d.activities = [];
    d.campaigns = d.campaigns.slice(0, 1);
    d.enrollments = d.enrollments.slice(0, 1);
    const e = d.enrollments[0];
    e.state = 'queued';
    e.step = 1;
    e.nextAt = '2026-11-23T07:00:00Z';
    d.people[0].connected = false;
    if (rule !== 'reply') d.conversations = [];
    if (rule === 'blacklist')
      d.blacklist = [{ id: 'b', clientId: '', kind: 'profile', value: d.people[0].linkedinUrl }];
    if (rule === 'kill') d.settings.killSwitch = true;
    if (rule === 'disconnected') d.senders[0].status = 'Disconnected';
    assert.equal(plan(d, new Date('2026-11-23T10:00:00Z')).length, 0, rule);
  }
});
test('quotas apply across campaigns on the same sender', () => {
  const d = demoData(),
    at = new Date('2026-11-23T10:00:00Z');
  d.activities = Array.from({ length: 20 }, (_, i) => ({
    id: `q${i}`,
    campaignId: 'c2',
    personId: 'p0',
    type: 'invitation.sent',
    at: at.toISOString(),
    detail: '',
  }));
  assert.equal(quotaAvailable(d, d.campaigns[0], d.senders[0], 'invite', at), false);
});
test('planner paces sends, claims only one per sender and advances after success', () => {
  const d = demoData(),
    at = new Date('2026-11-23T10:00:00Z');
  d.activities = [];
  d.conversations = [];
  d.enrollments = d.enrollments
    .slice(3, 5)
    .map((e) => ({ ...e, state: 'queued', step: 1, nextAt: '' }));
  d.people.forEach((p) => (p.connected = false));
  assert.equal(plan(d, at, () => 0).length, 0);
  assert.ok(d.enrollments.every((e) => new Date(e.nextAt).getTime() >= at.getTime() + 45000));
  const actions = plan(d, new Date(at.getTime() + 60000), () => 0);
  assert.equal(actions.length, 1);
  completeAction(d, actions[0], new Date(at.getTime() + 60000));
  assert.equal(d.enrollments[0].step, 2);
  assert.equal(d.activities[0].type, 'invitation.sent');
});
test('message conditions require a new thread when requested', () => {
  const d = demoData(),
    s = templateSteps('Message connections')[1];
  s.condition = 'new';
  assert.equal(sendConditionAllows(s, d.conversations[0]), false);
  assert.equal(sendConditionAllows(s, undefined), true);
});
