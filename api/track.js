// Vercel Node serverless function — /api/track
// Lightweight anonymous usage events → Supabase `events` table.
// No personal data here: event name + random per-device session id only.
//
// Env (server-only, set in Vercel):
//   SUPABASE_URL              — https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service-role key (never shipped to client)
//
// Table:
//   create table events (
//     id bigint generated always as identity primary key,
//     event_name text not null,
//     session_id text not null,
//     created_at timestamptz not null default now()
//   );

export const config = { maxDuration: 10 };

// Closed set of event names — anything else is dropped so the table can't
// be polluted by arbitrary client-supplied strings.
const ALLOWED_EVENTS = new Set([
  'session_start',
  'situation_opened',
  'photo_taken',
  'ai_check_run',
  'photo_saved',
  'email_captured',
]);

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* fall through */ }
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Tracking is best-effort: if the backend isn't configured, succeed
  // quietly so the client never logs noise or retries.
  if (!url || !key) return res.status(204).end();

  let body;
  try { body = await readJsonBody(req); }
  catch { return res.status(204).end(); }

  const eventName = (body?.event_name || '').trim();
  const sessionId = (body?.session_id || '').trim().slice(0, 64);
  if (!ALLOWED_EVENTS.has(eventName) || !sessionId) {
    return res.status(204).end();
  }

  try {
    const r = await fetch(`${url}/rest/v1/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: key,
        authorization: `Bearer ${key}`,
        prefer: 'return=minimal',
      },
      body: JSON.stringify({ event_name: eventName, session_id: sessionId }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[track] supabase insert failed', r.status, detail.slice(0, 300));
    }
  } catch (e) {
    console.error('[track] network error', e?.message);
  }

  return res.status(204).end();
}
