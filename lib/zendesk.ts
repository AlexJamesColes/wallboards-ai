const cache = new Map<string, { data: any; expires: number }>();

export function isZendeskConfigured(): boolean {
  return !!process.env.WB_ZENDESK_SUBDOMAIN;
}

export async function fetchZendesk(path: string): Promise<any> {
  const sub = process.env.WB_ZENDESK_SUBDOMAIN!;
  const email = process.env.WB_ZENDESK_EMAIL!;
  const token = process.env.WB_ZENDESK_API_TOKEN!;
  const url = `https://${sub}.zendesk.com/api/v2/${path.replace(/^\//, '')}`;

  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.data;

  const auth = Buffer.from(`${email}/token:${token}`).toString('base64');
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`Zendesk ${res.status}: ${await res.text()}`);
  const data = await res.json();
  cache.set(url, { data, expires: Date.now() + 60_000 });
  return data;
}
