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
import { makePortHook } from '../src/port-hook.js';
import { PORTS, PORT_META } from '../ports/index.js';

const FRAME_HZ = CPU_CLOCK / CYCLES_PER_FRAME;          // 59.64 Hz
const FRAME_MS = 1000 / FRAME_HZ;

// ---- PORT HOOKS (T9.2 HUMAN-GATE play build) ----------------------------
// The 37 ported JS routines are byte-transparent (hooked == un-hooked), so the
// game LOOKS identical with or without them. The live dispatch counter below is the
// ONLY way to confirm hooks are actually firing -- watch it climb. Defaults ON;
// `?hooks=0` runs the bare emulator (Z80 core only) for A/B comparison.
//   `?breakrandom=1` swaps in a DELIBERATELY-WRONG RANDOM port (clobbers the LCG seed)
// as a one-time confidence check: hooked -> entropy/robots visibly diverge; un-hooked
// (?hooks=0) -> normal. If breaking a JS port breaks ONLY the hooked game, hooks are
// unquestionably live. Use once, then play the real (un-broken) build.
const HOOK_PARAMS = new URLSearchParams(location.search);
const HOOKS_ON = HOOK_PARAMS.get('hooks') !== '0';
const BREAK_RANDOM = HOOK_PARAMS.get('breakrandom') === '1';
let hookDispatches = 0;
const hookSeen = new Set();

function brokenRandom(ctx) {
  // Deliberately wrong: pin the LCG seed (0x435C) + A to a constant so downstream
  // entropy (robot spawn/placement/AI) diverges visibly. NOT the real RANDOM.
  ctx.mem.w16(0x435c, 0x1234);
  ctx.regs.a = 0x12;
  ctx.cycles = 140;
}

// Build the live PORTS map: wrap each port to count dispatches (and distinct routines);
// optionally substitute the broken RANDOM for the confidence check.
function buildLivePorts() {
  const m = new Map();
  for (const [pc, fn] of PORTS) {
    const routine = (BREAK_RANDOM && pc === '0x2678') ? brokenRandom : fn;
    m.set(pc, (ctx) => { hookDispatches++; hookSeen.add(pc); routine(ctx); });
  }
  return m;
}

const hooksBadge = document.getElementById('hooks-badge');
function updateHooksBadge() {
  if (!HOOKS_ON) {
    hooksBadge.className = 'off';
    hooksBadge.textContent = 'PORT HOOKS: OFF (bare Z80 emulator) — reload without ?hooks=0 to enable';
    return;
  }
  hooksBadge.className = 'on';
  hooksBadge.textContent =
    `PORT HOOKS: ENABLED (${PORTS.size} routines)${BREAK_RANDOM ? ' [BREAK-RANDOM TEST]' : ''}`
    + ` — dispatches: ${hookDispatches.toLocaleString()} | distinct: ${hookSeen.size}/${PORTS.size}`;
}

// ---- COIN/START PULSE + play-state readout -------------------------------
// WHY: the CPU does not poll the input ports until POST completes (~frame 573 ~ 10 s;
// see cdoc/entropy-berzerk.md sec4). A coin/start pressed during POST is released
// before the CPU ever samples it, so it never credits. Two harness fixes:
//   1. Coin/start are LATCHED PULSES: a tap holds the line active for PULSE_FRAMES
//      emulated frames (auto-released), so a brief keypress reliably spans the CPU's
//      per-frame sample window. (Movement/fire stay momentary keydown/keyup.)
//   2. On-screen readouts -- READY (POST done), CREDITS (decoded from CMOS 0x08A4/0x08A5),
//      and ATTRACT vs IN-GAME (port 0x48 / P1 joystick is only polled during a live
//      game) -- so you can SEE the coin register and the game start. Because the ports
//      are byte-transparent, these readouts (and the hook counter) are the checkable
//      evidence, not the picture.
const PULSE_FIELDS = new Set(['SYSTEM:COIN1', 'SYSTEM:START1', 'SYSTEM:START2']);
const PULSE_FRAMES = 12;                 // > the CPU's per-frame sample window
const pulses = new Map();                // "PORT:FIELD" -> emulated frames remaining
// Apply an input AND mirror it to the recorder, so recorded scripts reflect the actual
// line state (incl. the pulse auto-release) rather than the raw key event.
function applyInput(port, field, value) {
  machine.setInput(port, field, value);
  if (recorder.recording) recorder.record(port, field, value, machine.scheduler.frameCount);
}
function pulseTick() {                    // call once per emulated frame
  for (const [key, n] of pulses) {
    if (n <= 1) { const [p, f] = key.split(':'); applyInput(p, f, 0); pulses.delete(key); }
    else pulses.set(key, n - 1);
  }
}

