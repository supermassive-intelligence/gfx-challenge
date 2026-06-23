# Lightweight-trace schema — DRAFT (NOT frozen)

Status: DRAFT for review. Needs a `cdoc/decisions.md` entry + Sudnya sign-off before
freeze, per the schema-freeze discipline. Supersedes nothing yet; the frozen
`cdoc/schemas/input-script.md` is the existing **cold-boot** lightweight trace and is
subsumed here as `start.mode = "cold"`.

## 0. Purpose & pipeline position

A **lightweight trace** is the durable, interactively-capturable artifact that *seeds*
heavyweight capture. It carries **no per-PC / per-invocation detail** — only (a) a
*start state* the machine begins from, and (b) the per-frame input/event log. Heavyweight
capture is produced by deterministically **re-emulating** a lightweight trace; per-PC and
component state are reproduced by that re-emulation, not stored here (see
`cdoc/architecture-review.md` §3 Phase 4).

**The one invariant — the seed contract:** a lightweight trace MUST pin everything needed
for a *bit-identical re-emulation*. Everything downstream rests on this.

## 1. Two start modes

| mode | seed | when to use | seed-contract burden |
|------|------|-------------|----------------------|
| `cold` | cold reset + the input log | start a run from power-on (hand-authored scripts, or interactive capture that begins at boot) | trivial: cold reset is a fully-known anchor; inputs alone suffice |
| `snapshot` | a complete machine-state snapshot taken at a frame boundary | start from a played-to / deep state (e.g. "level 19") with no cold-boot prefix to replay | **high: the snapshot must be COMPLETE or replay silently diverges** |

`cold` is preferred whenever the start state is reachable by replaying a recorded input
prefix (it cannot be incomplete). `snapshot` is for states you reached by playing and
cannot/again-do-not-want-to replay to.

## 2. Record structure

```jsonc
{ "type":"header", "schema":"lightweight-trace/1", "game":"berzerk",
  "rom_set":"RC31", "dips":{ "F3.Language":"English", ... },
  "provenance":{ "captured":"2026-..-..", "tool":"frame_capture_toggle",
                 "machine_version":"...", "note":"level 19, hit toggle" },
  "start":{ "mode":"cold" | "snapshot",
            "window_start_frame": 0,        // capture/interest begins here
            "snapshot": { ...§3... }         // present iff mode=="snapshot"
  } }
// then one record per frame with inputs (see §4), frame indices RELATIVE to start.
```

## 3. The snapshot state blob (mode = "snapshot") — MUST be complete

Every field below affects future execution. Omitting any one causes silent divergence
on replay. Taken **at a frame boundary** so timing is canonical (frame start = vpos 0 /
cycle 0), which removes the intra-frame cycle position as a field.

**CPU** (`cpu.getState()` — the whole thing):
- `a,f,b,c,d,e,h,l`, the **shadow set** `a',f',b',c',d',e',h',l'`,
- `ix, iy, sp, pc`, `i`, **`r`** (refresh — yes, include it),
- `iff1, iff2, im` (interrupt-enable flip-flops + interrupt mode).

**Mutable memory** (ROM is NOT included — it is immutable and reconstructed from
`rom_set`):
- NVRAM / work RAM `0x0800–0x0BFF` (1 KB),
- VRAM `0x4000–0x5FFF` (8 KB) — note the 0x6000 magic window shares this backing, so it
  is NOT a separate region,
- color RAM `0x8000–0x87FF` (2 KB).
- (~11 KB total.)

**Magic-RAM / video component latches** (NOT memory, NOT registers — the state we kept
circling; reads alone never surface it):
- magic **control register** (port 0x4B value: S3–S0 / flip / shift),
- **shift latch** (`last_shift_data`, the across-byte-boundary source),
- **intercept / collision flop**.

**Interrupt / scheduler state**:
- NMI-enable latch, IRQ-enable latch (port 0x4F),
- any held/pending IRQ + its data-bus vector,
- the frame-phase anchor (canonical at a frame boundary; record `frameCount` for the
  capture's own indexing). NOTE: the game's interrupt-phase counter `0x089F/0x08A0` lives
  in NVRAM and is therefore already captured by the memory block — do not double-count it,
  but do confirm it is inside the 0x0800–0x0BFF range.

**Input latches**: the currently-held field state of P1/P2/SYSTEM/DIP ports, so the first
replayed frame starts from the correct latched inputs.

**Explicitly OUT of scope (cosmetic, sampled, never reaches VRAM/gameplay logic):** the
S14001A / 6840 sound-chip internal state. Sound is sample-based (T2.8); the seed need not
restore it. If a future feel-bar failure makes sound stateful, revisit.

## 4. Per-frame input/event log

Identical in spirit to `input-script.md`: one record per frame, frame index **relative to
`window_start_frame`** (frame 0 = the start state above), each carrying the input/port
events for that frame, applied at the **vblank boundary** so CPU sampling is
deterministic. DIP overrides live in the header, not per-frame.

```jsonc
{ "frame": 0, "inputs":[ {"port":"SYSTEM","field":"COIN1","value":1}, ... ] }
```

## 5. Seed contract (restated, normative)

> Re-emulating from `start` and applying the event log MUST reproduce the captured
> session bit-identically — including every emulated-component state change PC-by-PC.

For `cold` this holds by construction. For `snapshot` it holds **iff §3 is complete.**

## 6. Round-trip validation (required before trusting a snapshot)

Because snapshot completeness can fail silently, every snapshot capture path MUST be
validated:
- **Determinism:** seed a fresh machine from the snapshot, run forward twice → byte-
  identical (proves the seed is self-consistent).
- **Completeness (strong, when a reproducible prefix exists):** during a `cold` run, take
  a snapshot at frame N; seed a fresh machine from it; confirm it matches the `cold` run
  *continued past N* — byte-identical frame hashes. A missing latch fails this
  immediately. This is the gate that catches an incomplete §3.
- **Completeness (weak, for genuinely played-to states):** seed from the snapshot, run
  forward, and compare against the original interactive run's continuation.

Same "self-validation gates incompleteness" discipline used elsewhere: an incomplete
snapshot fails the round-trip, it does not silently produce a wrong trace.

## 7. Granularity — one seed, not per-frame snapshots

A lightweight trace carries **one** seed snapshot (or a cold anchor) plus the per-frame
**inputs**. The inputs are the essential ongoing content — they drive the deterministic
re-execution that produces heavyweight traces. A movie of per-frame full snapshots would
be huge *and* useless for heavyweight capture (no execution to instrument). Additional
snapshots are OPTIONAL **checkpoints** only (resync anchors / to bound replay length),
never required for correctness.

## 8. Open decisions before freeze
- Confirm the exact `cpu.getState()` field names match what the snapshot writes/reads.
- Confirm the mutable-memory region list against `machine/src/memory.js` (esp. that all
  work RAM is within 0x0800–0x0BFF and nothing else is written by the game).
- Decide the snapshot encoding (inline base64 vs sidecar binary) — ~11 KB + latches.
- Decide whether `window_start_frame` (capture-region marker for a `cold` trace, §1) and
  `snapshot` are mutually exclusive or composable.
