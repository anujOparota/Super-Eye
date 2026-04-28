/**
 * Super Eye v3.0 — demo.js
 * Realistic face-detection simulation for when the Python backend
 * is not running. Uses actual uploaded person photos.
 */

const DemoDetection = (() => {
  let _liveTimer    = null;
  let _recordedRef  = null;
  let _lastVideoTs  = -10;
  let _active       = false;

  function _pickRandom() {
    if (!SE.people.length) return null;
    return SE.people[Math.floor(Math.random() * SE.people.length)];
  }

  function _fakeConf() {
    // Gaussian-ish spread: mostly 0.72–0.95
    return Math.min(0.97, Math.max(0.55, 0.84 + (Math.random() - 0.5) * 0.3));
  }

  function _fakeBbox(videoEl) {
    // Return [top, right, bottom, left] in screen/canvas pixels
    const cw = videoEl.clientWidth  || 640;
    const ch = videoEl.clientHeight || 480;
    const fw  = cw * (0.10 + Math.random() * 0.10);
    const fh  = fw * (1.25 + Math.random() * 0.15);
    const cx  = cw * (0.22 + Math.random() * 0.56);
    const cy  = ch * (0.12 + Math.random() * 0.48);
    const top    = Math.round(cy - fh / 2);
    const left   = Math.round(cx - fw / 2);
    const bottom = Math.round(top  + fh);
    const right  = Math.round(left + fw);
    return [top, right, bottom, left];
  }

  return {
    startLive() {
      _active = true;
      CanvasRenderer.startLoop();
      const interval = (SE.scanInterval || 1) * 1000 + Math.random() * 1200;

      const tick = () => {
        if (!_active || !SE.isRunning) return;
        const person = _pickRandom();
        if (person && Math.random() < 0.68) {
          const conf   = _fakeConf();
          const videoEl = document.getElementById('videoEl');
          const bbox   = _fakeBbox(videoEl);
          onDetection(person.name, 'live', conf, null, null);
          CanvasRenderer.drawSimulated('overlayLive', 'liveView', videoEl, person.name, conf);
        }
        _liveTimer = setTimeout(tick, 1800 + Math.random() * 1600);
      };
      _liveTimer = setTimeout(tick, 1200);
    },

    startRecorded(videoEl) {
      _active     = true;
      _lastVideoTs = -10;
      CanvasRenderer.startLoop();

      const check = () => {
        if (!_active || !SE.isRunning) return;
        const t = videoEl.currentTime;
        if (!videoEl.paused && t - _lastVideoTs >= (SE.scanInterval || 1) * 2.2) {
          _lastVideoTs = t;
          if (Math.random() < 0.65) {
            const person = _pickRandom();
            if (person) {
              const conf = _fakeConf();
              onDetection(person.name, 'recorded', conf, null, t);
              CanvasRenderer.drawSimulated('overlayRec', 'videoPlayerWrap', videoEl, person.name, conf);
            }
          }
        }
        _recordedRef = requestAnimationFrame(check);
      };
      _recordedRef = requestAnimationFrame(check);
    },

    stop() {
      _active = false;
      clearTimeout(_liveTimer);
      if (_recordedRef) { cancelAnimationFrame(_recordedRef); _recordedRef = null; }
    }
  };
})();
