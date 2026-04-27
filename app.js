// =====================================================================
// PrivateEye — Shoulder Surfing Detector
// Detects multiple faces in webcam feed and protects the screen.
// =====================================================================

// ---------- Theme toggle ----------
const THEME_KEY = 'pe-theme';
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
}
(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (sysDark ? 'dark' : 'light'));
})();

// ---------- Element refs ----------
const $ = id => document.getElementById(id);
const video      = $('video');
const overlay    = $('overlay');
const ctx        = overlay.getContext('2d');
const startBtn   = $('startBtn');
const stopBtn    = $('stopBtn');
const snapBtn    = $('snapBtn');
const cameraBtn  = $('cameraBtn');
const statusEl   = $('status');
const statusTitle= $('statusTitle');
const statusSub  = $('statusSub');
const loadingEl  = $('loading');
const loadingText= $('loadingText');
const hudFaces   = $('hudFaces');
const hudFps     = $('hudFps');
const liveFaces  = $('liveFaces');
const liveStatus = $('liveStatus');
const alertCount = $('alertCount');
const sessionTime= $('sessionTime');
const toast      = $('toast');
const blurEl     = $('privacyBlur');
const dimEl      = $('screenDim');
const sensInput  = $('sensitivity');
const sensValue  = $('sensValue');
const soundToggle= $('soundToggle');
const blurToggle = $('blurToggle');
const snapToggle = $('snapToggle');
const notifToggle= $('notifToggle');
const alertLog   = $('alertLog');

// ---------- State ----------
let model = null;
let stream = null;
let running = false;
let rafId = null;
let consecutiveMultiFrames = 0;
let inWarning = false;
let alertTotal = 0;
let sessionStart = null;
let sessionTimer = null;
let lastFrameAt = 0;
let fpsEMA = 0;             // exponential moving average
let useFrontCamera = true;

// Audio context for beep
let audioCtx = null;
let beepInterval = null;

// Notification UX state
let collapseTimer = null;     // timer that minimizes notification after a few seconds
let snoozedUntil = 0;         // suppress alerts until this timestamp

// ---------- Persisted settings ----------
const SETTINGS_KEY = 'pe-settings';
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (s.sens) sensInput.value = s.sens;
    if (typeof s.sound === 'boolean') soundToggle.checked = s.sound;
    if (typeof s.blur === 'boolean') blurToggle.checked = s.blur;
    if (typeof s.snap === 'boolean') snapToggle.checked = s.snap;
    if (typeof s.notif === 'boolean') notifToggle.checked = s.notif;
    sensValue.textContent = sensInput.value;
  } catch {}
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    sens: sensInput.value,
    sound: soundToggle.checked,
    blur: blurToggle.checked,
    snap: snapToggle.checked,
    notif: notifToggle.checked
  }));
}
[sensInput, soundToggle, blurToggle, snapToggle, notifToggle].forEach(el => {
  el.addEventListener('change', saveSettings);
});
sensInput.addEventListener('input', () => { sensValue.textContent = sensInput.value; });
loadSettings();

// ---------- Notifications permission ----------
notifToggle.addEventListener('change', async () => {
  if (notifToggle.checked && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') {
      notifToggle.checked = false;
      saveSettings();
      showToast('Notifications denied');
    }
  }
});

// ---------- Toast ----------
function showToast(msg, ms = 2500) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), ms);
}

// ---------- Model load ----------
async function loadModel() {
  if (model) return model;
  if (typeof blazeface === 'undefined' || typeof tf === 'undefined') {
    throw new Error('Face detection library failed to load. Check your internet connection or refresh the page.');
  }
  loadingEl.classList.add('show');
  loadingText.textContent = 'Loading face detection model…';
  model = await blazeface.load();
  return model;
}

