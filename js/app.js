/**
 * app.js — Main Orchestrator
 * Wires camera capture -> detector -> tracker -> state -> UI overlay,
 * plus controls for model loading, session start/stop, reports, and
 * the knowledge-engine query panel.
 */
import { CONFIG } from './core/config.js';
import { AppState } from './core/state.js';
import { exportReportJSON, exportReportCSV } from './core/reporting.js';
import { ask as knowledgeAsk } from './knowledge/engine.js';
import { TireDetector } from './vision/detector.js';
import { TireTracker } from './tracking/tracker.js';

const detector = new TireDetector();
const tracker = new TireTracker();

const els = {};
let videoStream = null;
let rafId = null;

function cacheEls() {
  [
    'video', 'overlay', 'startBtn', 'stopBtn', 'modelInput', 'modelStatus',
    'totalCount', 'classCounts', 'siteId', 'driverId', 'exportJsonBtn',
    'exportCsvBtn', 'askInput', 'askBtn', 'askLog', 'streamStatus', 'yardModeBtn'
  ].forEach(id => (els[id] = document.getElementById(id)));
}

async function loadModel(file) {
  els.modelStatus.textContent = 'Loading model…';
  try {
    await detector.load(file);
    AppState.setModelLoaded(file.name || 'model.onnx');
    els.modelStatus.textContent = `Model loaded: ${file.name}`;
  } catch (err) {
    console.error(err);
    els.modelStatus.textContent = `Failed to load model: ${err.message}`;
  }
}

async function startCamera() {
  videoStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  els.video.srcObject = videoStream;
  await els.video.play();
  els.overlay.width = els.video.videoWidth;
  els.overlay.height = els.video.videoHeight;
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
}

function drawOverlay(tracks, frameSize) {
  const ctx = els.overlay.getContext('2d');
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);

  // Counting line
  ctx.strokeStyle = '#ffb300';
  ctx.lineWidth = CONFIG.COUNTING_LINE.thicknessPx;
  ctx.beginPath();
  if (CONFIG.COUNTING_LINE.orientation === 'horizontal') {
    const y = CONFIG.COUNTING_LINE.position * frameSize.height;
    ctx.moveTo(0, y);
    ctx.lineTo(frameSize.width, y);
  } else {
    const x = CONFIG.COUNTING_LINE.position * frameSize.width;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, frameSize.height);
  }
  ctx.stroke();

  // Tracks
  for (const t of tracks) {
    const { x, y, w, h } = t.box;
    ctx.strokeStyle = t.confirmed ? '#00e676' : '#757575';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = t.confirmed ? '#00e676' : '#757575';
    ctx.font = '14px monospace';
    ctx.fillText(`#${t.id} ${t.classLabel} ${(t.avgScore * 100).toFixed(0)}%`, x, Math.max(12, y - 4));
  }
}

function renderCounts() {
  const snap = AppState.getSnapshot();
  els.totalCount.textContent = snap.counts.total;
  els.classCounts.innerHTML = Object.entries(snap.counts.byClass)
    .map(([cls, n]) => `<div class="class-row"><span>${cls.replace('_', ' ')}</span><span>${n}</span></div>`)
    .join('');
  els.streamStatus.textContent = snap.streaming ? 'LIVE' : 'STOPPED';
  els.streamStatus.className = snap.streaming ? 'status live' : 'status stopped';
}

async function frameLoop() {
  if (!AppState.state.streaming) return;
  if (detector.isLoaded() && els.video.readyState >= 2) {
    const frameSize = { width: els.video.videoWidth, height: els.video.videoHeight };
    try {
      const boxes = await detector.detect(els.video);
      const { tracks, newCrossings } = tracker.update(boxes, frameSize);
      AppState.touchFrame();
      AppState.setTracks(new Map(tracks.map(t => [t.id, t])));
      newCrossings.forEach(t => AppState.registerCrossing(t));
      drawOverlay(tracks, frameSize);
      renderCounts();
    } catch (err) {
      console.error('Frame processing error:', err);
    }
  }
  rafId = requestAnimationFrame(frameLoop);
}

async function handleStart() {
  if (!detector.isLoaded()) {
    els.modelStatus.textContent = 'Load a model before starting.';
    return;
  }
  AppState.startSession({ siteId: els.siteId.value || null, driverId: els.driverId.value || null });
  await startCamera();
  AppState.setStreaming(true);
  renderCounts();
  frameLoop();
}

function handleStop() {
  AppState.setStreaming(false);
  if (rafId) cancelAnimationFrame(rafId);
  stopCamera();
  renderCounts();
}

function handleAsk() {
  const q = els.askInput.value.trim();
  if (!q) return;
  const answer = knowledgeAsk(q);
  const entry = document.createElement('div');
  entry.className = 'ask-entry';
  entry.innerHTML = `<div class="q">You: ${q}</div><div class="a">System: ${answer}</div>`;
  els.askLog.prepend(entry);
  els.askInput.value = '';
}

/**
 * Yard mode: single-frame still-pile estimate. Kept explicitly separate
 * from conveyor counts and always labeled as an estimate (see engine.js).
 */
async function handleYardEstimate() {
  if (!detector.isLoaded() || els.video.readyState < 2) return;
  const boxes = await detector.detect(els.video);
  const byClass = {};
  let scoreSum = 0;
  boxes.forEach(b => {
    byClass[b.classLabel] = (byClass[b.classLabel] || 0) + 1;
    scoreSum += b.score;
  });
  AppState.setYardEstimate({
    count: boxes.length,
    byClass,
    confidence: boxes.length ? scoreSum / boxes.length : 0,
    timestamp: Date.now()
  });
  renderCounts();
}

function wireEvents() {
  els.modelInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadModel(file);
  });
  els.startBtn.addEventListener('click', handleStart);
  els.stopBtn.addEventListener('click', handleStop);
  els.exportJsonBtn.addEventListener('click', exportReportJSON);
  els.exportCsvBtn.addEventListener('click', exportReportCSV);
  els.askBtn.addEventListener('click', handleAsk);
  els.askInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleAsk(); });
  els.yardModeBtn.addEventListener('click', handleYardEstimate);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed:', err));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  cacheEls();
  wireEvents();
  renderCounts();
  registerServiceWorker();
});
