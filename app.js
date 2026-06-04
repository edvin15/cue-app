// Cue — photo-coaching camera (vanilla JS, client-side only)
// Build tag — bump whenever you push so you can confirm the phone has the new code.
const BUILD = 'BUILD 8 — 2026-06-04 ' + new Date().toISOString().slice(11, 16) + ' UTC';

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
  starting: false,
  diagTimer: null
};

// ---------- Diagnostics ----------
const diag = {
  log: [],
  lastGumError: null,
  lastPlayError: null,
  lastVideoError: null,
  attemptedGum: false,
  attemptedPlay: false,
  playOk: false,
};

function dlog(msg) {
  const stamp = new Date().toISOString().slice(11, 19);
  const line = `[${stamp}] ${msg}`;
  diag.log.push(line);
  if (diag.log.length > 40) diag.log.shift();
  console.log('[Cue]', msg);
  renderDiag();
}

function fmtErr(e) {
  if (!e) return '(none)';
  if (typeof e === 'string') return e;
  return `${e.name || 'Error'}: ${e.message || String(e)}`;
}

function renderDiag() {
  const body = $('#diag-body');
  if (!body) return;
  const v = $('#video');
  const tracks = state.stream ? state.stream.getVideoTracks() : [];
  const t = tracks[0];
  const lines = [];
  lines.push(`build      ${BUILD}`);
  lines.push(`url        ${location.protocol}//${location.host}`);
  lines.push(`secure     ${window.isSecureContext ? 'yes' : 'NO'}`);
  lines.push(`mediaDevs  ${!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)}`);
  lines.push(`UA         ${navigator.userAgent.slice(0, 80)}`);
  lines.push(`gum tried  ${diag.attemptedGum}`);
  lines.push(`gum error  ${fmtErr(diag.lastGumError)}`);
  lines.push(`stream     ${state.stream ? state.stream.id : '(none)'}`);
  lines.push(`tracks     ${tracks.length}`);
  if (t) {
    const s = (t.getSettings && t.getSettings()) || {};
    lines.push(`track      label="${t.label || '?'}" state=${t.readyState} muted=${t.muted} enabled=${t.enabled}`);
    lines.push(`settings   ${s.width || '?'}x${s.height || '?'} facing=${s.facingMode || '?'} fps=${s.frameRate || '?'}`);
  }
  if (v) {
    lines.push(`video      ready=${v.readyState} w=${v.videoWidth} h=${v.videoHeight} paused=${v.paused}`);
    lines.push(`v.error    ${fmtErr(diag.lastVideoError)}`);
  }
  lines.push(`play tried ${diag.attemptedPlay} ok=${diag.playOk}`);
  lines.push(`play error ${fmtErr(diag.lastPlayError)}`);
  lines.push('--- log ---');
  for (const l of diag.log.slice(-10)) lines.push(l);
  body.textContent = lines.join('\n');
}

function startDiagTimer() {
  if (state.diagTimer) return;
  state.diagTimer = setInterval(renderDiag, 500);
}
function stopDiagTimer() {
  if (state.diagTimer) { clearInterval(state.diagTimer); state.diagTimer = null; }
}

