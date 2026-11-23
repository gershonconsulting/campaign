import { useState } from 'react';
import {
  Eye,
  UserPlus,
  Clock,
  MessageSquare,
  Mail,
  Building2,
  ThumbsUp,
  Flag,
  GitBranch,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Copy,
  Check,
} from 'lucide-react';
import {
  type Campaign,
  type Data,
  type Step,
  type StepType,
  newStep,
  stepLabels,
  uid,
  renderVariables,
} from './model';
import { Button, Field, Select, Panel, Badge } from './ui';
const icons = {
  visit: Eye,
  invite: UserPlus,
  acceptance: GitBranch,
  wait: Clock,
  message: MessageSquare,
  inmail: Mail,
  company: Building2,
  react: ThumbsUp,
  end: Flag,
};
export default function Sequence({
  campaign,
  data,
  onChange,
  onTemplate,
}: {
  campaign: Campaign;
  data: Data;
  onChange: (steps: Step[]) => void;
  onTemplate: () => void;
}) {
  const [selected, setSelected] = useState(campaign.steps[0]?.id);
  const [advanced, setAdvanced] = useState(false);
  const [preview, setPreview] = useState(false);
  const [variant, setVariant] = useState(0);
  const [personId, setPersonId] = useState(
    data.enrollments.find((e) => e.campaignId === campaign.id)?.personId || '',
  );
  const step = campaign.steps.find((s) => s.id === selected);
  const locked = !!campaign.startedAt;
  const update = (patch: Partial<Step>) =>
    step && onChange(campaign.steps.map((s) => (s.id === step.id ? { ...s, ...patch } : s)));
  const selectedBody = variant ? step?.variants[variant - 1] || '' : step?.body || '';
  const setBody = (body: string) =>
    variant
      ? update({ variants: step!.variants.map((v, i) => (i === variant - 1 ? body : v)) })
      : update({ body });
  const person = data.people.find((p) => p.id === personId) || data.people[0];
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h3>Build a conversation, one step at a time.</h3>
          <p>Replies stop the sequence automatically.</p>
        </div>
        <div className="row">
          <Button onClick={() => setAdvanced(!advanced)}>
            <GitBranch size={15} />
            {advanced ? 'Simple view' : 'Show branches'}
          </Button>
          <Button onClick={onTemplate}>
            <Copy size={15} />
            Save as template
          </Button>
        </div>
      </div>
      {locked && (
        <div className="notice">
          This campaign has started. Message text and delays remain editable; its step structure is
          locked.
        </div>
      )}
      <div className="sequence-layout">
        <div className="sequence-canvas">
          <div className="flow-label">PROSPECT ENROLLED</div>
          {campaign.steps.map((s, i) => {
            const Icon = icons[s.type];
            return (
              <div className="flow-item" key={s.id}>
                <button
                  className={`step-card ${selected === s.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelected(s.id);
                    setVariant(0);
                    setPreview(false);
                  }}
                >
                  <span className={`step-icon ${s.type}`}>
                    <Icon size={20} />
                  </span>
                  <span>
                    <strong>{stepLabels[s.type]}</strong>
                    <small>
                      {s.type === 'wait'
                        ? `${s.hours} hours`
                        : s.type === 'acceptance'
                          ? `Accepted within ${Math.round(s.hours / 24)} days?`
                          : s.type === 'invite'
                            ? 'Skip if already connected'
                            : s.type === 'message'
                              ? s.body.slice(0, 55) || 'Write a message'
                              : s.type === 'end'
                                ? 'Mark as finished'
                                : 'LinkedIn action'}
                    </small>
                  </span>
                  {s.type === 'message' && s.variants.length > 0 && <Badge>A/B</Badge>}
                </button>
                {advanced && s.type === 'invite' && (
                  <div className="branch-note">
                    Already connected: skip invitation and acceptance wait
                  </div>
                )}
                {s.type === 'acceptance' && (
                  <div className="branch-row">
                    <span className="yes">
                      <Check size={13} />
                      Accepted · continue
                    </span>
                    <span>
                      No · {s.noBranch === 'withdraw' ? 'withdraw & end' : 'end sequence'}
                    </span>
                  </div>
                )}
                {!locked && s.type !== 'end' && (
                  <div className="insert-step">
                    <Select
                      label={`Insert after step ${i + 1}`}
                      value=""
                      onChange={(type) => {
                        const next = newStep(type as StepType);
                        const list = [...campaign.steps];
                        list.splice(i + 1, 0, next);
                        onChange(list);
                        setSelected(next.id);
                      }}
                      options={[
                        { value: '', label: '+ Add step' },
                        ...Object.entries(stepLabels)
                          .filter(([t]) => t !== 'end')
                          .map(([value, label]) => ({ value, label })),
                      ]}
                    />
                  </div>
                )}
              </div>
            );
          })}
          <div className="flow-label">SEQUENCE COMPLETE</div>
        </div>
        <Panel className="step-editor">
          {step ? (
            <>
              <div className="panel-head">
                <h3>{stepLabels[step.type]}</h3>
                {!locked && step.type !== 'end' && (
                  <div className="row">
                    <button
                      className="icon-btn"
                      title="Move earlier"
                      disabled={campaign.steps.indexOf(step) === 0}
                      onClick={() => {
                        const l = [...campaign.steps],
                          i = l.indexOf(step);
                        [l[i - 1], l[i]] = [l[i], l[i - 1]];
                        onChange(l);
                      }}
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Move later"
                      disabled={campaign.steps.indexOf(step) >= campaign.steps.length - 2}
                      onClick={() => {
                        const l = [...campaign.steps],
                          i = l.indexOf(step);
                        [l[i + 1], l[i]] = [l[i], l[i + 1]];
                        onChange(l);
                      }}
                    >
                      <ChevronDown size={16} />
                    </button>
                    <button
                      className="icon-btn danger"
                      aria-label="Remove step"
                      onClick={() => {
                        onChange(campaign.steps.filter((s) => s.id !== step.id));
                        setSelected(campaign.steps[0]?.id);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
              {['message', 'invite', 'inmail'].includes(step.type) && (
                <>
                  <div className="tabs small-tabs">
                    {[step.body, ...step.variants].map((_, i) => (
                      <button
                        key={i}
                        className={variant === i ? 'active' : ''}
                        onClick={() => {
                          setVariant(i);
                          setPreview(false);
                        }}
                      >
                        Variant {String.fromCharCode(65 + i)}
                      </button>
                    ))}
                    {step.variants.length < 2 && (
                      <button
                        onClick={() => {
                          update({ variants: [...step.variants, step.body] });
                          setVariant(step.variants.length + 1);
                        }}
                      >
                        <Plus size={14} />
                        Variation
                      </button>
                    )}
                  </div>
                  {variant > 0 && (
                    <button
                      className="text-btn danger"
                      onClick={() => {
                        update({ variants: step.variants.filter((_, i) => i !== variant - 1) });
                        setVariant(0);
                      }}
                    >
                      Remove this variation
                    </button>
                  )}
                  {step.type === 'inmail' && (
                    <Field label="Subject">
                      <input
                        value={step.subject || ''}
                        onChange={(e) => update({ subject: e.target.value })}
                        maxLength={200}
                      />
                    </Field>
                  )}
                  <Field label={step.type === 'invite' ? 'Invitation note (optional)' : 'Message'}>
                    <textarea
                      rows={8}
                      value={selectedBody}
                      maxLength={step.type === 'invite' ? 300 : 4000}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="Write a personal message…"
                    />
                  </Field>
                  <div className="row spread">
                    <Select
                      label="Insert variable"
                      value=""
                      onChange={(value) =>
                        setBody(
                          `${selectedBody}{{${value} | ${value === 'firstName' ? 'there' : value === 'company' ? 'your company' : ''}}}`,
                        )
                      }
                      options={[
                        { value: '', label: 'Insert variable' },
                        ...[
                          'firstName',
                          'lastName',
                          'fullName',
                          'title',
                          'company',
                          'city',
                          'country',
                          'senderFirstName',
                          'senderFullName',
                        ].map((v) => ({ value: v, label: v })),
                      ]}
                    />
                    <small>
                      {selectedBody.length.toLocaleString()} /{' '}
                      {step.type === 'invite' ? '300' : '4,000'}
                    </small>
                  </div>
                  <Button onClick={() => setPreview(!preview)}>
                    <Eye size={15} />
                    Preview message
                  </Button>
                  {preview && (
                    <div className="message-preview">
                      <Select
                        label="Preview prospect"
                        value={person?.id || ''}
                        onChange={setPersonId}
                        options={data.people.map((p) => ({
                          value: p.id,
                          label: `${p.firstName} ${p.lastName}`,
                        }))}
                      />
                      <p>
                        {
                          renderVariables(
                            selectedBody,
                            person || {},
                            data.senders.find((s) => s.id === campaign.senderId),
                          ).text
                        }
                      </p>
                    </div>
                  )}
                  {step.type !== 'invite' && (
                    <Field label="Send condition">
                      <Select
                        value={step.condition}
                        onChange={(condition) =>
                          update({ condition: condition as Step['condition'] })
                        }
                        options={[
                          { value: 'last_from_me', label: 'New thread or last message from me' },
                          { value: 'new', label: 'New conversation only' },
                          { value: 'never_replied', label: 'Only if they have never replied' },
                          { value: 'always', label: 'Always send' },
                        ]}
                      />
                    </Field>
                  )}
                  <div className="notice subtle">
                    Use a fallback like {'{{firstName | there}}'} when a value might be missing.
                  </div>
                </>
              )}
              {['wait', 'acceptance'].includes(step.type) && (
                <>
                  <Field
                    label={
                      step.type === 'acceptance' ? 'Acceptance window (days)' : 'Wait time (hours)'
                    }
                  >
                    <input
                      type="number"
                      min="1"
                      max={step.type === 'acceptance' ? 60 : 1440}
                      value={step.type === 'acceptance' ? step.hours / 24 : step.hours}
                      onChange={(e) =>
                        update({
                          hours: Number(e.target.value) * (step.type === 'acceptance' ? 24 : 1),
                        })
                      }
                    />
                  </Field>
                  {step.type === 'acceptance' && (
                    <Field label="If not accepted">
                      <Select
                        value={step.noBranch || 'end'}
                        onChange={(value) => update({ noBranch: value as 'end' | 'withdraw' })}
                        options={[
                          { value: 'end', label: 'End sequence' },
                          { value: 'withdraw', label: 'Withdraw invitation and end' },
                        ]}
                      />
                    </Field>
                  )}
                  <p className="muted">Sending resumes within the sender’s working hours.</p>
                </>
              )}
              {step.type === 'company' && (
                <Field
                  label="LinkedIn company provider ID"
                  hint="The sender must be an admin of this company page."
                >
                  <input
                    value={step.companyId || ''}
                    onChange={(e) => update({ companyId: e.target.value })}
                  />
                </Field>
              )}
              {step.type === 'visit' && (
                <p className="muted">
                  Visit the prospect’s LinkedIn profile before reaching out. This action counts
                  toward the sender’s profile visit limit.
                </p>
              )}
              {step.type === 'react' && (
                <p className="muted">Like the prospect’s latest post, if one is available.</p>
              )}
              {step.type === 'end' && (
                <p className="muted">
                  Finish the prospect’s sequence. No further actions will be scheduled.
                </p>
              )}
            </>
          ) : (
            <p>Select a step to edit it.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
