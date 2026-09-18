# TireCycle AR Vision AI

Browser-based (PWA) tire counting for a conveyor-belt recycling operation, plus a
"yard mode" for estimating tire count from a still pile. Runs entirely on-device —
no backend, no data leaves the browser.

## What's implemented

- **`app/index.html` / `css/main.css`** — industrial dark-theme dashboard: live
  camera feed, overlay canvas, running totals by class, session fields, export
  buttons, and a query box.
- **`js/core/config.js`** — every tunable constant (model paths/thresholds,
  counting-line position, tracker thresholds, safety rules) in one place.
- **`js/core/state.js`** — single source of truth (counts, tracks, session,
  events) with a tiny pub/sub so the UI reacts to changes.
- **`js/core/reporting.js`** — builds a structured session report from live
  state only, exports as JSON or CSV.
- **`js/knowledge/engine.js`** — a **rules-based, not generative** query
  answerer ("Ask the System" box). It only ever reports numbers read directly
  from state; anything it can't find in real recorded data gets an explicit
  "I don't have that" instead of a guess.
- **`js/vision/detector.js`** — loads a `.onnx` model via **onnxruntime-web**,
  preprocesses frames (letterbox + normalize), decodes a YOLOv8-style output,
  and runs NMS.
- **`js/tracking/tracker.js`** — a lightweight ByteTrack-style tracker:
  two-stage IoU association (high-confidence detections, then low-confidence
  ones to recover partially occluded tires), constant-velocity prediction,
  track confirmation (to reduce flicker), and line-crossing detection that
  increments the count exactly once per confirmed track.
- **`sw.js` / `manifest.json`** — installable PWA with an offline app shell.

## Before it runs

1. **Export your Roboflow model to ONNX** and drop it in `models/` (or upload
   it via the "Model" panel in the UI — it's read as a `File`, no filesystem
   path needed).
2. **Check the export's I/O names and shape** with a tool like
   [Netron](https://netron.app). This build assumes:
   - Input name `images`, shape `[1,3,640,640]`
   - Output name `output0`, shape `[1, 4+numClasses, N]` (standard YOLOv8
     export)
   If your export differs, update `CONFIG.MODEL.INPUT_NAME` / `OUTPUT_NAME` /
   `INPUT_SIZE` in `js/core/config.js`, and adjust `_decode()` in
   `detector.js` if the layout isn't the anchor-free YOLOv8 format.
3. **Update `CONFIG.MODEL.CLASSES`** to match your model's actual class order
   (car/truck/bike tire, or however you trained it).
4. **Serve over HTTPS or localhost.** Camera access (`getUserMedia`) and
   service workers both require a secure context — this won't work opened
   directly as a `file://` path.

## Running it

Any static file server works, e.g.:

```bash
cd app
python3 -m http.server 8080
# open https://localhost:8080 (or http://localhost:8080 — localhost is exempt
# from the HTTPS requirement for camera access)
```

## Known simplifications / next steps

- The tracker uses constant-velocity + IoU instead of a full Kalman filter —
  fine for a steady conveyor belt, less robust if the camera itself moves.
- Detection decode assumes YOLOv8's anchor-free export shape; other
  architectures (YOLOv5 anchor-based, etc.) need a different `_decode()`.
- "Yard Estimate" mode is a single-frame count of a still pile — it's labeled
  as an estimate everywhere (UI + knowledge engine) and never mixed into the
  conveyor's confirmed totals.
- No backend/sync yet — reports export as JSON/CSV for now; wiring persistent
  local storage (IndexedDB) for multi-session history is a natural next step.
- Driver job-assignment flow (pick up job → travel to site → start count) is
  not built into this dashboard yet — this build is the on-site counting
  screen itself.
