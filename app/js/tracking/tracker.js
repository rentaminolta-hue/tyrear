/**
 * tracker.js — ByteTrack-lite Implementation
 *
 * Simplified ByteTrack: two-stage IoU association (high-confidence
 * detections first, then low-confidence ones to recover occluded/partial
 * tires) with constant-velocity position prediction between frames.
 * This is intentionally lighter than full ByteTrack (no Kalman filter)
 * to keep it fast and dependency-free in the browser.
 *
 * A track only increments the global count once, the first time its
 * centroid crosses the configured counting line, AND only after it has
 * been confirmed (seen for MIN_HITS_TO_CONFIRM frames) — this avoids
 * double counting from flicker/occlusion near the line.
 */
import { CONFIG } from '../core/config.js';

let _nextId = 1;

class Track {
  constructor(box) {
    this.id = _nextId++;
    this.box = box;                // {x,y,w,h,score,classId,classLabel}
    this.velocity = { dx: 0, dy: 0 };
    this.hits = 1;
    this.age = 0;                  // frames since last matched
    this.confirmed = false;
    this.counted = false;
    this.scores = [box.score];
    this.classLabel = box.classLabel;
    this.classVotes = { [box.classLabel]: 1 };
    this._prevCentroid = this._centroid(box);
    this._sideAtStart = null;
  }

  _centroid(box) {
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }

  predict() {
    // Constant-velocity prediction for the box used in matching this frame.
    return {
      ...this.box,
      x: this.box.x + this.velocity.dx,
      y: this.box.y + this.velocity.dy
    };
  }

  update(box) {
    const prevCentroid = this._centroid(this.box);
    const newCentroid = this._centroid(box);
    this.velocity = {
      dx: newCentroid.x - prevCentroid.x,
      dy: newCentroid.y - prevCentroid.y
    };
    this.box = box;
    this.hits += 1;
    this.age = 0;
    this.scores.push(box.score);
    if (this.scores.length > 10) this.scores.shift();
    this.classVotes[box.classLabel] = (this.classVotes[box.classLabel] || 0) + 1;
    this.classLabel = Object.entries(this.classVotes).sort((a, b) => b[1] - a[1])[0][0];
    if (!this.confirmed && this.hits >= CONFIG.TRACKING.MIN_HITS_TO_CONFIRM) {
      this.confirmed = true;
    }
  }

  markMissed() {
    this.age += 1;
  }

  get avgScore() {
    return this.scores.reduce((a, b) => a + b, 0) / this.scores.length;
  }
}

export class TireTracker {
  constructor() {
    this.tracks = new Map(); // id -> Track
  }

  _iou(a, b) {
    const ax2 = a.x + a.w, ay2 = a.y + a.h;
    const bx2 = b.x + b.w, by2 = b.y + b.h;
    const ix1 = Math.max(a.x, b.x), iy1 = Math.max(a.y, b.y);
    const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
    const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    const union = a.w * a.h + b.w * b.h - inter;
    return union <= 0 ? 0 : inter / union;
  }

  /** Greedy IoU-based assignment (fast, dependency-free stand-in for Hungarian). */
  _associate(tracks, detections, iouThreshold) {
    const pairs = [];
    for (const t of tracks) {
      for (const d of detections) {
        const iou = this._iou(t.predict(), d.det);
        if (iou >= iouThreshold) pairs.push({ t, d, iou });
      }
    }
    pairs.sort((a, b) => b.iou - a.iou);

    const usedTracks = new Set();
    const usedDets = new Set();
    const matches = [];
    for (const { t, d } of pairs) {
      if (usedTracks.has(t.id) || usedDets.has(d.idx)) continue;
      matches.push({ track: t, detection: d.det });
      usedTracks.add(t.id);
      usedDets.add(d.idx);
    }
    const unmatchedTracks = tracks.filter(t => !usedTracks.has(t.id));
    const unmatchedDets = detections.filter(d => !usedDets.has(d.idx)).map(d => d.det);
    return { matches, unmatchedTracks, unmatchedDets };
  }

  /**
   * Step the tracker forward with a new frame's detections.
   * frameSize = {width, height} of the source video, needed to resolve
   * the counting line's absolute pixel position.
   * Returns { tracks: Track[], newCrossings: Track[] }.
   */
  update(detections, frameSize) {
    const highConf = [];
    const lowConf = [];
    detections.forEach((det, idx) => {
      const entry = { det, idx };
      if (det.score >= CONFIG.TRACKING.HIGH_CONF_THRESHOLD) highConf.push(entry);
      else if (det.score >= CONFIG.TRACKING.LOW_CONF_THRESHOLD) lowConf.push(entry);
    });

    const activeTracks = Array.from(this.tracks.values());

    // Stage 1: match high-confidence detections against all active tracks
    const stage1 = this._associate(activeTracks, highConf, CONFIG.TRACKING.IOU_MATCH_THRESHOLD);
    for (const { track, detection } of stage1.matches) track.update(detection);

    // Stage 2: try to recover remaining tracks using low-confidence detections
    const stage2 = this._associate(stage1.unmatchedTracks, lowConf, CONFIG.TRACKING.IOU_MATCH_THRESHOLD);
    for (const { track, detection } of stage2.matches) track.update(detection);

    // Anything still unmatched ages; remove if too stale
    for (const track of stage2.unmatchedTracks) {
      track.markMissed();
      if (track.age > CONFIG.TRACKING.MAX_AGE_FRAMES) this.tracks.delete(track.id);
    }

    // Spawn new tracks for unmatched high-confidence detections only
    // (low-confidence detections alone shouldn't start a brand new track).
    for (const det of stage1.unmatchedDets) {
      const t = new Track(det);
      this.tracks.set(t.id, t);
    }

    // Check line crossings for confirmed, not-yet-counted tracks
    const newCrossings = [];
    for (const track of this.tracks.values()) {
      if (!track.confirmed || track.counted) continue;
      const side = this._sideOfLine(track.box, frameSize);
      if (track._sideAtStart === null) {
        track._sideAtStart = side;
        continue;
      }
      if (side !== track._sideAtStart) {
        track.counted = true;
        newCrossings.push(track);
      }
    }

    return { tracks: Array.from(this.tracks.values()), newCrossings };
  }

  _sideOfLine(box, frameSize) {
    const { orientation, position } = CONFIG.COUNTING_LINE;
    const centroid = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    if (orientation === 'horizontal') {
      const lineY = position * frameSize.height;
      return centroid.y < lineY ? 'before' : 'after';
    } else {
      const lineX = position * frameSize.width;
      return centroid.x < lineX ? 'before' : 'after';
    }
  }
}
