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
  mode: null,
  preset: null,
  refUrl: null,
  refMirrored: false,
  facingMode: 'environment',
  stream: null,
  lastBlob: null,
  lastObjectUrl: null,
  starting: false
};

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
  hideAllErrors();
  $hide('#review');
  state.mode = null;
  state.preset = null;
  if (state.refUrl) { URL.revokeObjectURL(state.refUrl); state.refUrl = null; }
  if (state.lastObjectUrl) { URL.revokeObjectURL(state.lastObjectUrl); state.lastObjectUrl = null; }
  state.lastBlob = null;
  $('#overlay').style.display = 'none';
  $('#overlay').removeAttribute('src');
  showScreen('home');
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

function enterShoot() {
  showScreen('shoot');
  $hide('#review');
  startCamera();
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
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
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

  const finish = (src) => {
    state.lastBlob = null;
    if (state.lastObjectUrl) { URL.revokeObjectURL(state.lastObjectUrl); state.lastObjectUrl = null; }
    if (src instanceof Blob) {
      state.lastBlob = src;
      state.lastObjectUrl = URL.createObjectURL(src);
      $('#review-img').src = state.lastObjectUrl;
    } else {
      $('#review-img').src = src;
      fetch(src).then(r => r.blob()).then(b => { state.lastBlob = b; }).catch(()=>{});
    }
    $show('#review');
  };

  let toBlobCalled = false;
  try {
    canvas.toBlob((blob) => {
      toBlobCalled = true;
      if (blob) finish(blob);
      else finish(canvas.toDataURL('image/jpeg', 0.92));
    }, 'image/jpeg', 0.92);
  } catch (e) {
    finish(canvas.toDataURL('image/jpeg', 0.92));
  }
  setTimeout(() => {
    if (!toBlobCalled) finish(canvas.toDataURL('image/jpeg', 0.92));
  }, 1000);
}

$('#btn-retake').addEventListener('click', async () => {
  $hide('#review');
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

$('#btn-save').addEventListener('click', async (e) => {
  e.preventDefault();
  if (!state.lastBlob && !state.lastObjectUrl) return;
  const filename = `cue-${Date.now()}.jpg`;
  const blob = state.lastBlob;

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

  const url = state.lastObjectUrl || (blob ? URL.createObjectURL(blob) : $('#review-img').src);
  const opened = window.open(url, '_blank');
  if (!opened) {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
});

buildPresetGrid();
showScreen('home');

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCamera();
  } else if (screens.shoot.classList.contains('active') && !state.starting && !state.stream) {
    startCamera();
  }
});
