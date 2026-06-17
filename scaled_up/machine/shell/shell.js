/**
 * Browser shell for the Berzerk JS machine (T2.9). No build step: serve
 * machine/ with `npx http-server` (or any static server) and open
 * shell/index.html.
 *
 * The scheduler stays wall-clock-free; THIS shell paces it. We accumulate real
 * time and call machine.runFrame() at the original 59.64 Hz, then blit once per
 * requestAnimationFrame (decoupling emulation rate from display refresh).
 *
 * T3.1: InputRecorder wraps machine.setInput(), stamps each change with the
 * current scheduler.frameCount, and produces a frozen-schema JSONL dump on Stop.
 */

import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { CYCLES_PER_FRAME, CPU_CLOCK } from '../src/scheduler.js';

const FRAME_HZ = CPU_CLOCK / CYCLES_PER_FRAME;          // 59.64 Hz
const FRAME_MS = 1000 / FRAME_HZ;

const statusEl = document.getElementById('status');
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const image = ctx.createImageData(256, 224);
const rgba = image.data; // Uint8ClampedArray, 256*224*4

const status = (msg) => { statusEl.textContent = msg; };

// ---- sample-optional WebAudio backend ----------------------------------
// Loads samples/manifest.json + any referenced .wav. With an empty manifest
// (audio is deferred to T2.8b) this is effectively silent but ready.
class WebAudioBackend {
  constructor() { this.ctx = null; this.manifest = { speech: {}, sfx: {} }; this.buffers = {}; }
  async init() {
    try {
      const m = await fetch('../fixtures/samples/manifest.json').then((r) => r.ok ? r.json() : null);
      if (m) this.manifest = { speech: m.speech || {}, sfx: m.sfx || {} };
      const files = new Set([...Object.values(this.manifest.speech), ...Object.values(this.manifest.sfx)]);
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      for (const f of files) {
        try {
          const buf = await fetch('../fixtures/samples/' + f).then((r) => r.arrayBuffer());
          this.buffers[f] = await this.ctx.decodeAudioData(buf);
        } catch { /* missing sample -> stays silent */ }
      }
    } catch { /* no manifest -> silent */ }
  }
  emit(ev) {
    let file;
    if (ev.kind === 'speech' && ev.op === 'play') file = this.manifest.speech['0x' + ev.address.toString(16)];
    // sfx mapping is TBD (T2.8b); manifest.sfx is empty for now.
    const buffer = file && this.buffers[file];
    if (buffer && this.ctx) {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.ctx.destination);
      src.start();
    }
  }
}

// ---- keyboard -> input.setField ----------------------------------------
// (port, field). active-low handled inside input.js; we pass pressed = 1/0.
const KEYMAP = {
  ArrowLeft:  ['P1', 'LEFT'],  ArrowRight: ['P1', 'RIGHT'],
  ArrowUp:    ['P1', 'UP'],    ArrowDown:  ['P1', 'DOWN'],
  Space:      ['P1', 'BUTTON1'], KeyZ:     ['P1', 'BUTTON1'],
  Digit1:     ['SYSTEM', 'START1'], Digit2: ['SYSTEM', 'START2'],
  Digit5:     ['SYSTEM', 'COIN1'],
};

// ---- input recorder (T3.1) ---------------------------------------------
// Wraps machine.setInput(); stamps each change with the scheduler frame index.
// Produces a JSONL string matching cdoc/schemas/input-script.md (version 1).
class InputRecorder {
  constructor() {
    this._recording = false;
    this._records = [];
    this._startFrame = 0;
  }

  get recording() { return this._recording; }

  start(currentFrame) {
    this._recording = true;
    this._records = [];
    this._startFrame = currentFrame;
  }

  // Call this instead of machine.setInput() while recording is active.
  record(port, field, value, currentFrame) {
    if (!this._recording) return;
    const frame = currentFrame - this._startFrame;
    this._records.push({ type: 'input', frame, port, field, value });
  }

