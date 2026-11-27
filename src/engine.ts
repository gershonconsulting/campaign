import {
  type Data,
  type Campaign,
  type Enrollment,
  type Person,
  type Sender,
  type Step,
  renderVariables,
  maxLimits,
  normalizeUrl,
} from './model.ts';
export type PlannedAction = {
  key: string;
  campaignId: string;
  enrollmentId: string;
  personId: string;
  senderId: string;
  stepId: string;
  type: string;
  body: string;
  subject?: string;
  companyId?: string;
  variant: number;
};
export function localParts(at: Date, timezone: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const v = (key: string) => p.find((p) => p.type === key)?.value || '';
  return {
    day: `${v('year')}-${v('month')}-${v('day')}`,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v('weekday')),
    hour: Number(v('hour')),
  };
}
export function isWorking(c: Campaign, at: Date) {
  const p = localParts(at, c.timezone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: c.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const v = (k: string) => parts.find((p) => p.type === k)?.value || '';
  const local = `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
  return (
    c.workDays.includes(p.weekday) &&
    p.hour >= c.workStart &&
    p.hour < c.workEnd &&
    (!c.startAt || local >= c.startAt) &&
    (!c.endAt || local < c.endAt)
  );
}
export function blacklisted(d: Data, p: Person, c: Campaign) {
  return d.blacklist.some(
    (b) =>
      (!b.clientId || b.clientId === c.clientId) &&
      (b.kind === 'profile'
        ? normalizeUrl(b.value) === p.linkedinUrl
        : (b.kind === 'company' ? p.company : p.title)
            .toLowerCase()
            .includes(b.value.toLowerCase())),
  );
}
export function sendConditionAllows(step: Step, thread: Data['conversations'][number] | undefined) {
  if (step.condition === 'always') return true;
  if (step.condition === 'new') return !thread?.messages.length;
  if (step.condition === 'never_replied')
    return !thread?.messages.some((m) => m.direction === 'in');
  return !thread?.messages.length || thread.messages.at(-1)?.direction === 'out';
}
const eventFor: Record<string, string> = {
  visit: 'profile.visited',
  invite: 'invitation.sent',
  message: 'message.sent',
  inmail: 'inmail.sent',
  company: 'company.invited',
  react: 'post.reacted',
  withdraw: 'invitation.withdrawn',
};
export function advance(d: Data, e: Enrollment, at: Date, delay = 0) {
  e.step++;
  e.nextAt = new Date(at.getTime() + delay).toISOString();
  const c = d.campaigns.find((c) => c.id === e.campaignId);
  if (!c?.steps[e.step] || c.steps[e.step]?.type === 'end') {
    e.state = 'finished';
    e.nextAt = '';
  }
}
export function quotaAvailable(d: Data, c: Campaign, s: Sender, type: string, at: Date) {
  const events = d.activities.filter(
    (a) => d.campaigns.find((c) => c.id === a.campaignId)?.senderId === s.id,
  );
  const today = localParts(at, s.timezone).day;
  const sent = events.filter(
    (a) => a.type === eventFor[type] && localParts(new Date(a.at), s.timezone).day === today,
  ).length;
  const limit = Math.min(
    s.limits[type] || 0,
    maxLimits[type] || 0,
    type === 'invite' ? c.dailyCap : Infinity,
  );
  if (sent >= limit) return false;
  if (
    type === 'invite' &&
    events.filter(
      (a) => a.type === 'invitation.sent' && new Date(a.at).getTime() > at.getTime() - 7 * 86400000,
    ).length >= 100
  )
    return false;
  return true;
}
/** Pure planner. One action per sender per tick; caller must hold the workspace lease. */
export function plan(d: Data, at: Date, random = Math.random): PlannedAction[] {
  if (d.settings.killSwitch) return [];
  const actions: PlannedAction[] = [],
    used = new Set<string>();
  const campaigns = d.campaigns
    .filter((c) => c.status === 'Running')
    .sort((a, b) => Number(b.priority) - Number(a.priority));
  for (const c of campaigns) {
    const s = d.senders.find((s) => s.id === c.senderId);
    if (!s || s.status !== 'Connected') {
      c.status = 'Paused';
      continue;
    }
    if (!isWorking(c, at) || used.has(s.id)) continue;
    const last = d.activities
      .filter((a) => d.campaigns.find((c) => c.id === a.campaignId)?.senderId === s.id)
      .filter((a) => Object.values(eventFor).includes(a.type))
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (last && at.getTime() - new Date(last.at).getTime() < 45000) continue;
    for (const e of d.enrollments.filter(
      (e) => e.campaignId === c.id && !['replied', 'finished', 'skipped'].includes(e.state),
    )) {
      const p = d.people.find((p) => p.id === e.personId);
      if (!p) continue;
      const thread = d.conversations.find((t) => t.personId === p.id && t.senderId === s.id);
      if (thread?.messages.some((m) => m.direction === 'in')) {
        e.state = 'replied';
        e.nextAt = '';
        continue;
      }
      if (blacklisted(d, p, c)) {
        e.state = 'skipped';
        e.skipReason = 'Blacklisted';
        e.nextAt = '';
        continue;
      }
      if (e.nextAt && new Date(e.nextAt) > at) continue;
      const step = c.steps[e.step];
      if (!step || step.type === 'end') {
        e.state = 'finished';
        e.nextAt = '';
        continue;
      }
      if (step.type === 'wait') {
        advance(d, e, at, step.hours * 3600000);
        continue;
      }
      if ((step.type === 'invite' || step.type === 'acceptance') && p.connected) {
        advance(d, e, at, step.type === 'acceptance' ? 2 * 3600000 : 0);
        continue;
      }
      if (step.type === 'acceptance') {
        if (e.state !== 'waiting_acceptance') {
          e.state = 'waiting_acceptance';
          e.nextAt = new Date(at.getTime() + step.hours * 3600000).toISOString();
          continue;
        }
        if (step.noBranch === 'withdraw') {
          actions.push({
            key: `${e.id}:${step.id}:withdraw`,
            campaignId: c.id,
            enrollmentId: e.id,
            personId: p.id,
            senderId: s.id,
            stepId: step.id,
            type: 'withdraw',
            body: '',
            variant: 0,
          });
          used.add(s.id);
          break;
        }
        e.state = 'finished';
        e.nextAt = '';
        continue;
      }
      if (['message', 'inmail'].includes(step.type) && !sendConditionAllows(step, thread)) {
        e.state = 'skipped';
        e.skipReason = 'Send condition not met';
        e.nextAt = '';
        continue;
      }
      if (step.type === 'message' && !p.connected) {
        e.state = 'skipped';
        e.skipReason = 'Not a first-degree connection';
        continue;
      }
      if (!quotaAvailable(d, c, s, step.type, at)) continue;
      const variants = [step.body, ...step.variants];
      const previous = d.activities.filter(
        (a) => a.campaignId === c.id && a.type === eventFor[step.type],
      ).length;
      const variant = previous % variants.length;
      const rendered = renderVariables(variants[variant] || '', p, s);
      if (rendered.missing.length) {
        e.state = 'skipped';
        e.skipReason = 'Missing message variables';
        continue;
      }
      if (!e.nextAt) {
        e.nextAt = new Date(at.getTime() + 45000 + Math.floor(random() * 315000)).toISOString();
        continue;
      }
      actions.push({
        key: `${e.id}:${step.id}`,
        campaignId: c.id,
        enrollmentId: e.id,
        personId: p.id,
        senderId: s.id,
        stepId: step.id,
        type: step.type,
        body: rendered.text,
        subject: step.subject,
        companyId: step.companyId,
        variant,
      });
      used.add(s.id);
      break;
    }
  }
  return actions;
}
export function completeAction(d: Data, a: PlannedAction, at: Date) {
  const e = d.enrollments.find((e) => e.id === a.enrollmentId);
  if (!e) return;
  d.activities.push({
    id: crypto.randomUUID(),
    campaignId: a.campaignId,
    personId: a.personId,
    type: eventFor[a.type],
    at: at.toISOString(),
    detail: `${a.type} completed · Variant ${String.fromCharCode(65 + a.variant)}`,
  });
  if (a.type === 'withdraw') {
    e.state = 'finished';
    e.nextAt = '';
    return;
  }
  e.state =
    a.type === 'invite'
      ? 'invited'
      : a.type === 'message' || a.type === 'inmail'
        ? 'messaged'
        : e.state;
  advance(d, e, at);
}
