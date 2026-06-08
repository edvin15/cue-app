// Real-time on-device pose detection — the "live director" engine.
//
// Reusable across both paths: this module knows nothing about presets or
// Copy-a-photo. It loads MediaPipe Tasks Vision (lazily, ~5MB first-load),
// runs the Pose Landmarker Lite model on a live <video> element, and emits
// an observation per animation frame to a caller-supplied callback. Callers
// translate those observations into verdicts (per-situation thresholds for
// presets, reference-derived thresholds for Copy-a-photo).
//
// API:
//   getDirectorState()              → {modelState, fps, active, error}
//   loadDirector()                  → Promise<boolean>   (memoized)
//   startDirector(videoEl, onObs)   → boolean             (idempotent)
//   stopDirector()                  → void
//
// Observation shape:
//   { detected: boolean,
//     fps: number,
//     t: number (ms timestamp),
//     bbox: { left, right, top, bottom, width, height }   // 0..1 normalized
//     landmarks: PoseLandmark[]                            // raw landmarks
//   }

const VERSION    = '0.10.17';
const CDN_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const CDN_WASM   = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

const STATE = {
  modelState: 'idle',  // 'idle' | 'loading' | 'ready' | 'error'
  fps: 0,
  active: false,
  error: null,
  delegate: null,      // 'GPU' or 'CPU' once ready
};

let landmarker = null;
let _videoEl   = null;
let _onObs     = null;
let _rafId     = null;
let _frameCount = 0;
let _fpsStart   = 0;
let _loadPromise = null;
let _lastTimestamp = 0;

export function getDirectorState() {
  return { ...STATE };
}

export function loadDirector() {
  if (STATE.modelState === 'ready') return Promise.resolve(true);
  if (_loadPromise) return _loadPromise;
  STATE.modelState = 'loading';
  STATE.error = null;
  _loadPromise = (async () => {
    try {
      const vision  = await import(CDN_BUNDLE);
      const fileset = await vision.FilesetResolver.forVisionTasks(CDN_WASM);
      // Try GPU first (WebGL2 on iOS Safari); fall back to CPU if it errors.
      let lm = null;
      let lastErr = null;
      for (const delegate of ['GPU', 'CPU']) {
        try {
          lm = await vision.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.4,
            minPosePresenceConfidence:  0.4,
            minTrackingConfidence:      0.4,
          });
          STATE.delegate = delegate;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`[director] ${delegate} delegate failed:`, err);
        }
      }
      if (!lm) throw lastErr || new Error('No delegate worked');
      landmarker = lm;
      STATE.modelState = 'ready';
      return true;
    } catch (err) {
      STATE.modelState = 'error';
      STATE.error = String(err && err.message || err);
      _loadPromise = null;
      console.warn('[director] load failed:', err);
      return false;
    }
  })();
  return _loadPromise;
}

export function startDirector(videoEl, onObservation) {
  if (STATE.modelState !== 'ready' || !landmarker) return false;
  stopDirector();
  _videoEl = videoEl;
  _onObs   = onObservation || (() => {});
  _fpsStart   = performance.now();
  _frameCount = 0;
  _lastTimestamp = 0;
  STATE.active = true;
  STATE.fps = 0;
  loop();
  return true;
}

export function stopDirector() {
  if (_rafId) cancelAnimationFrame(_rafId);
  _rafId = null;
  _videoEl = null;
  _onObs = null;
  STATE.active = false;
}

function loop() {
  _rafId = requestAnimationFrame(loop);
  if (!_videoEl || !landmarker) return;
  if (_videoEl.readyState < 2 || !_videoEl.videoWidth) return;
  const now = performance.now();
  // detectForVideo requires monotonically increasing timestamps.
  const ts = now > _lastTimestamp ? now : _lastTimestamp + 1;
  _lastTimestamp = ts;
  let result;
  try {
    result = landmarker.detectForVideo(_videoEl, ts);
  } catch (err) {
    console.warn('[director] frame error:', err);
    return;
  }
  _frameCount++;
  const dt = now - _fpsStart;
  if (dt >= 500) {
    STATE.fps = Math.round((_frameCount / dt) * 1000);
    _frameCount = 0;
    _fpsStart = now;
  }
  if (_onObs) _onObs(makeObservation(result, now));
}

function makeObservation(result, t) {
  const landmarks = result && result.landmarks && result.landmarks[0];
  if (!landmarks || landmarks.length === 0) {
    return { detected: false, fps: STATE.fps, t };
  }
  // bbox in normalized image coords (0..1) — useful axis is height for distance.
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
  }
  return {
    detected: true,
    fps: STATE.fps,
    t,
    bbox: {
      left: minX, right: maxX, top: minY, bottom: maxY,
      width:  maxX - minX,
      height: maxY - minY,
    },
    landmarks,
  };
}
