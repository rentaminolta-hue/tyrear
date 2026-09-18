/**
 * detector.js — ONNX Runtime Integration
 * Loads a YOLO-style .onnx model and runs per-frame inference in-browser.
 * Assumes a standard YOLOv8-export output shape [1, 4+numClasses, N]
 * (transposed anchors-free format). Adjust decode() if your export differs.
 *
 * Requires onnxruntime-web, loaded via <script> in index.html:
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/ort.min.js"></script>
 */
import { CONFIG } from '../core/config.js';

export class TireDetector {
  constructor() {
    this.session = null;
    this.inputSize = CONFIG.MODEL.INPUT_SIZE;
    this.classes = CONFIG.MODEL.CLASSES;
  }

  async load(modelUrlOrFile) {
    if (typeof ort === 'undefined') {
      throw new Error('onnxruntime-web (ort) is not loaded. Check the <script> tag in index.html.');
    }
    let source = modelUrlOrFile;
    if (modelUrlOrFile instanceof File) {
      source = await modelUrlOrFile.arrayBuffer();
    }
    this.session = await ort.InferenceSession.create(source, {
      executionProviders: CONFIG.MODEL.EXECUTION_PROVIDERS
    });
    return this.session;
  }

  isLoaded() {
    return !!this.session;
  }

  /**
   * Preprocess a video/canvas frame into a letterboxed square tensor.
   * Returns { tensor, scale, padX, padY } needed to map boxes back to
   * original frame coordinates.
   */
  _preprocess(sourceEl, srcW, srcH) {
    const size = this.inputSize;
    const scale = Math.min(size / srcW, size / srcH);
    const newW = Math.round(srcW * scale);
    const newH = Math.round(srcH * scale);
    const padX = Math.floor((size - newW) / 2);
    const padY = Math.floor((size - newH) / 2);

    const canvas = this._scratchCanvas || (this._scratchCanvas = document.createElement('canvas'));
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#727272';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(sourceEl, 0, 0, srcW, srcH, padX, padY, newW, newH);

    const imgData = ctx.getImageData(0, 0, size, size).data;
    const float32 = new Float32Array(3 * size * size);
    // HWC -> CHW, normalize 0-1
    for (let i = 0; i < size * size; i++) {
      float32[i] = imgData[i * 4] / 255;                       // R
      float32[size * size + i] = imgData[i * 4 + 1] / 255;     // G
      float32[2 * size * size + i] = imgData[i * 4 + 2] / 255; // B
    }

    const tensor = new ort.Tensor('float32', float32, [1, 3, size, size]);
    return { tensor, scale, padX, padY };
  }

  /**
   * Run detection on a video element or canvas. Returns boxes in ORIGINAL
   * frame pixel coordinates: [{x, y, w, h, score, classId, classLabel}]
   * (x,y = top-left corner).
   */
  async detect(sourceEl) {
    if (!this.session) throw new Error('Model not loaded.');
    const srcW = sourceEl.videoWidth || sourceEl.width;
    const srcH = sourceEl.videoHeight || sourceEl.height;
    const { tensor, scale, padX, padY } = this._preprocess(sourceEl, srcW, srcH);

    const feeds = { [CONFIG.MODEL.INPUT_NAME]: tensor };
    const results = await this.session.run(feeds);
    const output = results[CONFIG.MODEL.OUTPUT_NAME] || Object.values(results)[0];

    const boxes = this._decode(output, scale, padX, padY);
    return this._nms(boxes);
  }

  /**
   * Decode a [1, 4+numClasses, N] YOLOv8-style output tensor.
   */
  _decode(output, scale, padX, padY) {
    const data = output.data;
    const dims = output.dims; // [1, 4+numClasses, N]
    const numAttrs = dims[1];
    const numBoxes = dims[2];
    const numClasses = numAttrs - 4;
    const boxes = [];

    for (let i = 0; i < numBoxes; i++) {
      let bestScore = 0;
      let bestClass = -1;
      for (let c = 0; c < numClasses; c++) {
        const score = data[(4 + c) * numBoxes + i];
        if (score > bestScore) {
          bestScore = score;
          bestClass = c;
        }
      }
      if (bestScore < CONFIG.MODEL.CONF_THRESHOLD) continue;

      const cx = data[0 * numBoxes + i];
      const cy = data[1 * numBoxes + i];
      const w = data[2 * numBoxes + i];
      const h = data[3 * numBoxes + i];

      // Undo letterbox padding + scale to get original-frame coordinates
      const x = (cx - w / 2 - padX) / scale;
      const y = (cy - h / 2 - padY) / scale;
      const bw = w / scale;
      const bh = h / scale;

      boxes.push({
        x, y, w: bw, h: bh,
        score: bestScore,
        classId: bestClass,
        classLabel: this.classes[bestClass] || `class_${bestClass}`
      });
    }
    return boxes;
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

  _nms(boxes) {
    const sorted = [...boxes].sort((a, b) => b.score - a.score);
    const kept = [];
    while (sorted.length) {
      const best = sorted.shift();
      kept.push(best);
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (best.classId === sorted[i].classId && this._iou(best, sorted[i]) > CONFIG.MODEL.IOU_THRESHOLD) {
          sorted.splice(i, 1);
        }
      }
    }
    return kept;
  }
}
