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

const REFERENCE_BREAKDOWN_PROMPT = `You are Cue's photo coach. The user uploaded a reference photo. Give 3 telegraphic instructions a friend can follow in two seconds — NOT prose sentences.

CRITICAL FORMAT — match the preset style exactly:
- Each instruction is AT MOST 9 WORDS. Count them before you write.
- AT MOST 3 comma-joined clauses. If you have 4 details, drop the least important one.
- Drop articles and sentence-opening verbs (no "Stand", "Walk", "Capture", "The", "A").
- Use "you/your" for the person being photographed. Gender-neutral.

GOOD examples (these are real Cue presets — write exactly like these):
  stand: "6 ft back, phone at your chest"                              (7 words)
  stand: "12 ft back, crouch a little, phone at your hip"              (9 words)
  stand: "8 ft back, phone at your waist, tilt up a bit"               (10 words — borderline, prefer shorter)
  pose:  "turn toward the table, look off to the side"                 (8 words)
  pose:  "walk slowly, look away, arms relaxed"                        (6 words)
  pose:  "lean on the wall, weight on back foot, chin down"            (10 words — borderline)
  frame: "get you and the table, keep your hands in"                   (9 words)
  frame: "leave space ahead of you, shoot a few"                       (8 words)
  frame: "stand off to one side, keep wall behind you clear"           (10 words — borderline)

BAD — one too many ideas; cut the last clause:
  pose:  "walk slowly forward, look off to side, arms relaxed at sides"   (11 — cut "at sides")
  pose:  "lean on wall, look down, hand in pocket, weight on back foot"    (12 — cut "weight on back foot")
  frame: "center you in shot, keep paneled wall behind clear, full body visible"  (12 — cut "full body visible")

BAD — prose-y, full sentence:
  stand: "Stand 5-6 feet away at chest height, phone tilted slightly up."

CONTENT each cue covers (pick AT MOST 3):
- STAND — distance ("8 ft back"), phone height (chest / waist / knee / eye level), any tilt.
- POSE — body angle, where to look, hands, weight, what to touch or lean on.
- FRAME — where you sit (off to one side / centered), what's around you, full-body vs cropped.

RULES:
- Judge ONLY what's visible.
- No photo jargon: never use 'composition', 'framing', 'perspective', 'subject', 'rule of thirds', 'left third', 'negative space'.

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