// ---------- Camera ----------
async function getCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  // Higher resolution = more pixels per face → cleaner detection.
  // Browser will downscale if camera doesn't support 1280x720.
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width:  { ideal: 1280 },
      height: { ideal: 720  },
      frameRate: { ideal: 30 },
      facingMode: useFrontCamera ? 'user' : 'environment'
    },
    audio: false
  });
  video.srcObject = stream;
  await new Promise(res => {
    video.onloadedmetadata = () => {
      overlay.width  = video.videoWidth;
      overlay.height = video.videoHeight;
      res();
    };
  });
}

// ---------- Start / Stop ----------
async function start() {
  startBtn.disabled = true;
  try {
    await getCamera();
    await loadModel();
    loadingEl.classList.remove('show');

    running = true;
    sessionStart = Date.now();
    startTimer();

    stopBtn.disabled = false;
    snapBtn.disabled = false;
    cameraBtn.disabled = false;

    setStatus('idle', 'Monitoring…', 'Detection active.');
    detectLoop();
    showToast('Monitoring started');
  } catch (err) {
    console.error(err);
    loadingEl.classList.remove('show');
    setStatus('warn', 'Camera error', err.message || 'Could not access camera.');
    startBtn.disabled = false;
  }
}

function stop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  hudFaces.textContent = '0';
  hudFps.textContent = '--';
  liveFaces.textContent = '0';
  liveStatus.textContent = 'Idle';
  liveStatus.className = 'stat-value safe';
  stopAlarm();
  dismissBlur();
  dimEl.classList.remove('show');
  inWarning = false;
  consecutiveMultiFrames = 0;
  stopTimer();
  setStatus('idle', 'Stopped', 'Click Start to monitor again.');
  startBtn.disabled = false;
  stopBtn.disabled = true;
  snapBtn.disabled = true;
  cameraBtn.disabled = true;
  showToast('Monitoring stopped');
}

// ---------- Timer ----------
function startTimer() {
  stopTimer();
  sessionTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - sessionStart) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2,'0');
    const s = String(sec % 60).padStart(2,'0');
    sessionTime.textContent = `${m}:${s}`;
  }, 1000);
}
function stopTimer() {
  if (sessionTimer) clearInterval(sessionTimer);
  sessionTime.textContent = '00:00';
}

// ---------- Detection loop ----------
async function detectLoop() {
  if (!running) return;
  try {
    // Args: input, returnTensors, flipHorizontal, annotateBoxes
    // flipHorizontal=false because we mirror via CSS already.
    const preds = await model.estimateFaces(video, false, false, true);
    drawPredictions(preds);
    handleResult(preds.length);

    // FPS calc
    const now = performance.now();
    if (lastFrameAt) {
      const fps = 1000 / (now - lastFrameAt);
      fpsEMA = fpsEMA ? fpsEMA * 0.9 + fps * 0.1 : fps;
      hudFps.textContent = Math.round(fpsEMA);
    }
    lastFrameAt = now;
  } catch (e) {
    console.error(e);
  }
  rafId = requestAnimationFrame(detectLoop);
}

// ---------- Drawing ----------
function drawPredictions(preds) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!preds.length) return;

  // Mirror to align with mirrored video
  ctx.save();
  ctx.translate(overlay.width, 0);
  ctx.scale(-1, 1);

  const isWarn = preds.length > 1;
  const color = isWarn ? '#ef4444' : '#10b981';
  const fill  = isWarn ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)';

  preds.forEach((p, i) => {
    const [x1, y1] = p.topLeft;
    const [x2, y2] = p.bottomRight;
    const w = x2 - x1, h = y2 - y1;

    // box
    ctx.fillStyle = fill;
    ctx.fillRect(x1, y1, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, w, h);

    // corner accents
    const a = 16;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1+a); ctx.lineTo(x1, y1); ctx.lineTo(x1+a, y1);
    ctx.moveTo(x2-a, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1+a);
    ctx.moveTo(x2, y2-a); ctx.lineTo(x2, y2); ctx.lineTo(x2-a, y2);
    ctx.moveTo(x1+a, y2); ctx.lineTo(x1, y2); ctx.lineTo(x1, y2-a);
    ctx.stroke();

    // label (un-mirror text)
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-x2, 0);
    ctx.fillStyle = color;
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.fillText(`#${i+1}  ${(p.probability?.[0] ?? 1).toFixed(2)}`, 4, y1 - 6);
    ctx.restore();
  });

  ctx.restore();
}