let postReady = false;                   // CPU has begun sampling input (POST done)
let p48reads = 0, p48prev = 0, inGame = false;
function trackInputReads() {             // wrap input.readAddress to observe port polling
  const orig = machine.input.readAddress.bind(machine.input);
  machine.input.readAddress = (addr) => {
    const a = addr & 0xff;
    if (a === 0x49) postReady = true;    // first SYSTEM poll == POST complete
    if (a === 0x48) p48reads++;          // P1 joystick poll == active gameplay
    return orig(a);
  };
}
function creditsBCD() {                   // mirror GET_CREDITS_AS_BCD (0x18E0)
  const lo = machine.memory.read8(0x08a4) & 0xf0;
  const hi = (machine.memory.read8(0x08a5) >> 4) & 0x0f;
  return ((lo | hi) & 0xff).toString(16); // BCD nibbles read as decimal digits
}
const playReadout = document.getElementById('play-readout');
function updatePlayReadout() {
  const ready = postReady ? 'READY — press 5 to insert a coin' : 'BOOTING (POST, ~10 s) — wait for READY';
  playReadout.textContent =
    `PLAY STATE: ${ready} | CREDITS: ${creditsBCD()} | ${inGame ? 'IN GAME (player active)' : 'ATTRACT / no game'}`;
}

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
    // Record ABSOLUTE frames from cold boot (not relative to the Record click). The
    // input-script schema (cdoc/schemas/input-script.md) replays from hardware reset, so a
    // deterministic trace must carry boot-absolute frame stamps -- this makes the captured
    // script reproduce the EXACT session played (same boot -> same entropy -> same maze ->
    // the same kills), regardless of when Record was pressed.
    this._startFrame = 0;
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
      const key = `${m[0]}:${m[1]}`;
      if (PULSE_FIELDS.has(key)) {
        // Coin/start: a keydown fires a fixed-length pulse (auto-released by pulseTick);
        // keyup is ignored so a brief tap still spans the CPU's sample window.
        if (down) { applyInput(m[0], m[1], 1); pulses.set(key, PULSE_FRAMES); }
      } else {
        applyInput(m[0], m[1], down ? 1 : 0);   // movement/fire: momentary
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
      while (acc >= FRAME_MS) { pulseTick(); machine.runFrame(); acc -= FRAME_MS; }
    }
    machine.renderToRGBA(rgba);
    ctx.putImageData(image, 0, 0);
    // IN-GAME = the CPU polled the P1 joystick (port 0x48) since the last readout tick.
    inGame = p48reads > p48prev; p48prev = p48reads;
    if (HOOKS_ON) updateHooksBadge();      // live proof hooks are dispatching
    updatePlayReadout();                   // READY / CREDITS / ATTRACT-vs-IN-GAME
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
  trackInputReads();                       // observe port polling for the play readouts
  if (HOOKS_ON) {
    machine.cpu.installPortHook(makePortHook(buildLivePorts(), PORT_META, machine.scheduler));
    // Weak confirmation (proves the install call ran, NOT that dispatch happens -- the
    // climbing on-page counter is the real proof):
    console.log(`port hooks: ENABLED (${PORTS.size} routines)`
      + `${BREAK_RANDOM ? ' [BREAK-RANDOM confidence test active -- expect divergence]' : ''}`);
  } else {
    console.log('port hooks: DISABLED (bare Z80 emulator)');
  }
  updateHooksBadge();
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
