export type ListKind = 'radar' | 'csv' | 'sales_navigator';
export type ListConfig = { grade?: string; country?: string; url?: string; fileName?: string };
export type ProspectList = {
  id: string;
  kind: ListKind;
  label: string;
  refresh_minutes: number;
  last_synced_at: string | null;
  next_sync_at: string | null;
  last_error: string | null;
  added_count: number;
  config: ListConfig;
};

export function salesNavigatorSource(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid Sales Navigator URL.');
  }
  if (
    url.protocol !== 'https:' ||
    !['linkedin.com', 'www.linkedin.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Use an HTTPS URL from linkedin.com.');
  url.hash = '';
  if (/^\/sales\/search\/people\/?$/.test(url.pathname))
    return {
      url: url.toString(),
      path: 'linkedin/sales-navigator/search',
      body: { url: url.toString() },
    };
  const list = url.pathname.match(/^\/sales\/lists\/people\/([a-zA-Z0-9_-]+)\/?$/);
  if (list)
    return {
      url: url.toString(),
      path: `linkedin/sales-navigator/lead-lists/${encodeURIComponent(list[1])}`,
      body: {},
    };
  throw new Error('Use a Sales Navigator people-search or saved lead-list URL.');
}

export function listConfig(kind: ListKind, raw: ListConfig): ListConfig {
  if (kind === 'sales_navigator') return { url: salesNavigatorSource(raw.url || '').url };
  if (kind === 'csv') return { fileName: String(raw.fileName || 'CSV upload').slice(0, 160) };
  if (kind !== 'radar') throw new Error('Unknown prospect list type.');
  const grade = String(raw.grade || '');
  if (grade && !['A+', 'A', 'B', 'C', 'D'].includes(grade)) throw new Error('Unknown Radar grade.');
  return {
    grade,
    country: String(raw.country || '')
      .trim()
      .slice(0, 100),
  };
}

export function csvRows(input: unknown) {
  if (!Array.isArray(input) || input.length > 5000)
    throw new Error('Upload at most 5,000 CSV rows.');
  const fields = [
    'linkedinUrl',
    'firstName',
    'lastName',
    'company',
    'title',
    'country',
    'city',
    'language',
  ] as const;
  return input.map((row) =>
    Object.fromEntries([
      ...fields.map((key) => [key, typeof row?.[key] === 'string' ? row[key].trim() : '']),
      ['source', 'CSV'],
    ]),
  );
}

export function radarRow(row: Record<string, unknown>) {
  return {
    linkedinUrl: String(row.linkedin_url || ''),
    firstName: String(row.first_name || ''),
    lastName: String(row.last_name || ''),
    company: String(row.company || ''),
    title: String(row.title || ''),
    country: String(row.country || ''),
    city: String(row.city || ''),
    language: String(row.language || ''),
    grade: String(row.grade || ''),
    radarProspectId: String(row.lead_id || ''),
    source: 'Radar',
  };
}

export function salesRow(row: Record<string, any>) {
  const specifics = row.specifics || {};
  // Keep only public /in/ URLs. Sales Navigator IDs are not fabricated into slugs.
  return {
    linkedinUrl: String(
      row.profile_url ||
        (row.public_identifier
          ? `https://www.linkedin.com/in/${encodeURIComponent(row.public_identifier)}`
          : ''),
    ),
    firstName: String(row.first_name || ''),
    lastName: String(row.last_name || ''),
    company: '',
    title: String(specifics.headline || row.headline || ''),
    source: 'Sales Navigator',
  };
}
