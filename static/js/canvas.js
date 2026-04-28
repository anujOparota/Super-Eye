/**
 * Super Eye v3.0 — canvas.js
 * Handles ALL canvas drawing: face boxes, scan grid, shimmer.
 * Correctly maps face_recognition bbox coords → screen pixels
 * for both object-fit:cover (live) and object-fit:contain (recorded).
 */

const CanvasRenderer = (() => {
  let _scanGridTimer  = null;
  let _shimmerFrame   = null;
  let _activeFaces    = {};   // canvasId → [{ name, conf, rect, born }]
  let _renderLoop     = null;
  let _fpsTime        = Date.now();
  let _fpsFrames      = 0;

  // ── Internal helpers ──────────────────────────────────────

  function _getCanvas(id) {
    return document.getElementById(id);
  }

  /**
   * Compute the actual rendered rect of a <video> inside its container.
   * Supports object-fit: cover AND contain.
   */
  function _videoRect(videoEl, containerEl, fitMode) {
    fitMode = fitMode || 'cover';
    const cw = containerEl.clientWidth;
    const ch = containerEl.clientHeight;
    const vw = videoEl.videoWidth  || 1280;
    const vh = videoEl.videoHeight || 720;

    const scaleX = cw / vw;
    const scaleY = ch / vh;
    let scale, offX, offY;

    if (fitMode === 'cover') {
      scale = Math.max(scaleX, scaleY);
      offX  = (cw - vw * scale) / 2;
      offY  = (ch - vh * scale) / 2;
    } else {
      // contain
      scale = Math.min(scaleX, scaleY);
      offX  = (cw - vw * scale) / 2;
      offY  = (ch - vh * scale) / 2;
    }
    return { scale, offX, offY, vw, vh };
  }

  /**
   * Convert face_recognition bbox [top,right,bottom,left] (in ORIGINAL video pixels,
   * before any scaling) → canvas pixel rect {x,y,w,h}.
   *
   * face_recognition returns coords on the DOWNSCALED frame (0.25x).
   * The backend multiplies by 4 before sending, so we always receive
   * coords in full-resolution video space.
   */
  function _bboxToCanvas(bbox, videoEl, containerEl, fitMode) {
    const { scale, offX, offY } = _videoRect(videoEl, containerEl, fitMode);
    const [top, right, bottom, left] = bbox;
    const x  = left   * scale + offX;
    const y  = top    * scale + offY;
    const w  = (right  - left) * scale;
    const h  = (bottom - top)  * scale;
    return { x, y, w, h };
  }

  // ── Resize canvas to match container exactly ──────────────
  function _syncCanvas(canvas, container) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }
  }

  // ── Draw one face box ─────────────────────────────────────
  function _drawBox(ctx, rect, name, conf, age) {
    const { x, y, w, h } = rect;
    const FADE_IN  = 300;   // ms
    const FADE_OUT = 2500;  // ms start
    const TOTAL    = 3200;  // ms total life

    const alpha = age < FADE_IN
      ? age / FADE_IN
      : age > FADE_OUT
        ? 1 - (age - FADE_OUT) / (TOTAL - FADE_OUT)
        : 1;

    if (alpha <= 0) return false;  // expired

    const confPct  = Math.round(conf * 100);
    const boxColor = conf >= 0.85 ? '#00ffb4' : conf >= 0.65 ? '#ffb84d' : '#ff6b6b';
    const a        = alpha.toFixed(3);

    ctx.save();
    ctx.globalAlpha = alpha;

    // ── Outer glow ──
    ctx.shadowColor = boxColor;
    ctx.shadowBlur  = 14;
    ctx.strokeStyle = boxColor;
    ctx.lineWidth   = 1.8;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur  = 0;

    // ── Corner brackets (precise) ──
    const cl = Math.min(16, w * 0.22, h * 0.18);
    ctx.strokeStyle = boxColor;
    ctx.lineWidth   = 2.8;
    ctx.lineCap     = 'round';

    // Top-left
    ctx.beginPath(); ctx.moveTo(x + cl, y);          ctx.lineTo(x, y);          ctx.lineTo(x, y + cl);          ctx.stroke();
    // Top-right
    ctx.beginPath(); ctx.moveTo(x + w - cl, y);      ctx.lineTo(x + w, y);      ctx.lineTo(x + w, y + cl);      ctx.stroke();
    // Bottom-left
    ctx.beginPath(); ctx.moveTo(x, y + h - cl);      ctx.lineTo(x, y + h);      ctx.lineTo(x + cl, y + h);      ctx.stroke();
    // Bottom-right
    ctx.beginPath(); ctx.moveTo(x + w - cl, y + h);  ctx.lineTo(x + w, y + h);  ctx.lineTo(x + w, y + h - cl);  ctx.stroke();

    // ── Scan shimmer ──
    const shimFrac = ((Date.now() % 900) / 900);
    const shimY    = y + shimFrac * h;
    const shimGrad = ctx.createLinearGradient(x, shimY - 10, x, shimY + 10);
    shimGrad.addColorStop(0,   'rgba(0,255,180,0)');
    shimGrad.addColorStop(0.5, `rgba(0,255,180,${0.22 * alpha})`);
    shimGrad.addColorStop(1,   'rgba(0,255,180,0)');
    ctx.fillStyle = shimGrad;
    ctx.fillRect(x, shimY - 10, w, 20);

    // ── Name label ──
    const LABEL_H = 22;
    const FONT    = 'bold 10px "DM Mono", monospace';
    ctx.font      = FONT;
    const nameW   = ctx.measureText(name.toUpperCase()).width + 14;
    const confW   = 36;
    const totalW  = nameW + confW + 3;
    const lx      = x;
    const ly      = y + h;

    // Name bg
    ctx.fillStyle = boxColor;
    ctx.fillRect(lx, ly, nameW, LABEL_H);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name.toUpperCase(), lx + 7, ly + LABEL_H / 2);

    // Confidence bg
    const confBg = conf >= 0.85 ? 'rgba(0,30,20,0.92)' : conf >= 0.65 ? 'rgba(40,28,0,0.92)' : 'rgba(40,0,10,0.92)';
    ctx.fillStyle = confBg;
    ctx.fillRect(lx + nameW + 2, ly, confW, LABEL_H);
    ctx.fillStyle = boxColor;
    ctx.font      = 'bold 9px "DM Mono", monospace';
    ctx.fillText(confPct + '%', lx + nameW + 6, ly + LABEL_H / 2);

    ctx.restore();
    return true;  // still alive
  }

  // ── Render loop ───────────────────────────────────────────
  function _startRenderLoop() {
    if (_renderLoop) return;
    function loop() {
      const now = Date.now();

      // FPS counter
      _fpsFrames++;
      if (now - _fpsTime >= 1000) {
        const fps = Math.round(_fpsFrames * 1000 / (now - _fpsTime));
        const el  = document.getElementById('fpsDisplay');
        if (el) el.textContent = fps + ' FPS';
        _fpsFrames = 0;
        _fpsTime   = now;
      }

      // Draw each canvas
      ['overlayLive', 'overlayRec'].forEach(id => {
        const canvas    = _getCanvas(id);
        if (!canvas) return;
        const container = canvas.parentElement;
        if (!container) return;
        _syncCanvas(canvas, container);
        const ctx  = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw scan grid (live only)
        if (id === 'overlayLive' && SE.isRunning) {
          _drawScanGrid(ctx, canvas.width, canvas.height);
        }

        const faces = _activeFaces[id];
        if (faces && faces.length) {
          const alive = faces.filter(f => {
            const age = now - f.born;
            return _drawBox(ctx, f.rect, f.name, f.conf, age);
          });
          _activeFaces[id] = alive;
        }
      });

      _renderLoop = requestAnimationFrame(loop);
    }
    _renderLoop = requestAnimationFrame(loop);
  }

  function _stopRenderLoop() {
    if (_renderLoop) { cancelAnimationFrame(_renderLoop); _renderLoop = null; }
  }

  // ── Scan grid (faint) ─────────────────────────────────────
  function _drawScanGrid(ctx, w, h) {
    const GS = 44;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,180,0.035)';
    ctx.lineWidth   = 0.5;
    for (let x = 0; x < w; x += GS) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for (let y = 0; y < h; y += GS) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

    // Corner HUD decoration
    ctx.strokeStyle = 'rgba(0,255,180,0.28)';
    ctx.lineWidth   = 1.2;
    const fc = 28, m = 10;
    [[m,m,1,1],[w-m,m,-1,1],[m,h-m,1,-1],[w-m,h-m,-1,-1]].forEach(([cx,cy,dx,dy]) => {
      ctx.beginPath(); ctx.moveTo(cx+dx*fc,cy); ctx.lineTo(cx,cy); ctx.lineTo(cx,cy+dy*fc); ctx.stroke();
    });
    ctx.restore();
  }

  // ── PUBLIC API ────────────────────────────────────────────
  return {

    /**
     * drawFaceBox — main entry point called from app.js / ws.js
     * bbox: [top, right, bottom, left] in full-resolution video pixels
     */
    drawFaceBox(canvasId, containerId, videoEl, name, conf, bbox) {
      const canvas    = _getCanvas(canvasId);
      const container = document.getElementById(containerId);
      if (!canvas || !container || !videoEl) return;

      // Wait until video has dimensions
      const tryDraw = () => {
        if (!videoEl.videoWidth) { setTimeout(tryDraw, 80); return; }
        const fitMode = canvasId === 'overlayLive' ? 'cover' : 'contain';
        const rect    = _bboxToCanvas(bbox, videoEl, container, fitMode);

        if (!_activeFaces[canvasId]) _activeFaces[canvasId] = [];
        // Replace existing entry for same person
        const existing = _activeFaces[canvasId].findIndex(f => f.name === name);
        const entry = { name, conf, rect, born: Date.now() };
        if (existing >= 0) _activeFaces[canvasId][existing] = entry;
        else _activeFaces[canvasId].push(entry);
      };
      tryDraw();
    },

    /** Called when live camera starts — kick off render loop */
    startLiveScan(videoEl) {
      _startRenderLoop();
    },

    /** Stop render loop (called on stopDetection) */
    stop() {
      _stopRenderLoop();
    },

    /** Clear all canvases immediately */
    clearAll() {
      _activeFaces = {};
      ['overlayLive', 'overlayRec'].forEach(id => {
        const c = _getCanvas(id);
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
      });
    },

    /** Kick render loop from outside (e.g. recorded video loaded) */
    startLoop() { _startRenderLoop(); },

    /** Draw a simulated face box (used by DemoDetection) */
    drawSimulated(canvasId, containerId, videoEl, name, conf) {
      if (!videoEl.videoWidth && !videoEl.clientWidth) return;

      const cw = videoEl.clientWidth  || videoEl.videoWidth  || 640;
      const ch = videoEl.clientHeight || videoEl.videoHeight || 480;

      // Generate plausible random face location (centre-biased)
      const faceW  = (0.11 + Math.random() * 0.09) * cw;
      const faceH  = faceW * 1.3;
      const cx     = cw * (0.25 + Math.random() * 0.5);
      const cy     = ch * (0.15 + Math.random() * 0.45);
      const left   = Math.max(0, cx - faceW / 2);
      const top    = Math.max(0, cy - faceH / 2);
      const right  = left + faceW;
      const bottom = top  + faceH;

      // For simulated, we work in canvas/screen space directly
      const canvas    = _getCanvas(canvasId);
      const container = document.getElementById(containerId);
      if (!canvas || !container) return;
      _syncCanvas(canvas, container);

      if (!_activeFaces[canvasId]) _activeFaces[canvasId] = [];
      const existing = _activeFaces[canvasId].findIndex(f => f.name === name);
      const entry = { name, conf, rect: { x: left, y: top, w: faceW, h: faceH }, born: Date.now() };
      if (existing >= 0) _activeFaces[canvasId][existing] = entry;
      else _activeFaces[canvasId].push(entry);

      _startRenderLoop();
    }
  };
})();
