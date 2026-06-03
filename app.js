// Cue — photo-coaching camera (vanilla JS, client-side only)

const PRESETS = [
  { id: 'dinner', name: 'Dinner', blurb: 'At a table, evening light',
    stand: '6 ft back, phone at her chest height',
    pose:  'turned in, hand on the table, eyes off-camera',
    frame: 'her + the table, don’t cut her hands' },
  { id: 'walking', name: 'Walking', blurb: 'Candid, in motion',
    stand: '12 ft back, crouch slightly, phone at her hip',
    pose:  'walk slowly toward you, look away, arms relaxed',
    frame: 'leave space ahead of her, shoot a burst' },
  { id: 'standing', name: 'Standing', blurb: 'Against a wall',
    stand: '8 ft back, phone at her waist, tilt up',
    pose:  'lean on the wall, weight on back foot, chin down',
    frame: 'put her in the left third, keep the wall clean' },
  { id: 'sitting', name: 'Sitting', blurb: 'Cafe, bench, steps',
    stand: '5 ft back, phone at her eye level',
    pose:  'lean in, hands relaxed, soft smile',
    frame: 'get her and the surroundings, her off-center' },
  { id: 'golden', name: 'Golden hour', blurb: 'Sun low, warm light',
    stand: '9 ft back, get low, phone at her chest',
    pose:  'face into the sun, eyes closed or looking away',
    frame: 'let the sun flare into a corner, shoot low' },
  { id: 'full', name: 'Full look', blurb: 'Head-to-toe outfit',
    stand: '12 ft back, phone at her knee height',
    pose:  'slight angle, one foot forward, hand in pocket',
    frame: 'head to shoes, room top and bottom' }
];

const $ = (sel) => document.querySelector(sel);
const screens = {
  home: $('#screen-home'),
  presets: $('#screen-presets'),
  shoot: $('#screen-shoot')
};

const state = {
  mode: null,           // 'preset' | 'paste'
  preset: null,         // preset id
  refUrl: null,         // object URL for reference image
  refMirrored: false,
  facingMode: 'environment',
  stream: null
};

// ---------- Navigation ----------
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function goHome() {
  stopCamera();
  hide('#cam-tap'); hide('#cam-denied'); hide('#cam-https'); hide('#review');
  state.mode = null;
  state.preset = null;
  if (state.refUrl) { URL.revokeObjectURL(state.refUrl); state.refUrl = null; }
  $('#overlay').style.display = 'none';
  $('#overlay').removeAttribute('src');
  showScreen('home');
}

document.querySelectorAll('[data-go="home"]').forEach(b => b.addEventListener('click', goHome));
document.querySelectorAll('[data-go="presets"]').forEach(b => b.addEventListener('click', () => {
  buildPresetGrid();
  showScreen('presets');
}));

// ---------- Preset grid ----------
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
  state.mode = 'preset';
  state.preset = id;
  $('#shoot-title').textContent = p.name;
  $('#cue-stand').textContent = p.stand;
  $('#cue-pose').textContent = p.pose;
  $('#cue-frame').textContent = p.frame;
  $('#cue-card').hidden = false;
  $('#opacity-bar').hidden = true;
  $('#overlay').style.display = 'none';
  enterShoot();
}

// ---------- Paste path ----------
$('#choice-paste').addEventListener('click', () => $('#ref-input').click());

$('#ref-input').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (state.refUrl) URL.revokeObjectURL(state.refUrl);
  state.refUrl = URL.createObjectURL(file);
  const ov = $('#overlay');
  ov.classList.remove('mirrored');
  state.refMirrored = false;
  ov.onload = () => { ov.style.display = 'block'; };
  ov.onerror = () => {
    alert('Couldn’t load that photo. If it’s a HEIC from iPhone, screenshot the photo first, then upload the screenshot.');
    ov.style.display = 'none';
  };
  ov.src = state.refUrl;
  state.mode = 'paste';
  $('#shoot-title').textContent = 'Copy a photo';
  $('#cue-card').hidden = true;
  $('#opacity-bar').hidden = false;
  $('#opacity').value = 45;
  ov.style.opacity = '0.45';
  enterShoot();
});

$('#opacity').addEventListener('input', (e) => {
  $('#overlay').style.opacity = String((+e.target.value) / 100);
});

$('#btn-mirror').addEventListener('click', () => {
  state.refMirrored = !state.refMirrored;
  $('#overlay').classList.toggle('mirrored', state.refMirrored);
});

// ---------- Shoot screen / camera ----------
function enterShoot() {
  showScreen('shoot');
  hide('#review');
  startCamera();
}

function hide(sel) { const el = $(sel); if (el) el.hidden = true; }
function show(sel) { const el = $(sel); if (el) el.hidden = false; }

function isSecure() {
  return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

async function startCamera() {
  if (!isSecure()) { show('#cam-https'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    show('#cam-https'); return;
  }

  stopCamera();
  const video = $('#video');
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.muted = true;
  video.classList.toggle('mirror-self', state.facingMode === 'user');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: state.facingMode },
        width:  { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
    state.stream = stream;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (err) {
      show('#cam-tap');
    }
  } catch (err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      show('#cam-denied');
    } else if (err && err.name === 'NotFoundError') {
      show('#cam-denied');
    } else {
      show('#cam-denied');
      console.error('Camera error:', err);
    }
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  const v = $('#video');
  if (v) v.srcObject = null;
}

$('#btn-tap-start').addEventListener('click', async () => {
  hide('#cam-tap');
  const v = $('#video');
  try { await v.play(); } catch (e) { show('#cam-tap'); }
});

$('#btn-reload').addEventListener('click', () => location.reload());

$('#btn-back').addEventListener('click', goHome);

$('#btn-flip').addEventListener('click', () => {
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
});

// ---------- Capture ----------
$('#btn-shoot').addEventListener('click', capture);

function capture() {
  const video = $('#video');
  const canvas = $('#canvas');
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // If front camera is shown mirrored on screen, capture the un-mirrored frame
  // for a natural saved photo (standard phone behavior).
  ctx.save();
  if (state.facingMode === 'user') {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();
  // IMPORTANT: only the video frame is drawn. Overlay image and cue card are NOT included.
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  $('#review-img').src = dataUrl;
  $('#btn-save').href = dataUrl;
  $('#btn-save').download = `cue-${Date.now()}.jpg`;
  show('#review');
}

$('#btn-retake').addEventListener('click', () => hide('#review'));

// ---------- Boot ----------
buildPresetGrid();
showScreen('home');

// Stop camera if the page is hidden (battery + iOS quirks)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
  else if (screens.shoot.classList.contains('active')) startCamera();
});
