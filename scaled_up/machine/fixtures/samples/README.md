# Berzerk sound samples (user-supplied, never committed)

T2.8 decodes the CPU's audio-port writes into events; a WebAudio backend (wired
in T2.9) plays a recorded sample per event. Drop your sample audio here. These
files are gitignored on purpose (see `.gitignore`) — they are user-sourced.

Tests do NOT need any files here (they use the recording backend).

## Event keys to provide samples for

`machine/src/sound.js` emits spec-pure events (cdoc/hardware-berzerk.md §7):

- **Speech** — `{ kind:'speech', op:'play', address:<0..0x3f> }`
  One sample per spoken word, keyed by the 6-bit S14001A word address. Suggested
  filename: `speech_<hex>.wav` (e.g. `speech_12.wav`). The 30-word vocabulary is
  in `cdoc/disassembly_analysis.md` §4.2 for naming reference, e.g.
  `0x05`=SHOOT, `0x08`=ALERT, `0x0f`=HUMANOID, `0x12`=INTRUDER, `0x19`=FIGHT,
  `0x1c`=ROBOT.
- **SFX** — `{ kind:'sfx', port:<0x40-0x43,0x45,0x47>, data:<byte> }`
  Raw 6840 register writes. Which write pattern maps to which effect is NOT
  pinned by §7 (we don't model the 6840); identifying SFX triggers from these
  writes is part of supplying samples / the T2.9 backend.
- **SFX control** — `{ kind:'sfxctrl', port:0x46, data:<byte> }`.

The mapping from event → file is owned by `manifest.json` (loaded by the T2.9
WebAudio backend), NOT by sound.js — the decoder stays address-keyed and
spec-pure (decision: option (a), cdoc/decisions.md 2026-06-12).

## manifest.json format

`manifest.json` IS committed (it is the event→file contract, not audio). Shape:

```json
{
  "speech": { "0x12": "speech_intruder_alert.wav", "0x08": "speech_alert.wav" },
  "sfx":    { }
}
```

- `speech` keys are the S14001A word address formatted as `"0x" + address.toString(16)`
  (lowercase, no zero-padding): e.g. event `{speech, play, address:0x12}` → key
  `"0x12"`. Value is the filename in this directory.
- `sfx` mapping (6840 register-write patterns → effect samples) is TBD — §7 does
  not decode the 6840, so the trigger identity is determined during audition /
  T2.9. Leave `{}` until that scheme is settled.

Populate `speech` from the MAME 0x44-write capture (word address logged as each
phrase plays) + audition; the same addr→identity→filename table is recorded as
T2.8 provenance in cdoc/decisions.md.

