import { useState } from 'react';
import Papa from 'papaparse';
import { Radio, Upload, Link2, Check, Download } from 'lucide-react';
import { type Campaign, type Data, type Person, importPeople, exportCsv } from './model';
import { Modal, Button, Field, Select, Badge } from './ui';
import { isDemo, providerAction } from './store';
export default function ImportDialog({
  campaign,
  data,
  onClose,
  onImport,
}: {
  campaign: Campaign;
  data: Data;
  onClose: () => void;
  onImport: (people: Person[], enrollments: Data['enrollments']) => void;
}) {
  const [source, setSource] = useState('radar'),
    [rows, setRows] = useState<Partial<Person>[]>([]),
    [urls, setUrls] = useState(''),
    [grade, setGrade] = useState(''),
    [owner, setOwner] = useState(''),
    [country, setCountry] = useState(''),
    [score, setScore] = useState(0),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [headers, setHeaders] = useState<string[]>([]),
    [raw, setRaw] = useState<Record<string, string>[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({});
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
  const effective: Partial<Person>[] =
    source === 'urls'
      ? urls
          .split(/\r?\n/)
          .filter((x) => x.trim())
          .map((linkedinUrl) => ({ linkedinUrl, source: 'Profile URLs' }))
      : source === 'csv'
        ? raw.map(
            (row) =>
              Object.fromEntries(fields.map((k) => [k, row[mapping[k]] || ''])) as Partial<Person>,
          )
        : rows.filter(
            (p) =>
              (!grade || p.grade === grade) &&
              (!owner || (p.owner || '').toLowerCase().includes(owner.toLowerCase())) &&
              (!country || (p.country || '').toLowerCase().includes(country.toLowerCase())) &&
              (p.score || 0) >= score,
          );
  const result = importPeople(data, campaign, effective);
  async function fetchRadar() {
    setBusy(true);
    try {
      if (isDemo) {
        setRows(data.people.map((p) => ({ ...p, source: 'Sample Radar data' })));
        setMessage(
          'Sample Radar prospects loaded. A live connection is required for your real prospects.',
        );
      } else {
        const response = await providerAction('radar-prospects', { clientId: campaign.clientId });
        setRows(response.prospects);
        setMessage('Radar prospects loaded.');
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add prospects" onClose={onClose} wide>
      <div className="modal-body">
        <p className="muted">
          Choose who should enter <strong>{campaign.name}</strong>. Duplicates and blacklisted
          profiles are skipped.
        </p>
        <div className="source-grid">
          {[
            ['radar', 'From Radar', Radio],
            ['csv', 'Upload CSV', Upload],
            ['urls', 'Profile URLs', Link2],
          ].map(([key, label, Icon]) => {
            const I = Icon as typeof Radio;
            return (
              <button
                key={key as string}
                className={`source-option ${source === key ? 'selected' : ''}`}
                onClick={() => {
                  setSource(key as string);
                  setMessage('');
                }}
              >
                <I size={22} />
                <strong>{label as string}</strong>
                <small>
                  {key === 'radar'
                    ? 'Your graded prospects'
                    : key === 'csv'
                      ? 'Up to 5,000 rows'
                      : 'Paste one URL per line'}
                </small>
              </button>
            );
          })}
        </div>
        {source === 'radar' && (
          <>
            <div className="form-grid">
              <Field label="Grade">
                <Select
                  value={grade}
                  onChange={setGrade}
                  options={[
                    { value: '', label: 'All grades' },
                    ...['A+', 'A', 'B', 'C', 'D'].map((v) => ({ value: v, label: v })),
                  ]}
                />
              </Field>
              <Field label="Minimum score">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={score}
                  onChange={(e) => setScore(Number(e.target.value))}
                />
              </Field>
              <Field label="Owner">
                <input
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder="All owners"
                />
              </Field>
              <Field label="Country">
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="All countries"
                />
              </Field>
            </div>
            <Button onClick={fetchRadar} disabled={busy}>
              <Radio size={16} />
              {busy ? 'Loading…' : 'Load prospects from Radar'}
            </Button>
          </>
        )}
        {source === 'csv' && (
          <>
            <div className="upload-zone">
              <Upload size={26} />
              <strong>Choose a CSV file</strong>
              <p>First row should contain column names. Maximum 5,000 prospects.</p>
              <input
                aria-label="Upload prospects CSV"
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 5_000_000) {
                    setMessage('File is too large. Maximum file size is 5 MB.');
                    return;
                  }
                  const text = await f.text();
                  const parsed = Papa.parse<Record<string, string>>(text, {
                    header: true,
                    skipEmptyLines: true,
                  });
                  if (parsed.errors.length) {
                    setMessage(`CSV could not be read: ${parsed.errors[0].message}`);
                    return;
                  }
                  if (parsed.data.length > 5000) {
                    setMessage('This CSV has more than 5,000 rows. Split it into smaller files.');
                    return;
                  }
                  const h = parsed.meta.fields || [];
                  setHeaders(h);
                  setRaw(parsed.data);
                  const norm = (v: string) => v.toLowerCase().replace(/[^a-z]/g, '');
                  setMapping(
                    Object.fromEntries(
                      fields.map((k) => [
                        k,
                        h.find(
                          (x) =>
                            norm(x) === norm(k) ||
                            (k === 'linkedinUrl' &&
                              ['linkedin', 'profileurl', 'linkedinprofileurl'].includes(norm(x))),
                        ) || '',
                      ]),
                    ),
                  );
                  setMessage(`${parsed.data.length} rows loaded. Check the column mapping below.`);
                }}
              />
            </div>
            <button
              className="text-btn"
              onClick={() =>
                exportCsv('campaign-import-template.csv', [
                  {
                    linkedinUrl: 'https://www.linkedin.com/in/example',
                    firstName: 'Alex',
                    lastName: 'Example',
                    company: 'Example Ltd',
                    title: 'Director',
                    country: 'France',
                  },
                ])
              }
            >
              <Download size={15} />
              Download CSV template
            </button>
            {headers.length > 0 && (
              <div className="form-grid">
                {fields.map((k) => (
                  <Field key={k} label={labels[k]}>
                    <Select
                      value={mapping[k] || ''}
                      onChange={(v) => setMapping({ ...mapping, [k]: v })}
                      options={[
                        { value: '', label: 'Not mapped' },
                        ...headers.map((h) => ({ value: h, label: h })),
                      ]}
                    />
                  </Field>
                ))}
              </div>
            )}
          </>
        )}
        {source === 'urls' && (
          <Field
            label="LinkedIn profile URLs"
            hint="Profiles without a name can use message variable fallbacks."
          >
            <textarea
              rows={7}
              placeholder={
                'https://www.linkedin.com/in/example\nhttps://www.linkedin.com/in/another-person'
              }
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
            />
          </Field>
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
                    <th>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {effective.slice(0, 5).map((p, i) => (
                    <tr key={i}>
                      <td>{`${p.firstName || ''} ${p.lastName || ''}`.trim() || p.linkedinUrl}</td>
                      <td>{p.company || '—'}</td>
                      <td>{p.grade ? <Badge tone="grade">{p.grade}</Badge> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <div className="modal-foot">
        <span className="muted">{isDemo ? 'Demo · saved in this browser' : ''}</span>
        <div className="row">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            primary
            disabled={!result.added || busy}
            onClick={() => onImport(result.people, result.enrollments)}
          >
            Add {result.added} prospects
          </Button>
        </div>
      </div>
    </Modal>
  );
}
