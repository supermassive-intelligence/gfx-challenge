/**
 * Sound/speech for the Berzerk machine via recorded samples (NOT chip
 * emulation). Decision (cdoc/decisions.md + plan Phase 2): decode the CPU's
 * writes to the audio/speech ports and emit named events; an audio backend
 * plays recorded samples keyed on those events. At the feel bar this is
 * indistinguishable from S14001A/6840 emulation, which stays a later opt-in.
 *
 * The CPU-visible write contract is pinned in cdoc/hardware-berzerk.md Section 7
 * (from berzerk.cpp); section refs are cited inline. Events are keyed by the
 * decoded word address / port -- spec-pure, no semantic vocabulary baked in.
 * (The 30-word speech vocabulary in cdoc/disassembly_analysis.md Section 4.2 is
 * a reference for NAMING the supplied sample files, e.g. 0x08=ALERT, 0x12=INTRUDER.)
 *
 * The audio backend is pluggable: RecordingBackend (tests/headless, logs the
 * event sequence -- no audio files needed), and a WebAudio backend wired in T2.9.
 */

export const AUDIO_BASE = 0x40; // audio ports occupy 0x40-0x47 [Section 3/7]

/** Headless backend: records the emitted event sequence. Needs no sample files. */
export class RecordingBackend {
  constructor() { this.events = []; }
  emit(ev) { this.events.push(ev); }
}

/** No-op backend (default). */
export class SilentBackend {
  emit() {}
}

export class Sound {
  constructor(backend = new SilentBackend()) {
    this.backend = backend;
    // S14001A control state [Section 7]
    this.volume = 0;        // (data>>3)&7, 0-7 (gain = volume/7 at the backend)
    this.clockDivisor = 16; // 16 - (data&7)
  }

  /**
   * Handle a CPU write to an audio port (0x40-0x47). Decodes per Section 7 and
   * emits an event to the backend. Non-audio ports are not this module's concern.
   */
  writePort(port, data) {
    port &= 0xff;
    data &= 0xff;
    const offset = port - AUDIO_BASE;
    if (offset < 0 || offset > 7) return;

    if (offset === 4) { this._speech(data); return; }        // 0x44 S14001A speech
    if (offset === 6) {                                       // 0x46 SFX control (sfxctrl_w)
      this.backend.emit({ kind: 'sfxctrl', port, data });
      return;
    }
    // 0x40-0x43, 0x45, 0x47 -> 6840-based sound board. We do not model the 6840;
    // emit the raw write (which register pattern == which effect is not pinned by
    // Section 7 -- the sample manifest / T2.9 maps it). [Section 7]
    this.backend.emit({ kind: 'sfx', port, data });
  }

  // 0x44 S14001A protocol [Section 7].
  _speech(data) {
    const mode = data >> 6;
    if (mode === 0) {
      // Load 6-bit word address and pulse start -> play that word.
      this.backend.emit({ kind: 'speech', op: 'play', address: data & 0x3f });
    } else if (mode === 1) {
      // Volume + clock-divisor control write.
      this.volume = (data >> 3) & 0x07;
      this.clockDivisor = 16 - (data & 0x07);
      this.backend.emit({ kind: 'speech', op: 'control', volume: this.volume, clockDivisor: this.clockDivisor });
    }
    // modes 2,3 are unused.
  }

  /**
   * S14001A status read (port 0x44). Section 7 does NOT pin the read; sample
   * playback is fire-and-forget, so we report READY (bit 6 set; original-analysis
   * convention: bit6=1 ready, 0 busy). This is a documented timing approximation
   * (no per-utterance busy window) -- see cdoc/decisions.md. The CPU's busy-poll
   * loops therefore exit immediately.
   */
  readStatus() {
    return 0x40; // ready
  }
}
