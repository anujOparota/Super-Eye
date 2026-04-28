/**
 * Super Eye v3.0 — app.js
 * Main application controller
 */

// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
window.SE = {
  people:           [],      // { name, thumbSrc, imgEl }
  detectionLog:     [],      // { name, time, type, confidence }
  detectedSession:  new Set(),
  cooldowns:        {},
  currentMode:      'live',
  isRunning:        false,
  liveStream:       null,
  scanInterval:     1,       // seconds between scans
  matchThreshold:   0.52,
  autoExport:       true,
};

// ══════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════
function getInitials(name) {
  return (name || '').split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
}

function fmtSeconds(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtNow() {
  const n = new Date();
  return n.toLocaleDateString('en-IN') + '  ' + n.toLocaleTimeString('en-IN', { hour12: false });
}

function showToast(msg, ms) {
  ms = ms || 2600;
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}

function setStatus(txt, cls) {
  const p = document.getElementById('sysStatus');
  p.textContent = txt;
  p.className = 'status-pill ' + (cls || 'ready');
}

// ══════════════════════════════════════
// PERSON MANAGEMENT
// ══════════════════════════════════════
function handleFiles(files) {
  const before = SE.people.length;
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.src = ev.target.result;
      img.onload = () => {
        const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
        SE.people.push({ name, thumbSrc: ev.target.result, imgEl: img });
        renderPeopleList();
        // Sync to backend if connected
        if (window._ws && window._ws.readyState === WebSocket.OPEN) {
          window._ws.send(JSON.stringify({ type: 'add_person', name, image: ev.target.result }));
        }
        showToast('✓ Added: ' + name);
      };
    };
    reader.readAsDataURL(file);
  });
}

function removePerson(idx) {
  SE.people.splice(idx, 1);
  renderPeopleList();
}

