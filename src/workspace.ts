import type { Data } from './model.ts';

export function emptyWorkspace(): Data {
  return {
    clients: [],
    campaigns: [],
    people: [],
    enrollments: [],
    senders: [],
    conversations: [],
    activities: [],
    blacklist: [],
    snippets: [],
    templates: [],
    settings: { timezone: 'America/La_Paz', digest: false, notifications: true, killSwitch: true },
  };
}

/** Preserve imported contacts and user drafts from the former local preview.
 * The original browser entry remains untouched as a recovery copy. Provider
 * delivery facts cannot have been real in that local-only preview. */
export function migrateLocalDrafts(previous: Data): Data {
  const people = previous.people.filter(
    (p) => !p.linkedinUrl.includes('/in/demo-person-') && p.source !== 'Sample Radar data',
  );
  const personIds = new Set(people.map((p) => p.id));
  const seedIds = new Set(['c1', 'c2', 'c3']);
  const campaigns = previous.campaigns
    .filter(
      (c) =>
        !seedIds.has(c.id) ||
        previous.enrollments.some((e) => e.campaignId === c.id && personIds.has(e.personId)),
    )
    .map((c) => ({
      ...c,
      name: seedIds.has(c.id) ? 'Recovered draft' : c.name,
      status: 'Draft' as const,
      startedAt: undefined,
      senderId: previous.senders.some(
        (s) => s.id === c.senderId && s.providerId?.startsWith('acc_'),
      )
        ? c.senderId
        : '',
    }));
  const campaignIds = new Set(campaigns.map((c) => c.id));
  return {
    ...emptyWorkspace(),
    people,
    campaigns,
    clients: previous.clients.filter(
      (c) => c.id !== 'client1' || campaigns.some((x) => x.clientId === c.id),
    ),
    senders: previous.senders.filter((s) => s.providerId?.startsWith('acc_')),
    enrollments: previous.enrollments
      .filter((e) => personIds.has(e.personId) && campaignIds.has(e.campaignId))
      .map((e) => ({ ...e, state: 'queued', step: 0, nextAt: '', skipReason: '' })),
    blacklist: previous.blacklist,
    snippets: previous.snippets.filter((s) => s.id !== 'sn1'),
    templates: previous.templates,
  };
}
