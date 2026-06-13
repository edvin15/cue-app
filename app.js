// Cue — photo-coaching camera (vanilla JS, client-side only)

// ---------- PWA: register service worker (silent if unsupported) ----------
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[Cue] SW register failed:', err);
    });
  });
}

// ---------- In-app browser detection ----------
// TikTok / Instagram / Facebook / Snapchat webviews don't grant getUserMedia,
// so the camera silently fails. Detect and warn — most of our traffic comes
// from TikTok/IG link taps, so this is critical.
(() => {
  const ua = navigator.userAgent || '';

  // Explicit in-app browser markers, in order of specificity.
  const isTikTok    = /TikTok|musical_ly|Bytedance|BytedanceWebview/i.test(ua);
  const isInstagram = /Instagram/i.test(ua);
  const isFacebook  = /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua);
  const isSnapchat  = /Snapchat/i.test(ua);
  const isLinkedIn  = /LinkedInApp/i.test(ua);
  const isPinterest = /Pinterest/i.test(ua);
  const isTwitter   = /Twitter|TwitterAndroid/i.test(ua);
  const isLine      = /Line\//i.test(ua);

  // Generic webview fallbacks. Safari iOS WKWebView has no "Safari/" token;
  // Android WebViews advertise "; wv)".
  const isIOS       = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isAndroid   = /Android/.test(ua);
  const isIOSWebView     = isIOS && !/Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  const isAndroidWebView = isAndroid && /; wv\)/.test(ua);

  const named = isTikTok || isInstagram || isFacebook || isSnapchat ||
                isLinkedIn || isPinterest || isTwitter || isLine;
  if (!named && !isIOSWebView && !isAndroidWebView) return;

  // Already in standalone PWA → camera permission flow works, skip.
  const isStandalone = window.navigator.standalone === true ||
                       (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (isStandalone) return;

  // Per-app menu hint so the instruction matches what the user actually
  // sees, naming the app and pointing at ITS native menu — the ••• in our
  // banner is plain text, so the copy must make clear where the real
  // button lives. We deliberately don't try to deep-link to Safari —
  // every webview blocks the obvious tricks (x-safari-https://,
  // intent://) or shows a scary prompt.
  const hint = (() => {
    if (isTikTok)    return { app: 'TikTok',    target: 'Open in browser' };
    if (isInstagram) return { app: 'Instagram', target: 'Open in external browser' };
    if (isFacebook)  return { app: 'Facebook',  target: 'Open in Browser' };
    if (isSnapchat)  return { app: 'Snapchat',  target: 'Open in Browser' };
    if (isLinkedIn)  return { app: 'LinkedIn',  target: 'Open in Browser' };
    if (isPinterest) return { app: 'Pinterest', target: 'Open in Browser' };
    if (isTwitter)   return { app: 'X',         target: 'Open in Browser' };
    if (isLine)      return { app: 'LINE',      target: 'Open in Browser' };
    if (isIOS)       return { app: null,        target: 'Open in Safari' };
    return                  { app: null,        target: 'Open in Browser' };
  })();

  const init = () => {
    const el = document.getElementById('webview-banner');
    if (!el) return;

    // Rewrite the instruction line to match this specific app.
    const ins = document.getElementById('webview-banner-instructions');
    if (ins) {
      if (hint.app) {
        ins.innerHTML =
          `The camera doesn't work inside ${hint.app}. ` +
          `In <em>${hint.app}'s own bar at the very top of your screen</em> ` +
          `(above this notice), tap the <em>•••</em> button, ` +
          `then choose <em>${hint.target}</em>.`;
      } else {
        ins.innerHTML =
          `The camera doesn't work in this in-app browser. ` +
          `Use the app's own menu at the very top of your screen ` +
          `to choose <em>${hint.target}</em> — or copy the link below ` +
          `and paste it into Safari.`;
      }
    }

    el.hidden = false;

    // Push the rest of the UI down so the banner doesn't overlap content.
    // The screens are position:fixed, so body padding has no effect — set a
    // CSS variable the .screen rule pads with instead.
    const applyOffset = () => {
      const h = el.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--webview-banner-h', h + 'px');
    };
    applyOffset();
    window.addEventListener('resize', applyOffset);

    // Copy link — works inside every webview we've tested, gives the user
    // a one-tap fallback when the share-sheet menu is hard to find.
    const cta = document.getElementById('webview-banner-cta');
    if (cta) {
      cta.addEventListener('click', async () => {
        const url = location.href;
        let ok = false;
        try {
          await navigator.clipboard.writeText(url);
          ok = true;
        } catch {
          // Fallback for webviews that block the async Clipboard API.
          try {
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            ok = document.execCommand && document.execCommand('copy');
            document.body.removeChild(ta);
          } catch { ok = false; }
        }
        if (ok) {
          cta.textContent = 'Link copied — paste in your browser';
          cta.classList.add('copied');
        } else {
          cta.textContent = "Couldn't copy — long-press the URL bar instead";
          cta.classList.add('copied');
        }
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ---------- PWA: iOS install banner ----------
// Apple does not show a native install prompt — the user has to tap Share
// then "Add to Home Screen". The banner just shows them how, once, and
// remembers their dismissal so it never nags.
(() => {
  const KEY  = 'cue-install-banner-dismissed';
  const ua   = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  // navigator.standalone === true → already installed and running standalone
  const isStandalone = window.navigator.standalone === true ||
                       (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const dismissed = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();

  if (!isIOS || isStandalone || dismissed) return;

  // Small delay so the banner doesn't slam in during initial paint.
  setTimeout(() => {
    const el = document.getElementById('install-banner');
    if (!el) return;
    el.hidden = false;
    document.getElementById('install-banner-close').addEventListener('click', () => {
      el.hidden = true;
      try { localStorage.setItem(KEY, '1'); } catch {}
    });
  }, 1200);
})();

// ---------- Watermark (display-only) ----------
// Single master switch — ship OFF. When flipped to true, a small "cue"
// wordmark overlays photos as displayed in-app (post-shot review and the
// My-shots fullscreen preview), so screenshots carry the mark. It is a
// pure CSS overlay: the stored blob is untouched, and the email-gated
// save/download always delivers the clean full-res file.
const WATERMARK_ENABLED = false;
if (WATERMARK_ENABLED) document.documentElement.classList.add('watermark-on');

// ---------- User settings (persisted in localStorage) ----------
const DEFAULT_SETTINGS = {
  aspect:   '9:16',   // '9:16' | 'original'
  autoSave: false,
};
const settings = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('cue-settings') || '{}');
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch { return { ...DEFAULT_SETTINGS }; }
})();
function persistSettings() {
  try { localStorage.setItem('cue-settings', JSON.stringify(settings)); } catch {}
}

// ---------- Daily AI-coaching quota ----------
// The AI check is a bonus layer. Daily cap currently disabled: every
// shot gets a check. To re-enable, set this to a positive integer
// (e.g. 10). Reset behavior + UI fire from the same module — nothing
// downstream needs to change.
const COACH_LIMIT_PER_DAY = Infinity;
const coachQuota = (() => {
  const KEY = 'cue-coach-quota-v1';
  const SHOWN_PREFIX = 'cue-coach-limit-notice-shown-';

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function readState() {
    const today = todayKey();
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (raw && raw.date === today && typeof raw.count === 'number') return raw;
    } catch {}
    return { date: today, count: 0 };
  }
  function writeState(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }
  return {
    remaining() {
      const s = readState();
      return Math.max(0, COACH_LIMIT_PER_DAY - s.count);
    },
    canCoach() { return this.remaining() > 0; },
    /** Reserve one coaching credit. Returns true if reserved, false if over. */
    consume() {
      const s = readState();
      if (s.count >= COACH_LIMIT_PER_DAY) return false;
      s.count += 1;
      writeState(s);
      return true;
    },
    /** True the first time today the quota is exactly used up. */
    shouldShowLimitNotice() {
      const s = readState();
      if (s.count < COACH_LIMIT_PER_DAY) return false;
      try {
        if (localStorage.getItem(SHOWN_PREFIX + s.date) === '1') return false;
      } catch {}
      return true;
    },
    markLimitNoticeShown() {
      try { localStorage.setItem(SHOWN_PREFIX + todayKey(), '1'); } catch {}
    },
  };
})();

// ---------- Anonymous usage tracking ----------
// Fire-and-forget event counts to /api/track (→ Supabase `events`).
// No personal data: event name + a random per-device id only. Failures
// are silent — analytics must never affect the app.
const trackSessionId = (() => {
  const KEY = 'cue-session-id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
           `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
})();

function track(eventName) {
  try {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_name: eventName, session_id: trackSessionId }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* never let analytics break the app */ }
}

track('session_start');

const samplePaths = (slug) => [1, 2, 3, 4].map(n => `/samples/${slug}-${n}.webp`);

const PRESETS = [
  { id: 'dinner', name: 'Dinner', blurb: 'At a table, evening light',
    stand: '6 ft back, phone at your chest',
    pose:  'turn toward the table, look off to the side',
    frame: 'get you and the table, keep your hands in',
    samples: samplePaths('dinner') },
  { id: 'walking', name: 'Walking', blurb: 'Candid, in motion',
    stand: '12 ft back, crouch a little, phone at your hip',
    pose:  'walk slowly, look away, arms relaxed',
    frame: 'leave space ahead of you, shoot a few',
    samples: samplePaths('walking') },
  { id: 'standing', name: 'Standing', blurb: 'Against a wall',
    stand: '8 ft back, phone at your waist, tilt up a bit',
    pose:  'lean on the wall, weight on your back foot, chin down',
    frame: 'stand off to one side, keep the wall behind you clear',
    samples: samplePaths('standing') },
  { id: 'sitting', name: 'Sitting', blurb: 'Cafe, bench, steps',
    stand: '5 ft back, phone at your eye level',
    pose:  'lean in a little, hands relaxed, soft smile',
    frame: 'get you and where you’re sitting, keep you off-center',
    samples: samplePaths('sitting') },
  { id: 'golden', name: 'Golden hour', blurb: 'Sun low, warm light',
    stand: '9 ft back, get low, phone at your chest',
    pose:  'face the sun, eyes closed or look away',
    frame: 'let the sun glow in a corner, shoot from low',
    samples: samplePaths('golden-hour') },
  { id: 'full', name: 'Full look', blurb: 'Head-to-toe outfit',
    stand: '12 ft back, phone at your knees',
    pose:  'slight angle, one foot forward, hand in pocket',
    frame: 'get your whole body in, head to shoes',
    samples: samplePaths('full-look') }
];

const $ = (sel) => document.querySelector(sel);
const screens = {
  home:            $('#screen-home'),
  presets:         $('#screen-presets'),
  'paste-options': $('#screen-paste-options'),
  'cue-poses':     $('#screen-cue-poses'),
  shoot:           $('#screen-shoot'),
  gallery:         $('#screen-gallery'),
};

// Lazily-loaded IndexedDB gallery module.
const GALLERY_VER = '20260610c';
let _galleryMod = null;
async function gallery() {
  if (_galleryMod) return _galleryMod;
  _galleryMod = await import(`./gallery.js?v=${GALLERY_VER}`);
  return _galleryMod;
}

// Curated pose library — flattened from PRESETS so we can render the gallery
// grouped by situation under Copy-a-photo without re-stating the file paths.
function getCuratedPoseGroups() {
  return PRESETS
    .filter(p => Array.isArray(p.samples) && p.samples.length)
    .map(p => ({ label: p.name, samples: p.samples }));
}

const state = {
  mode: null,
  preset: null,
  refUrl: null,
  refMirrored: false,
  facingMode: 'environment',
  stream: null,
  lastBlob: null,
  lastObjectUrl: null,
  starting: false,
  session: [],          // preset-path captures: { id, fullBlob, fullUrl, thumbUrl, status, result }
  activeReviewId: null  // when reviewing a session photo
};

// Reference-overlay transform (paste path). Defaults = centered fit-to-screen.
const refXform = { x: 0, y: 0, scale: 1, rot: 0 };

// Cue-card transform. Defaults = original position. tucked = fully hidden + tab visible.
const cueXform = { x: 0, y: 0, tucked: false };

// Reference-bar transform. Same pattern as cueXform — drag anywhere, slide off
// any edge to tuck, tap the tab to bring it back.
const refBarXform = { x: 0, y: 0, tucked: false };

let toastTimer = null;

function $hide(sel) { const el = $(sel); if (el) el.hidden = true; }
function $show(sel) { const el = $(sel); if (el) el.hidden = false; }
function hideAllErrors() {
  $hide('#cam-tap'); $hide('#cam-denied'); $hide('#cam-https'); $hide('#cam-error');
}
function showError(msg) {
  hideAllErrors();
  $('#cam-error-msg').textContent = msg;
  $show('#cam-error');
}

function showScreen(name) {
  // Free any blob URLs held by the My-shots grid when we leave it; refresh
  // the home tile count whenever we land back on the home screen.
  if (name !== 'gallery' && typeof _galleryUrls !== 'undefined' && _galleryUrls.length) {
    for (const u of _galleryUrls) URL.revokeObjectURL(u);
    _galleryUrls = [];
  }
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  if (name === 'home' && typeof refreshGalleryBadge === 'function') {
    refreshGalleryBadge();
  }
  if (typeof updateCoachLimitTag === 'function') updateCoachLimitTag();
}

function goHome() {
  stopCamera();
  stopDirectorIfRunning();
  hideAllErrors();
  $hide('#review');
  hideToast();
  resetSession();
  state.mode = null;
  state.preset = null;
  state.activeReviewId = null;
  clearReference();
  if (state.lastObjectUrl) { URL.revokeObjectURL(state.lastObjectUrl); state.lastObjectUrl = null; }
  state.lastBlob = null;
  resetRefTransform();
  resetCueTransform();
  resetRefBarTransform();
  $('#cue-card').hidden = true;
  $('#cue-tab').hidden = true;
  $('#overlay').style.display = 'none';
  $('#overlay').removeAttribute('src');
  $('#overlay').classList.remove('draggable');
  $('#opacity-bar').hidden = true;
  $('#refbar-tab').hidden = true;
  showScreen('home');
  if (typeof updateDirectorHud === 'function') updateDirectorHud();
}

function resetSession() {
  for (const rec of state.session) {
    if (rec.fullUrl) URL.revokeObjectURL(rec.fullUrl);
    if (rec.thumbUrl && rec.thumbUrl !== rec.fullUrl) URL.revokeObjectURL(rec.thumbUrl);
  }
  state.session = [];
  renderGallery();
}

document.querySelectorAll('[data-go="home"]').forEach(b => b.addEventListener('click', goHome));
document.querySelectorAll('[data-go="presets"]').forEach(b => b.addEventListener('click', () => {
  buildPresetGrid();
  showScreen('presets');
}));

function buildPresetGrid() {
  const grid = $('#preset-grid');
  if (grid.dataset.built) return;
  grid.dataset.built = '1';
  PRESETS.forEach((p, i) => {
    const card = document.createElement('button');
    card.className = 'preset-card';
    card.innerHTML = `
      <div class="num">0${i+1}</div>
      <div>
        <div class="name">${p.name}</div>
        <div class="blurb">${p.blurb}</div>
      </div>`;
    card.addEventListener('click', () => openPreset(p.id));
    grid.appendChild(card);
  });
}

function openPreset(id) {
  const p = PRESETS.find(x => x.id === id);
  if (!p) return;
  track('situation_opened');
  if (state.preset !== id) resetSession();
  stopDirectorIfRunning();
  state.mode = 'preset';
  state.preset = id;
  $('#shoot-title').textContent = p.name;
  $('#cue-stand').textContent = p.stand;
  $('#cue-pose').textContent = p.pose;
  $('#cue-frame').textContent = p.frame;
  setCuesLoading(false);
  $('#cue-card').hidden = false;
  collapseCueInitial();
  resetRefBarTransform();
  $('#opacity-bar').hidden = true;
  $('#overlay').style.display = 'none';
  $('#overlay').removeAttribute('src');
  $('#overlay').classList.remove('draggable');
  clearReference();
  renderGallery();
  enterShoot();
}

// Initial state when a situation is opened: card tucked away off-screen, only
// the CUES tab is visible. No animation on entry to avoid a flash.
function collapseCueInitial() {
  cueXform.tucked = true;
  cueXform.x = 0; cueXform.y = 0;
  $('#cue-card').classList.remove('animating');
  applyCueTransform();
  $('#cue-tab').hidden = false;
}

function clearReference() {
  if (state.refUrl && state.refUrl.startsWith('blob:')) {
    URL.revokeObjectURL(state.refUrl);
  }
  state.refUrl = null;
}

// ---------- Cue's curated pose gallery (Copy-a-photo · Browse poses) ----------
function renderCuePosesGallery() {
  const root = $('#cue-poses-scroll');
  if (root.dataset.built) return;
  root.dataset.built = '1';
  for (const group of getCuratedPoseGroups()) {
    const section = document.createElement('div');
    section.className = 'cue-poses-section';
    const h3 = document.createElement('h3');
    h3.className = 'cue-poses-section-title';
    h3.textContent = group.label;
    section.appendChild(h3);
    const grid = document.createElement('div');
    grid.className = 'cue-poses-grid';
    for (const path of group.samples) {
      const tile = document.createElement('button');
      tile.className = 'cue-pose-tile';
      tile.dataset.path = path;
      tile.innerHTML = '<img alt="" />';
      tile.querySelector('img').src = path;
      tile.addEventListener('click', () => useCuratedPose(path));
      grid.appendChild(tile);
    }
    section.appendChild(grid);
    root.appendChild(section);
  }
}

async function useCuratedPose(path) {
  // Same flow as uploading a reference from your own photos.
  state.mode = 'paste';
  state.preset = null;
  $('#shoot-title').textContent = 'Copy a photo';
  $('#cue-card').hidden = false;
  setCuesLoading(true);
  $('#cue-stand').textContent = '';
  $('#cue-pose').textContent  = '';
  $('#cue-frame').textContent = '';
  // Start the cue card tucked behind the CUES pill — enterShoot's
  // auto-expand will reveal it briefly so the user knows it's there.
  collapseCueInitial();
  resetSession();
  renderGallery();
  activateReference(path);
  enterShoot();
  // Fetch the curated image as a Blob so we can run the same reference-
  // breakdown call we use for user uploads.
  try {
    const blob = await fetch(path).then(r => r.blob());
    fetchReferenceBreakdown(blob);
  } catch (err) {
    console.warn('[Cue] curated pose breakdown failed:', err);
    setCuesLoading(false);
  }
}

// ---------- Shared reference-overlay activation ----------
function activateReference(src) {
  clearReference();
  state.refUrl = src;
  resetRefTransform();
  const ov = $('#overlay');
  ov.onload = () => { ov.style.display = 'block'; };
  ov.onerror = () => {
    if (state.mode === 'paste') {
      alert('Couldn’t load that photo. If it’s a HEIC from iPhone, screenshot the photo first, then upload the screenshot.');
    }
    deactivateReference();
  };
  ov.src = src;
  ov.style.display = 'block';
  ov.style.opacity = '0.45';
  $('#opacity').value = 45;
  $('#opacity-bar').hidden = false;
  $('#overlay').classList.add('draggable');
  // Default state: bar tucked behind the REFERENCE pill at top-right.
  refBarXform.x = 0; refBarXform.y = 0; refBarXform.tucked = true;
  $('#opacity-bar').classList.remove('animating');
  applyRefBarTransform();
  updateOpacityBarLayout();
  updateRefBarPillVisibility();
}

function deactivateReference() {
  clearReference();
  const ov = $('#overlay');
  ov.onload = null;
  ov.onerror = null;
  ov.style.display = 'none';
  ov.removeAttribute('src');
  resetRefTransform();
  resetRefBarTransform();
  $('#opacity-bar').hidden = true;
  $('#refbar-tab').hidden = true;
  $('#overlay').classList.remove('draggable');
  updateOpacityBarLayout();
}

function updateOpacityBarLayout() {
  const bar = $('#opacity-bar');
  const stacked = state.mode === 'preset' && state.session.length > 0 && !bar.hidden;
  bar.classList.toggle('with-gallery', stacked);
  if (typeof updateRefBarTabLayout === 'function') updateRefBarTabLayout();
}

// Home tile → step into the Copy-a-photo source picker (upload vs curated).
$('#choice-paste').addEventListener('click', () => {
  showScreen('paste-options');
});

// Source picker — pick a photo from your phone gallery.
$('#choice-paste-upload').addEventListener('click', () => {
  $('#ref-input').click();
});

// Source picker — browse Cue's curated poses.
$('#choice-paste-curated').addEventListener('click', () => {
  renderCuePosesGallery();
  showScreen('cue-poses');
});

$('#btn-cue-poses-back').addEventListener('click', () => {
  showScreen('paste-options');
});

$('#ref-input').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  state.mode = 'paste';
  state.preset = null;
  $('#shoot-title').textContent = 'Copy a photo';

  // Cue card is used in paste mode too — start it tucked behind the CUES
  // pill, then enterShoot's auto-expand reveals it briefly.
  $('#cue-card').hidden = false;
  setCuesLoading(true);
  $('#cue-stand').textContent = '';
  $('#cue-pose').textContent = '';
  $('#cue-frame').textContent = '';
  collapseCueInitial();
  resetSession();
  renderGallery();
  activateReference(URL.createObjectURL(file));
  enterShoot();

  // Kick off AI breakdown in the background.
  fetchReferenceBreakdown(file);
});

function setCuesLoading(loading) {
  $('#cue-card').classList.toggle('is-loading', loading);
  $('#cues-loading').hidden = !loading;
}

async function fetchReferenceBreakdown(file) {
  // Always populate the cue text (or fallbacks) — even if the user has
  // navigated away mid-call. Skipping it leaves the card with the loading
  // class removed but no cue rows ever populated, which is exactly the
  // "Reading photo… then nothing" bug. Setting harmless text is safe.
  let populated = false;
  try {
    const small  = await downscaleBlob(file, 1280);
    const b64    = await blobToBase64(small);
    const res    = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'reference_breakdown', imageBase64: b64 }),
      signal: evaluateTimeoutSignal(),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.warn('[Cue] /api/analyze non-OK:', res.status, errBody);
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || typeof data.stand !== 'string') {
      console.warn('[Cue] /api/analyze bad shape:', data);
      throw new Error('bad shape');
    }
    $('#cue-stand').textContent = data.stand || '—';
    $('#cue-pose').textContent  = data.pose  || '—';
    $('#cue-frame').textContent = data.frame || '—';
    populated = true;
  } catch (err) {
    console.warn('[Cue] reference breakdown failed:', err);
    $('#cue-stand').textContent = 'Match the angle and distance you see.';
    $('#cue-pose').textContent  = 'Copy the body position and where they look.';
    $('#cue-frame').textContent = 'Frame it like the reference.';
    populated = true;
  } finally {
    setCuesLoading(false);
    // Briefly auto-expand the now-populated cue card so the user actually
    // sees the result of the AI breakdown, then it collapses back to the
    // pill per the clean default state.
    if (populated) autoExpandCuesAfterLoad();
  }
}

$('#btn-remove-overlay').addEventListener('click', () => {
  const wasPaste = state.mode === 'paste';
  deactivateReference();
  if (wasPaste) goHome();
});

$('#opacity').addEventListener('input', (e) => {
  $('#overlay').style.opacity = String((+e.target.value) / 100);
});

$('#btn-mirror').addEventListener('click', () => {
  state.refMirrored = !state.refMirrored;
  applyRefTransform();
});

$('#btn-reset').addEventListener('click', () => {
  resetRefTransform();
});

function applyRefTransform() {
  const ov = $('#overlay');
  const mx = state.refMirrored ? -1 : 1;
  ov.style.transform =
    `translate(${refXform.x}px, ${refXform.y}px) ` +
    `rotate(${refXform.rot}deg) ` +
    `scale(${refXform.scale * mx}, ${refXform.scale})`;
}

function resetRefTransform() {
  refXform.x = 0; refXform.y = 0;
  refXform.scale = 1; refXform.rot = 0;
  state.refMirrored = false;
  applyRefTransform();
}

// ---------- Reference gesture handling (preset Poses + Copy-a-photo) ----------
// Bound at the DOCUMENT level in the CAPTURE phase. This sidesteps iOS Safari
// quirks around touch events on <img> elements with pointer-events: auto and
// guarantees we see every touch before any element-level handler runs. For
// each touchstart we look at document.elementFromPoint(): if it's inside a
// button / card / control we let the normal tap flow happen; otherwise, if a
// reference is loaded, we drive the same refXform that activateReference()
// applies — so the visible #overlay <img> follows the finger.
(() => {
  let baseXform = null;
  let start = null;

  const dist  = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  const angle = (a, b) => Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180 / Math.PI;

  const SKIP_SEL = [
    'button', 'input', 'a',
    '#cue-card', '#cue-tab',
    '#opacity-bar', '#refbar-tab', '#gallery', '.bar-top', '#review',
    '#screen-home', '#screen-presets',
  ].join(', ');

  function begin(touches) {
    if (touches.length === 1) {
      start = { mode: 'pan', x: touches[0].clientX, y: touches[0].clientY };
    } else if (touches.length >= 2) {
      start = {
        mode: 'pinch',
        dist:  dist(touches[0], touches[1]),
        angle: angle(touches[0], touches[1]),
      };
    }
    baseXform = { ...refXform };
  }

  function onStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    if (!state.refUrl) return;
    if (!screens.shoot.classList.contains('active')) return;
    const hit = document.elementFromPoint(t.clientX, t.clientY) || e.target;
    if (hit && hit.closest && hit.closest(SKIP_SEL)) return;
    e.preventDefault();
    begin(e.touches);
  }

  function onMove(e) {
    if (!start || !baseXform) return;
    e.preventDefault();
    if (start.mode === 'pan' && e.touches.length === 1) {
      refXform.x = baseXform.x + (e.touches[0].clientX - start.x);
      refXform.y = baseXform.y + (e.touches[0].clientY - start.y);
    } else if (start.mode === 'pinch' && e.touches.length >= 2) {
      const d = dist(e.touches[0], e.touches[1]);
      const a = angle(e.touches[0], e.touches[1]);
      refXform.scale = Math.max(0.2, Math.min(8, baseXform.scale * (d / start.dist)));
      refXform.rot   = baseXform.rot + (a - start.angle);
    }
    applyRefTransform();
  }

  function onEnd(e) {
    if (!start) return;
    if (e.touches.length === 0) {
      start = null; baseXform = null;
    } else {
      // Finger count changed mid-gesture — rebase from what's still down.
      begin(e.touches);
    }
  }

  document.addEventListener('touchstart',  onStart, { capture: true, passive: false });
  document.addEventListener('touchmove',   onMove,  { capture: true, passive: false });
  document.addEventListener('touchend',    onEnd,   { capture: true, passive: false });
  document.addEventListener('touchcancel', onEnd,   { capture: true, passive: false });
})();

// ---------- Cue-card drag + tuck ----------
function applyCueTransform() {
  const card = $('#cue-card');
  if (cueXform.tucked) {
    card.style.transform = 'translate(0, -200%)';
    card.style.opacity = '0';
    card.style.pointerEvents = 'none';
  } else {
    card.style.transform = `translate(${cueXform.x}px, ${cueXform.y}px)`;
    card.style.opacity = '';
    card.style.pointerEvents = '';
  }
}

function resetCueTransform() {
  cueXform.x = 0; cueXform.y = 0; cueXform.tucked = false;
  $('#cue-card').classList.remove('animating');
  $('#cue-tab').hidden = true;
  applyCueTransform();
}

function setCueAnimating() {
  const card = $('#cue-card');
  card.classList.add('animating');
  setTimeout(() => card.classList.remove('animating'), 240);
}

function tuckCue() {
  cueXform.tucked = true;
  setCueAnimating();
  applyCueTransform();
  $('#cue-tab').hidden = false;
}

function untuckCue() {
  cueXform.tucked = false;
  cueXform.x = 0; cueXform.y = 0;
  setCueAnimating();
  applyCueTransform();
  $('#cue-tab').hidden = true;
}

(() => {
  const card = $('#cue-card');
  let drag = null;

  function onStart(e) {
    if (card.hidden || cueXform.tucked) return;
    if (e.touches.length !== 1) return;
    // Don't initiate drag if the touch started on the collapse button; let it
    // become a click.
    if (e.target.closest('#btn-cue-collapse')) return;
    drag = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      baseX:  cueXform.x,
      baseY:  cueXform.y,
    };
    card.classList.remove('animating');
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag) return;
    // Multi-touch frames during a one-finger gesture (iOS phantom touches,
    // a stray edge touch) — just skip this frame, don't kill the drag.
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - drag.startX;
    const dy = e.touches[0].clientY - drag.startY;
    cueXform.x = drag.baseX + dx;
    cueXform.y = drag.baseY + dy;
    applyCueTransform();
    e.preventDefault();
  }

  function onEnd(e) {
    if (!drag) return;
    // Only end the drag once every finger is up.
    if (e && e.touches && e.touches.length > 0) return;
    drag = null;
    const r = card.getBoundingClientRect();
    const margin = 40;
    const W = window.innerWidth, H = window.innerHeight;
    const off =
      r.right  < margin ||
      r.left   > W - margin ||
      r.bottom < margin ||
      r.top    > H - margin;
    if (off) tuckCue();
  }

  card.addEventListener('touchstart',  onStart, { passive: false });
  card.addEventListener('touchmove',   onMove,  { passive: false });
  card.addEventListener('touchend',    onEnd,   { passive: false });
  card.addEventListener('touchcancel', onEnd,   { passive: false });
})();

$('#cue-tab').addEventListener('click', () => {
  if (cueXform.tucked) openCuesPanel();
  else closeAllPanels();
});
$('#btn-cue-collapse').addEventListener('click', (e) => {
  e.stopPropagation();
  tuckCue();
});
$('#btn-refbar-collapse').addEventListener('click', (e) => {
  e.stopPropagation();
  tuckRefBar();
});

// ---------- Reference-bar drag + tuck (same pattern as cue card) ----------
function applyRefBarTransform() {
  const bar = $('#opacity-bar');
  if (refBarXform.tucked) {
    // Bar lives at the top now — tuck UP off-screen.
    bar.style.transform = 'translate(0, -130%)';
    bar.style.opacity = '0';
    bar.style.pointerEvents = 'none';
  } else {
    bar.style.transform = `translate(${refBarXform.x}px, ${refBarXform.y}px)`;
    bar.style.opacity = '';
    bar.style.pointerEvents = '';
  }
}

function resetRefBarTransform() {
  refBarXform.x = 0; refBarXform.y = 0; refBarXform.tucked = false;
  $('#opacity-bar').classList.remove('animating');
  applyRefBarTransform();
  updateRefBarPillVisibility();
}

function setRefBarAnimating() {
  const bar = $('#opacity-bar');
  bar.classList.add('animating');
  setTimeout(() => bar.classList.remove('animating'), 240);
}

function tuckRefBar() {
  refBarXform.tucked = true;
  setRefBarAnimating();
  applyRefBarTransform();
  updateRefBarPillVisibility();
  updateRefBarTabLayout();
}

function untuckRefBar() {
  refBarXform.tucked = false;
  refBarXform.x = 0; refBarXform.y = 0;
  setRefBarAnimating();
  applyRefBarTransform();
  $('#refbar-tab').hidden = true;
}

// ---------- Panel coordinator (mutual exclusion + tap-out + auto-collapse) ----------
// Only one of [cues, refbar] can be open at a time. Open one → close the other.
// Tap the camera viewfinder → both close. Take a shot → both close.
function openCuesPanel() {
  if (state.mode === 'preset' || state.mode === 'paste') {
    if (!refBarXform.tucked) tuckRefBar();
    if ( cueXform.tucked)   untuckCue();
  }
}
function openRefBarPanel() {
  if (state.mode !== 'paste' || !state.refUrl) return;       // REFERENCE only in paste mode
  if (!cueXform.tucked)     tuckCue();
  if ( refBarXform.tucked)  untuckRefBar();
}
function closeAllPanels() {
  if (!cueXform.tucked    && $('#cue-card').hidden    === false) tuckCue();
  if (!refBarXform.tucked && $('#opacity-bar').hidden === false) tuckRefBar();
}

// Hide REFERENCE pill outside paste mode entirely; reveal it whenever a paste
// reference is loaded. Called from the various lifecycle hooks below.
function updateRefBarPillVisibility() {
  const tab = $('#refbar-tab');
  if (state.mode === 'paste' && state.refUrl) {
    // Only show when the bar itself is hidden behind it.
    if (refBarXform.tucked) tab.hidden = false;
  } else {
    tab.hidden = true;
  }
}

// Auto-expand the CUES panel briefly on shoot entry so the user sees what's
// there, then collapse it back to the pill. ~2.5s of visibility.
// Preset mode: fires immediately on entry (cues are static and ready).
// Paste mode:  fires AFTER fetchReferenceBreakdown finishes (the AI takes
//              several seconds — flashing "Reading photo…" briefly and then
//              collapsing before the cues arrive is worse than not opening
//              at all).
let _autoExpandTimer = null;
let _autoExpandOpenTimer = null;
function autoExpandCuesOnEntry() {
  if (state.mode === 'paste') return;
  scheduleAutoExpand();
}
function autoExpandCuesAfterLoad() {
  if (state.mode !== 'paste') return;
  if (!screens.shoot.classList.contains('active')) return;
  scheduleAutoExpand();
}
function scheduleAutoExpand() {
  if (_autoExpandTimer)     { clearTimeout(_autoExpandTimer);     _autoExpandTimer     = null; }
  if (_autoExpandOpenTimer) { clearTimeout(_autoExpandOpenTimer); _autoExpandOpenTimer = null; }
  _autoExpandOpenTimer = setTimeout(() => { openCuesPanel();  _autoExpandOpenTimer = null; }, 60);
  _autoExpandTimer     = setTimeout(() => { closeAllPanels(); _autoExpandTimer     = null; }, 2560);
}

// Layout helper kept as a no-op now that the REFERENCE pill lives at a
// fixed top-right corner; callers still reference it from a few places.
function updateRefBarTabLayout() { /* no-op */ }

(() => {
  const bar = $('#opacity-bar');
  let drag = null;

  function onStart(e) {
    if (bar.hidden || refBarXform.tucked) return;
    if (e.touches.length !== 1) return;
    // Don't start a drag if the touch landed on a button (Mirror/Reset/Remove)
    // or the opacity slider — let those tap/slide normally.
    if (e.target.closest('button, input')) return;
    drag = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      baseX:  refBarXform.x,
      baseY:  refBarXform.y,
    };
    bar.classList.remove('animating');
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag) return;
    // Multi-touch frames during a one-finger drag — skip, don't kill.
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - drag.startX;
    const dy = e.touches[0].clientY - drag.startY;
    refBarXform.x = drag.baseX + dx;
    refBarXform.y = drag.baseY + dy;
    applyRefBarTransform();
    e.preventDefault();
  }

  function onEnd(e) {
    if (!drag) return;
    if (e && e.touches && e.touches.length > 0) return;
    drag = null;
    const r = bar.getBoundingClientRect();
    const margin = 40;
    const W = window.innerWidth, H = window.innerHeight;
    const off =
      r.right  < margin ||
      r.left   > W - margin ||
      r.bottom < margin ||
      r.top    > H - margin;
    if (off) tuckRefBar();
  }

  bar.addEventListener('touchstart',  onStart, { passive: false });
  bar.addEventListener('touchmove',   onMove,  { passive: false });
  bar.addEventListener('touchend',    onEnd,   { passive: false });
  bar.addEventListener('touchcancel', onEnd,   { passive: false });
})();

$('#refbar-tab').addEventListener('click', () => {
  if (refBarXform.tucked) openRefBarPanel();
  else closeAllPanels();
});

function enterShoot() {
  showScreen('shoot');
  $hide('#review');
  // Clean default state — both panels collapsed to pills, then briefly
  // auto-expand CUES so the user knows what's there.
  closeAllPanels();
  updateRefBarPillVisibility();
  autoExpandCuesOnEntry();
  startCamera().then(() => maybeStartDirector());
}

function isSecure() {
  return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

function applyVideoAttrs(video) {
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('muted', '');
  video.setAttribute('autoplay', '');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
}

// Play the video with silent retries to absorb iOS Safari's AbortError on the
// first play after attaching a fresh MediaStream. Only after retries fail do
// we fall back to the "Tap to start camera" UI.
async function playWithRetries(video, maxAttempts = 4) {
  let lastErr = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await video.play();
      return true;
    } catch (err) {
      lastErr = err;
      const name = err && err.name;
      if (name === 'NotAllowedError') {
        // True autoplay-blocked — only resolvable by a user gesture.
        return false;
      }
      // AbortError, AbortError-like, or anything else: wait briefly and retry.
      // The interval grows slightly each pass.
      await new Promise(r => setTimeout(r, 120 + i * 180));
    }
  }
  console.warn('[Cue] play() retries exhausted:', lastErr);
  return false;
}

async function startCamera() {
  if (state.starting) return;
  state.starting = true;
  try {
    hideAllErrors();
    if (!isSecure()) { $show('#cam-https'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('This browser doesn’t support camera access.');
      return;
    }

    stopCamera();
    const video = $('#video');
    applyVideoAttrs(video);
    video.classList.toggle('mirror-self', state.facingMode === 'user');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: state.facingMode },
          width:  { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
    } catch (err1) {
      // Retry once without constraints; some devices choke on resolution hints.
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err2) {
        if (err2 && (err2.name === 'NotAllowedError' || err2.name === 'SecurityError')) {
          $show('#cam-denied');
        } else if (err2 && err2.name === 'NotFoundError') {
          showError('No camera found on this device.');
        } else {
          showError(`Couldn’t open camera. ${err2 && err2.name ? err2.name : 'Error'}`);
        }
        return;
      }
    }

    state.stream = stream;
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
      showError('Camera track did not start. Close other apps using the camera and try again.');
      return;
    }

    video.srcObject = stream;

    // Wait until the video element actually has dimensions.
    await new Promise((resolve) => {
      if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
      let done = false;
      const finish = () => { if (done) return; done = true; cleanup(); resolve(); };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', finish);
        video.removeEventListener('loadeddata', finish);
        video.removeEventListener('canplay', finish);
      };
      video.addEventListener('loadedmetadata', finish);
      video.addEventListener('loadeddata', finish);
      video.addEventListener('canplay', finish);
      setTimeout(finish, 2000);
    });

    const ok = await playWithRetries(video);
    if (ok) {
      $hide('#cam-tap');
    } else {
      // Only surface the tap-to-start UI once retries are exhausted.
      $show('#cam-tap');
    }
  } finally {
    state.starting = false;
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => { try { t.stop(); } catch(e){} });
    state.stream = null;
  }
  const v = $('#video');
  if (v) { try { v.pause(); } catch(e){}; v.srcObject = null; }
}

$('#btn-tap-start').addEventListener('click', async () => {
  $hide('#cam-tap');
  const v = $('#video');
  applyVideoAttrs(v);
  const ok = await playWithRetries(v);
  if (!ok) $show('#cam-tap');
});

$('#btn-reload').addEventListener('click', () => location.reload());
$('#btn-retry').addEventListener('click', () => startCamera());

$('#btn-back').addEventListener('click', goHome);

$('#btn-flip').addEventListener('click', () => {
  stopDirectorIfRunning();
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  startCamera().then(() => maybeStartDirector());
  updateDirectorHud();
});

$('#btn-shoot').addEventListener('click', () => {
  closeAllPanels();
  capture();
});

// Tap-to-close: tapping the live camera viewfinder (i.e. anywhere on the
// shoot screen that ISN'T a panel, pill, button, or top bar) collapses the
// open panel back to the pills.
$('#screen-shoot').addEventListener('click', (e) => {
  const t = e.target;
  if (!t || !t.closest) return;
  if (t.closest(
    '#cue-card, #opacity-bar, #cue-tab, #refbar-tab, ' +
    '#btn-back, #btn-flip, #btn-shoot, #btn-cue-collapse, ' +
    '.bar-top, .gallery, #review, #director-toast, .home-icon-btn'
  )) return;
  closeAllPanels();
});

function capture() {
  const video = $('#video');
  const canvas = $('#canvas');
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) {
    showError('Camera isn’t ready yet. Give it a second and try again.');
    return;
  }

  // Compute crop region based on user's aspect-ratio setting.
  let sx = 0, sy = 0, sw = vw, sh = vh;   // source from video
  if (settings.aspect === '9:16') {
    const targetRatio = 9 / 16;            // width / height
    const native = vw / vh;
    if (native > targetRatio) {            // too wide → crop sides
      sw = vh * targetRatio;
      sx = (vw - sw) / 2;
    } else if (native < targetRatio) {     // too tall → crop top/bottom
      sh = vw / targetRatio;
      sy = (vh - sh) / 2;
    }
  }
  canvas.width  = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext('2d');
  ctx.save();
  if (state.facingMode === 'user') {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  try {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  } catch (e) {
    showError('Couldn’t capture the frame. Try again.');
    return;
  }
  ctx.restore();

  // LOCKED SHOOT FLOW — do not change as a side effect of other work.
  // Capture is silent in EVERY mode: the live camera stays up, the shot
  // drops into the bottom thumbnail strip, the AI check runs in the
  // background and surfaces only as the badge on that thumbnail. The
  // photo opens full-screen ONLY when the user taps its thumbnail.
  const onBlob = (blob) => {
    track('photo_taken');
    addSessionPhoto(blob);
    // Always save every shot to the local IndexedDB gallery — survives
    // reloads and is the source for "My shots" + bulk save to Photos.
    if (blob) saveShotToLocalGallery(blob);
  };

  // canvas.toBlob with a toDataURL fallback for iOS Safari quirks.
  let done = false;
  const handle = (src) => {
    if (done) return; done = true;
    if (src instanceof Blob) return onBlob(src);
    onBlob(dataUrlToBlob(src));
  };
  try {
    canvas.toBlob((blob) => {
      if (blob) handle(blob);
      else handle(canvas.toDataURL('image/jpeg', 0.92));
    }, 'image/jpeg', 0.92);
  } catch (e) {
    handle(canvas.toDataURL('image/jpeg', 0.92));
  }
  setTimeout(() => { if (!done) handle(canvas.toDataURL('image/jpeg', 0.92)); }, 1000);
}

function dataUrlToBlob(dataUrl) {
  const [, b64 = ''] = dataUrl.split(',');
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'image/jpeg' });
}

// ---------- Session gallery + background analysis (all shoot modes) ----------
async function addSessionPhoto(fullBlob) {
  if (!fullBlob) return;
  const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Tiny thumb (~160px) for the strip so we don't paint the full image at 56×56.
  let thumbBlob;
  try { thumbBlob = await downscaleBlob(fullBlob, 160); }
  catch { thumbBlob = fullBlob; }

  const rec = {
    id,
    fullBlob,
    fullUrl:  URL.createObjectURL(fullBlob),
    thumbUrl: URL.createObjectURL(thumbBlob),
    status:   'pending',
    result:   null,
  };
  state.session.push(rec);
  renderGallery();

  // Background analyze. Never blocks shooting.
  runBackgroundAnalyze(rec);
}

async function runBackgroundAnalyze(rec) {
  // Daily quota: if we're out for today, skip the API entirely.
  // The photo is already saved to the local gallery; we just don't coach.
  if (!coachQuota.consume()) {
    // Loud on purpose: "every shot shows only ✨ Photo saved" is exactly
    // what quota exhaustion looks like — make it one console glance.
    console.warn('[Cue] coaching quota exhausted — check skipped, resets at local midnight');
    rec.status = 'error';                  // hidden badge; "✨ Photo saved" copy
    updateThumbBadge(rec.id, 'error');
    updateCoachLimitTag();
    if (state.activeReviewId === rec.id) showResultsError();
    return;
  }
  track('ai_check_run');
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  try {
    // Downscale aggressively — the model only needs to read the body in
    // the frame, not pixel-peep. 768 longest-edge @ q=0.7 cuts payload
    // ~10× vs 1568 @ 0.85, slashing upload + decode time.
    const small = await downscaleBlob(rec.fullBlob, 768, 0.7);
    const photoB64 = await blobToBase64(small);
    if (typeof console !== 'undefined') {
      console.log('[Cue] evaluate payload',
        { srcBytes: rec.fullBlob.size, smallBytes: small.size, b64Bytes: photoB64.length });
    }
    const body = { imageBase64: photoB64, mediaType: 'image/jpeg' };
    if (state.mode === 'paste') {
      // Copy-a-photo: judge against the reference image. If the reference
      // can't be fetched, send the photo alone — general criteria beat
      // no check at all.
      const refBlob = await fetchRefBlob();
      if (refBlob) {
        const smallRef = await downscaleBlob(refBlob, 768, 0.7);
        body.reference          = await blobToBase64(smallRef);
        body.referenceMediaType = 'image/jpeg';
      }
    } else {
      const p = PRESETS.find(x => x.id === state.preset);
      if (!p) throw new Error('no preset');
      body.presetCues = { stand: p.stand, pose: p.pose, frame: p.frame };
    }
    const res = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: evaluateTimeoutSignal(),
    });
    // Read as text first so a non-JSON body (HTML error page, gateway
    // timeout, killed function) is logged verbatim with the exact
    // JSON.parse error instead of vanishing into a generic catch.
    const resText = await res.text();
    if (!res.ok) {
      console.warn('[Cue] /api/evaluate non-OK:', res.status, resText.slice(0, 500));
      throw new Error(`HTTP ${res.status}`);
    }
    let data;
    try { data = JSON.parse(resText); }
    catch (parseErr) {
      console.warn('[Cue] /api/evaluate non-JSON response:',
        parseErr.message, '— raw:', resText.slice(0, 500));
      throw parseErr;
    }
    if (!data || !Array.isArray(data.cues)) {
      console.warn('[Cue] /api/evaluate bad shape:', data);
      throw new Error('bad shape');
    }
    rec.result = data;
    rec.status = thumbStatusFromEvaluation(data);
    updateThumbBadge(rec.id, rec.status);
    if (state.activeReviewId === rec.id) renderResults(data);
    if (rec.status === 'good') showGotItToast();
    maybeShowCoachLimitNotice();
    if (typeof console !== 'undefined') {
      console.log('[Cue] evaluate done', { ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)) });
    }
  } catch (err) {
    console.warn('[Cue] evaluate failed:', err);
    rec.status = 'error';
    updateThumbBadge(rec.id, 'error');
    if (state.activeReviewId === rec.id) showResultsError();
  }
}

// Map a /api/evaluate response to the existing thumbnail-status palette:
//   all four cues 'pass'                  → 'good'   (sage check)
//   any 'fix' OR multiple 'adjust'        → 'partial' (amber dot)
//   one 'adjust' only                     → 'partial' (amber dot)
//   missing data                          → 'error'
function thumbStatusFromEvaluation(data) {
  if (!data || !Array.isArray(data.cues)) return 'error';
  const verdicts = data.cues.map(c => (c.verdict || '').toLowerCase());
  if (verdicts.every(v => v === 'pass')) return 'good';
  return 'partial';
}

function renderGallery() {
  const g = $('#gallery');
  const inShootMode = state.mode === 'preset' || state.mode === 'paste';
  if (!inShootMode || state.session.length === 0) {
    g.hidden = true;
    g.innerHTML = '';
    updateOpacityBarLayout();
    return;
  }
  g.hidden = false;
  g.innerHTML = '';
  for (const rec of state.session) {
    const btn = document.createElement('button');
    btn.className = 'thumb';
    btn.dataset.id = rec.id;
    btn.setAttribute('aria-label', 'Open photo');
    btn.innerHTML = `
      <img alt="" />
      <span class="thumb-badge ${rec.status}"></span>`;
    btn.querySelector('img').src = rec.thumbUrl;
    btn.querySelector('.thumb-badge').textContent = badgeChar(rec.status);
    btn.addEventListener('click', () => openPresetDetail(rec.id));
    g.appendChild(btn);
  }
  updateOpacityBarLayout();
  // Scroll to end so the newest is visible.
  requestAnimationFrame(() => { g.scrollLeft = g.scrollWidth; });
}

function updateThumbBadge(id, status) {
  const btn = $(`.thumb[data-id="${id}"]`);
  if (!btn) return;
  const b = btn.querySelector('.thumb-badge');
  if (!b) return;
  b.className = `thumb-badge ${status}`;
  b.textContent = badgeChar(status);
}

function badgeChar(s) {
  if (s === 'good') return '✓';
  if (s === 'error') return '';   // check unavailable — badge is hidden via CSS
  return '•';
}

function openPresetDetail(id) {
  const rec = state.session.find(r => r.id === id);
  if (!rec) return;
  state.activeReviewId = id;
  $('#review-img').src = rec.fullUrl;
  $('#btn-retake').hidden = true;
  $('#btn-delete').hidden = false;
  $('#btn-review-close').hidden = false;
  if (rec.status === 'pending') resetResults();
  else if (rec.status === 'error') showResultsError();
  else if (rec.result) renderResults(rec.result);
  else showResultsError();
  $show('#review');
}

function closeReview() {
  state.activeReviewId = null;
  $hide('#review');
  $('#review-img').removeAttribute('src');
}

// ---------- Toast ----------
function showGotItToast() {
  const t = $('#toast');
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  t.classList.remove('toast-out');
  // Restart entry animation by toggling hidden.
  t.hidden = true;
  // eslint-disable-next-line no-unused-expressions
  void t.offsetWidth;
  t.hidden = false;
  toastTimer = setTimeout(() => {
    t.classList.add('toast-out');
    toastTimer = setTimeout(() => {
      t.hidden = true;
      t.classList.remove('toast-out');
      toastTimer = null;
    }, 260);
  }, 1700);
}
function hideToast() {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  const t = $('#toast');
  t.hidden = true;
  t.classList.remove('toast-out');
}

// Show the once-per-day "10 coached shots" notice — only fires the first
// time today's quota lands exactly at the cap, and only after the shot's
// results have already painted so it doesn't interrupt the review flow.
function maybeShowCoachLimitNotice() {
  if (!coachQuota.shouldShowLimitNotice()) return;
  coachQuota.markLimitNoticeShown();
  updateCoachLimitTag();
  const el = $('#coach-limit-notice');
  if (!el) return;
  // Small delay so the notice arrives *after* the user sees their cues.
  setTimeout(() => { el.hidden = false; }, 700);
}
function hideCoachLimitNotice() {
  const el = $('#coach-limit-notice');
  if (el) el.hidden = true;
}
$('#coach-limit-notice-ok').addEventListener('click', hideCoachLimitNotice);
$('#coach-limit-notice-backdrop').addEventListener('click', hideCoachLimitNotice);

// Tiny "coaching back tomorrow" tag on the shoot screen — visible only
// when today's credits are gone, and only while the shoot screen is active.
function updateCoachLimitTag() {
  const tag = $('#coach-limit-tag');
  if (!tag) return;
  const onShoot = $('#screen-shoot') && $('#screen-shoot').classList.contains('active');
  tag.hidden = !(onShoot && !coachQuota.canCoach());
}

// Retake — paste path only. Closes the review and returns to camera.
$('#btn-retake').addEventListener('click', async () => {
  $hide('#review');
  resetResults();
  if (state.lastObjectUrl) { URL.revokeObjectURL(state.lastObjectUrl); state.lastObjectUrl = null; }
  state.lastBlob = null;
  $('#review-img').removeAttribute('src');

  const video = $('#video');
  const trackLive = state.stream && state.stream.getVideoTracks().some(t => t.readyState === 'live');
  if (!trackLive) {
    await startCamera();
    return;
  }
  const ok = await playWithRetries(video);
  if (!ok) $show('#cam-tap');
});

// Close review (preset detail) — camera is still running underneath.
$('#btn-review-close').addEventListener('click', closeReview);

// Delete the photo currently being reviewed (preset session).
$('#btn-delete').addEventListener('click', () => {
  const id = state.activeReviewId;
  if (!id) return;
  const idx = state.session.findIndex(r => r.id === id);
  if (idx >= 0) {
    const rec = state.session[idx];
    if (rec.fullUrl) URL.revokeObjectURL(rec.fullUrl);
    if (rec.thumbUrl && rec.thumbUrl !== rec.fullUrl) URL.revokeObjectURL(rec.thumbUrl);
    state.session.splice(idx, 1);
  }
  closeReview();
  renderGallery();
});

function getActiveSaveBlob() {
  if (state.activeReviewId) {
    const rec = state.session.find(r => r.id === state.activeReviewId);
    if (rec) return { blob: rec.fullBlob, url: rec.fullUrl };
  }
  return { blob: state.lastBlob, url: state.lastObjectUrl };
}

// Auto-save path — fires from inside capture() when settings.autoSave is on.
// Mirrors the manual Save button: tries Web Share with the file (iOS / modern
// Android share sheet → Save Image), falls back to opening the blob in a new
// tab so the user can long-press → "Save to Photos", and finally a synthetic
// <a download> click for non-iOS browsers.
async function autoSaveBlob(blob) {
  if (!blob) return;
  const filename = `cue-${Date.now()}.jpg`;
  if (navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: 'Cue photo' });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank');
  if (!opened) {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
}

// ---------- Email-to-save gate ----------
// The whole app is open anonymously; only the save/download action asks
// (once per device, ever) for an email before proceeding. The address is
// stored in Supabase as a record — Cue never sends any email to anyone.
const emailGate = (() => {
  const KEY = 'cue-email-captured';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  let pendingResolve = null;

  function captured() {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  }
  function markCaptured() {
    try { localStorage.setItem(KEY, '1'); } catch {}
  }

  function close(result) {
    $('#email-gate').hidden = true;
    $('#email-gate-error').hidden = true;
    const r = pendingResolve;
    pendingResolve = null;
    if (r) r(result);
  }

  async function submit() {
    const input = $('#email-gate-input');
    const btn   = $('#email-gate-submit');
    const email = (input.value || '').trim();
    if (!EMAIL_RE.test(email)) {
      $('#email-gate-error').hidden = false;
      input.focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    // Store the address (best-effort, short timeout). The user's save
    // proceeds either way — the gate must never eat a photo.
    try {
      await fetch('/api/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
        signal: evaluateTimeoutSignal(8000),
      });
    } catch (err) {
      console.warn('[Cue] email store failed:', err);
    }
    markCaptured();
    track('email_captured');
    btn.disabled = false;
    btn.textContent = 'Save my shot';
    close(true);
  }

  // Wire up once.
  $('#email-gate-submit').addEventListener('click', submit);
  $('#email-gate-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
  $('#email-gate-input').addEventListener('input', () => {
    $('#email-gate-error').hidden = true;
  });
  $('#email-gate-close').addEventListener('click', () => close(false));
  $('#email-gate-backdrop').addEventListener('click', () => close(false));

  return {
    /** Resolves true when saving may proceed, false if the user backed out. */
    async unlock() {
      if (captured()) return true;
      return new Promise((resolve) => {
        pendingResolve = resolve;
        $('#email-gate-error').hidden = true;
        $('#email-gate').hidden = false;
        setTimeout(() => $('#email-gate-input').focus(), 150);
      });
    },
  };
})();

$('#btn-save').addEventListener('click', async (e) => {
  e.preventDefault();
  if (!(await emailGate.unlock())) return;
  const { blob, url } = getActiveSaveBlob();
  if (!blob && !url) return;
  const filename = `cue-${Date.now()}.jpg`;

  if (blob && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: 'Cue photo' });
        track('photo_saved');
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  const openUrl = url || (blob ? URL.createObjectURL(blob) : $('#review-img').src);
  const opened = window.open(openUrl, '_blank');
  if (!opened) {
    const a = document.createElement('a');
    a.href = openUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
  track('photo_saved');
});

// ---------- Post-shot check (renders /api/evaluate output) ----------
function resetResults() {
  $show('#results-loading');
  $hide('#results-content');
  $hide('#results-error');
  $('#checks-list').innerHTML = '';
  $('#overall').textContent = '';
  $('#top-fix-text').textContent = '';
  $hide('#top-fix');
}

// The AI check is a bonus layer, never a dependency. When it can't run
// (no credits, rate limit, offline), we show a quiet "✨ Photo saved"
// note — the shot is already in the local gallery either way.
function showResultsError() {
  $hide('#results-loading');
  $hide('#results-content');
  $show('#results-error');
}

// Evaluate calls get a hard timeout so a hung connection can't leave the
// "Checking your shot…" spinner up forever. Falls back to AbortController
// for older Safari without AbortSignal.timeout.
function evaluateTimeoutSignal(ms = 25000) {
  try {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      return AbortSignal.timeout(ms);
    }
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
  } catch { return undefined; }
}

// Per-verdict label and icon used in the cue rows.
const VERDICT_META = {
  pass:   { label: 'Pass',   icon: '✓' },
  adjust: { label: 'Adjust', icon: '~' },
  fix:    { label: 'Fix',    icon: '!' },
};

function renderResults(data) {
  const list = $('#checks-list');
  list.innerHTML = '';
  const cues = Array.isArray(data.cues) ? data.cues : [];
  for (const c of cues) {
    const raw = (c && typeof c.verdict === 'string') ? c.verdict.toLowerCase() : 'adjust';
    const verdict = VERDICT_META[raw] ? raw : 'adjust';
    const meta = VERDICT_META[verdict];
    const li = document.createElement('li');
    li.className = `check verdict-${verdict}`;
    li.innerHTML = `
      <span class="check-icon ${verdict}">${meta.icon}</span>
      <div class="check-body">
        <span class="check-label"></span>
        <div class="check-note"></div>
      </div>`;
    li.querySelector('.check-label').textContent = (c.cue || '').toString().toUpperCase();
    li.querySelector('.check-note').textContent  = c.feedback || '';
    list.appendChild(li);
  }
  // "Overall" row no longer present in the new schema — leave empty.
  $('#overall').textContent = '';
  // "One thing for the retake" — only render when present and non-empty.
  const oneThing = (data.one_thing || '').trim();
  if (oneThing) {
    $('#top-fix-text').textContent = oneThing;
    $show('#top-fix');
  } else {
    $hide('#top-fix');
  }
  $hide('#results-loading');
  $hide('#results-error');
  $show('#results-content');
}

async function downscaleBlob(blob, maxDim, quality = 0.85) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * ratio));
      const h = Math.max(1, Math.round(img.naturalHeight * ratio));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => resolve(b || blob), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(r.error || new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}

async function fetchRefBlob() {
  if (!state.refUrl) return null;
  try { return await fetch(state.refUrl).then(r => r.blob()); }
  catch { return null; }
}

// ---------- Live director (distance pill on Standing, rear camera) ----------
let directorModule  = null;
let directorActive  = false;
let lastObservation = null;
const DIRECTOR_VER = '20260605u';

// Per-situation distance thresholds — pose bbox height as a fraction of
// frame. Wide windows so the user lands in them without micro-adjusting.
// Each situation frames the body differently:
//   dinner   — sitting at a table, half-body visible alongside surface
//   walking  — full body, room to walk into ahead of them
//   standing — full body against a wall
//   sitting  — full body on a cafe seat/bench/steps
//   golden   — full body with the sun, low angle
//   full     — head-to-toe outfit shot, more of the body fills the frame
//   paste    — fallback for Copy-a-photo (no preset id) — generic full body
// Dinner & Sitting cover desk/table situations where the legs are usually
// hidden — pose bbox height is unreliable there because the lower body
// isn't detected. Windows are deliberately very wide for those two so the
// pill almost never fires false positives. The other situations keep
// tighter, more meaningful ranges.
const DISTANCE_THRESHOLDS = {
  dinner:   { min: 0.20, max: 0.85 },
  walking:  { min: 0.40, max: 0.72 },
  standing: { min: 0.45, max: 0.72 },
  sitting:  { min: 0.20, max: 0.85 },
  golden:   { min: 0.40, max: 0.72 },
  full:     { min: 0.30, max: 0.58 },
  _paste:   { min: 0.35, max: 0.78 },
};

function currentDistanceThresholds() {
  if (state.mode === 'preset' && DISTANCE_THRESHOLDS[state.preset]) {
    return DISTANCE_THRESHOLDS[state.preset];
  }
  if (state.mode === 'paste') return DISTANCE_THRESHOLDS._paste;
  return DISTANCE_THRESHOLDS._paste; // safe default
}

function directorShouldRun() {
  if (!screens.shoot.classList.contains('active')) return false;
  if (state.facingMode !== 'environment') return false;
  if (state.mode === 'preset' && state.preset) return true;
  if (state.mode === 'paste'  && state.refUrl) return true;
  return false;
}

async function maybeStartDirector() {
  if (!directorShouldRun()) {
    stopDirectorIfRunning();
    return;
  }
  if (directorActive) return;
  try {
    if (!directorModule) {
      directorModule = await import(`./director.js?v=${DIRECTOR_VER}`);
    }
    setDirectorToast('');
    const ok = await directorModule.loadDirector();
    if (!ok) return;
    if (!directorShouldRun()) return;
    directorModule.startDirector($('#video'), onDirectorObservation);
    directorActive = true;
  } catch (err) {
    console.warn('[Cue] director init failed:', err);
  }
}

function stopDirectorIfRunning() {
  if (directorModule && directorActive) {
    try { directorModule.stopDirector(); } catch (e) { /* noop */ }
  }
  directorActive  = false;
  lastObservation = null;
  setDirectorToast('');
}

function onDirectorObservation(obs) {
  lastObservation = obs;
  if (!directorShouldRun()) { setDirectorToast(''); return; }
  const dist = evaluateDistance(obs);
  setDirectorToast(
    dist.verdict !== 'good' && dist.verdict !== 'searching' ? dist.text : ''
  );
}

// Universal "way too close" backstop — when the subject fills most of the
// frame's WIDTH, they're clearly too close even if the height signal is
// muddy (Sitting / Dinner with legs hidden, partial body crops, etc.).
// 0.80 lets normal full-body shots pass but catches the genuine close-ups.
const TOO_CLOSE_WIDTH = 0.80;

function evaluateDistance(obs) {
  const t = currentDistanceThresholds();
  if (!obs.detected) return { verdict: 'searching', text: '' };
  const h = obs.bbox.height;
  const w = obs.bbox.width;
  // Width-based "too close" backstop runs first so it catches situations
  // where the height threshold is intentionally wide (Sitting / Dinner).
  if (w > TOO_CLOSE_WIDTH) return { verdict: 'close', text: 'Move farther away' };
  if (h < t.min) return { verdict: 'far',   text: 'Move closer' };
  if (h > t.max) return { verdict: 'close', text: 'Move farther away' };
  return { verdict: 'good', text: '' };
}

let _toastHideTimer = null;
function setDirectorToast(text) {
  const el = $('#director-toast');
  if (!el) return;
  if (text) {
    if (_toastHideTimer) { clearTimeout(_toastHideTimer); _toastHideTimer = null; }
    el.classList.remove('fading');
    el.hidden = false;
    if (el.textContent !== text) el.textContent = text;
  } else if (!el.hidden) {
    el.classList.add('fading');
    if (_toastHideTimer) clearTimeout(_toastHideTimer);
    _toastHideTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('fading');
      _toastHideTimer = null;
    }, 260);
  }
}

// HUD was a Stage 2/3 calibration tool — removed from the UI. Keep the
// no-op so existing call sites compile without churn.
function updateDirectorHud() { /* intentionally empty */ }

// ---------- Settings sheet ----------
function openSettings() {
  renderSettings();
  const sheet = $('#settings-sheet');
  sheet.classList.remove('closing');
  sheet.hidden = false;
}

function closeSettings() {
  const sheet = $('#settings-sheet');
  if (sheet.hidden) return;
  sheet.classList.add('closing');
  setTimeout(() => {
    sheet.classList.remove('closing');
    sheet.hidden = true;
  }, 260);
}

function renderSettings() {
  document.querySelectorAll('.settings-pill[data-aspect]').forEach(el => {
    el.classList.toggle('selected', el.dataset.aspect === settings.aspect);
  });
}

$('#btn-settings').addEventListener('click', openSettings);
$('#btn-settings-close').addEventListener('click', () => closeSettings());
$('#settings-backdrop').addEventListener('click', () => closeSettings());

document.querySelectorAll('.settings-pill[data-aspect]').forEach(el => {
  el.addEventListener('click', () => {
    settings.aspect = el.dataset.aspect;
    persistSettings();
    renderSettings();
  });
});

// (Auto-save toggle removed — every shot now goes to "My shots" automatically;
// bulk save to Photos lives in that gallery.)

// ---------- My shots: local IndexedDB gallery + UI ----------

// Object URLs currently mounted into the grid — revoked on screen exit.
let _galleryUrls   = [];
let _galleryItems  = [];   // [{ id, thumbBlob, ... }]
let _selectMode    = false;
let _selectedIds   = new Set();

async function saveShotToLocalGallery(blob) {
  try {
    // 800px at 0.92 quality keeps tile thumbnails crisp at 3x DPR on the
    // 3-column grid (each tile renders at ~125 CSS px → ~375 device px).
    const thumbBlob = await downscaleBlob(blob, 800, 0.92);
    const mod = await gallery();
    await mod.saveShot(blob, thumbBlob, {
      mode:    state.mode || '',
      context: state.preset || '',
    });
    refreshGalleryBadge();
  } catch (err) {
    console.warn('[Cue] gallery save failed:', err);
  }
}

async function refreshGalleryBadge() {
  const el = $('#home-gallery-count');
  if (!el) return;
  try {
    const mod = await gallery();
    const n = await mod.countShots();
    if (n > 0) {
      el.hidden = false;
      el.textContent = n > 99 ? '99+' : String(n);
    } else {
      el.hidden = true;
    }
  } catch { /* ignore */ }
}

async function openGalleryScreen() {
  showScreen('gallery');
  exitSelectMode();
  await renderGalleryGrid();
}

function exitSelectMode() {
  _selectMode = false;
  _selectedIds.clear();
  $('#screen-gallery').classList.remove('select-mode', 'has-actions');
  $('#btn-gallery-select').textContent = 'Select';
  $('#gallery-actions').hidden = true;
  updateBulkActionButtons();
}

function enterSelectMode() {
  _selectMode = true;
  _selectedIds.clear();
  $('#screen-gallery').classList.add('select-mode', 'has-actions');
  $('#btn-gallery-select').textContent = 'Done';
  $('#gallery-actions').hidden = false;
  updateBulkActionButtons();
  // Repaint to clear any prior visual selection.
  document.querySelectorAll('.gallery-tile').forEach(t => t.classList.remove('selected'));
}

function updateBulkActionButtons() {
  const n = _selectedIds.size;
  const save = $('#btn-gallery-save');
  const del  = $('#btn-gallery-delete');
  save.textContent = n > 0 ? `Save ${n} to Photos` : 'Save to Photos';
  del.textContent  = n > 0 ? `Delete ${n}` : 'Delete';
  save.disabled = n === 0;
  del.disabled  = n === 0;
}

async function renderGalleryGrid() {
  // Revoke previous URLs.
  for (const u of _galleryUrls) URL.revokeObjectURL(u);
  _galleryUrls = [];
  const grid  = $('#gallery-grid');
  const empty = $('#gallery-empty');
  grid.innerHTML = '';

  let items;
  try { const mod = await gallery(); items = await mod.listShots(); }
  catch { items = []; }
  _galleryItems = items;

  if (!items.length) {
    grid.hidden = true;
    empty.hidden = false;
    $('#btn-gallery-select').hidden = true;
    return;
  }
  grid.hidden = false;
  empty.hidden = true;
  $('#btn-gallery-select').hidden = false;

  for (const it of items) {
    const tile = document.createElement('button');
    tile.className = 'gallery-tile';
    tile.dataset.id = String(it.id);
    const url = URL.createObjectURL(it.thumbBlob);
    _galleryUrls.push(url);
    tile.innerHTML = '<img alt="" /><span class="gallery-check">✓</span>';
    tile.querySelector('img').src = url;
    tile.addEventListener('click', () => onGalleryTileTap(it.id, tile));
    // Long-press to enter select mode.
    let pressTimer = null;
    tile.addEventListener('touchstart', () => {
      if (_selectMode) return;
      pressTimer = setTimeout(() => {
        enterSelectMode();
        toggleSelected(it.id, tile);
      }, 380);
    }, { passive: true });
    tile.addEventListener('touchend',   () => { if (pressTimer) clearTimeout(pressTimer); });
    tile.addEventListener('touchmove',  () => { if (pressTimer) clearTimeout(pressTimer); });
    tile.addEventListener('touchcancel',() => { if (pressTimer) clearTimeout(pressTimer); });
    grid.appendChild(tile);
  }
}

function onGalleryTileTap(id, tileEl) {
  if (_selectMode) { toggleSelected(id, tileEl); return; }
  // Outside select mode, a single tap opens a fullscreen preview.
  openGalleryPreview(id);
}

// ---------- Single-photo fullscreen preview ----------
let _previewId  = null;
let _previewUrl = null;

async function openGalleryPreview(id) {
  try {
    const mod = await gallery();
    const blob = await mod.getShotBlob(id);
    if (!blob) return;
    if (_previewUrl) URL.revokeObjectURL(_previewUrl);
    _previewId  = id;
    _previewUrl = URL.createObjectURL(blob);
    $('#gallery-preview-img').src = _previewUrl;
    $('#gallery-preview').hidden = false;
  } catch (err) {
    console.warn('[Cue] preview failed:', err);
  }
}

function closeGalleryPreview() {
  $('#gallery-preview').hidden = true;
  $('#gallery-preview-img').removeAttribute('src');
  if (_previewUrl) { URL.revokeObjectURL(_previewUrl); _previewUrl = null; }
  _previewId = null;
}

$('#btn-gallery-preview-close').addEventListener('click', closeGalleryPreview);

$('#btn-gallery-preview-share').addEventListener('click', async () => {
  if (_previewId == null) return;
  if (!(await emailGate.unlock())) return;
  await shareSingleFromGallery(_previewId);
});

$('#btn-gallery-preview-delete').addEventListener('click', async () => {
  if (_previewId == null) return;
  if (!confirm("Delete this shot? This can't be undone.")) return;
  try {
    const mod = await gallery();
    await mod.deleteShots([_previewId]);
    closeGalleryPreview();
    await renderGalleryGrid();
    await refreshGalleryBadge();
  } catch (err) {
    console.warn('[Cue] preview delete failed:', err);
  }
});

function toggleSelected(id, tileEl) {
  if (_selectedIds.has(id)) {
    _selectedIds.delete(id);
    tileEl.classList.remove('selected');
  } else {
    _selectedIds.add(id);
    tileEl.classList.add('selected');
  }
  updateBulkActionButtons();
}

async function shareSingleFromGallery(id) {
  try {
    const mod = await gallery();
    const blob = await mod.getShotBlob(id);
    if (!blob) return;
    const filename = `cue-${id}.jpg`;
    if (navigator.canShare) {
      const file = new File([blob], filename, { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] }) && navigator.share) {
        try { await navigator.share({ files: [file], title: 'Cue photo' }); track('photo_saved'); return; }
        catch (err) { if (err && err.name === 'AbortError') return; }
      }
    }
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, '_blank');
    if (!opened) {
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
    }
    track('photo_saved');
  } catch (err) {
    console.warn('[Cue] share failed:', err);
  }
}

$('#btn-home-gallery').addEventListener('click', () => openGalleryScreen());

$('#btn-gallery-select').addEventListener('click', () => {
  if (_selectMode) exitSelectMode();
  else enterSelectMode();
});

$('#btn-gallery-delete').addEventListener('click', async () => {
  if (_selectedIds.size === 0) return;
  const n = _selectedIds.size;
  if (!confirm(`Delete ${n} shot${n === 1 ? '' : 's'} from My shots? This can't be undone.`)) return;
  try {
    const mod = await gallery();
    await mod.deleteShots([..._selectedIds]);
    exitSelectMode();
    await renderGalleryGrid();
    await refreshGalleryBadge();
  } catch (err) {
    console.warn('[Cue] delete failed:', err);
  }
});

$('#btn-gallery-save').addEventListener('click', async () => {
  if (_selectedIds.size === 0) return;
  if (!(await emailGate.unlock())) return;
  try {
    const mod = await gallery();
    const ids = [..._selectedIds];
    const results = await mod.getShotsBlobs(ids);
    const files = results
      .filter(r => r.blob)
      .map((r, i) => new File([r.blob], `cue-${r.id}.jpg`, { type: 'image/jpeg' }));
    if (!files.length) return;
    if (navigator.canShare && navigator.canShare({ files }) && navigator.share) {
      try {
        await navigator.share({ files, title: 'Cue photos' });
        track('photo_saved');
        // iOS does not signal "saved to Photos" specifically; close select mode
        // either way so the UI feels resolved.
        exitSelectMode();
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.warn('[Cue] bulk share failed:', err);
      }
    } else {
      // No Web Share with files — fall back to downloading each one.
      for (const f of files) {
        const url = URL.createObjectURL(f);
        const a = document.createElement('a');
        a.href = url; a.download = f.name;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
      track('photo_saved');
      exitSelectMode();
    }
  } catch (err) {
    console.warn('[Cue] bulk save failed:', err);
  }
});

refreshGalleryBadge();

buildPresetGrid();
showScreen('home');

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCamera();
    stopDirectorIfRunning();
    updateDirectorHud();
  } else if (screens.shoot.classList.contains('active') && !state.starting && !state.stream) {
    startCamera().then(() => maybeStartDirector());
  }
});
