/**
 * config.js — System Constants & Safety Rules
 * Central place to tune the detector/tracker/UI without touching logic files.
 */
export const CONFIG = {
  APP_NAME: 'TireCycle AR Vision AI',
  VERSION: '1.0.0',

  // ---- Model / Inference ----
  MODEL: {
    PATH: '../models/model.onnx',        // drop your exported .onnx here
    INPUT_SIZE: 640,                      // square input, e.g. YOLOv8 640x640 export
    INPUT_NAME: 'images',                 // input tensor name (check with netron if different)
    OUTPUT_NAME: 'output0',               // output tensor name
    CONF_THRESHOLD: 0.40,                 // minimum score to keep a raw detection
    IOU_THRESHOLD: 0.45,                  // NMS IoU threshold
    CLASSES: ['car_tire', 'truck_tire', 'bike_tire'],
    EXECUTION_PROVIDERS: ['webgl', 'wasm'] // ORT will try in this order
  },

  // ---- Counting line (fraction of frame, 0-1) ----
  COUNTING_LINE: {
    orientation: 'horizontal',  // 'horizontal' | 'vertical'
    position: 0.55,             // 0 = top/left, 1 = bottom/right
    thicknessPx: 3
  },

  // ---- ByteTrack-lite tracker ----
  TRACKING: {
    HIGH_CONF_THRESHOLD: 0.5,   // first association stage
    LOW_CONF_THRESHOLD: 0.1,    // second association stage (recovers occluded tires)
    IOU_MATCH_THRESHOLD: 0.3,
    MAX_AGE_FRAMES: 30,         // frames a track can go unmatched before removal
    MIN_HITS_TO_CONFIRM: 3      // frames needed before a track is "confirmed" (reduces flicker double-counts)
  },

  // ---- Safety / anti-hallucination rules for the knowledge engine ----
  SAFETY: {
    // The knowledge engine must NEVER report a number that isn't read
    // directly from live AppState. If a query can't be answered from
    // real recorded data, it must say so rather than estimate/guess.
    ALLOW_ESTIMATION: false,
    REQUIRE_MODEL_LOADED_FOR_COUNTS: true,
    MAX_STALE_FRAME_MS: 4000 // if no new frame processed in this window, flag counts as "paused/stale"
  },

  // ---- Storage ----
  STORAGE: {
    DB_NAME: 'tirecycle_db',
    SESSIONS_KEY: 'tirecycle_sessions',
    CURRENT_SESSION_KEY: 'tirecycle_current_session'
  }
};
