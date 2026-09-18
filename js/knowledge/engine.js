/**
 * engine.js — Strict Anti-Hallucination AI
 *
 * This is NOT a generative model. It is a deterministic, rules-based
 * query answerer that only ever reports numbers pulled directly from
 * AppState at the moment of the question. It never estimates, rounds
 * up for effect, or fills gaps with a guess — if it can't find the
 * answer in real recorded data, it says so explicitly.
 *
 * Why: on a job site, a wrong tire count is worse than no answer.
 */
import { AppState } from '../core/state.js';
import { CONFIG } from '../core/config.js';

const CLASS_ALIASES = {
  car: 'car_tire', 'car tire': 'car_tire', 'car tires': 'car_tire', cars: 'car_tire',
  truck: 'truck_tire', 'truck tire': 'truck_tire', 'truck tires': 'truck_tire', trucks: 'truck_tire',
  bike: 'bike_tire', 'bike tire': 'bike_tire', 'bike tires': 'bike_tire', bikes: 'bike_tire', bicycle: 'bike_tire'
};

function matchClass(text) {
  const lower = text.toLowerCase();
  for (const [alias, cls] of Object.entries(CLASS_ALIASES)) {
    if (lower.includes(alias)) return cls;
  }
  for (const cls of CONFIG.MODEL.CLASSES) {
    if (lower.includes(cls.replace('_', ' '))) return cls;
  }
  return null;
}

function guardModelLoaded(snap) {
  if (CONFIG.SAFETY.REQUIRE_MODEL_LOADED_FOR_COUNTS && !snap.modelLoaded) {
    return "No model is loaded yet, so I have no detections to report. Load a .onnx model first.";
  }
  return null;
}

function guardStale(snap) {
  if (AppState.isStale() && snap.streaming) {
    return " (Note: no new frames processed recently — the feed may be paused or frozen, so this count may not reflect what's on the belt right now.)";
  }
  return "";
}

/**
 * Answer a free-text question using ONLY snap data. Returns a string.
 */
export function ask(question) {
  const snap = AppState.getSnapshot();
  const q = question.trim().toLowerCase();

  const notLoaded = guardModelLoaded(snap);
  const wantsCounts = /(how many|count|total|so far)/.test(q);

  if (wantsCounts && notLoaded) return notLoaded;

  // Total count
  if (/total/.test(q) || (/how many/.test(q) && !matchClass(q))) {
    return `Total counted this session: ${snap.counts.total}.` + guardStale(snap);
  }

  // Per-class count
  const cls = matchClass(q);
  if (cls && wantsCounts) {
    const n = snap.counts.byClass[cls] ?? 0;
    return `${cls.replace('_', ' ')} counted this session: ${n}.` + guardStale(snap);
  }

  // Session duration
  if (/how long|duration|session time/.test(q)) {
    if (!snap.startedAt) return "No session has been started yet.";
    const mins = Math.round((Date.now() - snap.startedAt) / 60000 * 10) / 10;
    return `Current session has been running for ${mins} minute(s).`;
  }

  // Streaming status
  if (/(is|are).*(running|streaming|active|live)/.test(q)) {
    return snap.streaming ? "Yes, the live feed is currently running." : "No, the live feed is not currently running.";
  }

  // Model status
  if (/model/.test(q) && /(loaded|ready|which|what)/.test(q)) {
    return snap.modelLoaded ? `Model loaded: ${snap.modelName || 'unnamed model'}.` : "No model is currently loaded.";
  }

  // Yard estimate
  if (/yard|pile|estimate/.test(q)) {
    if (!snap.yardEstimate) return "No yard pile estimate has been generated yet.";
    return `Yard pile estimate: ~${snap.yardEstimate.count} tires (estimate only, confidence ${(snap.yardEstimate.confidence * 100).toFixed(0)}%). This is not a confirmed count.`;
  }

  // Explicit refusal for anything not backed by real state — this is the
  // anti-hallucination fallback, not a generic chatbot answer.
  return "I can only answer from data actually recorded this session (counts, class breakdowns, session time, model/stream status, or yard estimates). I don't have data to answer that.";
}