function renderPeopleList() {
  const list = document.getElementById('personList');
  document.getElementById('personCount').textContent = SE.people.length + ' loaded';
  document.getElementById('personCount').className = 'badge ' + (SE.people.length > 0 ? 'green' : '');

  if (SE.people.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        Add photos to begin.<br>Name is read from filename.
      </div>`;
    return;
  }

  list.innerHTML = '';
  SE.people.forEach((p, i) => {
    const isDetected = SE.detectedSession.has(p.name);
    const card = document.createElement('div');
    card.className = 'person-card' + (isDetected ? ' detected' : '');
    card.innerHTML = `
      <img class="person-avatar" src="${p.thumbSrc}" alt="${p.name}"
           onerror="this.outerHTML='<div class=\\'person-avatar placeholder\\'>${getInitials(p.name)}</div>'">
      <div class="person-info">
        <div class="person-name">${p.name}</div>
        <div class="person-meta">${isDetected ? '● detected' : 'not detected'}</div>
      </div>
      <div class="person-indicator ${isDetected ? 'active' : ''}"></div>
      <button class="person-remove" onclick="removePerson(${i})" title="Remove">✕</button>
    `;
    list.appendChild(card);
  });
}

// ══════════════════════════════════════
// MODE SWITCHING
// ══════════════════════════════════════
function switchMode(mode) {
  stopDetection();
  SE.currentMode = mode;
  document.getElementById('btnLive').classList.toggle('active', mode === 'live');
  document.getElementById('btnRecorded').classList.toggle('active', mode === 'recorded');

  document.getElementById('idleView').style.display       = mode === 'live'     ? 'flex' : 'none';
  document.getElementById('liveView').style.display       = 'none';
  document.getElementById('recordedView').style.display   = mode === 'recorded' ? 'flex' : 'none';
  document.getElementById('videoDropUI').style.display    = mode === 'recorded' ? 'flex' : 'none';
  document.getElementById('videoPlayerWrap').style.display = 'none';
}

// ══════════════════════════════════════
// LIVE CAMERA
// ══════════════════════════════════════
async function startLive() {
  if (SE.people.length === 0) {
    showToast('⚠ Upload person photos first');
    return;
  }
  const vid = document.getElementById('videoEl');

  try {
    SE.liveStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
    });
    vid.srcObject = SE.liveStream;
    await vid.play();
  } catch (err) {
    // Demo mode — no real camera
    console.warn('[SuperEye] Camera unavailable, demo mode:', err.message);
    setStatus('DEMO MODE', 'warn');
  }

  document.getElementById('idleView').style.display = 'none';
  document.getElementById('liveView').style.display = 'flex';
  document.getElementById('stopBtn').classList.add('visible');
  SE.isRunning = true;
  setStatus('LIVE DETECTION', 'live');

  // Start clock
  updateLiveClock();

  // Start detection — WSClient sends frames to backend, falls back to demo
  WSClient.startLive();

  showToast('Camera started — scanning faces…');
}

function stopDetection() {
  if (SE.liveStream) {
    SE.liveStream.getTracks().forEach(t => t.stop());
    SE.liveStream = null;
  }
  SE.isRunning = false;
  DemoDetection.stop();
  CanvasRenderer.stop();

  document.getElementById('stopBtn').classList.remove('visible');
  document.getElementById('liveView').style.display   = 'none';
  document.getElementById('videoPlayerWrap').style.display = 'none';
  document.getElementById('videoDropUI').style.display =
    SE.currentMode === 'recorded' ? 'flex' : 'none';
  document.getElementById('idleView').style.display =
    SE.currentMode === 'live' ? 'flex' : 'none';
  if (SE.currentMode === 'recorded') {
    document.getElementById('recordedView').style.display = 'flex';
  }

  CanvasRenderer.clearAll();
  setStatus('SYSTEM READY', 'ready');

  if (window._ws && window._ws.readyState === WebSocket.OPEN) {
    window._ws.send(JSON.stringify({ type: 'stop' }));
  }
}

// ══════════════════════════════════════
// RECORDED VIDEO
// ══════════════════════════════════════
function handleVideoUpload(file) {
  if (!file || !file.type.startsWith('video/')) return;
  if (SE.people.length === 0) { showToast('⚠ Add person photos first'); return; }

  const vid = document.getElementById('uploadedVideo');
  vid.src = URL.createObjectURL(file);
  document.getElementById('videoDropUI').style.display    = 'none';
  document.getElementById('videoPlayerWrap').style.display = 'flex';
  document.getElementById('stopBtn').classList.add('visible');
  SE.isRunning = true;
  setStatus('VIDEO ANALYSIS', 'online');

  vid.addEventListener('timeupdate', onVideoTimeUpdate, { passive: true });
  vid.addEventListener('ended', onVideoEnded, { once: true });

  // Start recorded detection — WSClient sends frames to backend
  WSClient.startRecordedLoop(vid);

  showToast('Video loaded — analysing faces…');
}

function onVideoTimeUpdate() {
  const vid = document.getElementById('uploadedVideo');
  document.getElementById('videoTs').textContent = fmtSeconds(vid.currentTime);
}

function onVideoEnded() {
  showToast('✓ Video analysis complete');
  setStatus('ANALYSIS DONE', 'online');
}

// ══════════════════════════════════════
// LIVE CLOCK
// ══════════════════════════════════════
function updateLiveClock() {
  if (!SE.isRunning || SE.currentMode !== 'live') return;
  document.getElementById('liveTime').textContent = fmtNow();
  requestAnimationFrame(updateLiveClock);
}

// ══════════════════════════════════════
// DETECTION EVENT — called by any source
// ══════════════════════════════════════
function onDetection(name, type, confidence, bbox, videoTime) {
  const key = name + type;
  const now = Date.now();
  if (now - (SE.cooldowns[key] || 0) < 3500) return;
  SE.cooldowns[key] = now;

  const timeLabel = type === 'recorded'
    ? 'Video: ' + fmtSeconds(videoTime || 0)
    : fmtNow();

  const person = SE.people.find(p => p.name.toLowerCase() === name.toLowerCase())
              || { name, thumbSrc: '' };

  SE.detectedSession.add(name);
  SE.detectionLog.push({ name, time: timeLabel, type, confidence });
  renderPeopleList();
  addLogEntry(person, timeLabel, type, confidence);
  updateStats();
  flashVideoArea();

  // Draw bbox on canvas
  if (bbox) {
    const canvasId  = type === 'live' ? 'overlayLive' : 'overlayRec';
    const containId = type === 'live' ? 'liveView'    : 'videoPlayerWrap';
    const videoEl   = type === 'live'
      ? document.getElementById('videoEl')
      : document.getElementById('uploadedVideo');
    CanvasRenderer.drawFaceBox(canvasId, containId, videoEl, name, confidence, bbox);
  }
}

// ══════════════════════════════════════
// LOG
// ══════════════════════════════════════
function addLogEntry(person, time, type, confidence) {
  const logBody = document.getElementById('logBody');
  document.getElementById('logEmpty').style.display = 'none';

  const pct        = Math.round((confidence || 0.8) * 100);
  const fillColor  = pct >= 85 ? 'var(--accent)' : pct >= 65 ? 'var(--warn)' : 'var(--danger)';
  const labelColor = fillColor;

  const div = document.createElement('div');
  div.className = 'log-entry ' + type;
  div.innerHTML = `
    <img class="log-avatar" src="${person.thumbSrc}" alt="${person.name}"
         onerror="this.outerHTML='<div class=\\'log-avatar ph\\'>${getInitials(person.name)}</div>'">
    <div class="log-info">
      <div class="log-name">${person.name}</div>
      <div class="log-time">${time}</div>
      <div class="conf-row">
        <div class="conf-bar-bg">
          <div class="conf-bar-fill" style="width:${pct}%;background:${fillColor}"></div>
        </div>
        <span class="conf-label" style="color:${labelColor}">${pct}%</span>
      </div>
    </div>
    <div class="log-tag ${type}">${type === 'live' ? 'LIVE' : 'REC'}</div>
  `;
  logBody.insertBefore(div, logBody.firstChild);
}

function updateStats() {
  const total  = SE.detectionLog.length;
  const unique = new Set(SE.detectionLog.map(e => e.name)).size;
  const last   = total > 0 ? SE.detectionLog[total - 1].name.split(' ')[0] : '—';
  document.getElementById('statTotal').textContent  = total;
  document.getElementById('statUnique').textContent = unique;
  document.getElementById('statLast').textContent   = last;
  document.getElementById('logCount').textContent   = total + ' events';
}

function clearLog() {
  SE.detectionLog.length = 0;
  SE.detectedSession.clear();
  SE.cooldowns = {};
  document.getElementById('logBody').innerHTML = `
    <div class="empty-state" id="logEmpty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
        <rect x="9" y="3" width="6" height="4" rx="1"/>
      </svg>
      No detections yet.
    </div>`;
  updateStats();
  renderPeopleList();
}

function exportCSV() {
  if (SE.detectionLog.length === 0) { showToast('No detections to export'); return; }
  const rows = ['NAME,TIME,TYPE,CONFIDENCE'];
  SE.detectionLog.forEach(e =>
    rows.push(`"${e.name}","${e.time}","${e.type}","${Math.round((e.confidence||0.8)*100)}%"`)
  );
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'super_eye_log_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  showToast('CSV exported!');
}

// ══════════════════════════════════════
// FLASH
// ══════════════════════════════════════
function flashVideoArea() {
  const va = document.querySelector('.video-area');
  va.classList.remove('detecting');
  void va.offsetWidth;
  va.classList.add('detecting');
  setTimeout(() => va.classList.remove('detecting'), 600);
}

// ══════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════
function openSettings() {
  document.getElementById('settingsModal').classList.add('open');
}
function closeSettings() {
  SE.matchThreshold = parseFloat(document.getElementById('threshRange').value);
  SE.scanInterval   = parseInt(document.getElementById('intervalRange').value);
  SE.autoExport     = document.getElementById('autoExport').checked;
  document.getElementById('settingsModal').classList.remove('open');
  showToast('Settings saved');
}

// ══════════════════════════════════════
// KEYBOARD
// ══════════════════════════════════════
document.addEventListener('keydown', e => {
  if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'Escape') { stopDetection(); closeSettings(); }
  if (e.key === 'l')      { switchMode('live'); }
  if (e.key === 'r')      { switchMode('recorded'); }
  if (e.key === 'e')      { exportCSV(); }
  if (e.key === ',')      { openSettings(); }
});

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  renderPeopleList();
  updateStats();
  setStatus('SYSTEM READY', 'ready');
  setTimeout(() => {
    const h = document.getElementById('keyHint');
    if (h) h.style.opacity = '0';
  }, 5000);
  console.log('%c👁 Super Eye v3.0', 'font-size:18px;font-weight:bold;color:#00ffb4;background:#0a0b0f;padding:4px 10px;border-radius:5px');
});