// ---------- Result handler ----------
function handleResult(count) {
  hudFaces.textContent = count;
  liveFaces.textContent = count;

  const threshold = parseInt(sensInput.value, 10);
  if (count > 1) {
    consecutiveMultiFrames++;
    if (consecutiveMultiFrames >= threshold && !inWarning) triggerWarning(count);
  } else {
    consecutiveMultiFrames = 0;
    if (inWarning) clearWarning(count);
    if (count === 1) {
      setStatus('safe', '✅ Safe', 'Only you are visible.');
      liveStatus.textContent = 'Safe';
      liveStatus.className = 'stat-value safe';
    } else {
      setStatus('idle', 'No face detected', 'Sit in front of the camera.');
      liveStatus.textContent = 'No face';
      liveStatus.className = 'stat-value';
    }
  }
}

// ---------- Warning ----------
function triggerWarning(count) {
  inWarning = true;

  // Honor snooze: monitor silently until snooze expires
  if (Date.now() < snoozedUntil) {
    setStatus('warn', `⚠ Warning · ${count} faces (snoozed)`, 'Notification snoozed.');
    return;
  }

  alertTotal++;
  alertCount.textContent = alertTotal;
  setStatus('warn', `⚠ Warning · ${count} faces`, 'Someone may be watching your screen.');
  liveStatus.textContent = 'Warning';
  liveStatus.className = 'stat-value danger';

  if (soundToggle.checked) startAlarm();
  // Show prompt only — DON'T dim until the user clicks Accept.
  showAlertPanel();
  if (notifToggle.checked && Notification.permission === 'granted' && document.hidden) {
    new Notification('PrivateEye — Warning', {
      body: `${count} faces detected near your screen.`,
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Ccircle cx="16" cy="16" r="14" fill="%23ef4444"/%3E%3C/svg%3E'
    });
  }

  let snapshotURL = null;
  if (snapToggle.checked) snapshotURL = takeSnapshot(true);
  addLogEntry(count, snapshotURL);
}

// Show floating notification for 5s, then hide it completely.
const ALERT_VISIBLE_MS = 5000;
function showAlertPanel() {
  blurEl.classList.add('show');
  blurEl.classList.remove('compact');
  if (collapseTimer) clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    blurEl.classList.remove('show', 'compact');
  }, ALERT_VISIBLE_MS);
}

// Accept: user confirms the peeker — drop brightness to the lowest.
// The dim stays active until the peeker leaves the frame.
window.acceptDim = function() {
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
  blurEl.classList.remove('show');
  dimEl.classList.add('show');
  stopAlarm();
  showToast('Screen dimmed for privacy');
};

// Deny: user is OK with the situation — keep screen visible to the peeker.
// Suppress further prompts until the peeker leaves and re-enters.
window.denyDim = function() {
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
  blurEl.classList.remove('show');
  dimEl.classList.remove('show');
  stopAlarm();
  showToast('Screen kept visible');
};

function clearWarning(count) {
  inWarning = false;
  stopAlarm();
  blurEl.classList.remove('show', 'compact');
  dimEl.classList.remove('show');        // restore brightness automatically
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
}

window.dismissBlur = function() {
  blurEl.classList.remove('show', 'compact');
  dimEl.classList.remove('show');
  stopAlarm();
};