window.addEventListener('error', (e) => {
  dlog(`window error: ${e.message} @ ${e.filename}:${e.lineno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  dlog(`unhandled rejection: ${fmtErr(e.reason)}`);
});

// ---------- Helpers ----------
function $hide(sel) { const el = $(sel); if (el) el.hidden = true; }
function $show(sel) { const el = $(sel); if (el) el.hidden = false; }
function hideAllErrors() {
  $hide('#cam-tap'); $hide('#cam-denied'); $hide('#cam-https'); $hide('#cam-error');
}
function showError(msg) {
  dlog(`UI error: ${msg}`);
  hideAllErrors();
  $('#cam-error-msg').textContent = msg;
  $show('#cam-error');
}

// ---------- Navigation ----------
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  if (name === 'shoot') startDiagTimer(); else stopDiagTimer();
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

function bindVideoListeners() {
  const v = $('#video');
  if (v.dataset.boundDiag) return;
  v.dataset.boundDiag = '1';
  ['loadedmetadata','loadeddata','canplay','playing','pause','stalled','suspend','emptied','waiting','ended'].forEach(ev => {
    v.addEventListener(ev, () => dlog(`video ev: ${ev} (ready=${v.readyState} ${v.videoWidth}x${v.videoHeight})`));
  });
  v.addEventListener('error', () => {
    diag.lastVideoError = v.error || { name: 'MediaError', message: `code ${v.error && v.error.code}` };
    dlog(`video error: ${fmtErr(diag.lastVideoError)}`);
  });
}

async function startCamera() {
  if (state.starting) { dlog('startCamera: already starting'); return; }
  state.starting = true;
  try {
    hideAllErrors();
    dlog(`startCamera: facing=${state.facingMode}`);
    bindVideoListeners();

    if (!isSecure()) {
      dlog('not a secure context');
      $show('#cam-https');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('navigator.mediaDevices.getUserMedia is not available in this browser.');
      return;
    }

    stopCamera();
    const video = $('#video');
    applyVideoAttrs(video);
    video.classList.toggle('mirror-self', state.facingMode === 'user');

    diag.attemptedGum = true;
    diag.lastGumError = null;

    let stream;
    try {
      dlog('calling getUserMedia (ideal facingMode)…');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: state.facingMode },
          width:  { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      dlog('getUserMedia resolved');
    } catch (err1) {
      diag.lastGumError = err1;
      dlog(`getUserMedia (constrained) failed: ${fmtErr(err1)}`);
      // Retry with no constraints — some iPads/older iOS reject specific resolutions.
      try {
        dlog('retry getUserMedia with {video: true}…');
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        diag.lastGumError = null;
        dlog('getUserMedia (plain) resolved');
      } catch (err2) {
        diag.lastGumError = err2;
        dlog(`getUserMedia (plain) failed: ${fmtErr(err2)}`);
        if (err2.name === 'NotAllowedError' || err2.name === 'SecurityError') {
          $show('#cam-denied');
        } else {
          showError(`getUserMedia failed → ${fmtErr(err2)}`);
        }
        return;
      }
    }

    state.stream = stream;
    const track = stream.getVideoTracks()[0];
    if (!track) {
      showError('Stream has no video tracks.');
      return;
    }
    dlog(`track: label="${track.label}" state=${track.readyState} muted=${track.muted} enabled=${track.enabled}`);
    track.addEventListener('ended', () => dlog('track ended'));
    track.addEventListener('mute', () => dlog('track muted'));
    track.addEventListener('unmute', () => dlog('track unmuted'));

    if (track.readyState !== 'live') {
      showError(`Track state is "${track.readyState}", expected "live". Close other apps using the camera.`);
      return;
    }

    video.srcObject = stream;
    dlog('assigned srcObject');

    // Wait for the video to actually have dimensions.
    await new Promise((resolve) => {
      if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
      let done = false;
      const finish = (label) => { if (done) return; done = true; cleanup(); dlog(`metadata ready via ${label}`); resolve(); };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('loadeddata', onData);
        video.removeEventListener('canplay', onCanPlay);
      };
      const onMeta = () => finish('loadedmetadata');
      const onData = () => finish('loadeddata');
      const onCanPlay = () => finish('canplay');
      video.addEventListener('loadedmetadata', onMeta);
      video.addEventListener('loadeddata', onData);
      video.addEventListener('canplay', onCanPlay);
      setTimeout(() => finish('timeout-2s'), 2000);
    });

    diag.attemptedPlay = true;
    diag.lastPlayError = null;
    try {
      dlog('calling video.play()…');
      await video.play();
      diag.playOk = true;
      dlog('video.play() resolved');
      $hide('#cam-tap');
    } catch (err) {
      diag.lastPlayError = err;
      diag.playOk = false;
      dlog(`video.play() rejected: ${fmtErr(err)}`);
      $show('#cam-tap');
    }

    if (!video.videoWidth || !video.videoHeight) {
      dlog(`WARN: no dimensions after play. readyState=${video.readyState}`);
    }
    renderDiag();
  } finally {
    state.starting = false;
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => { try { t.stop(); } catch(e){} });
    state.stream = null;
    dlog('stopped stream');
  }
  const v = $('#video');
  if (v) { try { v.pause(); } catch(e){}; v.srcObject = null; }
}

// Diag toggle
$('#diag-toggle').addEventListener('click', () => {
  const d = $('#diag');
  d.classList.toggle('collapsed');
  $('#diag-toggle').textContent = d.classList.contains('collapsed') ? 'show' : 'hide';
});

$('#btn-tap-start').addEventListener('click', async () => {
  $hide('#cam-tap');
  const v = $('#video');
  applyVideoAttrs(v);
  diag.attemptedPlay = true;
  try {
    await v.play();
    diag.playOk = true;
    diag.lastPlayError = null;
    dlog('manual play() ok');
  } catch (e) {
    diag.lastPlayError = e;
    diag.playOk = false;
    dlog(`manual play() failed: ${fmtErr(e)}`);
    showError(`play() failed → ${fmtErr(e)}`);
  }
});

$('#btn-reload').addEventListener('click', () => location.reload());
$('#btn-retry').addEventListener('click', () => startCamera());

$('#btn-back').addEventListener('click', goHome);

$('#btn-flip').addEventListener('click', () => {
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  dlog(`flip → ${state.facingMode}`);
  startCamera();
});

// ---------- Capture ----------
$('#btn-shoot').addEventListener('click', capture);

function capture() {
  const video = $('#video');
  const canvas = $('#canvas');
  const w = video.videoWidth, h = video.videoHeight;
  dlog(`capture: ${w}x${h} ready=${video.readyState} paused=${video.paused}`);
  if (!w || !h) {
    showError(`Camera isn’t ready (no frame). readyState=${video.readyState}, paused=${video.paused}. Check DIAG panel.`);
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
    showError(`drawImage failed: ${fmtErr(e)}`);
    return;
  }
  ctx.restore();

  // Try toBlob first; if it returns null (some iOS builds), fall back to toDataURL.
  const finish = (src) => {
    state.lastBlob = null;
    if (state.lastObjectUrl) { URL.revokeObjectURL(state.lastObjectUrl); state.lastObjectUrl = null; }
    if (src instanceof Blob) {
      state.lastBlob = src;
      state.lastObjectUrl = URL.createObjectURL(src);
      $('#review-img').src = state.lastObjectUrl;
    } else {
      $('#review-img').src = src; // data: URL
      // Build a blob from the data URL for Save fallback paths.
      fetch(src).then(r => r.blob()).then(b => { state.lastBlob = b; }).catch(()=>{});
    }
    $('#review-img').onerror = () => {
      dlog('review img onerror — falling back to dataURL');
      try {
        const url = canvas.toDataURL('image/jpeg', 0.92);
        $('#review-img').onerror = () => showError('Captured image won’t render. Try Retake.');
        $('#review-img').src = url;
      } catch (e) {
        showError(`toDataURL failed: ${fmtErr(e)}`);
      }
    };
    $show('#review');
  };

  let toBlobCalled = false;
  try {
    canvas.toBlob((blob) => {
      toBlobCalled = true;
      if (blob) {
        dlog(`toBlob ok, ${blob.size} bytes`);
        finish(blob);
      } else {
        dlog('toBlob returned null — using toDataURL');
        try { finish(canvas.toDataURL('image/jpeg', 0.92)); }
        catch (e) { showError(`toDataURL failed: ${fmtErr(e)}`); }
      }
    }, 'image/jpeg', 0.92);
  } catch (e) {
    dlog(`toBlob threw: ${fmtErr(e)} — using toDataURL`);
    try { finish(canvas.toDataURL('image/jpeg', 0.92)); }
    catch (e2) { showError(`toDataURL failed: ${fmtErr(e2)}`); }
  }
  // Safari sometimes never invokes the toBlob callback — fallback after 1s.
  setTimeout(() => {
    if (!toBlobCalled) {
      dlog('toBlob never fired — using toDataURL');
      try { finish(canvas.toDataURL('image/jpeg', 0.92)); }
      catch (e) { showError(`toDataURL failed: ${fmtErr(e)}`); }
    }
  }, 1000);
}

// ---------- Retake ----------
$('#btn-retake').addEventListener('click', async () => {
  $hide('#review');
  if (state.lastObjectUrl) { URL.revokeObjectURL(state.lastObjectUrl); state.lastObjectUrl = null; }
  state.lastBlob = null;
  $('#review-img').removeAttribute('src');

  const video = $('#video');
  const trackLive = state.stream && state.stream.getVideoTracks().some(t => t.readyState === 'live');
  if (!trackLive) {
    dlog('retake: track not live, restarting camera');
    await startCamera();
    return;
  }
  try { await video.play(); dlog('retake: resumed'); }
  catch (e) { dlog(`retake play failed: ${fmtErr(e)}`); $show('#cam-tap'); }
});

// ---------- Save (iOS-friendly) ----------
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
      dlog(`share failed: ${fmtErr(err)}`);
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

// ---------- Boot ----------
const bannerEl = document.getElementById('build-banner');
if (bannerEl) bannerEl.textContent = BUILD;
buildPresetGrid();
showScreen('home');
dlog(`boot ${BUILD}`);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCamera();
  } else if (screens.shoot.classList.contains('active') && !state.starting && !state.stream) {
    dlog('visible again, restarting camera');
    startCamera();
  }
});
