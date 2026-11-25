import { useState, useEffect, useRef, type ReactNode } from 'react';
import {
  Send,
  LayoutDashboard,
  Megaphone,
  Users,
  Inbox,
  UserRound,
  BarChart3,
  Settings,
  Radio,
  Plus,
  Bell,
  ChevronRight,
  MoreHorizontal,
  Search,
  Pause,
  Play,
  Copy,
  Download,
  Archive,
  Star,
  Trash2,
  Check,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Clock,
  ArrowUpRight,
  MessageSquare,
  UserPlus,
  Eye,
  CheckCheck,
  LogOut,
  SlidersHorizontal,
  Mail,
  AlertCircle,
  Menu,
  StopCircle,
} from 'lucide-react';
import {
  type Data,
  type Campaign,
  type Sender,
  type Person,
  uid,
  metrics,
  templateSteps,
  validateCampaign,
  stepLabels,
  exportCsv,
  safeLimits,
  maxLimits,
  renderVariables,
} from './model';
import {
  loadData,
  saveData,
  isDemo,
  supabase,
  providerAction,
  linkedinStatus,
  type LinkedInStatus,
} from './store';
import { Button, Badge, Avatar, Field, Select, SearchBox, Empty, Modal, Panel } from './ui';
import Sequence from './Sequence';
import ImportDialog from './ImportDialog';
type Change = (fn: (d: Data) => Data) => void;
const date = (v: string) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
const time = (v: string) =>
  new Date(v).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const full = (p?: Person) =>
  p ? `${p.firstName} ${p.lastName}`.trim() || 'Unnamed prospect' : 'Unknown prospect';
