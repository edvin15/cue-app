// api/evaluate.js
// Cue photo evaluation endpoint — Vercel serverless function.
// Requires ANTHROPIC_API_KEY in Vercel env vars.
//
// Request (POST JSON):
//   { imageBase64: "<base64>", mediaType: "image/jpeg",
//     reference?: "<base64>", referenceMediaType?: "image/jpeg",   // copy-a-photo mode
//     presetCues?: { stand: "...", pose: "...", frame: "..." } }   // preset mode
//
// Response: { cues: [...], retake_worth_it: bool, one_thing?: "..." }

const EVAL_PROMPT = `You are Cue's photo evaluation engine. A person just took a photo, coached by a partner. Give honest, useful verdicts a stressed non-photographer can act on in 2 seconds.

THE GOLDEN RULES — these override everything else:

1. FEEDBACK LENGTH: every "feedback" string is MAXIMUM 8 WORDS. An imperative command or a short observation. No diagnosis, no reasoning, no "which makes" or "so that" clauses. The badge carries the severity; the words carry only the action.
   GOOD: "Lower the phone to chest height."
   GOOD: "Clear the cables off the floor."
   GOOD: "Genuine candid — keep it."
   BAD: "The phone is held at a steep overhead angle which distorts proportions and makes the subject look hunched."

2. ONE FIX MAXIMUM per photo. "fix" is reserved for the single worst problem, and ONLY if it genuinely ruins the shot (face in silhouette, subject badly cut off, completely unusable). Everything else is "adjust" — even if you spot several real problems. If two things feel fix-level, the worst one is the fix and the other becomes adjust. The partner can only correct one thing per retake; do not stack emergencies.

3. CALIBRATION: most casual photos land at 1-2 adjusts. All-pass should be rare (~1 in 5) and earned. All-fix should basically never happen. A flawed-but-keepable photo is adjusts, not fixes.

4. CANDID PASSES POSE. If the subject looks naturally absorbed in something and their face is visible, POSE is a pass. Working at a laptop, laughing mid-moment, walking — these are good photos, not failures to pose. Only flag POSE when the body language actively hurts the shot (slouch, dead hands, blink) or contradicts a provided reference.

THE FOUR CUES:

STAND — distance, height, phone tilt. Adjust if: slightly off height/distance, mild tilt (leaning verticals, rotated horizon). Fix only if: angle so steep or tilt so strong the shot is warped beyond use.

POSE — see rule 4. Adjust if: slouch, hands with nothing to do, tucked chin, mismatch vs reference. Fix only if: blink, badly cropped limbs, actively unflattering.

FRAME — composition. Adjust if: removable clutter in frame (name the object), dead-center when off-center is better, awkward space. Fix only if: subject lost or major elements cut off.

LIGHT — adjust if: flat light, mild shadows, background a bit brighter than the face. Fix only if: face clearly darker than background (silhouette), or blown-out source dominating the frame. If the face is clearly darker than the background, LIGHT is the photo's one fix.

If a reference image is provided, judge against THAT look. If preset cues are provided as text, judge whether those instructions were executed.

OUTPUT — emit ONLY this JSON, no markdown, no backticks, no prose
before or after. The whole response must be the JSON object and
nothing else. Keep every "feedback" string to 8 words MAX:
{
  "cues": [
    { "cue": "STAND", "verdict": "pass | adjust | fix", "feedback": "max 8 words" },
    { "cue": "POSE",  "verdict": "...", "feedback": "max 8 words" },
    { "cue": "FRAME", "verdict": "...", "feedback": "max 8 words" },
    { "cue": "LIGHT", "verdict": "...", "feedback": "max 8 words" }
  ],
  "retake_worth_it": true,
  "one_thing": "single highest-impact retake instruction, max 12 words, partner-proof"
}

Omit one_thing only if all four pass. Never use "perfect" or "totally" unless all four pass.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { imageBase64, mediaType, reference, referenceMediaType, presetCues } = req.body || {};
  if (!imageBase64 || !mediaType) {
    return res.status(400).json({ error: "imageBase64 and mediaType required" });
  }

  let instruction;
  if (reference) {
    instruction = "First image: the photo just taken. Second image: the reference being copied. Evaluate the shot against the reference.";
  } else if (presetCues) {
    instruction = `Evaluate this photo against the cues the user was given:\nSTAND: ${presetCues.stand}\nPOSE: ${presetCues.pose}\nFRAME: ${presetCues.frame}\nGrade whether they executed THESE instructions. Presets don't cue lighting — judge LIGHT independently.`;
  } else {
    instruction = "Evaluate this photo. No reference — judge against general criteria.";
  }

  const content = [
    { type: "text", text: instruction },
    { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } }
  ];
  if (reference) {
    content.push({ type: "image", source: { type: "base64", media_type: referenceMediaType || "image/jpeg", data: reference } });
  }

  const model = "claude-fable-5";
  const t0 = Date.now();
  let r, rawBody;

  // Log what we're about to send (size matters — big base64 → slow / 429).
  const photoBytes = (imageBase64 || "").length;
  const refBytes   = (reference   || "").length;
  console.log("[evaluate] →", { model, photoBytes, refBytes, presetCues: !!presetCues });

  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        // Fable 5 is a reasoning model — it burns thinking tokens before
        // emitting JSON. 1500 leaves comfortable headroom; dropping
        // below this triggered stop_reason:'max_tokens' mid-output and
        // the client never received valid JSON. Speed wins come from
        // the smaller image payload and trimmer prompt instead.
        model,
        max_tokens: 1500,
        system: EVAL_PROMPT,
        messages: [{ role: "user", content }]
      })
    });
  } catch (e) {
    console.error("[evaluate] network_error", { model, ms: Date.now() - t0, msg: e.message });
    return res.status(502).json({ error: "network_error", model, detail: e.message });
  }

  rawBody = await r.text().catch(() => "");
  const elapsed = Date.now() - t0;

  if (!r.ok) {
    let body;
    try { body = JSON.parse(rawBody); } catch { body = { raw: rawBody.slice(0, 300) }; }
    console.error("[evaluate] anthropic_api_error", {
      model, status: r.status, ms: elapsed, body,
    });
    return res.status(502).json({
      error:  "anthropic_api_error",
      stage:  "anthropic_http",
      model,
      status: r.status,
      body,
    });
  }

  let data;
  try { data = JSON.parse(rawBody); }
  catch (e) {
    console.error("[evaluate] anthropic_non_json", {
      model, ms: elapsed, msg: e.message, raw: rawBody.slice(0, 400),
    });
    return res.status(502).json({
      error:  "anthropic_non_json",
      model,
      detail: e.message,
      raw:    rawBody.slice(0, 400),
    });
  }
  if (data.error) {
    console.error("[evaluate] anthropic_returned_error", {
      model, ms: elapsed, detail: data.error,
    });
    return res.status(502).json({ error: "anthropic_returned_error", model, detail: data.error });
  }

  const raw = (data.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n");

  const result = parseLooseJson(raw);
  if (!result || !Array.isArray(result.cues)) {
    console.error("[evaluate] model_did_not_return_cues", {
      model, ms: elapsed, raw: (raw || "").slice(0, 600), stop_reason: data.stop_reason,
    });
    return res.status(502).json({
      error:  "model_did_not_return_cues",
      model,
      detail: "parser found no { cues: [...] } in the response",
      raw:    (raw || "").slice(0, 600),
      stop_reason: data.stop_reason,
    });
  }

  console.log("[evaluate] ok", {
    model, ms: elapsed,
    verdicts: result.cues.map(c => c.verdict),
    one_thing: !!result.one_thing,
  });
  return res.status(200).json(result);
}

// Forgiving JSON extractor — handles ```json fences, leading/trailing prose,
// stray whitespace, and falls back to the first balanced { ... } block found
// anywhere in the response. Many models occasionally wrap their JSON in a
// short prose sentence; we don't want one stray newline to fail the whole
// evaluation.
function parseLooseJson(text) {
  if (!text || typeof text !== "string") return null;

  // 1. Strip markdown fences and whitespace, then try as-is.
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }

  // 2. Find the first balanced { … } substring and try that.
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch { return null; }
      }
    }
  }
  return null;
}

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } }
};
