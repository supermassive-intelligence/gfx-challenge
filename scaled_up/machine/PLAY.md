# PLAY.md — spot-play the HOOKED build (T9.2 HUMAN-GATE)

This is the **hybrid machine**: 37 routines run as pure JavaScript (hooked in place of the
Z80 core), the rest run on the validated Z80 core. The ported routines are
**byte-transparent** — the game looks *identical* hooked vs un-hooked — so you cannot tell
hooks are on by looking at the game. **The live dispatch counter is the proof.** Watch it
climb.

The browser shell installs the port hooks **by default**. There is no build step.

---

## 1. Launch (one command + a URL)

The static server must be rooted at `machine/` so `shell/`, `src/`, `ports/`, and
`fixtures/` all resolve.

```sh
cd /Users/sudnya/checkout/smi/gfx-challenge/scaled_up/machine
python3 -m http.server 8000
```

Then open: **http://localhost:8000/shell/index.html**

(Any static server works: `npx http-server -p 8000`, etc.)

## 2. Point it at the ROMs

The ROMs are user-supplied and live at `gfx-challenge/rom/berzerk/`. Two options:

- **File picker (simplest):** on the page, click "Load ROM set" and select **all** the
  `rom/berzerk/*` files (rom0 + rom1–5; the voice ROMs are optional/ignored). It boots
  immediately.
- **Auto-boot (no picker):** symlink the ROMs into `fixtures/rom/` once, then just reload:
  ```sh
  ln -s ../../../rom/berzerk fixtures/rom    # run from machine/
  ```
  (`fixtures/rom/` is gitignored; the symlink is local-only.)

## 3. CONFIRM HOOKS ARE ACTIVE (this is the point of the gate)

On load you'll see a green badge under the status line:

> **PORT HOOKS: ENABLED (37 routines) — dispatches: N | distinct: M/37**

- The browser **console** also prints `port hooks: ENABLED (37 routines)` on boot. Treat
  that as **weak** — it only proves the install call ran, *not* that routines actually
  dispatch.
- **The real proof is the counter.** As the attract demo runs and as you play, **dispatches**
  must keep climbing into the thousands and **distinct** should reach a large fraction of
  37. If the counter is stuck at 0, hooks are NOT firing — stop and report.

## 3a. Start a game (IMPORTANT — timing matters)

The CPU does not sample the coin/start inputs until **POST finishes (~10 seconds after
boot, ~frame 573)**. A coin pressed during POST is ignored. So:

1. **Wait for the play-state readout to say `READY`** (under the hooks badge):
   > `PLAY STATE: READY — press 5 to insert a coin | CREDITS: 0 | ATTRACT / no game`
   Until then it shows `BOOTING (POST, ~10 s) — wait for READY`.
2. **Tap `5`** (coin). `CREDITS` climbs (`0 → 1`). You do **not** need to hold it — coin and
   start are latched pulses, so a quick tap registers. (If credits don't move, you tapped
   during POST; wait for READY and tap again.)
3. **Tap `1`** (1-player start). The readout flips to `IN GAME (player active)`, `CREDITS`
   drops back to 0 (the credit was spent), and the maze appears.
4. Now **move and fire** — the player is yours.

The `CREDITS` and `IN GAME` readouts are the checkable proof that coin/start work (the
picture alone can't tell you — see §3).

## 4. Controls

| Key | Action |
|-----|--------|
| `5` | insert coin (tap — pulse-latched) |
| `1` | 1-player start (tap) |
| `2` | 2-player start (tap) |
| `←  →  ↑  ↓` | move (hold) |
| `Space` or `Z` | fire (hold/tap) |
| `P` | pause |
| `R` | record an input script (optional) |

Click the page first so it has keyboard focus. Coin/start are **taps** (a fixed-length
pulse fires on keydown); movement/fire are **held** (active while the key is down).

## 5. What to look for (spot-play checklist)

Play a normal game and confirm it behaves like Berzerk, with **no glitches or freezes**:

- [ ] After ~10 s the play-state readout shows **READY**.
- [ ] Tapping `5` makes **CREDITS** climb (the coin registers); tapping `1` flips the readout
      to **IN GAME** and spends the credit.
- [ ] Coin + start enters a **maze** (walls drawn, player man appears).
- [ ] **Robots** are present and **move**; they **shoot** bolts.
- [ ] Your **fire** works; your bolt **kills robots** (collision detected, robot disappears).
- [ ] Robot bolts / robot contact / wall contact **kill you**; you **die and respawn** (or
      game-over after lives run out).
- [ ] **Score increments** when you kill robots; the on-screen digits update.
- [ ] Clearing/leaving a maze **transitions** to the next maze.
- [ ] Evil Otto (the bouncing smiley) appears if you dawdle.
- [ ] No visual corruption, no stuck frame, no runaway behavior — and the **dispatch counter
      keeps climbing** the whole time.

If it plays a normal, indistinguishable game **and** the counter climbs, the gate passes.
(Only Sudnya flips T9.2 → done; do not self-certify.)

## 6. Definitive confidence check — "break a port" (optional, do once)

Because the ports are byte-transparent, here's a way to *prove* the hooks are load-bearing,
not decorative: deliberately swap one ported routine for a wrong version. The hooked game
should diverge; the bare emulator should not.

- **Break it (hooked):** open
  **http://localhost:8000/shell/index.html?breakrandom=1**
  This substitutes a **deliberately-wrong RANDOM** (`0x2678`, clobbers the LCG seed). The
  badge shows `[BREAK-RANDOM TEST]`. Coin up and play into a maze with robots — robot
  spawn/placement/behavior will **diverge from a normal game** (entropy is corrupted).
- **Bare emulator (no hooks):** open
  **http://localhost:8000/shell/index.html?hooks=0**
  The badge turns orange ("PORT HOOKS: OFF"); the game runs on the Z80 core only. Breaking a
  JS port has no effect here (the port isn't used).

If breaking a JS routine breaks **only** the hooked build, the hooks are unquestionably live.

This was also verified **headlessly** (so you don't have to take it on faith): on
`attract-only`, normal-hooks reproduce the un-hooked frame hashes byte-identically for all
3085 frames, while the broken-RANDOM port first diverges at **frame 950** (once the attract
demo starts consuming entropy). See `cdoc/decisions.md` (2026-06-22, play-build gate).

## 7. A/B comparison (optional)

`?hooks=0` runs the bare Z80 emulator. Play the same game with and without `?hooks=0`: it
should feel identical (that's the whole point — the hooks are byte-transparent). The only
visible difference is the badge and the counter.

---

### Notes
- Audio is sample-based and currently mostly silent (samples deferred to T2.8b) — that is
  expected and unrelated to the gate.
- This shell is the **Scope-A** deliverable (the hybrid). It is deliberately **not** the
  pure-JS, core-removed target — that's Scope B (`cdoc/done-definition.md`).
