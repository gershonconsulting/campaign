import { useState } from 'react';
import Papa from 'papaparse';
import { Radio, Upload, Link2, Check, Download } from 'lucide-react';
import { type Campaign, type Data, type Person, importPeople, uid } from './model';
import { exportCsv } from './export';
import { Modal, Button, Field, Select } from './ui';
import { isLocal, listAction } from './store';
import {
  csvRows,
  listConfig,
  type ListKind,
  type ProspectList,
} from '../supabase/functions/_shared/prospect-lists';

export default function ImportDialog({
  campaign,
  data,
  onClose,
  onImport,
  onSaved,
  beforeRequest,
}: {
  campaign: Campaign;
  data: Data;
  onClose: () => void;
  onImport: (people: Person[], enrollments: Data['enrollments'], source: ProspectList) => void;
  onSaved: () => Promise<void>;
  beforeRequest: () => Promise<unknown>;
}) {
  const [source, setSource] = useState<ListKind>('radar'),
    [rows, setRows] = useState<Partial<Person>[]>([]),
    [url, setUrl] = useState(''),
    [grade, setGrade] = useState(''),
    [country, setCountry] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [fileName, setFileName] = useState(''),
    [headers, setHeaders] = useState<string[]>([]),
    [raw, setRaw] = useState<Record<string, string>[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [requestId, setRequestId] = useState(uid),
    [more, setMore] = useState(false);
  const fields = [
    'linkedinUrl',
    'firstName',
    'lastName',
    'company',
    'title',
    'country',
    'city',
    'language',
  ];
  const labels: Record<string, string> = {
    linkedinUrl: 'LinkedIn URL',
    firstName: 'First name',
    lastName: 'Last name',
    company: 'Company',
    title: 'Job title',
    country: 'Country',
    city: 'City',
    language: 'Language',
  };
  const config =
    source === 'radar' ? { grade, country } : source === 'csv' ? { fileName } : { url };
  const effective: Partial<Person>[] =
    source === 'csv'
      ? csvRows(
          raw.map((row) => Object.fromEntries(fields.map((key) => [key, row[mapping[key]] || '']))),
        )
      : rows;
  const result = importPeople(data, campaign, effective);
  function resetPreview() {
    setRows([]);
    setMessage('');
    setMore(false);
    setRequestId(uid());
  }
  async function preview() {
    setBusy(true);
    setMessage('');
    setRows([]);
    try {
      const validated = listConfig(source, config);
      await beforeRequest();
      const response = await listAction('preview', {
        campaignId: campaign.id,
        kind: source,
        config: validated,
      });
      setRows(response.prospects);
      setMore(response.more);
      setMessage(
        response.prospects.length
          ? `Preview loaded${response.more ? ' — more prospects will be imported in the background' : ''}.`
          : 'No prospects match this source. You can still save a dynamic list for future matches.',
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const validated = listConfig(source, config);
      if (isLocal) {
        if (source !== 'csv') throw new Error('Sign in to connect a dynamic prospect list.');
        onImport(result.people, result.enrollments, {
          id: requestId,
          kind: 'csv',
          label: fileName,
          config: validated,
          refresh_minutes: 0,
          last_synced_at: new Date().toISOString(),
          next_sync_at: null,
          last_error: null,
          added_count: result.added,
        });
        return;
      }
      await beforeRequest();
      await listAction('save', {
        campaignId: campaign.id,
        kind: source,
        config: validated,
        requestId,
        ...(source === 'csv' ? { rows: effective } : {}),
      });
      await onSaved();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add a prospect list" onClose={onClose} wide>
      <div className="modal-body">
        <p className="muted">
          Choose the list for <strong>{campaign.name}</strong>. Previously enrolled profiles and
          blacklisted prospects are skipped.
        </p>
        <div className="source-grid">
          {(
            [
              ['radar', 'From Radar', 'Dynamic · your selected prospects', Radio],
              ['csv', 'CSV upload', 'Static · one fixed import', Upload],
              [
                'sales_navigator',
                'Sales Navigator URL',
                'Dynamic · search or saved lead list',
                Link2,
              ],
            ] as const
          ).map(([key, label, hint, Icon]) => (
            <button
              key={key}
              className={`source-option ${source === key ? 'selected' : ''}`}
              onClick={() => {
                setSource(key);
                resetPreview();
              }}
            >
              <Icon size={22} />
              <strong>{label}</strong>
              <small>{hint}</small>
            </button>
          ))}
        </div>
        {source === 'radar' && (
          <>
            <p>
              Use the prospects selected in your own Radar account. Filters stay attached to this
              list.
            </p>
            <div className="form-grid">
              <Field label="Grade">
                <Select
                  value={grade}
                  onChange={(value) => {
                    setGrade(value);
                    resetPreview();
                  }}
                  options={[
                    { value: '', label: 'All grades' },
                    ...['A+', 'A', 'B', 'C', 'D'].map((value) => ({ value, label: value })),
                  ]}
                />
              </Field>
              <Field label="Country">
                <input
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value);
                    resetPreview();
                  }}
                  placeholder="All countries"
                />
              </Field>
            </div>
          </>
        )}
        {source === 'sales_navigator' && (
          <Field
            label="Sales Navigator URL"
            hint="Paste a people-search URL or a saved lead-list URL. Your assigned sender needs Sales Navigator access."
          >
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                resetPreview();
              }}
              placeholder="Paste your Sales Navigator URL"
            />
            <small className="muted">
              LinkedIn limits each search to 2,500 results. Narrow your search to cover additional
              prospects.
            </small>
          </Field>
        )}
        {source !== 'csv' && (
          <>
            <div className="notice">
              Refreshes hourly and adds new matches automatically. Existing prospects keep their
              progress.
            </div>
            {isLocal && (
              <p className="muted">
                Sign in to load real prospects and keep dynamic lists refreshing.
              </p>
            )}
            <Button
              disabled={busy || isLocal || (source === 'sales_navigator' && !url.trim())}
              onClick={preview}
            >
              {busy ? 'Loading…' : 'Preview matching prospects'}
            </Button>
          </>
        )}
        {source === 'csv' && (
          <>
            <div className="upload-zone">
              <Upload size={26} />
              <strong>Choose a CSV file</strong>
              <p>
                Column headings on the first row. Up to 5,000 rows and 5 MB. The imported list will
                not change automatically.
              </p>
              <input
                aria-label="Upload prospects CSV"
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  setRaw([]);
                  setHeaders([]);
                  setFileName('');
                  resetPreview();
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5_000_000) {
                    setMessage('Maximum CSV size is 5 MB.');
                    return;
                  }
                  const parsed = Papa.parse<Record<string, string>>(await file.text(), {
                    header: true,
                    skipEmptyLines: true,
                  });
                  if (parsed.errors.length) {
                    setMessage(`CSV could not be read: ${parsed.errors[0].message}`);
                    return;
                  }
                  if (parsed.data.length > 5000) {
                    setMessage('Upload at most 5,000 rows.');
                    return;
                  }
                  const h = parsed.meta.fields || [];
                  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
                  setHeaders(h);
                  setRaw(parsed.data);
                  setFileName(file.name);
                  setMapping(
                    Object.fromEntries(
                      fields.map((key) => [
                        key,
                        h.find(
                          (x) =>
                            norm(x) === norm(key) ||
                            (key === 'linkedinUrl' &&
                              ['linkedin', 'profileurl', 'linkedinprofileurl'].includes(norm(x))),
                        ) || '',
                      ]),
                    ),
                  );
                  setMessage(`${parsed.data.length} rows loaded. Check the column mapping.`);
                }}
              />
            </div>
            <button
              className="text-btn"
              onClick={() =>
                exportCsv('campaign-import-template.csv', [
                  {
                    linkedinUrl: '',
                    firstName: '',
                    lastName: '',
                    company: '',
                    title: '',
                    country: '',
                    city: '',
                    language: '',
                  },
                ])
              }
            >
              <Download size={15} />
              Download blank CSV template
            </button>
            {headers.length > 0 && (
              <div className="form-grid">
                {fields.map((key) => (
                  <div
                    key={key}
                    className={`mapping-field ${mapping[key] ? 'is-mapped' : 'is-unmapped'}`}
                  >
                    <Field
                      label={labels[key]}
                      hint={
                        mapping[key]
                          ? 'Mapped'
                          : key === 'linkedinUrl'
                            ? 'Not mapped · required'
                            : 'Not mapped · optional'
                      }
                    >
                      <Select
                        value={mapping[key] || ''}
                        onChange={(value) => setMapping({ ...mapping, [key]: value })}
                        options={[
                          { value: '', label: 'Not mapped' },
                          ...headers.map((value) => ({ value, label: value })),
                        ]}
                      />
                    </Field>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        {effective.length > 0 && (
          <>
            <div className="import-summary">
              <span>
                <Check size={18} />
                <strong>{result.added}</strong> ready to add
              </span>
              <span>{result.duplicate} duplicates</span>
              <span>{result.blocked} blacklisted</span>
              <span>{result.invalid} invalid URLs</span>
            </div>
            <div className="table-wrap compact">
              <table>
                <thead>
                  <tr>
                    <th>Prospect</th>
                    <th>Company</th>
                    <th>Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {effective.slice(0, 5).map((p, i) => (
                    <tr key={i}>
                      <td>
                        {`${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Name not provided'}
                      </td>
                      <td>{p.company || '—'}</td>
                      <td>{p.linkedinUrl || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {more && (
              <p className="muted">
                This is the first page. Saving connects the complete list and continues importing.
              </p>
            )}
          </>
        )}
      </div>
      <div className="modal-foot">
        <span className="muted">
          {isLocal ? 'Local draft · your data stays in this browser' : ''}
        </span>
        <div className="row">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            primary
            disabled={
              busy ||
              (source === 'csv'
                ? !result.added || !mapping.linkedinUrl
                : isLocal || (source === 'sales_navigator' && !url.trim()))
            }
            onClick={save}
          >
            {busy
              ? 'Saving…'
              : source === 'csv'
                ? `Import ${result.added} prospects`
                : 'Connect dynamic list'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
