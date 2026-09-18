/**
 * state.js — Global State Management
 * Single source of truth for counts, tracks, and session data.
 * Uses a minimal pub/sub so UI modules can react without tight coupling.
 */
import { CONFIG } from './config.js';

class Store {
  constructor() {
    this._listeners = new Set();
    this.reset();
  }

  reset() {
    this.state = {
      sessionId: null,
      siteId: null,
      driverId: null,
      startedAt: null,
      modelLoaded: false,
      modelName: null,
      streaming: false,
      lastFrameAt: null,

      // Live tracked objects (id -> track)
      tracks: new Map(),

      // Confirmed, counted totals — the ONLY numbers the knowledge engine
      // is allowed to speak about as "counted so far".
      counts: {
        total: 0,
        byClass: Object.fromEntries(CONFIG.MODEL.CLASSES.map(c => [c, 0]))
      },

      // Append-only log of crossing events, used for reports/CSV export.
      events: [],

      // Yard/estimate mode (still-pile view) is kept separate from the
      // conveyor "counted" totals, and always labeled as an estimate.
      yardEstimate: null
    };
    this._emit();
  }

  startSession({ siteId = null, driverId = null } = {}) {
    this.state.sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    this.state.siteId = siteId;
    this.state.driverId = driverId;
    this.state.startedAt = Date.now();
    this.state.counts = { total: 0, byClass: Object.fromEntries(CONFIG.MODEL.CLASSES.map(c => [c, 0])) };
    this.state.events = [];
    this.state.tracks.clear();
    this._emit();
    return this.state.sessionId;
  }

  setModelLoaded(name) {
    this.state.modelLoaded = true;
    this.state.modelName = name;
    this._emit();
  }

  setStreaming(isStreaming) {
    this.state.streaming = isStreaming;
    this._emit();
  }

  touchFrame() {
    this.state.lastFrameAt = Date.now();
  }

  isStale() {
    if (!this.state.lastFrameAt) return true;
    return (Date.now() - this.state.lastFrameAt) > CONFIG.SAFETY.MAX_STALE_FRAME_MS;
  }

  setTracks(trackMap) {
    this.state.tracks = trackMap;
    this._emit('tracks');
  }

  /**
   * Record a confirmed line-crossing count event. This is the ONLY place
   * totals are incremented, keeping the count logic auditable in one spot.
   */
  registerCrossing(track) {
    const cls = track.classLabel;
    if (!(cls in this.state.counts.byClass)) {
      this.state.counts.byClass[cls] = 0;
    }
    this.state.counts.byClass[cls] += 1;
    this.state.counts.total += 1;
    this.state.events.push({
      trackId: track.id,
      classLabel: cls,
      confidence: track.avgScore,
      timestamp: Date.now()
    });
    this._emit('counts');
  }

  setYardEstimate(estimate) {
    // estimate = { count, byClass, confidence, timestamp }
    this.state.yardEstimate = { ...estimate, isEstimate: true };
    this._emit('yardEstimate');
  }

  getSnapshot() {
    // Cheap deep-ish copy for consumers that shouldn't mutate live state.
    return {
      ...this.state,
      tracks: Array.from(this.state.tracks.values()),
      counts: JSON.parse(JSON.stringify(this.state.counts)),
      events: [...this.state.events]
    };
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(reason = 'state') {
    for (const fn of this._listeners) {
      try { fn(this.getSnapshot(), reason); } catch (e) { console.error('state listener error', e); }
    }
  }
}

export const AppState = new Store();
