// Cue — photo-coaching camera (vanilla JS, client-side only)

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
  home: $('#screen-home'),
  presets: $('#screen-presets'),
  shoot: $('#screen-shoot')
};

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
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
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
  closePoses(true); $('#btn-poses').hidden = true;
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
  renderPoses();
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

function renderPoses() {
  const chip = $('#btn-poses');
  if (state.mode !== 'preset' || !state.preset) {
    chip.hidden = true;
    closePoses(true);
    return;
  }
  const p = PRESETS.find(x => x.id === state.preset);
  if (!p || !p.samples || p.samples.length === 0) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  chip.classList.toggle('has-selection', !!state.refUrl);
  // Populate the sheet's grid (used when the sheet opens).
  const grid = $('#poses-grid');
  grid.innerHTML = '';
  for (const path of p.samples) {
    const tile = document.createElement('button');
    tile.className = 'pose-tile' + (state.refUrl === path ? ' selected' : '');
    tile.dataset.path = path;
    tile.innerHTML = '<img alt="" />';
    tile.querySelector('img').src = path;
    tile.addEventListener('click', () => {
      selectSample(path);
      closePoses();
    });
    grid.appendChild(tile);
  }
  $('#btn-poses-clear').hidden = !state.refUrl;
}

function openPoses() {
  const sheet = $('#poses-sheet');
  sheet.classList.remove('closing');
  sheet.hidden = false;
}

function closePoses(immediate) {
  const sheet = $('#poses-sheet');
  if (sheet.hidden) return;
  if (immediate) {
    sheet.classList.remove('closing');
    sheet.hidden = true;
    return;
  }
  sheet.classList.add('closing');
  // Match the longer of the two close animations.
  setTimeout(() => {
    sheet.classList.remove('closing');
    sheet.hidden = true;
  }, 280);
}

$('#btn-poses').addEventListener('click', openPoses);
$('#btn-poses-close').addEventListener('click', () => closePoses());
$('#poses-backdrop').addEventListener('click', () => closePoses());
$('#btn-poses-clear').addEventListener('click', () => {
  clearSampleOverlay();
  closePoses();
});

// ---------- Shared reference-overlay activation ----------
// Both the preset "Poses" path and the Copy-a-photo path call activateReference
// so they get IDENTICAL behavior: same overlay element, opacity slider,
// Mirror/Reset/Remove chips, drag/pinch/rotate gesture surface.
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
  updateOpacityBarLayout();
  updateRefBarTabLayout();
  renderPoses();
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
  renderPoses();
}

// Kept as an alias for the Poses-sheet "Clear overlay" link.
const clearSampleOverlay = deactivateReference;

function selectSample(path) {
  if (state.refUrl === path) {
    deactivateReference();
    return;
  }
  activateReference(path);
}

function updateOpacityBarLayout() {
  const bar = $('#opacity-bar');
  const stacked = state.mode === 'preset' && state.session.length > 0 && !bar.hidden;
  bar.classList.toggle('with-gallery', stacked);
  if (typeof updateRefBarTabLayout === 'function') updateRefBarTabLayout();
}

$('#choice-paste').addEventListener('click', () => $('#ref-input').click());