const navItems = [
  ['overview', 'Overview', LayoutDashboard],
  ['campaigns', 'Campaigns', Megaphone],
  ['contacts', 'Contacts', Users],
  ['inbox', 'Inbox', Inbox],
  ['senders', 'LinkedIn accounts', UserRound],
  ['reports', 'Reports', BarChart3],
  ['settings', 'Settings', Settings],
] as const;
export default function App() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [session, setSession] = useState(!supabase),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState(location.hash.slice(1) || 'overview'),
    [toast, setToast] = useState(''),
    [importId, setImportId] = useState(''),
    [create, setCreate] = useState(false),
    [notifications, setNotifications] = useState(false),
    [mobile, setMobile] = useState(false),
    [saving, setSaving] = useState(false);
  const revision = useRef(0),
    pending = useRef(Promise.resolve()),
    latest = useRef<Data | null>(null),
    dirty = useRef(false);
  const notify = (s: string) => {
    setToast(s);
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const h = () => setPage(location.hash.slice(1) || 'overview');
    window.addEventListener('hashchange', h);
    if (!supabase) return () => window.removeEventListener('hashchange', h);
    supabase.auth.getSession().then(({ data }) => {
      setSession(!!data.session);
      if (!data.session) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(!!s));
    return () => {
      window.removeEventListener('hashchange', h);
      listener.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    setLoading(true);
    loadData()
      .then((r) => {
        revision.current = r.revision;
        latest.current = r.data;
        setData(r.data);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [session]);
  const navigate = (p: string) => {
    location.hash = p;
    setMobile(false);
  };
  const change: Change = (fn) => {
    if (!latest.current) return;
    const next = fn(structuredClone(latest.current));
    latest.current = next;
    dirty.current = true;
    setData(next);
    setSaving(true);
    pending.current = pending.current
      .then(async () => {
        if (!dirty.current) return;
        const snapshot = latest.current!;
        dirty.current = false;
        try {
          revision.current = await saveData(snapshot, revision.current);
          setError('');
        } catch (e) {
          setError(
            `Changes could not be saved: ${(e as Error).message}. Reload before editing further.`,
          );
          throw e;
        } finally {
          setSaving(false);
        }
      })
      .catch(() => {});
  };
  if (!session) return <SignIn />;
  if (loading)
    return (
      <div className="loading">
        <span className="brand-mark">
          <Send size={25} />
        </span>
        <h2>Opening Campaign…</h2>
      </div>
    );
  if (!data)
    return (
      <div className="loading">
        <AlertCircle />
        <h2>Unable to open workspace</h2>
        <p>{error}</p>
        <Button onClick={() => location.reload()}>Try again</Button>
      </div>
    );
  const selected = data.campaigns.find((c) => page === `campaigns/${c.id}`);
  const unread = data.conversations.filter((c) => c.unread).length;
  const updateCampaign = (c: Campaign) =>
    change((d) => ({ ...d, campaigns: d.campaigns.map((x) => (x.id === c.id ? c : x)) }));
  async function lifecycle(c: Campaign, status: Campaign['status']) {
    if (status === 'Running') {
      const errors = validateCampaign(c, data!);
      if (errors.length) {
        notify(errors[0]);
        return;
      }
      if (!isDemo) {
        try {
          await pending.current;
          await providerAction('start-campaign', { campaignId: c.id });
          const fresh = await loadData();
          revision.current = fresh.revision;
          latest.current = fresh.data;
          setData(fresh.data);
          notify('Campaign started.');
          return;
        } catch (e) {
          notify((e as Error).message);
          return;
        }
      }
    }
    updateCampaign({
      ...c,
      status,
      startedAt: status === 'Running' ? c.startedAt || new Date().toISOString() : c.startedAt,
    });
    notify(
      isDemo
        ? `Demo campaign ${status.toLowerCase()}. No LinkedIn actions will be sent.`
        : `Campaign ${status.toLowerCase()}.`,
    );
  }
  function duplicate(c: Campaign) {
    const clone = {
      ...structuredClone(c),
      id: uid(),
      name: `${c.name} (copy)`,
      status: 'Draft' as const,
      startedAt: undefined,
      createdAt: new Date().toISOString(),
      steps: c.steps.map((s) => ({ ...s, id: uid() })),
    };
    change((d) => ({ ...d, campaigns: [...d.campaigns, clone] }));
    navigate(`campaigns/${clone.id}`);
    notify('Duplicated as a draft. Add prospects to start.');
  }
  const contentProps = { data, change, navigate, notify };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <a href="#overview" className="brand">
          <span className="brand-mark">
            <Send size={23} />
          </span>
          <span>
            Campaign<small>BY GERSHON.AI</small>
          </span>
        </a>
        <div className="workspace-chip">
          <span className="workspace-icon">G</span>
          <span>
            Gershon Consulting<small>Outreach workspace</small>
          </span>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navItems.slice(0, 4).map(([key, label, Icon]) => (
            <a
              href={`#${key}`}
              key={key}
              className={page.split('/')[0] === key ? 'active' : ''}
              onClick={() => setMobile(false)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {key === 'inbox' && unread > 0 && <span className="nav-count">{unread}</span>}
            </a>
          ))}
        </nav>
        <div className="nav-label">MANAGE</div>
        <nav>
          {navItems.slice(4).map(([key, label, Icon]) => (
            <a href={`#${key}`} key={key} className={page === key ? 'active' : ''}>
              <Icon size={19} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="radar-link">
          <span className="radar-symbol">
            <Radio size={22} />
          </span>
          <strong>Better prospects. Warmer starts.</strong>
          <p>Bring your graded prospects straight from Radar.</p>
          <a href="https://radar.gershon.ai" target="_blank" rel="noreferrer">
            Open Radar <ExternalLink size={14} />
          </a>
        </div>
        <div className="sidebar-foot">
          <Avatar name="Gershon Consulting" small />
          <span>
            Gershon Consulting<small>{isDemo ? 'Demo workspace' : 'Connected workspace'}</small>
          </span>
          {supabase && (
            <button className="icon-btn" title="Sign out" onClick={() => supabase!.auth.signOut()}>
              <LogOut size={17} />
            </button>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="row">
            <button
              className="icon-btn mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Workspace <ChevronRight size={14} />
              <strong>
                {selected ? 'Campaigns' : navItems.find((x) => x[0] === page)?.[1] || 'Campaigns'}
              </strong>
              {selected && (
                <>
                  <ChevronRight size={14} />
                  <span className="crumb-name">{selected.name}</span>
                </>
              )}
            </span>
          </div>
          <div className="row top-actions">
            <span className="save-state">
              {saving ? 'Saving…' : isDemo ? 'Saved locally' : 'Synced'}
            </span>
            <Badge tone={isDemo ? 'demo' : 'connected'}>
              {isDemo ? 'Demo mode' : 'Live workspace'}
            </Badge>
            <button
              className="icon-btn notification-btn"
              aria-label="Notifications"
              onClick={() => setNotifications(true)}
            >
              <Bell size={19} />
              {unread > 0 && <i />}
            </button>
            <Avatar name="Gershon Consulting" small />
          </div>
        </header>
        {isDemo && (
          <div className="demo-banner">
            <span>
              <strong>Demo workspace</strong> · Sample data, saved in this browser. Nothing is sent
              to LinkedIn.
            </span>
            <button onClick={() => navigate('settings')}>
              Connection setup <ChevronRight size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {data.settings.killSwitch && (
          <div className="error-banner">
            All sending is stopped. Resume from Settings when ready.
          </div>
        )}
        <main>
          {selected ? (
            <CampaignDetail
              {...contentProps}
              campaign={selected}
              onUpdate={updateCampaign}
              onImport={() => setImportId(selected.id)}
              onLifecycle={(status) => lifecycle(selected, status)}
              onDuplicate={() => duplicate(selected)}
            />
          ) : page === 'overview' ? (
            <Overview {...contentProps} onCreate={() => setCreate(true)} />
          ) : page === 'campaigns' ? (
            <Campaigns
              {...contentProps}
              onCreate={() => setCreate(true)}
              onLifecycle={lifecycle}
              onDuplicate={duplicate}
              onImport={setImportId}
            />
          ) : page === 'contacts' ? (
            <Contacts {...contentProps} />
          ) : page === 'inbox' ? (
            <InboxView {...contentProps} />
          ) : page === 'senders' ? (
            <Senders {...contentProps} />
          ) : page === 'reports' ? (
            <Reports {...contentProps} />
          ) : page === 'settings' ? (
            <SettingsView {...contentProps} />
          ) : (
            <Empty
              title="Page not found"
              description="Choose a page from the workspace navigation."
            >
              <Button onClick={() => navigate('overview')}>Open overview</Button>
            </Empty>
          )}
        </main>
        <footer className="main-footer">
          Campaign by Gershon.AI <span>From prospect to conversation.</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button
            className="icon-btn"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            ×
          </button>
        </div>
      )}
      {create && (
        <CreateCampaign
          data={data}
          onClose={() => setCreate(false)}
          onCreate={(c) => {
            change((d) => ({ ...d, campaigns: [...d.campaigns, c] }));
            setCreate(false);
            navigate(`campaigns/${c.id}`);
            setImportId(c.id);
          }}
        />
      )}
      {importId && data.campaigns.find((c) => c.id === importId) && (
        <ImportDialog
          data={data}
          campaign={data.campaigns.find((c) => c.id === importId)!}
          onClose={() => setImportId('')}
          onImport={(people, enrollments) => {
            change((d) => ({ ...d, people, enrollments }));
            setImportId('');
            notify('Prospects added to the campaign.');
          }}
        />
      )}
      {notifications && (
        <Modal title="Notifications" onClose={() => setNotifications(false)}>
          <div className="modal-body">
            {data.conversations
              .filter((c) => c.unread)
              .map((c) => (
                <button
                  className="notification-item"
                  key={c.id}
                  onClick={() => {
                    navigate('inbox');
                    setNotifications(false);
                  }}
                >
                  <Avatar name={full(data.people.find((p) => p.id === c.personId))} />
                  <span>
                    <strong>{full(data.people.find((p) => p.id === c.personId))} replied</strong>
                    <small>{c.messages.at(-1)?.body.slice(0, 100)}</small>
                  </span>
                </button>
              ))}
            {!unread && (
              <Empty
                title="You’re all caught up"
                description="New replies and account alerts will appear here."
              />
            )}
          </div>
          <div className="modal-foot">
            <Button
              onClick={() => {
                change((d) => ({
                  ...d,
                  conversations: d.conversations.map((c) => ({ ...c, unread: false })),
                }));
                setNotifications(false);
              }}
            >
              Mark all as read
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
type Props = {
  data: Data;
  change: Change;
  navigate: (p: string) => void;
  notify: (s: string) => void;
};
function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="row">{children}</div>
    </div>
  );
}
function Stats({
  data,
  campaignId,
  days = 30,
  clientId = '',
}: {
  data: Data;
  campaignId?: string;
  days?: number;
  clientId?: string;
}) {
  const m = metrics(data, campaignId, days, clientId);
  return (
    <div className="stats-grid">
      {[
        ['Invitations sent', m.invited, `${m.accepted} accepted`, UserPlus],
        ['Acceptance rate', `${m.acceptance}%`, 'Connections from invitations', CheckCheck],
        ['Messages sent', m.messages, `${m.replies} replies received`, MessageSquare],
        ['Reply rate', `${m.replyRate}%`, 'Replies from sent messages', Mail],
      ].map(([label, value, sub, Icon]) => {
        const I = Icon as typeof Mail;
        return (
          <div className="stat-card" key={label as string}>
            <div className="row spread">
              <span className="stat-label">{label as string}</span>
              <I size={18} />
            </div>
            <strong>{value as string}</strong>
            <small>{sub as string}</small>
          </div>
        );
      })}
    </div>
  );
}
function ActivityChart({
  data,
  days = 14,
  campaignId,
  clientId = '',
}: {
  data: Data;
  days?: number;
  campaignId?: string;
  clientId?: string;
}) {
  const ids = new Set(
    data.campaigns
      .filter((c) => (!campaignId || c.id === campaignId) && (!clientId || c.clientId === clientId))
      .map((c) => c.id),
  );
  const values = Array.from({ length: days }, (_, i) => {
    const day = new Date();
    day.setDate(day.getDate() - days + 1 + i);
    const key = day.toLocaleDateString('en-CA');
    const events = data.activities.filter(
      (a) => ids.has(a.campaignId) && new Date(a.at).toLocaleDateString('en-CA') === key,
    );
    return {
      label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      invite: events.filter((a) => a.type === 'invitation.sent').length,
      message: events.filter((a) => a.type === 'message.sent').length,
      reply: events.filter((a) => a.type === 'reply.received').length,
    };
  });
  const max = Math.max(1, ...values.map((v) => v.invite + v.message + v.reply));
  return (
    <>
      <div className="chart-legend">
        <span>
          <i className="invite" />
          Invitations
        </span>
        <span>
          <i className="message" />
          Messages
        </span>
        <span>
          <i className="reply" />
          Replies
        </span>
      </div>
      <div
        className="chart"
        role="img"
        aria-label={`Daily invitations, messages and replies for the last ${days} days`}
      >
        {[100, 75, 50, 25, 0].map((v) => (
          <div className="chart-gridline" key={v} style={{ bottom: `${v}%` }}>
            <span>{Math.round((max * v) / 100)}</span>
          </div>
        ))}
        <div className="chart-bars">
          {values.map((v, i) => (
            <div
              className="chart-column"
              key={i}
              title={`${v.label}: ${v.invite} invitations, ${v.message} messages, ${v.reply} replies`}
            >
              <div className="bar-stack">
                <i className="reply" style={{ height: `${(v.reply / max) * 100}%` }} />
                <i className="message" style={{ height: `${(v.message / max) * 100}%` }} />
                <i className="invite" style={{ height: `${(v.invite / max) * 100}%` }} />
              </div>
              <small>{i % Math.max(1, Math.floor(days / 7)) === 0 ? v.label : ''}</small>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
function Funnel({
  data,
  campaignId,
  days = 30,
  clientId = '',
}: {
  data: Data;
  campaignId?: string;
  days?: number;
  clientId?: string;
}) {
  const m = metrics(data, campaignId, days, clientId);
  return (
    <div className="funnel">
      {[
        ['Invitations sent', m.invited],
        ['Accepted', m.accepted],
        ['Replied', m.replies],
        ['Interested', m.interested],
      ].map(([label, value], i) => (
        <div key={label}>
          <div className="row spread">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
          <div className="funnel-track">
            <i
              style={{
                width: `${Math.max(2, (Number(value) / Math.max(m.invited, 1)) * 100)}%`,
                opacity: 1 - i * 0.18,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
function Overview({ data, navigate, onCreate }: Props & { onCreate: () => void }) {
  const [days, setDays] = useState('30');
  const running = data.campaigns.filter((c) => c.status === 'Running').length;
  return (
    <>
      <Heading
        eyebrow="YOUR OUTREACH, AT A GLANCE"
        title="Good things start with a conversation."
        description="A clear view of your campaigns, connections, and next opportunities."
      >
        <Button onClick={onCreate} primary>
          <Plus size={17} />
          Create campaign
        </Button>
      </Heading>
      <div className="overview-strip">
        <div className="row">
          <span className="live-indicator" />
          <strong>
            {running} active campaign{running !== 1 ? 's' : ''}
          </strong>
          <span className="muted">·</span>
          <span>
            {
              data.enrollments.filter((e) => !['finished', 'replied', 'skipped'].includes(e.state))
                .length
            }{' '}
            prospects in sequence
          </span>
        </div>
        <Select
          label="Reporting period"
          value={days}
          onChange={setDays}
          options={[
            { value: '7', label: 'Last 7 days' },
            { value: '14', label: 'Last 14 days' },
            { value: '30', label: 'Last 30 days' },
          ]}
        />
      </div>
      <Stats data={data} days={Number(days)} />
      <div className="dashboard-grid">
        <Panel
          title="Outreach activity"
          action={<span className="muted">{Number(days)} days</span>}
        >
          <ActivityChart data={data} days={Number(days)} />
        </Panel>
        <Panel title="Account health" action={<ShieldCheck size={19} color="#15803d" />}>
          {data.senders.map((s) => (
            <div className="health-card" key={s.id}>
              <div className="row">
                <Avatar name={s.name} />
                <div>
                  <strong>{s.name}</strong>
                  <small>{s.accountType}</small>
                </div>
                <Badge tone={s.status === 'Connected' ? 'connected' : 'paused'}>{s.status}</Badge>
              </div>
              <div className="health-score">
                <strong>
                  {s.health}
                  <small>/100</small>
                </strong>
                <span>{s.health >= 80 ? 'Healthy account' : 'Needs attention'}</span>
              </div>
              <div className="health-track">
                <i style={{ width: `${s.health}%` }} />
              </div>
              <p>
                {s.status === 'Connected'
                  ? `Daily invitation limit: ${s.limits.invite}. Sending follows working hours.`
                  : 'Reconnect this sender to resume outreach.'}
              </p>
            </div>
          ))}
          {!data.senders.length && (
            <Empty title="Connect a sender" description="Add your LinkedIn account to begin." />
          )}
          <Button className="full-width" onClick={() => navigate('senders')}>
            Manage LinkedIn accounts
          </Button>
        </Panel>
        <Panel
          title="Your campaigns"
          action={
            <button className="text-btn" onClick={() => navigate('campaigns')}>
              View all <ArrowUpRight size={15} />
            </button>
          }
        >
          <div className="mini-campaigns">
            {data.campaigns
              .filter((c) => c.status !== 'Archived')
              .slice(0, 4)
              .map((c) => {
                const m = metrics(data, c.id, Number(days));
                return (
                  <button key={c.id} onClick={() => navigate(`campaigns/${c.id}`)}>
                    <span className="campaign-icon">
                      <Megaphone size={18} />
                    </span>
                    <span className="grow">
                      <strong>{c.name}</strong>
                      <small>
                        {data.enrollments.filter((e) => e.campaignId === c.id).length} prospects ·{' '}
                        {m.replyRate}% reply rate
                      </small>
                    </span>
                    <Badge>{c.status}</Badge>
                    <ChevronRight size={17} />
                  </button>
                );
              })}
          </div>
        </Panel>
        <Panel title="Conversion funnel">
          <Funnel data={data} days={Number(days)} />
        </Panel>
        <Panel
          title="Recent activity"
          action={<Badge>{isDemo ? 'Sample activity' : 'Live activity'}</Badge>}
        >
          <ActivityList
            data={data}
            items={data.activities
              .slice()
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, 5)}
          />
        </Panel>
        <Panel
          title="Replies to answer"
          action={
            <Badge tone="grade">{data.conversations.filter((c) => c.unread).length} unread</Badge>
          }
        >
          <div className="reply-preview">
            {data.conversations
              .filter((c) => c.unread)
              .slice(0, 3)
              .map((c) => (
                <button key={c.id} onClick={() => navigate('inbox')}>
                  <Avatar name={full(data.people.find((p) => p.id === c.personId))} />
                  <span>
                    <strong>{full(data.people.find((p) => p.id === c.personId))}</strong>
                    <small>{c.messages.at(-1)?.body}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
          </div>
          <Button className="full-width" onClick={() => navigate('inbox')}>
            Open inbox
          </Button>
        </Panel>
      </div>
    </>
  );
}
function ActivityList({ data, items }: { data: Data; items: Data['activities'] }) {
  return (
    <div className="activity-list">
      {items.map((a) => (
        <div key={a.id}>
          <span className={`activity-icon ${a.type.includes('reply') ? 'green' : ''}`}>
            {a.type.includes('message') || a.type.includes('reply') ? (
              <MessageSquare size={15} />
            ) : (
              <UserPlus size={15} />
            )}
          </span>
          <span className="grow">
            <strong>{full(data.people.find((p) => p.id === a.personId))}</strong>
            <small>{a.detail}</small>
          </span>
          <time>{time(a.at)}</time>
        </div>
      ))}
      {!items.length && (
        <Empty
          title="No activity yet"
          description="LinkedIn actions will be listed here once sending starts."
        />
      )}
    </div>
  );
}
function Campaigns({
  data,
  navigate,
  onCreate,
  onLifecycle,
  onDuplicate,
  onImport,
  change,
  notify,
}: Props & {
  onCreate: () => void;
  onLifecycle: (c: Campaign, s: Campaign['status']) => void;
  onDuplicate: (c: Campaign) => void;
  onImport: (id: string) => void;
}) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('All'),
    [menu, setMenu] = useState('');
  const list = data.campaigns.filter(
    (c) =>
      (filter === 'All' ? c.status !== 'Archived' : c.status === filter) &&
      c.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Heading
        eyebrow="BUILD RELATIONSHIPS AT SCALE"
        title="Campaigns"
        description="Thoughtful sequences. Consistent follow-ups. More conversations."
      >
        <Button primary onClick={onCreate}>
          <Plus size={17} />
          Create campaign
        </Button>
      </Heading>
      <div className="tabs status-tabs">
        {['All', 'Running', 'Paused', 'Draft', 'Completed', 'Archived'].map((s) => (
          <button className={filter === s ? 'active' : ''} key={s} onClick={() => setFilter(s)}>
            {s === 'Running' ? 'Active' : s}
            <span>
              {
                data.campaigns.filter((c) =>
                  s === 'All' ? c.status !== 'Archived' : c.status === s,
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      <Panel className="table-panel">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search campaigns…" />
          <span className="muted">{list.length} campaigns</span>
        </div>
        <div className="table-wrap">
          <table className="campaign-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Invitations</th>
                <th>Reply rate</th>
                <th>Created</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const en = data.enrollments.filter((e) => e.campaignId === c.id),
                  done = en.filter((e) =>
                    ['finished', 'replied', 'skipped'].includes(e.state),
                  ).length,
                  m = metrics(data, c.id, 36500);
                return (
                  <tr key={c.id}>
                    <td>
                      <button
                        className="campaign-name"
                        onClick={() => navigate(`campaigns/${c.id}`)}
                      >
                        <span className="campaign-icon">
                          <Megaphone size={19} />
                        </span>
                        <span>
                          <strong>
                            {c.name}
                            {c.priority && <Star size={12} fill="currentColor" />}
                          </strong>
                          <small>
                            {data.clients.find((x) => x.id === c.clientId)?.name} ·{' '}
                            {data.senders.find((s) => s.id === c.senderId)?.name || 'No sender'}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <Badge>{c.status}</Badge>
                    </td>
                    <td>
                      <div className="progress">
                        <i style={{ width: `${(done / Math.max(en.length, 1)) * 100}%` }} />
                      </div>
                      <small>
                        {done} / {en.length} prospects
                      </small>
                    </td>
                    <td>
                      <strong>{m.invited}</strong>
                      <small>{m.acceptance}% accepted</small>
                    </td>
                    <td>
                      <strong>{m.replyRate}%</strong>
                      <small>{m.replies} replies</small>
                    </td>
                    <td>{date(c.createdAt)}</td>
                    <td className="menu-cell">
                      <button
                        className="icon-btn"
                        aria-label={`Actions for ${c.name}`}
                        onClick={() => setMenu(menu === c.id ? '' : c.id)}
                      >
                        <MoreHorizontal size={20} />
                      </button>
                      {menu === c.id && (
                        <>
                          <button
                            className="menu-dismiss"
                            aria-label="Close menu"
                            onClick={() => setMenu('')}
                          />
                          <div className="dropdown-menu">
                            {[
                              {
                                label: 'Open campaign',
                                icon: Eye,
                                action: () => navigate(`campaigns/${c.id}`),
                              },
                              {
                                label: c.status === 'Running' ? 'Pause campaign' : 'Start / resume',
                                icon: c.status === 'Running' ? Pause : Play,
                                action: () =>
                                  onLifecycle(c, c.status === 'Running' ? 'Paused' : 'Running'),
                              },
                              {
                                label: c.priority ? 'Remove priority' : 'Set as priority',
                                icon: Star,
                                action: () =>
                                  change((d) => ({
                                    ...d,
                                    campaigns: d.campaigns.map((x) =>
                                      x.id === c.id ? { ...x, priority: !x.priority } : x,
                                    ),
                                  })),
                              },
                              { label: 'Add prospects', icon: Plus, action: () => onImport(c.id) },
                              { label: 'Duplicate', icon: Copy, action: () => onDuplicate(c) },
                              {
                                label: 'Export prospects',
                                icon: Download,
                                action: () => exportContacts(data, c.id),
                              },
                              {
                                label: 'Archive campaign',
                                icon: Archive,
                                action: () => onLifecycle(c, 'Archived'),
                              },
                              ...(c.status === 'Draft'
                                ? [
                                    {
                                      label: 'Delete draft',
                                      icon: Trash2,
                                      action: () => {
                                        change((d) => ({
                                          ...d,
                                          campaigns: d.campaigns.filter((x) => x.id !== c.id),
                                          enrollments: d.enrollments.filter(
                                            (e) => e.campaignId !== c.id,
                                          ),
                                        }));
                                        notify('Draft deleted.');
                                      },
                                    },
                                  ]
                                : []),
                            ].map((item) => (
                              <button
                                key={item.label}
                                onClick={() => {
                                  item.action();
                                  setMenu('');
                                }}
                              >
                                <item.icon size={15} />
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!list.length && (
          <Empty
            title="No campaigns here yet"
            description="Create your first sequence, then bring in prospects from Radar."
          >
            <Button primary onClick={onCreate}>
              Create campaign
            </Button>
          </Empty>
        )}
      </Panel>
    </>
  );
}
function exportContacts(data: Data, campaignId?: string) {
  const en = data.enrollments.filter((e) => !campaignId || e.campaignId === campaignId);
  exportCsv(
    'campaign-prospects.csv',
    en.map((e) => {
      const p = data.people.find((p) => p.id === e.personId)!;
      return {
        firstName: p.firstName,
        lastName: p.lastName,
        linkedinUrl: p.linkedinUrl,
        title: p.title,
        company: p.company,
        campaign: data.campaigns.find((c) => c.id === e.campaignId)?.name,
        state: e.state,
        skipReason: e.skipReason,
      };
    }),
  );
}
function CreateCampaign({
  data,
  onClose,
  onCreate,
}: {
  data: Data;
  onClose: () => void;
  onCreate: (c: Campaign) => void;
}) {
  const [name, setName] = useState(''),
    [client, setClient] = useState(data.clients[0]?.id || ''),
    [sender, setSender] = useState(data.senders[0]?.id || ''),
    [template, setTemplate] = useState('Invite + 2 follow-ups');
  return (
    <Modal title="Create a campaign" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({
            id: uid(),
            name: name.trim(),
            clientId: client,
            senderId: sender,
            status: 'Draft',
            steps: structuredClone(
              data.templates.find((t) => t.id === template)?.steps || templateSteps(template),
            ).map((s) => ({ ...s, id: uid() })),
            priority: false,
            createdAt: new Date().toISOString(),
            startAt: '',
            endAt: '',
            dailyCap: 20,
            timezone: data.senders.find((s) => s.id === sender)?.timezone || 'Europe/Paris',
            workStart: 9,
            workEnd: 18,
            workDays: [1, 2, 3, 4, 5],
            autoFeed: false,
          });
        }}
      >
        <div className="modal-body">
          <div className="wizard-intro">
            <span className="campaign-icon large">
              <Megaphone size={27} />
            </span>
            <h3>Start with the right sequence.</h3>
            <p>You can import prospects and fine-tune every step next.</p>
          </div>
          <Field label="Campaign name">
            <input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="01 · Client — Topic"
              maxLength={160}
            />
          </Field>
          <div className="form-grid">
            <Field label="Client">
              <Select
                value={client}
                onChange={(v) => {
                  setClient(v);
                  setSender(data.senders.find((s) => s.clientId === v)?.id || '');
                }}
                options={data.clients.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="LinkedIn sender">
              <Select
                value={sender}
                onChange={setSender}
                options={[
                  { value: '', label: 'Select an account' },
                  ...data.senders
                    .filter((s) => s.clientId === client)
                    .map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </Field>
          </div>
          <Field label="Sequence template">
            <Select
              value={template}
              onChange={setTemplate}
              options={[
                ...['Invite + 2 follow-ups', 'Invite only', 'Message connections'].map((v) => ({
                  value: v,
                  label: v,
                })),
                ...data.templates.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </Field>
          <div className="template-preview">
            {(data.templates.find((t) => t.id === template)?.steps || templateSteps(template)).map(
              (s, i) => (
                <span key={i}>{stepLabels[s.type]}</span>
              ),
            )}
          </div>
        </div>
        <div className="modal-foot">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" primary disabled={!name.trim() || !client}>
            Create draft
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function CampaignDetail({
  data,
  campaign,
  onUpdate,
  onImport,
  onLifecycle,
  onDuplicate,
  change,
  notify,
  navigate,
}: Props & {
  campaign: Campaign;
  onUpdate: (c: Campaign) => void;
  onImport: () => void;
  onLifecycle: (s: Campaign['status']) => void;
  onDuplicate: () => void;
}) {
  const [tab, setTab] = useState('Sequence'),
    [template, setTemplate] = useState(false),
    [templateName, setTemplateName] = useState('');
  const en = data.enrollments.filter((e) => e.campaignId === campaign.id);
  return (
    <>
      <button className="back-link" onClick={() => navigate('campaigns')}>
        Campaigns / {campaign.name}
      </button>
      <Heading
        title={campaign.name}
        description={`${data.clients.find((c) => c.id === campaign.clientId)?.name || 'No client'} · ${data.senders.find((s) => s.id === campaign.senderId)?.name || 'Select a sender'} · ${en.length} prospects`}
      >
        <Badge>{campaign.status}</Badge>
        <Button onClick={onImport}>
          <Plus size={16} />
          Add prospects
        </Button>
        <Button
          primary
          onClick={() => onLifecycle(campaign.status === 'Running' ? 'Paused' : 'Running')}
          disabled={campaign.status === 'Archived' || data.settings.killSwitch}
        >
          {campaign.status === 'Running' ? <Pause size={16} /> : <Play size={16} />}{' '}
          {campaign.status === 'Running'
            ? 'Pause campaign'
            : campaign.status === 'Draft'
              ? 'Start campaign'
              : 'Resume campaign'}
        </Button>
      </Heading>
      <div className="campaign-wizard-strip">
        {[
          ['Prospects', `${en.length} added`],
          ['Sequence', `${campaign.steps.length} steps`],
          ['Settings', 'Schedule & sender'],
          ['Overview', 'Track results'],
        ].map(([label, sub], i) => (
          <button
            className={tab === label ? 'active' : ''}
            onClick={() => setTab(label)}
            key={label}
          >
            <span className="wizard-check">
              {i === 0 && en.length > 0 ? <Check size={15} /> : i + 1}
            </span>
            <span>
              <strong>{label}</strong>
              <small>{sub}</small>
            </span>
            {i < 3 && <ChevronRight size={17} />}
          </button>
        ))}
      </div>
      <div className="tabs">
        <button className={tab === 'Overview' ? 'active' : ''} onClick={() => setTab('Overview')}>
          Overview
        </button>
        <button className={tab === 'Prospects' ? 'active' : ''} onClick={() => setTab('Prospects')}>
          Prospects <span>{en.length}</span>
        </button>
        <button className={tab === 'Sequence' ? 'active' : ''} onClick={() => setTab('Sequence')}>
          Sequence
        </button>
        <button className={tab === 'Activity' ? 'active' : ''} onClick={() => setTab('Activity')}>
          Activity log
        </button>
        <button className={tab === 'Settings' ? 'active' : ''} onClick={() => setTab('Settings')}>
          Settings
        </button>
      </div>
      {tab === 'Sequence' && (
        <Sequence
          data={data}
          campaign={campaign}
          onChange={(steps) => onUpdate({ ...campaign, steps })}
          onTemplate={() => setTemplate(true)}
        />
      )}
      {tab === 'Prospects' && (
        <Contacts
          data={data}
          campaignId={campaign.id}
          change={change}
          notify={notify}
          navigate={navigate}
        />
      )}
      {tab === 'Overview' && (
        <>
          <Stats data={data} campaignId={campaign.id} />
          <div className="dashboard-grid">
            <Panel title="Activity over time">
              <ActivityChart data={data} campaignId={campaign.id} />
            </Panel>
            <Panel title="Conversion funnel">
              <Funnel data={data} campaignId={campaign.id} />
            </Panel>
          </div>
          <Panel title="Message variations">
            <div className="notice subtle">
              Variant results appear after messages have been sent by the connected execution
              provider.
            </div>
            {campaign.steps
              .filter((s) => s.type === 'message')
              .map((s, i) => (
                <div className="variant-report" key={s.id}>
                  <strong>Message {i + 1}</strong>
                  {[s.body, ...s.variants].map((body, j) => (
                    <div key={j}>
                      <Badge>Variant {String.fromCharCode(65 + j)}</Badge>
                      <p>{body}</p>
                    </div>
                  ))}
                </div>
              ))}
          </Panel>
        </>
      )}
      {tab === 'Activity' && (
        <Panel title="Campaign activity">
          <ActivityList
            data={data}
            items={data.activities
              .filter((a) => a.campaignId === campaign.id)
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, 150)}
          />
        </Panel>
      )}
      {tab === 'Settings' && (
        <CampaignSettings
          campaign={campaign}
          data={data}
          onUpdate={onUpdate}
          onDuplicate={onDuplicate}
          onArchive={() => onLifecycle('Archived')}
        />
      )}
      {template && (
        <Modal title="Save sequence as template" onClose={() => setTemplate(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              change((d) => ({
                ...d,
                templates: [
                  ...d.templates,
                  { id: uid(), name: templateName, steps: structuredClone(campaign.steps) },
                ],
              }));
              setTemplate(false);
              notify('Template saved.');
            }}
          >
            <div className="modal-body">
              <Field label="Template name">
                <input
                  autoFocus
                  required
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                />
              </Field>
            </div>
            <div className="modal-foot">
              <Button type="submit" primary>
                Save template
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function CampaignSettings({
  campaign,
  data,
  onUpdate,
  onDuplicate,
  onArchive,
}: {
  campaign: Campaign;
  data: Data;
  onUpdate: (c: Campaign) => void;
  onDuplicate: () => void;
  onArchive: () => void;
}) {
  const [c, setC] = useState(campaign),
    [saved, setSaved] = useState(false);
  const patch = (v: Partial<Campaign>) => {
    setC({ ...c, ...v });
    setSaved(false);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onUpdate(c);
        setSaved(true);
      }}
    >
      <div className="settings-layout">
        <Panel title="Campaign details">
          <Field label="Campaign name">
            <input required value={c.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="LinkedIn sender">
            <Select
              value={c.senderId}
              onChange={(v) => patch({ senderId: v })}
              options={[
                { value: '', label: 'Select a sender' },
                ...data.senders
                  .filter((s) => s.clientId === c.clientId)
                  .map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </Field>
          <Field label="Daily invitation cap" hint="Shared sender limits still apply.">
            <input
              required
              type="number"
              min="1"
              max="40"
              value={c.dailyCap}
              onChange={(e) => patch({ dailyCap: Number(e.target.value) })}
            />
          </Field>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={c.priority}
              onChange={(e) => patch({ priority: e.target.checked })}
            />
            Prioritize this campaign
          </label>
        </Panel>
        <Panel title="Sending schedule">
          <Field label="Timezone">
            <Select
              value={c.timezone}
              onChange={(v) => patch({ timezone: v })}
              options={[
                'Europe/Paris',
                'Europe/London',
                'America/New_York',
                'America/La_Paz',
                'Asia/Singapore',
                'UTC',
              ].map((v) => ({ value: v, label: v }))}
            />
          </Field>
          <div className="form-grid">
            <Field label="Start time">
              <input
                required
                type="number"
                min="0"
                max="23"
                value={c.workStart}
                onChange={(e) => patch({ workStart: Number(e.target.value) })}
              />
            </Field>
            <Field label="End time">
              <input
                required
                type="number"
                min={c.workStart + 1}
                max="24"
                value={c.workEnd}
                onChange={(e) => patch({ workEnd: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="Active days">
            <div className="day-picker">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((v, i) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={c.workDays.includes(i)}
                  className={c.workDays.includes(i) ? 'active' : ''}
                  onClick={() =>
                    patch({
                      workDays: c.workDays.includes(i)
                        ? c.workDays.filter((d) => d !== i)
                        : [...c.workDays, i],
                    })
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          </Field>
          <div className="form-grid">
            <Field label="Start date (optional)">
              <input
                type="datetime-local"
                value={c.startAt}
                onChange={(e) => patch({ startAt: e.target.value })}
              />
            </Field>
            <Field label="End date (optional)">
              <input
                type="datetime-local"
                value={c.endAt}
                onChange={(e) => patch({ endAt: e.target.value })}
              />
            </Field>
          </div>
        </Panel>
      </div>
      <div className="row spread settings-actions">
        <div className="row">
          <Button onClick={onDuplicate}>
            <Copy size={16} />
            Duplicate campaign
          </Button>
          <Button onClick={onArchive}>
            <Archive size={16} />
            Archive
          </Button>
        </div>
        <div className="row">
          {saved && <span className="success-text">Saved</span>}
          <Button type="submit" primary>
            Save settings
          </Button>
        </div>
      </div>
    </form>
  );
}
function Contacts({ data, change, notify, navigate, campaignId }: Props & { campaignId?: string }) {
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [campaign, setCampaign] = useState(''),
    [selected, setSelected] = useState<string[]>([]);
  const list = data.enrollments
    .filter(
      (e) =>
        (!campaignId || e.campaignId === campaignId) &&
        (!campaign || e.campaignId === campaign) &&
        (!status || e.state === status),
    )
    .filter((e) => {
      const p = data.people.find((p) => p.id === e.personId);
      return p && `${full(p)} ${p.company} ${p.title}`.toLowerCase().includes(search.toLowerCase());
    });
  const blacklist = () => {
    change((d) => {
      const target = d.enrollments.filter((e) => selected.includes(e.id));
      return {
        ...d,
        blacklist: [
          ...d.blacklist,
          ...target.map((e) => ({
            id: uid(),
            clientId: d.campaigns.find((c) => c.id === e.campaignId)!.clientId,
            kind: 'profile',
            value: d.people.find((p) => p.id === e.personId)!.linkedinUrl,
          })),
        ],
        enrollments: d.enrollments.map((e) =>
          target.some((t) => t.personId === e.personId)
            ? { ...e, state: 'skipped', skipReason: 'Blacklisted', nextAt: '' }
            : e,
        ),
      };
    });
    setSelected([]);
    notify('Selected prospects blacklisted. Their sequences are stopped.');
  };
  return (
    <>
      {!campaignId && (
        <Heading
          title="Contacts"
          description="Every prospect, their progress, and the next step in the conversation."
        >
          <Button onClick={() => exportContacts(data)}>
            <Download size={16} />
            Export CSV
          </Button>
        </Heading>
      )}
      <Panel className="table-panel">
        <div className="table-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search name, company, or title…"
          />
          <div className="row">
            {!campaignId && (
              <Select
                label="Filter campaign"
                value={campaign}
                onChange={setCampaign}
                options={[
                  { value: '', label: 'All campaigns' },
                  ...data.campaigns.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            )}
            <Select
              label="Filter contact status"
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: 'All statuses' },
                ...[
                  'queued',
                  'invited',
                  'connected',
                  'messaged',
                  'replied',
                  'finished',
                  'skipped',
                ].map((v) => ({ value: v, label: v })),
              ]}
            />
          </div>
        </div>
        {selected.length > 0 && (
          <div className="bulk-bar">
            <strong>{selected.length} selected</strong>
            <Button onClick={blacklist}>Blacklist & stop</Button>
            <Button
              onClick={() => {
                change((d) => ({
                  ...d,
                  enrollments: d.enrollments.map((e) =>
                    selected.includes(e.id) ? { ...e, state: 'finished', nextAt: '' } : e,
                  ),
                }));
                setSelected([]);
                notify('Sequences stopped.');
              }}
            >
              Stop sequences
            </Button>
            <Button onClick={() => setSelected([])}>Clear</Button>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    aria-label="Select all visible contacts"
                    type="checkbox"
                    checked={!!list.length && list.every((e) => selected.includes(e.id))}
                    onChange={(e) => setSelected(e.target.checked ? list.map((e) => e.id) : [])}
                  />
                </th>
                <th>Prospect</th>
                <th>Company</th>
                <th>Campaign</th>
                <th>Status</th>
                <th>Next step</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => {
                const p = data.people.find((p) => p.id === e.personId)!,
                  c = data.campaigns.find((c) => c.id === e.campaignId);
                return (
                  <tr key={e.id}>
                    <td>
                      <input
                        aria-label={`Select ${full(p)}`}
                        type="checkbox"
                        checked={selected.includes(e.id)}
                        onChange={(ev) =>
                          setSelected(
                            ev.target.checked
                              ? [...selected, e.id]
                              : selected.filter((x) => x !== e.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="person-cell">
                        <Avatar name={full(p)} small />
                        <span>
                          <a href={p.linkedinUrl} target="_blank" rel="noreferrer">
                            {full(p)} <ExternalLink size={12} />
                          </a>
                          <small>{p.title || 'No title'}</small>
                        </span>
                      </div>
                    </td>
                    <td>{p.company || '—'}</td>
                    <td>
                      <button
                        className="text-btn table-link"
                        onClick={() => navigate(`campaigns/${c?.id}`)}
                      >
                        {c?.name}
                      </button>
                    </td>
                    <td>
                      <Badge>{e.state}</Badge>
                      {e.skipReason && <small>{e.skipReason}</small>}
                    </td>
                    <td>
                      {['finished', 'skipped', 'replied'].includes(e.state)
                        ? '—'
                        : stepLabels[c?.steps[e.step]?.type || 'end']}
                      <small>
                        {e.nextAt && !['finished', 'skipped', 'replied'].includes(e.state)
                          ? date(e.nextAt)
                          : ''}
                      </small>
                    </td>
                    <td>{p.grade ? <Badge tone="grade">{p.grade}</Badge> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!list.length && (
          <Empty
            title="No prospects found"
            description="Add prospects from Radar, upload a CSV, or adjust your filters."
          />
        )}
        <div className="table-bottom">
          {list.length} prospects {isDemo && '· Sample data'}
        </div>
      </Panel>
    </>
  );
}
function InboxView({ data, change, notify }: Props) {
  const [filter, setFilter] = useState('All'),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState(data.conversations[0]?.id || ''),
    [reply, setReply] = useState(''),
    [busy, setBusy] = useState(false);
  const conversations = data.conversations.filter((c) => {
    const p = data.people.find((p) => p.id === c.personId);
    return (
      `${full(p)} ${p?.company}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'All' ||
        (filter === 'Unread' && c.unread) ||
        (filter === 'Starred' && c.starred) ||
        (filter === 'Needs reply' && c.messages.at(-1)?.direction === 'in'))
    );
  });
  const c = data.conversations.find((c) => c.id === selected),
    p = data.people.find((p) => p.id === c?.personId);
  const update = (patch: Partial<Data['conversations'][number]>) =>
    change((d) => ({
      ...d,
      conversations: d.conversations.map((x) => (x.id === c?.id ? { ...x, ...patch } : x)),
    }));
  async function sendReply() {
    if (!c || !reply.trim()) return;
    setBusy(true);
    try {
      if (!isDemo) {
        await providerAction('reply', { conversationId: c.id, body: reply });
        notify('Message sent.');
      } else {
        update({
          messages: [
            ...c.messages,
            { id: uid(), direction: 'out', body: reply, at: new Date().toISOString() },
          ],
          unread: false,
        });
        notify('Demo reply saved locally. Nothing was sent to LinkedIn.');
      }
      setReply('');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="Inbox" description="One place for the conversations your outreach starts." />
      <div className="inbox-layout">
        <div className="conversation-list">
          <div className="inbox-search">
            <SearchBox value={search} onChange={setSearch} placeholder="Search conversations…" />
            <Select
              label="Conversation filter"
              value={filter}
              onChange={setFilter}
              options={['All', 'Unread', 'Needs reply', 'Starred'].map((v) => ({
                value: v,
                label: v,
              }))}
            />
          </div>
          {conversations.map((thread) => {
            const person = data.people.find((p) => p.id === thread.personId);
            return (
              <button
                className={`conversation-item ${selected === thread.id ? 'active' : ''}`}
                key={thread.id}
                onClick={() => {
                  setSelected(thread.id);
                  setReply('');
                  change((d) => ({
                    ...d,
                    conversations: d.conversations.map((x) =>
                      x.id === thread.id ? { ...x, unread: false } : x,
                    ),
                  }));
                }}
              >
                <Avatar name={full(person)} />
                <span className="grow">
                  <span className="row spread">
                    <strong>{full(person)}</strong>
                    <small>{date(thread.messages.at(-1)?.at || '')}</small>
                  </span>
                  <small>{person?.company}</small>
                  <p>{thread.messages.at(-1)?.body}</p>
                  {thread.tags.length > 0 && <Badge tone="tag">{thread.tags[0]}</Badge>}
                </span>
                {thread.unread && <i className="unread-dot" />}
              </button>
            );
          })}
          {!conversations.length && (
            <Empty title="No conversations" description="Try a different filter." />
          )}
        </div>
        {c && p ? (
          <>
            <div className="thread">
              <div className="thread-head">
                <div className="row">
                  <Avatar name={full(p)} />
                  <span>
                    <strong>{full(p)}</strong>
                    <small>
                      {p.title} · {p.company}
                    </small>
                  </span>
                </div>
                <div className="row">
                  <button
                    className={`icon-btn ${c.starred ? 'starred' : ''}`}
                    aria-label={c.starred ? 'Unstar conversation' : 'Star conversation'}
                    onClick={() => update({ starred: !c.starred })}
                  >
                    <Star size={19} fill={c.starred ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label="Mark unread"
                    onClick={() => update({ unread: true })}
                  >
                    <Mail size={19} />
                  </button>
                </div>
              </div>
              <div className="messages">
                <div className="thread-date">
                  {data.campaigns.find((x) => x.id === c.campaignId)?.name}
                </div>
                {c.messages.map((m) => (
                  <div className={`message ${m.direction}`} key={m.id}>
                    <div>{m.body}</div>
                    <time>{time(m.at)}</time>
                  </div>
                ))}
              </div>
              <form
                className="reply-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendReply();
                }}
              >
                <textarea
                  aria-label="Reply message"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={`Reply to ${p.firstName || 'this prospect'}…`}
                  maxLength={4000}
                  rows={3}
                />
                <div className="row spread">
                  <Select
                    label="Insert snippet"
                    value=""
                    onChange={(v) => {
                      const s = data.snippets.find((x) => x.id === v);
                      if (s)
                        setReply(
                          renderVariables(
                            s.body,
                            p,
                            data.senders.find((s) => s.id === c.senderId),
                          ).text,
                        );
                    }}
                    options={[
                      { value: '', label: 'Insert snippet' },
                      ...data.snippets.map((s) => ({ value: s.id, label: s.title })),
                    ]}
                  />
                  <Button primary type="submit" disabled={!reply.trim() || busy}>
                    <Send size={15} />
                    {busy ? 'Sending…' : isDemo ? 'Save demo reply' : 'Send reply'}
                  </Button>
                </div>
              </form>
            </div>
            <div className="contact-rail">
              <Avatar name={full(p)} />
              <h3>{full(p)}</h3>
              <p>
                {p.title}
                <br />
                {p.company}
              </p>
              <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="profile-link">
                LinkedIn profile <ExternalLink size={14} />
              </a>
              <hr />
              <Field label="Lead tag">
                <Select
                  value={c.tags[0] || ''}
                  onChange={(value) => {
                    update({ tags: value ? [value] : [] });
                    notify(value ? `Tagged as ${value}.` : 'Tag removed.');
                  }}
                  options={[
                    { value: '', label: 'No tag' },
                    ...[
                      'Interested',
                      'Not now',
                      'Not interested',
                      'Meeting booked',
                      'Wrong person',
                    ].map((v) => ({ value: v, label: v })),
                  ]}
                />
              </Field>
              <div className="notice subtle">
                <ShieldCheck size={17} />A reply stops the automated sequence.
              </div>
              <Button
                className="full-width"
                onClick={() => {
                  change((d) => ({
                    ...d,
                    enrollments: d.enrollments.map((e) =>
                      e.personId === p.id ? { ...e, state: 'finished', nextAt: '' } : e,
                    ),
                  }));
                  notify('Sequence stopped.');
                }}
              >
                <StopCircle size={15} />
                Stop sequence
              </Button>
              <Button
                className="full-width"
                onClick={() => {
                  change((d) => ({
                    ...d,
                    blacklist: [
                      ...d.blacklist,
                      {
                        id: uid(),
                        clientId: d.campaigns.find((x) => x.id === c.campaignId)?.clientId || '',
                        kind: 'profile',
                        value: p.linkedinUrl,
                      },
                    ],
                    enrollments: d.enrollments.map((e) =>
                      e.personId === p.id
                        ? { ...e, state: 'skipped', skipReason: 'Blacklisted', nextAt: '' }
                        : e,
                    ),
                  }));
                  notify('Prospect blacklisted and sequences stopped.');
                }}
              >
                Blacklist prospect
              </Button>
            </div>
          </>
        ) : (
          <Empty title="Choose a conversation" description="Your campaign replies appear here." />
        )}
      </div>
    </>
  );
}
function Senders({ data, change, notify }: Props) {
  const [editing, setEditing] = useState<Sender | null>(null),
    [busy, setBusy] = useState(false),
    [live, setLive] = useState<LinkedInStatus | null | undefined>(undefined);
  useEffect(() => {
    let on = true;
    linkedinStatus().then((s) => on && setLive(s));
    return () => {
      on = false;
    };
  }, []);
  async function connect() {
    setBusy(true);
    try {
      const result = await providerAction('connect-sender', { clientId: data.clients[0]?.id });
      if (result.url) location.assign(result.url);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="LinkedIn accounts"
        description="Manage your senders, working hours, and daily sending limits."
      >
        <Button primary onClick={connect} disabled={busy}>
          <Plus size={16} />
          {busy ? 'Connecting…' : 'Connect LinkedIn account'}
        </Button>
      </Heading>
      {live !== null && (
        <div
          className={`notice live-status ${live?.connected ? 'ok' : live ? 'bad' : ''}`}
          role="status"
        >
          <span className={`live-dot ${live?.connected ? 'ok' : live ? 'bad' : ''}`} />
          {live === undefined
            ? 'Checking the live LinkedIn connection…'
            : live.connected
              ? `Live LinkedIn connection (Unipile): Connected · checked ${new Date(live.checkedAt || Date.now()).toLocaleTimeString()}`
              : 'Live LinkedIn connection (Unipile): Not connected. Campaigns will not send until it is restored.'}
        </div>
      )}
      {isDemo && (
        <div className="notice">
          <AlertCircle size={18} />
          The account cards below are sample data. Real senders appear here once the workspace is
          linked.
        </div>
      )}
      <div className="sender-grid">
        {data.senders.map((s) => (
          <Panel key={s.id}>
            <div className="row spread">
              <div className="row">
                <Avatar name={s.name} />
                <span>
                  <h3>{s.name}</h3>
                  <small>{s.accountType}</small>
                </span>
              </div>
              <Badge>{s.status}</Badge>
            </div>
            <div className="sender-health">
              <ShieldCheck size={20} />
              <span>Account health</span>
              <strong>{s.health}/100</strong>
            </div>
            <div className="health-track">
              <i style={{ width: `${s.health}%` }} />
            </div>
            <div className="sender-limits">
              {Object.entries(s.limits).map(([key, value]) => (
                <div key={key}>
                  <span>{stepLabels[key as keyof typeof stepLabels]}</span>
                  <strong>
                    {value}
                    <small>/day</small>
                  </strong>
                </div>
              ))}
            </div>
            <div className="row spread">
              <small>{s.timezone}</small>
              <Button onClick={() => setEditing(structuredClone(s))}>
                <SlidersHorizontal size={15} />
                Adjust limits
              </Button>
            </div>
          </Panel>
        ))}
      </div>
      {editing && (
        <Modal title={`${editing.name} · Daily limits`} onClose={() => setEditing(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              change((d) => ({
                ...d,
                senders: d.senders.map((s) => (s.id === editing.id ? editing : s)),
              }));
              setEditing(null);
              notify('Daily limits saved.');
            }}
          >
            <div className="modal-body">
              <p className="muted">
                These limits are shared across the sender’s campaigns. A daily limit does not
                guarantee protection from account restrictions.
              </p>
              {Object.entries(editing.limits).map(([key, value]) => (
                <div className="limit-field" key={key}>
                  <div className="row spread">
                    <strong>{stepLabels[key as keyof typeof stepLabels]}</strong>
                    <Badge tone={value <= safeLimits[key] ? 'connected' : 'paused'}>
                      {value}/day
                    </Badge>
                  </div>
                  <input
                    aria-label={stepLabels[key as keyof typeof stepLabels]}
                    type="range"
                    min="1"
                    max={maxLimits[key]}
                    value={value}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        limits: { ...editing.limits, [key]: Number(e.target.value) },
                      })
                    }
                  />
                  <div className="row spread">
                    <small>Conservative default: {safeLimits[key]}</small>
                    <small>Maximum: {maxLimits[key]}</small>
                  </div>
                </div>
              ))}
              <Button onClick={() => setEditing({ ...editing, limits: { ...safeLimits } })}>
                <RefreshCw size={15} />
                Reset to conservative limits
              </Button>
            </div>
            <div className="modal-foot">
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" primary>
                Save limits
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Reports({ data }: Props) {
  const [days, setDays] = useState('30'),
    [client, setClient] = useState('');
  const list = data.campaigns.filter((c) => !client || c.clientId === client);
  return (
    <>
      <Heading
        title="Reports"
        description="Understand what’s working, across every client and campaign."
      >
        <Button onClick={() => window.print()}>
          <Download size={16} />
          Print / Save PDF
        </Button>
        <Button
          primary
          onClick={() =>
            exportCsv(
              'campaign-report.csv',
              list.map((c) => ({
                campaign: c.name,
                status: c.status,
                ...metrics(data, c.id, Number(days)),
              })),
            )
          }
        >
          <Download size={16} />
          Export CSV
        </Button>
      </Heading>
      <div className="report-filters">
        <Select
          label="Report client"
          value={client}
          onChange={setClient}
          options={[
            { value: '', label: 'All clients' },
            ...data.clients.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Select
          label="Report period"
          value={days}
          onChange={setDays}
          options={['7', '14', '30', '90'].map((v) => ({ value: v, label: `Last ${v} days` }))}
        />
      </div>
      <Stats data={data} days={Number(days)} clientId={client} />
      <div className="dashboard-grid">
        <Panel title="Outreach activity">
          <ActivityChart data={data} days={Math.min(30, Number(days))} clientId={client} />
        </Panel>
        <Panel title="Conversion funnel">
          <Funnel data={data} days={Number(days)} clientId={client} />
        </Panel>
      </div>
      <Panel title="Campaign performance">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Invitations</th>
                <th>Accepted</th>
                <th>Acceptance rate</th>
                <th>Messages</th>
                <th>Replies</th>
                <th>Reply rate</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const m = metrics(data, c.id, Number(days));
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    {[
                      m.invited,
                      m.accepted,
                      `${m.acceptance}%`,
                      m.messages,
                      m.replies,
                      `${m.replyRate}%`,
                    ].map((v, i) => (
                      <td key={i}>{v}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
function SettingsView({ data, change, notify }: Props) {
  const [tab, setTab] = useState('General'),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [kind, setKind] = useState('profile'),
    [clientName, setClientName] = useState(''),
    [clientKey, setClientKey] = useState('');
  return (
    <>
      <Heading
        title="Settings"
        description="Your workspace, connected tools, and outreach preferences."
      />
      <div className="tabs">
        {['General', 'Clients', 'Snippets', 'Blacklist', 'Integrations'].map((t) => (
          <button
            className={tab === t ? 'active' : ''}
            key={t}
            onClick={() => {
              setTab(t);
              setTitle('');
              setBody('');
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'General' && (
        <div className="settings-layout">
          <Panel title="Workspace preferences">
            <Field label="Default timezone">
              <Select
                value={data.settings.timezone}
                onChange={(v) =>
                  change((d) => ({ ...d, settings: { ...d.settings, timezone: v } }))
                }
                options={[
                  'Europe/Paris',
                  'Europe/London',
                  'America/New_York',
                  'America/La_Paz',
                  'UTC',
                ].map((v) => ({ value: v, label: v }))}
              />
            </Field>
            <label className="toggle-row">
              <span>
                <strong>Daily report</strong>
                <small>Preference for a daily outreach summary.</small>
              </span>
              <input
                type="checkbox"
                checked={data.settings.digest}
                onChange={(e) =>
                  change((d) => ({ ...d, settings: { ...d.settings, digest: e.target.checked } }))
                }
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>Reply notifications</strong>
                <small>Preference for new reply alerts.</small>
              </span>
              <input
                type="checkbox"
                checked={data.settings.notifications}
                onChange={(e) =>
                  change((d) => ({
                    ...d,
                    settings: { ...d.settings, notifications: e.target.checked },
                  }))
                }
              />
            </label>
            <div className="notice subtle">
              Email delivery requires a configured report service. These settings alone do not send
              emails.
            </div>
          </Panel>
          <Panel title="Sending controls">
            <p className="muted">
              Stop sending across every account and campaign in this workspace.
            </p>
            <Button
              className={data.settings.killSwitch ? '' : 'danger-outline'}
              onClick={() => {
                change((d) => ({
                  ...d,
                  settings: { ...d.settings, killSwitch: !d.settings.killSwitch },
                }));
                notify(
                  data.settings.killSwitch
                    ? 'Workspace sending enabled.'
                    : 'Workspace sending stopped.',
                );
              }}
            >
              <StopCircle size={17} />
              {data.settings.killSwitch ? 'Resume workspace sending' : 'Stop all sending'}
            </Button>
            <hr />
            <h3>About this workspace</h3>
            <p className="muted">Campaign v0.1 · No AI features</p>
            <p className="muted">
              {isDemo
                ? 'Demo data is stored in this browser.'
                : 'Data is stored in the configured Supabase project.'}
            </p>
          </Panel>
        </div>
      )}
      {tab === 'Clients' && (
        <div className="settings-layout">
          <Panel title="Clients">
            {data.clients.map((c) => (
              <div className="setting-list-item" key={c.id}>
                <span className="workspace-icon">{c.key}</span>
                <strong>{c.name}</strong>
                <small>{data.campaigns.filter((x) => x.clientId === c.id).length} campaigns</small>
              </div>
            ))}
          </Panel>
          <Panel title="Add a client">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                change((d) => ({
                  ...d,
                  clients: [...d.clients, { id: uid(), name: clientName, key: clientKey }],
                }));
                setClientName('');
                setClientKey('');
                notify('Client added.');
              }}
            >
              <Field label="Client name">
                <input
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </Field>
              <Field label="Gershon client key">
                <input
                  required
                  value={clientKey}
                  onChange={(e) => setClientKey(e.target.value)}
                  placeholder="01"
                />
              </Field>
              <Button primary type="submit">
                Add client
              </Button>
            </form>
          </Panel>
        </div>
      )}
      {tab === 'Snippets' && (
        <div className="settings-layout">
          <Panel title="Message snippets">
            {data.snippets.map((s) => (
              <div className="snippet" key={s.id}>
                <div className="row spread">
                  <h3>{s.title}</h3>
                  <button
                    className="icon-btn"
                    aria-label={`Delete ${s.title}`}
                    onClick={() =>
                      change((d) => ({ ...d, snippets: d.snippets.filter((x) => x.id !== s.id) }))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <p>{s.body}</p>
              </div>
            ))}
            {!data.snippets.length && (
              <Empty title="No snippets yet" description="Save text you use often." />
            )}
          </Panel>
          <Panel title="Create a snippet">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                change((d) => ({ ...d, snippets: [...d.snippets, { id: uid(), title, body }] }));
                setTitle('');
                setBody('');
                notify('Snippet saved.');
              }}
            >
              <Field label="Snippet name">
                <input required value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Message text">
                <textarea
                  required
                  rows={6}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={4000}
                />
              </Field>
              <Button type="submit" primary>
                Save snippet
              </Button>
            </form>
          </Panel>
        </div>
      )}
      {tab === 'Blacklist' && (
        <div className="settings-layout">
          <Panel title="Excluded from outreach">
            {data.blacklist.map((b) => (
              <div className="setting-list-item" key={b.id}>
                <Badge>{b.kind}</Badge>
                <span className="grow break-word">{b.value}</span>
                <button
                  className="icon-btn"
                  aria-label="Remove blacklist entry"
                  onClick={() =>
                    change((d) => ({ ...d, blacklist: d.blacklist.filter((x) => x.id !== b.id) }))
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {!data.blacklist.length && (
              <Empty
                title="Your blacklist is empty"
                description="Exclude profiles, companies, or job title keywords from outreach."
              />
            )}
          </Panel>
          <Panel title="Add to blacklist">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                change((d) => ({
                  ...d,
                  blacklist: [
                    ...d.blacklist,
                    { id: uid(), clientId: '', kind, value: body.trim() },
                  ],
                }));
                setBody('');
                notify('Blacklist rule added.');
              }}
            >
              <Field label="Rule type">
                <Select
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'profile', label: 'LinkedIn profile URL' },
                    { value: 'company', label: 'Company name contains' },
                    { value: 'keyword', label: 'Job title contains' },
                  ]}
                />
              </Field>
              <Field label="Value">
                <input required value={body} onChange={(e) => setBody(e.target.value)} />
              </Field>
              <div className="notice subtle">
                Rules apply to all clients. Matching active sequences are stopped by the execution
                engine.
              </div>
              <Button type="submit" primary>
                Add rule
              </Button>
            </form>
          </Panel>
        </div>
      )}
      {tab === 'Integrations' && (
        <div className="settings-layout">
          <Panel title="Connections">
            {[
              [
                'Supabase',
                isDemo ? 'Not configured' : 'Configured',
                'Authentication and campaign data',
              ],
              [
                'LinkedIn / Unipile',
                data.senders.some((s) => s.providerId) ? 'Configured' : 'Setup required',
                'Hosted sender connection and cloud execution',
              ],
              ['Radar', 'Setup required', 'Import prospects and write campaign status back'],
              ['Email reports', 'Setup required', 'Daily and weekly report delivery'],
            ].map(([name, status, description]) => (
              <div className="integration-row" key={name}>
                <span>
                  <strong>{name}</strong>
                  <small>{description}</small>
                </span>
                <Badge tone={status === 'Configured' ? 'connected' : 'draft'}>{status}</Badge>
              </div>
            ))}
          </Panel>
          <Panel title="Deployment setup">
            <p>Configure the database and provider through the deployment environment.</p>
            <ol className="setup-list">
              <li>Create a Supabase project and run the included migration.</li>
              <li>Configure sign-in and add workspace members.</li>
              <li>Set the Unipile server credentials and connect a test sender.</li>
              <li>Configure the Radar import endpoint.</li>
              <li>Run the acceptance checks before live outreach.</li>
            </ol>
            <a
              className="text-btn"
              href="https://github.com/gershonconsulting/campaign"
              target="_blank"
              rel="noreferrer"
            >
              Repository and setup guide <ExternalLink size={15} />
            </a>
            <div className="notice subtle">
              API credentials belong in server secrets. Never paste them into message templates.
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
// Google sign-in shows only once the Google provider is configured in Supabase Auth.
const googleSignIn =
  (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_GOOGLE_SIGNIN === '1';
function SignIn() {
  const [email, setEmail] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="signin">
      <div className="signin-box">
        <span className="brand-mark">
          <Send size={26} />
        </span>
        <div className="eyebrow">GERSHON.AI</div>
        <h1>Welcome to Campaign</h1>
        <p>Turn the right prospects into your next conversations.</p>
        {googleSignIn && (
          <Button
            primary
            className="full-width"
            onClick={async () => {
              const { error } = await supabase!.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: location.origin },
              });
              if (error) setMessage(error.message);
            }}
          >
            Continue with Google
          </Button>
        )}
        {googleSignIn && <div className="signin-divider">or sign in with email</div>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const { error } = await supabase!.auth.signInWithOtp({
              email,
              options: { emailRedirectTo: location.origin, shouldCreateUser: false },
            });
            setMessage(error ? error.message : 'Check your email for a sign-in link.');
            setBusy(false);
          }}
        >
          <Field label="Email address">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gershonconsulting.com"
            />
          </Field>
          <Button className="full-width" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send sign-in link'}
          </Button>
        </form>
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        <small>Workspace access is managed by your administrator.</small>
      </div>
    </div>
  );
}
