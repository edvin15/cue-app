// Vercel Node serverless function — /api/analyze
// Sends a captured photo (and the cues, or a reference photo) to the
// Anthropic Messages API and returns the model's JSON judgement.
// The ANTHROPIC_API_KEY env var lives on the server only.

export const config = {
  maxDuration: 30,
};

const SYSTEM_PROMPT = `You are a kind, encouraging photo coach. You're checking whether a photo followed 3 specific directions. You will get the photo, the situation, and the 3 cues (Stand, Pose, Frame). For EACH cue, judge ONLY from what's visible and return a status and a short note (under 12 words).
Calibration rules:
- Be confident about what you can actually see: framing, headroom, where the subject sits in the frame, whether there's space ahead of them, full-body vs cropped, rough body angle, whether the pose roughly matches the description.
- Be gentle about what you CANNOT measure from one image (exact distance like '12 ft', exact phone height). For those, never say 'missed' — at most 'close', phrased softly ('looks a bit...').
- Never be harsh or discouraging. Default to encouraging. If something's clearly right, celebrate it.
Return ONLY valid JSON, no markdown:
{"checks":[{"label":"Stand","status":"good|close|missed","note":"..."},{"label":"Pose","status":"...","note":"..."},{"label":"Frame","status":"...","note":"..."}],"overall":"one warm sentence","topFix":"the single most useful change, or a compliment if it's great"}`;

const stripDataUrl = (s) => (s && typeof s === 'string' && s.includes(','))
  ? s.split(',', 2)[1]
  : s;

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* fall through */ }
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function parseModelJson(text) {
  if (!text) return null;
  const cleaned = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '');
  try { return JSON.parse(cleaned); } catch { /* try extracting */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
  }

  let body;
  try { body = await readJsonBody(req); }
  catch { return res.status(400).json({ error: 'Bad JSON body' }); }

  const { mode, imageBase64, situation, cues, referenceBase64 } = body || {};
  const photoB64 = stripDataUrl(imageBase64);
  if (!photoB64) return res.status(400).json({ error: 'Missing imageBase64' });

  let content;
  if (mode === 'paste') {
    const refB64 = stripDataUrl(referenceBase64);
    if (!refB64) return res.status(400).json({ error: 'Missing referenceBase64 for paste mode' });
    const userText = `These are two photos. The first is the REFERENCE the user wanted to copy. The second is the photo they took. Judge how well the captured photo matches the reference's pose, framing, and overall feel. Return ONLY this JSON shape with these exact labels: {"checks":[{"label":"Pose match","status":"good|close|missed","note":"..."},{"label":"Framing","status":"...","note":"..."},{"label":"Overall feel","status":"...","note":"..."}],"overall":"one warm sentence","topFix":"the single most useful change, or a compliment if it's great"}`;
    content = [
      { type: 'text', text: 'Reference photo:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: refB64 } },
      { type: 'text', text: 'Photo the user took:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: photoB64 } },
      { type: 'text', text: userText },
    ];
  } else {
    const userText = `Situation: ${situation || 'unknown'}
Cues:
- Stand: ${cues?.stand || '(none)'}
- Pose:  ${cues?.pose  || '(none)'}
- Frame: ${cues?.frame || '(none)'}

Judge the photo against the cues and return ONLY the JSON.`;
    content = [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: photoB64 } },
      { type: 'text', text: userText },
    ];
  }

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (err) {
    return res.status(502).json({ error: 'Network error talking to Anthropic', detail: String(err?.message || err) });
  }

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text().catch(() => '');
    return res.status(502).json({ error: `Anthropic API ${anthropicRes.status}`, detail: detail.slice(0, 500) });
  }

  let data;
  try { data = await anthropicRes.json(); }
  catch (e) { return res.status(502).json({ error: 'Anthropic returned non-JSON' }); }

  const text = data?.content?.find(c => c.type === 'text')?.text || data?.content?.[0]?.text;
  const parsed = parseModelJson(text);
  if (!parsed) {
    return res.status(502).json({ error: 'Model did not return JSON', raw: (text || '').slice(0, 400) });
  }

  return res.status(200).json(parsed);
}