$('#ref-input').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  state.mode = 'paste';
  state.preset = null;
  $('#shoot-title').textContent = 'Copy a photo';

  // Cue card is now used in paste mode too — start expanded with a loading
  // state, then fill from /api/analyze (mode: reference_breakdown).
  $('#cue-card').hidden = false;
  $('#cue-tab').hidden = true;
  cueXform.x = 0; cueXform.y = 0; cueXform.tucked = false;
  $('#cue-card').classList.remove('animating');
  applyCueTransform();
  setCuesLoading(true);
  $('#cue-stand').textContent = '';
  $('#cue-pose').textContent = '';
  $('#cue-frame').textContent = '';

  resetRefBarTransform();
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
  try {
    const small  = await downscaleBlob(file, 1280);
    const b64    = await blobToBase64(small);
    const res    = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'reference_breakdown', imageBase64: b64 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data.stand !== 'string') throw new Error('bad shape');
    // Only apply if still in paste mode (user might have navigated away).
    if (state.mode !== 'paste') return;
    $('#cue-stand').textContent = data.stand || '—';
    $('#cue-pose').textContent  = data.pose  || '—';
    $('#cue-frame').textContent = data.frame || '—';
  } catch (err) {
    console.warn('[Cue] reference breakdown failed:', err);
    if (state.mode !== 'paste') return;
    $('#cue-stand').textContent = 'Match the angle and distance you see.';
    $('#cue-pose').textContent  = 'Copy the body position and where they look.';
    $('#cue-frame').textContent = 'Frame it like the reference.';
  } finally {
    if (state.mode === 'paste') setCuesLoading(false);
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
    '#cue-card', '#cue-tab', '#btn-poses', '#poses-sheet',
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
  setTimeout(() => card.classList.remove('animating'), 360);
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

$('#cue-tab').addEventListener('click', untuckCue);
$('#btn-cue-collapse').addEventListener('click', (e) => {
  e.stopPropagation();
  tuckCue();
});

// ---------- Reference-bar drag + tuck (same pattern as cue card) ----------
function applyRefBarTransform() {
  const bar = $('#opacity-bar');
  if (refBarXform.tucked) {
    bar.style.transform = 'translate(0, 220%)';
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
  $('#refbar-tab').hidden = true;
  applyRefBarTransform();
}

function setRefBarAnimating() {
  const bar = $('#opacity-bar');
  bar.classList.add('animating');
  setTimeout(() => bar.classList.remove('animating'), 360);
}

function tuckRefBar() {
  refBarXform.tucked = true;
  setRefBarAnimating();
  applyRefBarTransform();
  $('#refbar-tab').hidden = false;
  updateRefBarTabLayout();
}

function untuckRefBar() {
  refBarXform.tucked = false;
  refBarXform.x = 0; refBarXform.y = 0;
  setRefBarAnimating();
  applyRefBarTransform();
  $('#refbar-tab').hidden = true;
}

function updateRefBarTabLayout() {
  // Mirror the opacity bar's vertical position so the tab lands where the
  // bar would normally sit.
  const stacked = state.mode === 'preset' && state.session.length > 0;
  $('#refbar-tab').classList.toggle('with-gallery', stacked);
}

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

$('#refbar-tab').addEventListener('click', untuckRefBar);

function enterShoot() {
  showScreen('shoot');
  $hide('#review');
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

$('#btn-shoot').addEventListener('click', capture);

function capture() {
  const video = $('#video');
  const canvas = $('#canvas');
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) {
    showError('Camera isn’t ready yet. Give it a second and try again.');
    return;
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.save();
  if (state.facingMode === 'user') {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  try {
    ctx.drawImage(video, 0, 0, w, h);
  } catch (e) {
    showError('Couldn’t capture the frame. Try again.');
    return;
  }
  ctx.restore();

  const onBlob = (blob) => {
    if (state.mode === 'preset') addSessionPhoto(blob);
    else finishPasteReview(blob);
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

// ---------- PASTE: existing immediate-review behavior ----------
function finishPasteReview(blob) {
  if (state.lastObjectUrl) { URL.revokeObjectURL(state.lastObjectUrl); state.lastObjectUrl = null; }
  state.lastBlob = blob;
  state.lastObjectUrl = URL.createObjectURL(blob);
  state.activeReviewId = null;
  $('#review-img').src = state.lastObjectUrl;
  $('#btn-retake').hidden = false;
  $('#btn-delete').hidden = true;
  $('#btn-review-close').hidden = true;
  $show('#review');
  analyzeShot(blob);
}

// ---------- PRESET: session gallery, background analysis ----------
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
  try {
    const small = await downscaleBlob(rec.fullBlob, 1024);
    const photoB64 = await blobToBase64(small);
    const p = PRESETS.find(x => x.id === state.preset);
    if (!p) throw new Error('no preset');
    const body = {
      mode: 'preset',
      situation: p.name,
      cues: { stand: p.stand, pose: p.pose, frame: p.frame },
      imageBase64: photoB64,
    };
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.checks)) throw new Error('bad shape');
    rec.result = data;
    rec.status = data.gotIt ? 'good' : 'partial';
    updateThumbBadge(rec.id, rec.status);
    if (state.activeReviewId === rec.id) renderResults(data);
    if (data.gotIt) showGotItToast();
  } catch (err) {
    console.warn('[Cue] analyze failed:', err);
    rec.status = 'error';
    updateThumbBadge(rec.id, 'error');
    if (state.activeReviewId === rec.id) showResultsError();
  }
}

function renderGallery() {
  const g = $('#gallery');
  if (state.mode !== 'preset' || state.session.length === 0) {
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
  if (s === 'error') return '—';
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

$('#btn-save').addEventListener('click', async (e) => {
  e.preventDefault();
  const { blob, url } = getActiveSaveBlob();
  if (!blob && !url) return;
  const filename = `cue-${Date.now()}.jpg`;

  if (blob && navigator.canShare) {
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

  const openUrl = url || (blob ? URL.createObjectURL(blob) : $('#review-img').src);
  const opened = window.open(openUrl, '_blank');
  if (!opened) {
    const a = document.createElement('a');
    a.href = openUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
});

// ---------- Post-shot check ----------
function resetResults() {
  $show('#results-loading');
  $hide('#results-content');
  $hide('#results-error');
  $('#checks-list').innerHTML = '';
  $('#overall').textContent = '';
  $('#top-fix-text').textContent = '';
  $hide('#top-fix');
}

function showResultsError() {
  $hide('#results-loading');
  $hide('#results-content');
  $show('#results-error');
}

function renderResults(data) {
  const list = $('#checks-list');
  list.innerHTML = '';
  const checks = Array.isArray(data.checks) ? data.checks : [];
  for (const c of checks) {
    const status = (c && typeof c.status === 'string') ? c.status.toLowerCase() : 'close';
    const cls = ['good','close','missed'].includes(status) ? status : 'close';
    const icon = cls === 'good' ? '✓' : cls === 'close' ? '~' : '–';
    const li = document.createElement('li');
    li.className = 'check';
    li.innerHTML = `
      <span class="check-icon ${cls}">${icon}</span>
      <div class="check-body">
        <span class="check-label"></span>
        <div class="check-note"></div>
      </div>`;
    li.querySelector('.check-label').textContent = c.label || '';
    li.querySelector('.check-note').textContent = c.note || '';
    list.appendChild(li);
  }
  $('#overall').textContent = data.overall || '';
  if (data.topFix) {
    $('#top-fix-text').textContent = data.topFix;
    $show('#top-fix');
  } else {
    $hide('#top-fix');
  }
  $hide('#results-loading');
  $hide('#results-error');
  $show('#results-content');
}

async function downscaleBlob(blob, maxDim) {
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
      c.toBlob(b => resolve(b || blob), 'image/jpeg', 0.85);
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

async function analyzeShot(photoBlob) {
  resetResults();
  try {
    const smallPhoto = await downscaleBlob(photoBlob, 1280);
    const photoB64 = await blobToBase64(smallPhoto);

    let body;
    if (state.mode === 'preset') {
      const p = PRESETS.find(x => x.id === state.preset);
      if (!p) return showResultsError();
      body = {
        mode: 'preset',
        situation: p.name,
        cues: { stand: p.stand, pose: p.pose, frame: p.frame },
        imageBase64: photoB64,
      };
    } else if (state.mode === 'paste') {
      const refBlob = await fetchRefBlob();
      if (!refBlob) return showResultsError();
      const smallRef = await downscaleBlob(refBlob, 1280);
      const refB64 = await blobToBase64(smallRef);
      body = { mode: 'paste', imageBase64: photoB64, referenceBase64: refB64 };
    } else {
      return showResultsError();
    }

    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.checks)) throw new Error('Bad response shape');
    renderResults(data);
  } catch (err) {
    console.warn('[Cue] analyze failed:', err);
    showResultsError();
  }
}

// ---------- Live director (Stage 3: distance + tilt on Standing) ----------
let directorModule  = null;
let directorActive  = false;
let lastObservation = null;
const DIRECTOR_VER = '20260605u';

// Per-situation distance thresholds — pose bbox height as fraction of frame.
// Wide window so the user lands in it without micro-adjusting; the AI
// post-shot check refines anything subtle.
const DISTANCE_THRESHOLDS = {
  standing: { min: 0.45, max: 0.72 },
};

// Tilt thresholds — beta is pitch (90° = phone vertical in portrait),
// gamma is roll. Wide window — flags obvious mistakes (phone pointed at
// the ceiling, phone rolled sideways), not millimetre angle perfection.
const TILT_THRESHOLDS = {
  standing: { pitchMin: 58, pitchMax: 88, rollMax: 18 },
};

// Position check — bbox.top is where the topmost landmark (≈ head) sits
// in the frame, 0 = top edge, 1 = bottom.
//   too high (top < topMin) → head is being cropped off the top
//   too low  (top > topMax) → phone climbed up to chest/face level
// Wide acceptance window — the AI post-shot picks up subtleties.
const POSITION_THRESHOLDS = {
  standing: { topMin: 0.05, topMax: 0.22 },
};

const tiltState = {
  permission: 'unknown',  // 'unknown' | 'unavailable' | 'pending' | 'granted' | 'denied'
  beta:  null,
  gamma: null,
  listenerAdded: false,
  ts: 0,
};


function directorShouldRun() {
  return (
    state.mode === 'preset' &&
    state.preset === 'standing' &&
    state.facingMode === 'environment' &&
    screens.shoot.classList.contains('active')
  );
}

async function maybeStartDirector() {
  if (!directorShouldRun()) {
    stopDirectorIfRunning();
    updateDirectorHud();
    return;
  }
  if (directorActive) {
    setupTilt();
    updateDirectorHud();
    return;
  }
  try {
    if (!directorModule) {
      directorModule = await import(`./director.js?v=${DIRECTOR_VER}`);
    }
    setDirectorToast('');
    updateDirectorHud();
    setupTilt();
    const ok = await directorModule.loadDirector();
    if (!ok) { updateDirectorHud(); return; }
    if (!directorShouldRun()) { updateDirectorHud(); return; }
    directorModule.startDirector($('#video'), onDirectorObservation);
    directorActive = true;
    updateDirectorHud();
  } catch (err) {
    console.warn('[Cue] director init failed:', err);
    updateDirectorHud();
  }
}

function stopDirectorIfRunning() {
  if (directorModule && directorActive) {
    try { directorModule.stopDirector(); } catch (e) { /* noop */ }
  }
  directorActive  = false;
  lastObservation = null;
  setDirectorToast('');
  setShutterGo(false);
  $('#tilt-enable').hidden = true;
}

function onDirectorObservation(obs) {
  lastObservation = obs;
  updateCombinedVerdict();
}

function updateCombinedVerdict() {
  if (state.preset !== 'standing') {
    setDirectorToast('');
    setShutterGo(false);
    updateDirectorHud();
    return;
  }
  const obs = lastObservation;
  if (!obs) { updateDirectorHud(); return; }

  const dist = evaluateStandingDistance(obs);
  const pos  = evaluateStandingPosition(obs);
  const tilt = evaluateTilt(tiltState.beta, tiltState.gamma);

  // Pill priority: distance → phone-height-via-head-position → tilt →
  // "please grant the level sensor" nudge.
  let pill = '';
  if (dist.verdict !== 'good' && dist.verdict !== 'searching') {
    pill = dist.text;
  } else if (pos.verdict !== 'good' && pos.verdict !== 'searching') {
    pill = pos.text;
  } else if (tilt.verdict !== 'good' && tilt.verdict !== 'unknown') {
    pill = tilt.text;
  } else if (tilt.verdict === 'unknown' && dist.verdict === 'good' &&
             pos.verdict === 'good' && tiltState.permission !== 'unavailable') {
    pill = 'Enable level guide';
  }
  setDirectorToast(pill);

  // Green shutter when distance, head-position, and tilt are all roughly in
  // range. This is an "you're broadly in position" signal, not a guarantee
  // the AI will love every shot — the AI post-shot check is the fine-tune.
  // No stability gate: don't make the user freeze still chasing a flicker.
  const go = dist.verdict === 'good' &&
             pos.verdict === 'good' &&
             tilt.verdict === 'good';
  setShutterGo(go);

  updateDirectorHud();
}

function evaluateStandingPosition(obs) {
  if (!obs.detected) return { verdict: 'searching', text: '' };
  const t   = POSITION_THRESHOLDS.standing;
  const top = obs.bbox.top;
  if (top < t.topMin) return { verdict: 'cropped', text: 'Tilt down a bit' };
  if (top > t.topMax) return { verdict: 'high',    text: 'Lower the phone' };
  return { verdict: 'good', text: '' };
}

function setShutterGo(on) {
  const btn = $('#btn-shoot');
  if (!btn) return;
  btn.classList.toggle('go', !!on);
}

function evaluateStandingDistance(obs) {
  const t = DISTANCE_THRESHOLDS.standing;
  if (!obs.detected) return { verdict: 'searching', text: '' };
  const h = obs.bbox.height;
  if (h < t.min) return { verdict: 'far',   text: 'Move closer' };
  if (h > t.max) return { verdict: 'close', text: 'Move farther away' };
  return { verdict: 'good', text: '' };
}

function evaluateTilt(beta, gamma) {
  if (beta == null || gamma == null) return { verdict: 'unknown', text: '' };
  const t = TILT_THRESHOLDS.standing;
  if (Math.abs(gamma) > t.rollMax) return { verdict: 'roll', text: 'Hold level' };
  if (beta < t.pitchMin) return { verdict: 'pitch_low',  text: 'Tilt down' };
  if (beta > t.pitchMax) return { verdict: 'pitch_high', text: 'Tilt up' };
  return { verdict: 'good', text: '' };
}

// ---------- Tilt sensor (DeviceOrientation) ----------
function handleDeviceOrientation(e) {
  if (e.beta == null && e.gamma == null) return;
  tiltState.beta  = e.beta;
  tiltState.gamma = e.gamma;
  tiltState.ts    = performance.now();
  updateCombinedVerdict();
}

function setupTilt() {
  if (typeof DeviceOrientationEvent === 'undefined') {
    tiltState.permission = 'unavailable';
    return;
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS — user gesture required to request permission.
    if (tiltState.permission === 'granted') {
      attachTiltListener();
      $('#tilt-enable').hidden = true;
    } else {
      $('#tilt-enable').hidden = false;
    }
  } else {
    // Android / desktop — permission not required.
    attachTiltListener();
    tiltState.permission = 'granted';
    $('#tilt-enable').hidden = true;
  }
}

function attachTiltListener() {
  if (tiltState.listenerAdded) return;
  window.addEventListener('deviceorientation', handleDeviceOrientation);
  tiltState.listenerAdded = true;
}

$('#tilt-enable').addEventListener('click', async () => {
  tiltState.permission = 'pending';
  try {
    const result = await DeviceOrientationEvent.requestPermission();
    tiltState.permission = result;
    if (result === 'granted') {
      attachTiltListener();
      $('#tilt-enable').hidden = true;
    }
  } catch (err) {
    console.warn('[tilt] permission failed:', err);
    tiltState.permission = 'denied';
  }
  updateDirectorHud();
});

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

function updateDirectorHud() {
  const hud = $('#director-hud');
  if (!hud) return;
  const visible = directorShouldRun();
  hud.hidden = !visible;
  if (!visible) return;
  const m      = directorModule;
  const mstate = m ? m.getDirectorState() : { modelState: 'idle', fps: 0, active: false, error: null, delegate: null };
  const obs    = lastObservation;
  const lines  = ['DIRECTOR · standing'];
  lines.push(`mdl: ${mstate.modelState}${mstate.delegate ? ' (' + mstate.delegate + ')' : ''}`);
  if (mstate.error) lines.push(`err: ${mstate.error.slice(0, 36)}`);
  lines.push(`fps: ${mstate.fps}`);
  let distVerdict = { verdict: 'no-obs', text: '' };
  let posVerdict  = { verdict: 'no-obs', text: '' };
  if (obs) {
    lines.push(`det: ${obs.detected ? 'Y' : 'N'}`);
    if (obs.detected) {
      const b = obs.bbox;
      lines.push(`top: ${(b.top    * 100).toFixed(0)}%`);
      lines.push(`bot: ${(b.bottom * 100).toFixed(0)}%`);
      lines.push(`h  : ${(b.height * 100).toFixed(0)}%`);
      distVerdict = evaluateStandingDistance(obs);
      posVerdict  = evaluateStandingPosition(obs);
      lines.push(`dist: ${distVerdict.verdict}`);
      lines.push(`pos : ${posVerdict.verdict}`);
    }
  }
  lines.push(`tilt-p: ${tiltState.permission}`);
  if (tiltState.beta  != null) lines.push(`β: ${tiltState.beta.toFixed(0)}°`);
  if (tiltState.gamma != null) lines.push(`γ: ${tiltState.gamma.toFixed(0)}°`);
  const tiltV = evaluateTilt(tiltState.beta, tiltState.gamma);
  lines.push(`tilt: ${tiltV.verdict}`);
  const go = distVerdict.verdict === 'good' &&
             posVerdict.verdict  === 'good' &&
             tiltV.verdict === 'good';
  lines.push(go ? '★ GO' : '○ wait');
  hud.textContent = lines.join('\n');
}

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
