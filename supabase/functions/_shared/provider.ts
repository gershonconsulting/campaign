/** Unipile v1 adapter. Credentials are resolved only in the server environment. */
export async function unipile(path: string, options: RequestInit = {}) {
  const base = Deno.env.get('UNIPILE_DSN'),
    key = Deno.env.get('UNIPILE_API_KEY');
  if (!base || !key)
    throw new Error('Unipile is not configured. Set UNIPILE_DSN and UNIPILE_API_KEY.');
  const url = new URL(base);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.unipile.com'))
    throw new Error('UNIPILE_DSN must be the HTTPS endpoint supplied by Unipile.');
  const response = await fetch(`${base.replace(/\/$/, '')}/api/v1/${path}`, {
    ...options,
    headers: {
      'X-API-KEY': key,
      Accept: 'application/json',
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      `LinkedIn provider request failed (${response.status}). Check provider logs before retrying.`,
    );
  return response.json();
}
