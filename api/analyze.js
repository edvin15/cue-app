// Vercel Node serverless function — /api/analyze
// Sends a captured photo (and the cues, or a reference photo) to the
// Anthropic Messages API and returns the model's JSON judgement.
// The ANTHROPIC_API_KEY env var lives on the server only.

export const config = {
  maxDuration: 30,
};

const SYSTEM_PROMPT = `You are a warm, encouraging photo coach. The user is taking a casual photo with a friend behind the camera — they're not a pro photographer. Your job is to celebrate what's working and offer ONE gentle nudge for next time.

CALIBRATION — be generous:
- 'good' = the cue is basically met. Don't demand perfection. If they're close to right, mark it 'good'.
- 'close' = noticeably off but in the right direction. Use this when there's a real, visible gap but they're trying.
- 'missed' = the photo clearly contradicts the cue (e.g., "lean on the wall" but they're across the room). Use rarely.

When in doubt, lean toward 'good'. Default to encouragement.

gotIt = true if any of these are true:
- all three checks are 'good', OR
- two are 'good' and one is 'close'
Be generous with gotIt — if the photo is keepable, it's gotIt.

VOICE:
- Warm and casual, like a friend giving a tip. Never harsh.
- Lead with what's working. Then offer ONE gentle suggestion.
- No photo jargon: no 'left third', 'rule of thirds', 'composition', 'subject', 'framing', 'perspective', 'negative space'.
- Say 'you/your', not 'the subject'.
- Each note short (under 12 words), warm.
- The 'overall' sentence celebrates what's working before any nudge.
- The 'topFix' is a single gentle tip — or a full compliment if everything's good.

Return ONLY valid JSON: {"gotIt":bool,"checks":[{"label":"Stand","status":"good|close|missed","note":"..."},{"label":"Pose","status":"...","note":"..."},{"label":"Frame","status":"...","note":"..."}],"overall":"warm one-liner","topFix":"one gentle tip or a compliment"}`;

const REFERENCE_BREAKDOWN_PROMPT = `You are a kind, encouraging photo coach. The user wants to recreate the photo they're showing you, using their phone camera with a friend behind the camera. Explain how to take the same shot in 3 short, plain-language instructions:

STAND — where the photographer should stand: rough distance from the person (e.g. "6 ft back"), what height to hold the phone (chest / waist / knee / eye level), any tilt (looking up, looking down, straight on).
POSE — what the person being photographed should do: body position and angle, where to look, hands, weight, what to touch or lean on.
FRAME — how to compose the photo: where the person sits in the shot (centered, off to one side), what should be around them, full-body vs cropped.

Rules:
- Judge ONLY what you can actually see in the photo.
- Plain, friendly language — NEVER use photography jargon: no 'rule of thirds', 'left third', 'negative space', 'composition', 'framing', 'perspective', 'subject'. Talk like a friend giving a quick tip.
- Say 'you/your' referring to the person being photographed.
- Each instruction short — under 14 words.
- Gender-neutral.

Return ONLY valid JSON, no markdown:
{"stand":"...","pose":"...","frame":"..."}`;

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
  let systemPrompt = SYSTEM_PROMPT;
  let maxTokens = 600;
  if (mode === 'reference_breakdown') {
    systemPrompt = REFERENCE_BREAKDOWN_PROMPT;
    maxTokens = 400;
    content = [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: photoB64 } },
      { type: 'text', text: 'Photo to recreate. Return the JSON only.' },
    ];
  } else if (mode === 'paste') {
    const refB64 = stripDataUrl(referenceBase64);
    if (!refB64) return res.status(400).json({ error: 'Missing referenceBase64 for paste mode' });
    const userText = `These are two photos. The first is the REFERENCE the user wanted to copy. The second is the photo they took. Judge how well the captured photo matches the reference's pose, framing, and overall feel. Set gotIt=true ONLY if the captured photo clearly matches the reference well enough to keep and post. Return ONLY this JSON shape with these exact labels: {"gotIt":true|false,"checks":[{"label":"Pose match","status":"good|close|missed","note":"..."},{"label":"Framing","status":"...","note":"..."},{"label":"Overall feel","status":"...","note":"..."}],"overall":"one warm sentence","topFix":"the single most useful change, or a compliment if it's great"}`;
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
        max_tokens: maxTokens,
        system: systemPrompt,
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