// ---------- Make floating notification draggable ----------
(function makeDraggable() {
  const handle = blurEl.querySelector('.pb-inner');
  if (!handle) return;
  let dragging = false, startX = 0, startY = 0, baseRight = 24, baseTop = 90;

  handle.addEventListener('mousedown', e => {
    // Don't start drag when clicking the close button
    if (e.target.tagName === 'BUTTON') return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = blurEl.getBoundingClientRect();
    baseRight = window.innerWidth - rect.right;
    baseTop = rect.top;
    handle.style.animationPlayState = 'paused';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    blurEl.style.right = (baseRight - dx) + 'px';
    blurEl.style.top   = (baseTop + dy) + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      handle.style.animationPlayState = 'running';
    }
  });
})();

// ---------- Beeping alarm ----------
// Plays a short 3-chirp pattern then stops automatically.
// User has been alerted; continuous beeping is annoying once they know.
function startAlarm() {
  if (beepInterval) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const playChirp = () => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.2);
  };

  let plays = 0;
  const MAX_CHIRPS = 3;
  playChirp(); plays++;
  beepInterval = setInterval(() => {
    playChirp(); plays++;
    if (plays >= MAX_CHIRPS) {
      clearInterval(beepInterval);
      beepInterval = null;
    }
  }, 500);
}
function stopAlarm() {
  if (beepInterval) { clearInterval(beepInterval); beepInterval = null; }
}

// ---------- Status helper ----------
function setStatus(kind, title, sub) {
  statusEl.className = 'status ' + kind;
  statusTitle.textContent = title;
  statusSub.textContent = sub;
}

// ---------- Snapshot ----------
function takeSnapshot(silent = false) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  const cx = c.getContext('2d');
  cx.translate(c.width, 0);
  cx.scale(-1, 1);
  cx.drawImage(video, 0, 0);
  const url = c.toDataURL('image/jpeg', 0.85);
  if (!silent) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `privateeye-${Date.now()}.jpg`;
    a.click();
    showToast('Snapshot saved');
  }
  return url;
}

// ---------- Log ----------
function addLogEntry(count, imgURL) {
  const empty = alertLog.querySelector('.log-empty');
  if (empty) empty.remove();

  const li = document.createElement('li');
  li.className = 'log-entry';
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  li.innerHTML = `
    ${imgURL ? `<img src="${imgURL}" alt="Snapshot">` : ''}
    <div class="log-meta">
      <strong>${count} faces detected</strong>
      <span>${time}</span>
      ${imgURL ? `<a href="${imgURL}" download="privateeye-${Date.now()}.jpg">↓ Save snapshot</a>` : ''}
    </div>
  `;
  alertLog.prepend(li);
  while (alertLog.children.length > 30) alertLog.lastChild.remove();
}

window.clearLog = function() {
  alertLog.innerHTML = '<li class="log-empty">No alerts yet. You\'re safe.</li>';
  alertTotal = 0;
  alertCount.textContent = '0';
  showToast('History cleared');
};

// ---------- Theme switch ----------
document.querySelectorAll('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.theme;
    if (!t) return;
    applyTheme(t);
    showToast(t === 'dark' ? 'Dark theme' : 'Light theme');
  });
});

// ---------- Buttons ----------
startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
snapBtn.addEventListener('click', () => takeSnapshot(false));
cameraBtn.addEventListener('click', async () => {
  useFrontCamera = !useFrontCamera;
  try {
    await getCamera();
    showToast(useFrontCamera ? 'Front camera' : 'Rear camera');
  } catch {
    useFrontCamera = !useFrontCamera; // revert
    showToast('Camera switch failed');
  }
});

// Hide loading shell when page loads
window.addEventListener('load', () => {
  loadingEl.classList.remove('show');
  // Surface a clear hint if the CDN libs never reached us
  if (typeof tf === 'undefined' || typeof blazeface === 'undefined') {
    setStatus('warn', 'Libraries failed to load',
      'Check your internet connection and refresh the page.');
    startBtn.disabled = true;
  }
});
