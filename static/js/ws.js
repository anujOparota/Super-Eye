/**
 * Super Eye v3.1 — ws.js  (FIXED)
 *
 * ROOT CAUSE FIX:
 * The browser captures the webcam via getUserMedia.
 * The backend was trying to open cv2.VideoCapture (second camera instance).
 * On Windows, two processes cannot share a webcam → backend got nothing.
 *
 * NEW APPROACH:
 * Browser captures frames from <video> element every N ms,
 * sends them as base64 JPEG to backend via WebSocket.
 * Backend does face detection on those frames and sends results back.
 * Backend NEVER opens its own camera for live mode.
 */

const WSClient = (() => {
  let _ws             = null;
  let _reconnectTimer = null;
  let _liveLoopId     = null;
  let _recLoopActive  = false;

  // Offscreen canvas for frame capture
  const _cap    = document.createElement('canvas');
  const _capCtx = _cap.getContext('2d');

  // ── Capture a frame from a video element as base64 JPEG ──
  function _captureFrame(videoEl, maxW, quality) {
    maxW    = maxW    || 480;   // keep small for fast transfer
    quality = quality || 0.70;

    const vw = videoEl.videoWidth  || 640;
    const vh = videoEl.videoHeight || 480;
    const scale = Math.min(1.0, maxW / vw);

    _cap.width  = Math.round(vw * scale);
    _cap.height = Math.round(vh * scale);
    _capCtx.drawImage(videoEl, 0, 0, _cap.width, _cap.height);
    return _cap.toDataURL('image/jpeg', quality);
  }

  // ── Live frame sender loop ────────────────────────────────
  // Sends browser webcam frames to backend every INTERVAL ms
  function _startLiveLoop() {
    _stopLiveLoop();
    const INTERVAL = 200; // send 5 frames/sec → enough for detection
    const vid = document.getElementById('videoEl');

    _liveLoopId = setInterval(() => {
      if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
      if (!SE.isRunning || SE.currentMode !== 'live') { _stopLiveLoop(); return; }
      if (!vid || vid.readyState < 2 || vid.videoWidth === 0) return;

      const frame = _captureFrame(vid, 480, 0.70);
      _ws.send(JSON.stringify({ type: 'live_frame', data: frame }));
    }, INTERVAL);

    console.log('[WS] Live frame loop started (5fps to backend)');
  }

  function _stopLiveLoop() {
    if (_liveLoopId) { clearInterval(_liveLoopId); _liveLoopId = null; }
  }

  // ── Recorded video frame sender loop ─────────────────────
  async function _recordedLoop(videoEl) {
    _recLoopActive = true;
    let lastSent   = -99;
    const INTERVAL = Math.max(1, SE.scanInterval || 1);

    while (_recLoopActive && SE.isRunning && SE.currentMode === 'recorded') {
      const t = videoEl.currentTime;
      if (!videoEl.paused && !videoEl.ended && (t - lastSent) >= INTERVAL) {
        if (_ws && _ws.readyState === WebSocket.OPEN && videoEl.readyState >= 2) {
          lastSent = t;
          const frame = _captureFrame(videoEl, 480, 0.65);
          _ws.send(JSON.stringify({ type: 'frame', data: frame, timestamp: t }));
        }
      }
      await new Promise(r => setTimeout(r, 300));
    }
    _recLoopActive = false;
  }

  // ── Backend status pill ───────────────────────────────────
  function _setBackendUI(state) {
    const el = document.getElementById('backendBadge');
    if (!el) return;
    if (state === 'connected') {
      el.className = 'backend-badge online';
      el.innerHTML = '<div class="bdot"></div>BACKEND CONNECTED';
    } else {
      el.className = 'backend-badge demo';
      el.innerHTML = '<div class="bdot"></div>DEMO MODE';
    }
  }

  // ── Handle messages from backend ──────────────────────────
  function _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'ready') {
      console.log('[WS] Backend ready. People:', msg.people);
      return;
    }

    if (msg.type === 'detection' && msg.name && msg.name !== 'Unknown') {
      onDetection(
        msg.name,
        msg.source || SE.currentMode,
        msg.confidence || 0.85,
        msg.bbox   || null,
        msg.timestamp || null
      );
      if (msg.bbox) {
        const isLive   = (msg.source === 'live');
        const canvasId = isLive ? 'overlayLive'     : 'overlayRec';
        const contId   = isLive ? 'liveView'        : 'videoPlayerWrap';
        const videoEl  = isLive
          ? document.getElementById('videoEl')
          : document.getElementById('uploadedVideo');
        CanvasRenderer.drawFaceBox(canvasId, contId, videoEl, msg.name, msg.confidence, msg.bbox);
      }
    }

    if (msg.type === 'add_result') {
      console.log(`[WS] Sync: ${msg.name} → ${msg.success ? 'OK' : 'FAILED'}`);
    }
  }

  // ── Connect ───────────────────────────────────────────────
  function _connect() {
    if (_ws && _ws.readyState !== WebSocket.CLOSED) return;
    try { _ws = new WebSocket('ws://localhost:8765'); window._ws = _ws; }
    catch (e) { _scheduleReconnect(); return; }

    _ws.onopen = () => {
      clearTimeout(_reconnectTimer);
      _setBackendUI('connected');
      showToast('✓ Backend connected');
      console.log('[WS] Connected to backend');

      // Sync loaded people to backend
      SE.people.forEach(p => {
        _ws.send(JSON.stringify({ type: 'add_person', name: p.name, image: p.thumbSrc }));
      });

      // If detection already running, start sending frames
      if (SE.isRunning && SE.currentMode === 'live') {
        DemoDetection.stop();
        CanvasRenderer.startLoop();
        _startLiveLoop();
      }
      if (SE.isRunning && SE.currentMode === 'recorded') {
        DemoDetection.stop();
        _recordedLoop(document.getElementById('uploadedVideo'));
      }
    };

    _ws.onmessage = e => _onMessage(e.data);

    _ws.onclose = () => {
      window._ws = null;
      _stopLiveLoop();
      _recLoopActive = false;
      _setBackendUI('demo');
      _scheduleReconnect();
    };

    _ws.onerror = () => _ws.close();
  }

  function _scheduleReconnect() {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = setTimeout(_connect, 4000);
  }

  // ── PUBLIC API ────────────────────────────────────────────
  return {
    init() { _connect(); },

    /** Called when live camera starts */
    startLive() {
      DemoDetection.stop();
      CanvasRenderer.startLoop();
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _startLiveLoop();
      }
      // else: demo mode runs until backend connects, then _ws.onopen starts loop
    },

    /** Called when recorded video is loaded */
    startRecordedLoop(videoEl) {
      DemoDetection.stop();
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _recordedLoop(videoEl);
      }
    },

    /** Stop all frame sending */
    stop() {
      _stopLiveLoop();
      _recLoopActive = false;
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify({ type: 'stop' }));
      }
    },

    /** Sync one person to backend */
    syncPerson(name, thumbSrc) {
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify({ type: 'add_person', name, image: thumbSrc }));
      }
    },

    isConnected() {
      return _ws && _ws.readyState === WebSocket.OPEN;
    }
  };
})();
