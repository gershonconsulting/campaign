import { useEffect, useState } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import { Button, Badge, Empty, Panel } from './ui';
import { listAction, isLocal } from './store';
import type { Campaign } from './model';
import type { ProspectList } from '../supabase/functions/_shared/prospect-lists';

export default function ProspectLists({
  campaign,
  beforeRequest,
  onReload,
  onAdd,
}: {
  campaign: Campaign;
  beforeRequest: () => Promise<unknown>;
  onReload: () => Promise<void>;
  onAdd: () => void;
}) {
  const [lists, setLists] = useState<ProspectList[]>(campaign.prospectLists || []),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  async function load() {
    if (isLocal) return;
    await beforeRequest();
    const result = await listAction('lists', { campaignId: campaign.id });
    setLists(result.lists);
  }
  useEffect(() => {
    let active = true;
    if (!isLocal)
      beforeRequest()
        .then(() => listAction('lists', { campaignId: campaign.id }))
        .then((result) => {
          if (active) setLists(result.lists);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [campaign.id]);
  return (
    <Panel
      title="Prospect lists"
      action={
        <Button onClick={onAdd}>
          <Plus size={16} />
          Add list
        </Button>
      }
    >
      <p className="muted">
        Radar and Sales Navigator add new matches every hour. CSV lists stay fixed. Existing
        prospects keep their progress.
      </p>
      {error && (
        <div role="alert" className="notice">
          {error}
        </div>
      )}
      {!lists.length && !error && (
        <Empty
          title="No prospect lists yet"
          description="Connect Radar, upload a CSV, or paste a Sales Navigator URL to add your first real prospects."
        />
      )}
      {lists.map((source) => (
        <div className="setting-list-item" key={source.id}>
          <div>
            <strong>{source.label}</strong>
            <p>
              {source.added_count} prospects added ·{' '}
              {source.last_synced_at
                ? `Last refreshed ${new Date(source.last_synced_at).toLocaleString()}`
                : 'Not refreshed yet'}
            </p>
            {source.config.url && (
              <a href={source.config.url} target="_blank" rel="noreferrer">
                Open source
              </a>
            )}
            {source.last_error && <p role="alert">{source.last_error}</p>}
          </div>
          <Badge>{source.kind === 'csv' ? 'Static CSV' : 'Dynamic · hourly'}</Badge>
          {source.kind !== 'csv' && (
            <Button
              disabled={!!busy || campaign.status !== 'Draft'}
              onClick={async () => {
                setBusy(source.id);
                setError('');
                try {
                  await beforeRequest();
                  await listAction('sync', { campaignId: campaign.id, sourceId: source.id });
                  await onReload();
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy('');
                }
              }}
            >
              <RefreshCw size={15} />
              {busy === source.id ? 'Refreshing…' : 'Sync now'}
            </Button>
          )}
        </div>
      ))}
    </Panel>
  );
}
