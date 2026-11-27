export type Status = 'Draft' | 'Running' | 'Paused' | 'Completed' | 'Archived';
export type StepType =
  'visit' | 'invite' | 'acceptance' | 'wait' | 'message' | 'inmail' | 'company' | 'react' | 'end';
export type Step = {
  id: string;
  type: StepType;
  hours: number;
  body: string;
  variants: string[];
  condition: 'last_from_me' | 'always' | 'new' | 'never_replied';
  subject?: string;
  companyId?: string;
  noBranch?: 'end' | 'withdraw';
};
export type Campaign = {
  id: string;
  name: string;
  clientId: string;
  senderId: string;
  status: Status;
  steps: Step[];
  priority: boolean;
  createdAt: string;
  startedAt?: string;
  startAt: string;
  endAt: string;
  dailyCap: number;
  timezone: string;
  workStart: number;
  workEnd: number;
  workDays: number[];
  autoFeed: boolean;
};
export type Person = {
  id: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  linkedinUrl: string;
  country: string;
  city: string;
  grade: string;
  score: number;
  owner: string;
  language: string;
  connected: boolean;
  source: string;
};
export type Enrollment = {
  id: string;
  campaignId: string;
  personId: string;
  state: string;
  step: number;
  nextAt: string;
  skipReason: string;
};
export type Sender = {
  id: string;
  clientId: string;
  name: string;
  initials: string;
  status: 'Connected' | 'Disconnected';
  accountType: string;
  timezone: string;
  limits: Record<string, number>;
  health: number;
  providerId?: string;
};
export type Conversation = {
  id: string;
  personId: string;
  senderId: string;
  campaignId: string;
  unread: boolean;
  starred: boolean;
  tags: string[];
  messages: { id: string; direction: 'in' | 'out'; body: string; at: string }[];
};
export type Activity = {
  id: string;
  campaignId: string;
  personId: string;
  type: string;
  at: string;
  detail: string;
};
export type Client = { id: string; name: string; key: string };
export type Data = {
  clients: Client[];
  campaigns: Campaign[];
  people: Person[];
  enrollments: Enrollment[];
  senders: Sender[];
  conversations: Conversation[];
  activities: Activity[];
  blacklist: { id: string; clientId: string; kind: string; value: string }[];
  snippets: { id: string; title: string; body: string }[];
  settings: { timezone: string; digest: boolean; notifications: boolean; killSwitch: boolean };
  templates: { id: string; name: string; steps: Step[] }[];
};
export const uid = () => crypto.randomUUID();
export const stepLabels: Record<StepType, string> = {
  visit: 'Visit profile',
  invite: 'Send invitation',
  acceptance: 'Wait for acceptance',
  wait: 'Wait',
  message: 'Send message',
  inmail: 'Send InMail',
  company: 'Invite to follow company',
  react: 'React to latest post',
  end: 'End sequence',
};
export const safeLimits: Record<string, number> = {
  invite: 20,
  visit: 60,
  message: 50,
  inmail: 15,
  company: 30,
  react: 20,
};
export const maxLimits: Record<string, number> = {
  invite: 40,
  visit: 150,
  message: 120,
  inmail: 30,
  company: 100,
  react: 40,
};
export function newStep(type: StepType): Step {
  return {
    id: uid(),
    type,
    hours: type === 'acceptance' ? 336 : type === 'wait' ? 24 : 0,
    body: type === 'message' ? 'Hi {{firstName | there}}, thanks for connecting.' : '',
    variants: [],
    condition: 'last_from_me',
    noBranch: 'end',
  };
}
export function templateSteps(name: string): Step[] {
  if (name === 'Message connections') return [newStep('visit'), newStep('message'), newStep('end')];
  if (name === 'Invite only')
    return [newStep('visit'), newStep('invite'), newStep('acceptance'), newStep('end')];
  return [
    newStep('visit'),
    newStep('invite'),
    newStep('acceptance'),
    { ...newStep('wait'), hours: 2 },
    newStep('message'),
    newStep('wait'),
    {
      ...newStep('message'),
      body: 'Hi {{firstName | there}}, just following up. Is this relevant to your work at {{company | your company}}?',
    },
    newStep('end'),
  ];
}
export function normalizeUrl(input: string): string {
  try {
    const u = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`);
    if (
      !['linkedin.com', 'www.linkedin.com'].includes(u.hostname.toLowerCase()) ||
      !/^\/in\/[^/]+\/?$/.test(u.pathname)
    )
      return '';
    return `https://www.linkedin.com${u.pathname.replace(/\/$/, '').toLowerCase()}`;
  } catch {
    return '';
  }
}
export function renderVariables(
  text: string,
  p: Partial<Person>,
  sender?: Sender,
): { text: string; missing: string[] } {
  const values: Record<string, string> = {
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    fullName: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
    company: p.company || '',
    currentCompany: p.company || '',
    title: p.title || '',
    city: p.city || '',
    country: p.country || '',
    senderFirstName: sender?.name.split(' ')[0] || '',
    senderFullName: sender?.name || '',
  };
  const missing: string[] = [];
  return {
    text: text.replace(/\{\{\s*([^{}|]+?)(?:\s*\|\s*([^{}]*))?\s*\}\}/g, (_m, key, fallback) => {
      const value = values[key.trim()] || fallback?.trim();
      if (!value) missing.push(key.trim());
      return value || `[${key.trim()} missing]`;
    }),
    missing,
  };
}
export function importPeople(data: Data, campaign: Campaign, rows: Partial<Person>[]) {
  const people = [...data.people],
    enrollments = [...data.enrollments];
  let added = 0,
    duplicate = 0,
    invalid = 0,
    blocked = 0;
  for (const row of rows) {
    const url = normalizeUrl(row.linkedinUrl || '');
    if (!url) {
      invalid++;
      continue;
    }
    if (
      data.blacklist.some(
        (b) =>
          (!b.clientId || b.clientId === campaign.clientId) &&
          (b.kind === 'profile'
            ? normalizeUrl(b.value) === url
            : b.kind === 'company'
              ? (row.company || '').toLowerCase().includes(b.value.toLowerCase())
              : (row.title || '').toLowerCase().includes(b.value.toLowerCase())),
      )
    ) {
      blocked++;
      continue;
    }
    let person = people.find((p) => p.linkedinUrl === url);
    if (
      person &&
      enrollments.some(
        (e) =>
          e.personId === person!.id &&
          (e.campaignId === campaign.id ||
            data.campaigns.some(
              (c) =>
                c.id === e.campaignId &&
                c.clientId === campaign.clientId &&
                ['Running', 'Paused', 'Draft'].includes(c.status),
            )),
      )
    ) {
      duplicate++;
      continue;
    }
    if (!person) {
      person = {
        id: uid(),
        firstName: '',
        lastName: '',
        title: '',
        company: '',
        country: '',
        city: '',
        grade: '',
        score: 0,
        owner: '',
        language: '',
        connected: false,
        source: 'CSV',
        ...row,
        linkedinUrl: url,
      };
      people.push(person);
    }
    enrollments.push({
      id: uid(),
      campaignId: campaign.id,
      personId: person.id,
      state: 'queued',
      step: 0,
      nextAt: '',
      skipReason: '',
    });
    added++;
  }
  return { people, enrollments, added, duplicate, invalid, blocked };
}
export function validateCampaign(c: Campaign, d: Data) {
  const errors: string[] = [];
  if (!c.name.trim()) errors.push('Give this campaign a name.');
  if (!c.senderId || !d.senders.some((s) => s.id === c.senderId && s.status === 'Connected'))
    errors.push('Connect a LinkedIn sender before starting.');
  if (!d.enrollments.some((e) => e.campaignId === c.id && e.state !== 'skipped'))
    errors.push('Add at least one prospect.');
  if (c.workStart >= c.workEnd || c.workDays.length === 0)
    errors.push('Choose valid working hours and at least one active day.');
  if (c.endAt && new Date(c.endAt) <= new Date(c.startAt || Date.now()))
    errors.push('End date must be after the start date.');
  if (c.dailyCap < 1 || c.dailyCap > 40)
    errors.push('Daily invitation cap must be between 1 and 40.');
  if (!c.steps.length || c.steps.at(-1)?.type !== 'end')
    errors.push('Finish the sequence with an End step.');
  for (const s of c.steps) {
    if (['message', 'inmail'].includes(s.type) && !s.body.trim())
      errors.push('Every message needs text.');
    if (s.type === 'company' && !s.companyId?.trim())
      errors.push('Company invitations need a company ID.');
    if (s.type === 'inmail' && !s.subject?.trim()) errors.push('InMails need a subject.');
    if (
      (s.type === 'wait' || s.type === 'acceptance') &&
      (!Number.isFinite(s.hours) || s.hours <= 0)
    )
      errors.push('Waits must have a positive duration.');
    for (const body of [s.body, ...s.variants]) {
      if (body.length > (s.type === 'invite' ? 300 : 4000))
        errors.push(`${stepLabels[s.type]} exceeds the character limit.`);
      for (const e of d.enrollments.filter((e) => e.campaignId === c.id)) {
        const p = d.people.find((p) => p.id === e.personId);
        if (
          p &&
          renderVariables(
            body,
            p,
            d.senders.find((x) => x.id === c.senderId),
          ).missing.length
        )
          errors.push('Some variables have no value. Add fallbacks in the sequence.');
      }
    }
  }
  return [...new Set(errors)];
}
export function metrics(d: Data, campaignId?: string, days = 30, clientId = '') {
  const ids = new Set(
    d.campaigns
      .filter((c) => (!campaignId || c.id === campaignId) && (!clientId || c.clientId === clientId))
      .map((c) => c.id),
  );
  const cutoff = Date.now() - days * 86400000;
  const a = d.activities.filter((a) => ids.has(a.campaignId) && new Date(a.at).getTime() >= cutoff);
  const count = (type: string) => a.filter((x) => x.type === type).length;
  const invited = count('invitation.sent'),
    accepted = count('invitation.accepted'),
    messages = count('message.sent'),
    replies = count('reply.received');
  return {
    invited,
    accepted,
    messages,
    replies,
    acceptance: invited ? Math.round((accepted / invited) * 100) : 0,
    replyRate: messages ? Math.round((replies / messages) * 100) : 0,
    interested: d.conversations.filter(
      (c) => ids.has(c.campaignId) && c.tags.includes('Interested'),
    ).length,
  };
}
export function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const escape = (v: unknown) =>
    `"${String(v ?? '')
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  const blob = new Blob(
    [
      '\uFEFF' +
        [
          keys.map(escape).join(','),
          ...rows.map((row) => keys.map((k) => escape(row[k])).join(',')),
        ].join('\r\n'),
    ],
    { type: 'text/csv;charset=utf-8' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
