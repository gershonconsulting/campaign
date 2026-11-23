import { type Data, templateSteps, safeLimits } from './model.ts';
const ago = (days: number, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(h, 15, 0, 0);
  return d.toISOString();
};
export function demoData(): Data {
  const people = [
    ['Emma', 'Laurent', 'VP of Partnerships', 'Northstar', 'France', 'A', '92'],
    ['James', 'Wilson', 'Chief Revenue Officer', 'Meridian', 'United Kingdom', 'A', '89'],
    ['Sofia', 'Martin', 'Head of Growth', 'Forma', 'France', 'B', '78'],
    ['Lucas', 'Bernard', 'Managing Director', 'Atlas Partners', 'France', 'A', '94'],
    ['Maya', 'Chen', 'Director of Strategy', 'Kinetic', 'United States', 'A', '90'],
    ['Thomas', 'Dubois', 'CEO', 'Brightworks', 'France', 'B', '81'],
    ['Anna', 'Schmidt', 'VP of Sales', 'Novum', 'Germany', 'A', '88'],
    ['Daniel', 'Reed', 'Founder', 'Fieldwork', 'United Kingdom', 'B', '79'],
  ].map((p, i) => ({
    id: `p${i}`,
    firstName: p[0],
    lastName: p[1],
    title: p[2],
    company: p[3],
    country: p[4],
    city: '',
    grade: p[5],
    score: Number(p[6]),
    linkedinUrl: `https://www.linkedin.com/in/demo-person-${i}`,
    owner: 'Olivier',
    language: 'English',
    connected: i < 3,
    source: 'Sample Radar data',
  }));
  const campaigns = [
    {
      id: 'c1',
      name: '01 · Gershon — Growth leaders',
      clientId: 'client1',
      senderId: 's1',
      status: 'Running' as const,
      steps: templateSteps('Invite + 2 follow-ups'),
      priority: true,
      createdAt: ago(21),
      startedAt: ago(20),
      startAt: '',
      endAt: '',
      dailyCap: 20,
      timezone: 'Europe/Paris',
      workStart: 9,
      workEnd: 18,
      workDays: [1, 2, 3, 4, 5],
      autoFeed: false,
    },
    {
      id: 'c2',
      name: '02 · Gershon — Partner network',
      clientId: 'client1',
      senderId: 's1',
      status: 'Paused' as const,
      steps: templateSteps('Invite only'),
      priority: false,
      createdAt: ago(12),
      startedAt: ago(11),
      startAt: '',
      endAt: '',
      dailyCap: 15,
      timezone: 'Europe/Paris',
      workStart: 9,
      workEnd: 18,
      workDays: [1, 2, 3, 4, 5],
      autoFeed: false,
    },
    {
      id: 'c3',
      name: '03 · Gershon — Founder introductions',
      clientId: 'client1',
      senderId: 's1',
      status: 'Draft' as const,
      steps: templateSteps('Invite + 2 follow-ups'),
      priority: false,
      createdAt: ago(1),
      startAt: '',
      endAt: '',
      dailyCap: 15,
      timezone: 'Europe/Paris',
      workStart: 9,
      workEnd: 18,
      workDays: [1, 2, 3, 4, 5],
      autoFeed: false,
    },
  ];
  const activities: Data['activities'] = [];
  for (let day = 13; day >= 0; day--) {
    for (let i = 0; i < 8 + (day % 5); i++)
      activities.push({
        id: `a-${day}-${i}`,
        campaignId: day % 4 === 0 ? 'c2' : 'c1',
        personId: `p${i % 8}`,
        type: 'invitation.sent',
        at: ago(day, 9 + (i % 8)),
        detail: 'Invitation sent',
      });
    for (let i = 0; i < 3 + (day % 3); i++)
      activities.push({
        id: `b-${day}-${i}`,
        campaignId: 'c1',
        personId: `p${i}`,
        type: 'invitation.accepted',
        at: ago(day, 12),
        detail: 'Invitation accepted',
      });
    for (let i = 0; i < 6 + (day % 4); i++)
      activities.push({
        id: `m-${day}-${i}`,
        campaignId: 'c1',
        personId: `p${i % 8}`,
        type: 'message.sent',
        at: ago(day, 14),
        detail: 'Follow-up message sent',
      });
    if (day % 2 === 0)
      activities.push({
        id: `r-${day}`,
        campaignId: 'c1',
        personId: `p${day % 3}`,
        type: 'reply.received',
        at: ago(day, 16),
        detail: 'Replied to your message',
      });
  }
  return {
    clients: [{ id: 'client1', name: 'Gershon Consulting', key: '01' }],
    campaigns,
    people,
    enrollments: people.map((p, i) => ({
      id: `e${i}`,
      personId: p.id,
      campaignId: i < 6 ? 'c1' : 'c2',
      state: [
        'replied',
        'replied',
        'connected',
        'invited',
        'messaged',
        'queued',
        'invited',
        'queued',
      ][i],
      step: i < 3 ? 4 : 1,
      nextAt: ago(-1),
      skipReason: '',
    })),
    senders: [
      {
        id: 's1',
        clientId: 'client1',
        name: 'Olivier Attia',
        initials: 'OA',
        status: 'Connected',
        accountType: 'Sales Navigator',
        timezone: 'Europe/Paris',
        limits: { ...safeLimits },
        health: 92,
      },
    ],
    conversations: [
      {
        id: 't1',
        personId: 'p0',
        senderId: 's1',
        campaignId: 'c1',
        unread: true,
        starred: true,
        tags: ['Interested'],
        messages: [
          {
            id: 'm1',
            direction: 'out',
            body: 'Hi Emma, thanks for connecting. I’d love to learn more about your partnerships work at Northstar.',
            at: ago(2),
          },
          {
            id: 'm2',
            direction: 'in',
            body: 'Thanks for reaching out! This sounds relevant. Could you share a little more about how you help teams build their partner network?',
            at: ago(0, 11),
          },
        ],
      },
      {
        id: 't2',
        personId: 'p1',
        senderId: 's1',
        campaignId: 'c1',
        unread: true,
        starred: false,
        tags: [],
        messages: [
          {
            id: 'm3',
            direction: 'out',
            body: 'Hi James, great to connect. Are warm introductions a focus for your team this quarter?',
            at: ago(3),
          },
          {
            id: 'm4',
            direction: 'in',
            body: 'Hi Olivier, yes absolutely. Happy to have a conversation next week.',
            at: ago(1),
          },
        ],
      },
      {
        id: 't3',
        personId: 'p2',
        senderId: 's1',
        campaignId: 'c1',
        unread: false,
        starred: false,
        tags: ['Not now'],
        messages: [
          {
            id: 'm5',
            direction: 'in',
            body: 'Thank you, but we’re focused on a different project right now. Please check back next quarter.',
            at: ago(4),
          },
        ],
      },
    ],
    activities,
    blacklist: [],
    snippets: [
      {
        id: 'sn1',
        title: 'A quick introduction',
        body: 'Hi {{firstName | there}}, I’m reaching out from Gershon Consulting. We help teams build relationships through warm introductions.',
      },
    ],
    templates: [],
    settings: { timezone: 'Europe/Paris', digest: true, notifications: true, killSwitch: false },
  };
}
