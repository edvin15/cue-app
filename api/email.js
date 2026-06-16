// Vercel Node serverless function — /api/email
// Stores the save-gate email in the Supabase `emails` table.
//
// IMPORTANT: this is storage only. There is no email-sending anywhere in
// Cue — no confirmation, no welcome mail, nothing outbound. The address is
// a record in the database and nothing else.
//
// Env (server-only, set in Vercel):
//   SUPABASE_URL              — https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service-role key (never shipped to client)
//
// Table:
//   create table emails (
//     id bigint generated always as identity primary key,
//     email text not null,
//     created_at timestamptz not null default now()
//   );

export const config = { maxDuration: 10 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
  if (!url || !key) {
    console.error('[email] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'server_not_configured' });
  }

  let body;
  try { body = await readJsonBody(req); }
  catch { return res.status(400).json({ error: 'bad_json' }); }

  const email = (body?.email || '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  // Optional but lets us correlate this email to the device's events
  // in the events table (same session_id). Bounded length so a malformed
  // client can't blow out the column.
  const sessionId = (body?.session_id || '').trim().slice(0, 64) || null;

  try {
    const r = await fetch(`${url}/rest/v1/emails`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: key,
        authorization: `Bearer ${key}`,
        prefer: 'return=minimal',
      },
      body: JSON.stringify({ email, session_id: sessionId }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[email] supabase insert failed', r.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'store_failed' });
    }
  } catch (e) {
    console.error('[email] network error', e?.message);
    return res.status(502).json({ error: 'network_error' });
  }

  return res.status(200).json({ ok: true });
}