  stop(currentFrame) {
    this._recording = false;
    const totalFrames = currentFrame - this._startFrame;
    const header = { type: 'header', game: 'berzerk', version: 1, dips: {}, frames: totalFrames };
    const lines = [JSON.stringify(header), ...this._records.map((r) => JSON.stringify(r))];
    return lines.join('\n');
  }
}

let machine = null;
let paused = false;
const recorder = new InputRecorder();

const recBtn = document.getElementById('rec-btn');
const recStatusEl = document.getElementById('rec-status');
const recDl = document.getElementById('rec-dl');

function setRecButtonState(isRecording) {
  recBtn.textContent = isRecording ? 'Stop' : 'Record';
  recBtn.classList.toggle('recording', isRecording);
  recStatusEl.textContent = isRecording ? ' Recording...' : '';
}

recBtn.addEventListener('click', () => {
  if (!machine) return;
  if (!recorder.recording) {
    recorder.start(machine.scheduler.frameCount);
    recDl.style.display = 'none';
    setRecButtonState(true);
  } else {
    const jsonl = recorder.stop(machine.scheduler.frameCount);
    setRecButtonState(false);
    const blob = new Blob([jsonl], { type: 'application/jsonlines' });
    const url = URL.createObjectURL(blob);
    recDl.href = url;
    recDl.style.display = '';
    recStatusEl.textContent = ` Saved (${recorder._records.length || 0} records).`;
  }
});

function installInput() {
  const set = (code, down) => {
    if (code === 'KeyP') { if (down) paused = !paused; return; }
    if (code === 'KeyR') {
      if (down && machine) recBtn.click();
      return;
    }
    const m = KEYMAP[code];
    if (m && machine) {
      machine.setInput(m[0], m[1], down ? 1 : 0);
      if (recorder.recording) {
        recorder.record(m[0], m[1], down ? 1 : 0, machine.scheduler.frameCount);
      }
    }
  };
  window.addEventListener('keydown', (e) => {
    if (KEYMAP[e.code] || e.code === 'KeyP' || e.code === 'KeyR') e.preventDefault();
    set(e.code, true);
  });
  window.addEventListener('keyup', (e) => set(e.code, false));
}

// ---- main loop ----------------------------------------------------------
function startLoop() {
  let acc = 0;
  let last = performance.now();
  function tick(now) {
    acc += now - last;
    last = now;
    if (acc > 250) acc = FRAME_MS;        // avoid spiral-of-death after a stall
    if (!paused) {
      while (acc >= FRAME_MS) { machine.runFrame(); acc -= FRAME_MS; }
    }
    machine.renderToRGBA(rgba);
    ctx.putImageData(image, 0, 0);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function boot(romData) {
  const audio = new WebAudioBackend();
  await audio.init();
  machine = new Machine({ audioBackend: audio });
  machine.loadRoms(romData);
  machine.reset();
  installInput();
  recBtn.disabled = false;
  startLoop();
  status(`Booted. ${FRAME_HZ.toFixed(2)} Hz. Click the page and use the keyboard. R = record.`);
}

document.getElementById('roms').addEventListener('change', async (e) => {
  try {
    const byName = {};
    for (const file of e.target.files) byName[file.name] = new Uint8Array(await file.arrayBuffer());
    const missing = ROM_FILES.filter((f) => !byName[f]);
    if (missing.length) { status(`Missing ROM file(s): ${missing.join(', ')}`); return; }
    await boot(assembleRoms((name) => byName[name]));
  } catch (err) {
    status('Boot failed: ' + err.message);
  }
});

// Optional convenience: if the ROMs happen to be served at ../fixtures/rom/,
// boot automatically without the file picker.
(async () => {
  try {
    const data = await Promise.all(ROM_FILES.map((f) =>
      fetch('../fixtures/rom/' + f).then((r) => { if (!r.ok) throw 0; return r.arrayBuffer(); })));
    const byName = {};
    ROM_FILES.forEach((f, i) => { byName[f] = new Uint8Array(data[i]); });
    status('Found ROMs at fixtures/rom/, booting...');
    await boot(assembleRoms((name) => byName[name]));
  } catch { /* no served ROMs -> wait for the file picker */ }
})();
