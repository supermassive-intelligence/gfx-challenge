# SETUP.md — one-time pre-flight before Phase A

> Run these steps **once** when you start with a fresh Kubernetes pod. After this, every subsequent SSH session into the same pod skips to `phases/phase_a.md`'s entry criteria.

There are two layers:

- **Step 0** — your laptop. Configure SSH so pod rotations don't break you. Have OpenCode credentials ready.
- **Step 1** — the pod, first time. Project root, reference repo, ROMs, SingleStepTests corpus, deploy the `c-cowork/` bundle, OpenCode auth.

When both steps are done, jump to `phases/phase_a.md` → **Before you start — entry criteria** and verify.

---

## Paths cheat sheet — the three "berzerks"

These three paths get confused often. Pin them in your head before you start:

| Path | Lives on | What it is | Expected ROM count |
|---|---|---|---|
| `/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk/` | **laptop** | Your local working copy, source of truth for ROMs | 8 |
| `/home/user/sudnya/checkout/gfx-challenge/rom/berzerk/` | **pod** | Reference repo (cloned in Step 1.2). Empty of ROMs — they're not in the git remote. | **0 (expected)** |
| `/home/user/sudnya/checkout/orbits/games/arcade/berzerk/rom/berzerk/` | **pod** | **Project root** — where `opencode --agent berzerk` runs. ROMs arrive here via Step 1.4 deploy. | 8 |

When `phase_a.md` says "verify ROMs are present", it means the **third** path. When SETUP.md says "tar the ROMs from the laptop", it means transferring from the **first** to the **third**.

---

## Step 0 — Laptop side

### 0.1 SSH config block for pod rotation resilience

k8s pods rotate. Their host keys change. Without the right `~/.ssh/config`, you'll fight SSH every time the pod gets rescheduled. Add this block to `~/.ssh/config`:

```sshconfig
Host pod-*
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ProxyJump ssh.scalarlmforge.com
    ForwardAgent yes
```

`StrictHostKeyChecking no` + `UserKnownHostsFile /dev/null` is fine here because the pod is ephemeral and you don't care about host-key persistence. `ForwardAgent yes` lets `git clone` on the pod use your laptop's SSH keys. `ProxyJump ssh.scalarlmforge.com` routes through the scalarlm jumphost.

Verify:

```bash
POD=pod-XXXXXXXX                  # substitute your pod name
ssh -A "$POD" 'echo ok && hostname'
```

If that prints `ok` and the pod hostname, you're good.

### 0.2 OpenCode auth (one-time)

You'll log into OpenCode **on the pod** (Step 1.6), not on the laptop, because OpenCode runs there. But have your scalarlm credentials handy — typically an API key or token for `nvidia/Gemma-4-31B-IT-NVFP4` served via `scalarlmforge.com`.

If you've already used OpenCode + scalarlm on this pod before, the credentials persist at `~/.opencode/` (or `~/.config/opencode/`) on the pod. A pod rotation wipes them. Keep the credentials accessible (1Password, a local note, whatever) so re-auth is fast.

---

## Step 1 — Pod side (first time on a fresh pod)

### 1.1 SSH in

```bash
ssh -A pod-XXXXXXXX
```

Confirm you have sudo + apt-get + no Docker:

```bash
sudo -n true && echo "sudo ok"
command -v apt-get && echo "apt ok"
command -v docker 2>/dev/null && echo "WARNING: docker present, ignore it" || echo "no docker (expected)"
```

### 1.2 Clone the reference repo (read-only, for rule R4)

The reference repo is the Claude Code build of the same Berzerk project. The agent reads from it occasionally (only with your permission per R4). It needs to be present on the pod or those reads can't happen.

```bash
mkdir -p /home/user/sudnya/checkout
cd /home/user/sudnya/checkout
git clone git@github.com:supermassive-intelligence/gfx-challenge.git
cd gfx-challenge
git checkout sudnya.hd_v0     # or whichever branch holds the reference build
```

Verify the docs and source are present:

```bash
ls /home/user/sudnya/checkout/gfx-challenge/cdoc/ | head            # expect architecture.md, disassembly.md, ...
ls /home/user/sudnya/checkout/gfx-challenge/noweb/ | head           # expect main.nw, memory.nw, video.nw, ...
```

**ROM files:** the `rom/berzerk/` directory in the git remote may be empty or missing — arcade ROMs are typically not checked into source-controlled repos (copyright reasons). If `ls /home/user/sudnya/checkout/gfx-challenge/rom/berzerk/ | wc -l` is less than 8, that's expected. ROMs come from your laptop in Step 1.4 (deploy bundle includes them) and Step 1.6 (verify).

### 1.3 Create the project root

The project root is where `opencode --agent berzerk` will run. It's a separate path from the reference repo:

```bash
mkdir -p /home/user/sudnya/checkout/orbits/games/arcade/berzerk
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk
```

If `/home/user/sudnya/checkout/orbits/` should be its own git repo, clone it now. Otherwise just creating the directory is fine for the experiment.

### 1.4 Deploy the c-cowork bundle + ROMs from laptop to pod

**Run this from your laptop**, in a separate terminal. Use two separate tar pipes — one for the runbook, one for ROMs. Splitting them avoids a macOS-BSD-tar quirk where a `-C` interleaved with positional file args mid-stream can silently drop the pre-`-C` segment.

```bash
cd /Users/sudnya/checkout/smi/gfx-challenge
POD=pod-XXXXXXXX

# Confirm ROMs are present locally before deploy:
ls rom/berzerk/ | wc -l        # expect 8

# 1. Ship the c-cowork bundle (contents land at the project root).
COPYFILE_DISABLE=1 tar czf - -C c-cowork . \
  | ssh "$POD" "tar xzf - -C /home/user/sudnya/checkout/orbits/games/arcade/berzerk"

# 2. Ship ROMs in a second pipe (preserves the rom/berzerk/ prefix).
COPYFILE_DISABLE=1 tar czf - rom/berzerk \
  | ssh "$POD" "tar xzf - -C /home/user/sudnya/checkout/orbits/games/arcade/berzerk"
```

`COPYFILE_DISABLE=1` suppresses macOS-only `LIBARCHIVE.xattr.com.apple.provenance` warnings on extract. The `-C c-cowork .` form in pipe 1 tars the *contents* of `c-cowork/` (not the folder itself) so files land at the project root.

**Alternative — `rsync` for ROMs.** Useful if you'll iterate on the ROM set or want incremental sync semantics:

```bash
rsync -av --no-perms rom/berzerk/ \
  "$POD:/home/user/sudnya/checkout/orbits/games/arcade/berzerk/rom/berzerk/"
```

**Verification runs on the pod, not the laptop.** SSH into the pod in a separate terminal first:

```bash
# === ON YOUR LAPTOP: open a new terminal and SSH in ===
ssh -A pod-XXXXXXXX

# === NOW ON THE POD ===
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk
ls -la
# Expect: goals.md, MILESTONES.md, README.md, SETUP.md, phases/, .opencode/, scripts/, rom/
test -f goals.md && test -f MILESTONES.md && test -f phases/phase_a.md && test -f .opencode/agent/berzerk.md && echo "OK runbook"
test -x scripts/host-bootstrap.sh && echo "OK bootstrap script"
test -d rom/berzerk && [ "$(ls rom/berzerk/ | wc -l)" -eq 8 ] && echo "OK roms (8 files)"
```

> ⚠ **Common confusion:** `/home/user/sudnya/...` is a path **on the pod (Linux)**. macOS has no `/home/user/` — running `ls /home/user/...` on your laptop will say "No such file or directory" no matter how the deploy went. The xattr warnings you saw from `tar xzf` came from the pod, which means tar extracted successfully there. Always re-SSH to the pod to verify.

If `rom/berzerk/` is missing or empty **after running the above on the pod**, the second tar pipe failed silently. Diagnose, on the pod, with:

```bash
find /home/user/sudnya/checkout/orbits/games/arcade/berzerk -maxdepth 4 -name '*.rom*' -o -name 'berzerk_*'
```

If ROMs landed somewhere unexpected, move them with `mv`. If they didn't land at all, retry pipe 2 alone from the laptop, or fall back to `rsync` per the alternative above.

### 1.5 Pre-fetch SingleStepTests Z80 corpus

The Z80 test suite for Phase C lives at a canonical path. **Do NOT clone into `tests/z80/`** — that was the V2 mistake. The right path is `third_party/SingleStepTests/z80/`.

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk
mkdir -p third_party
[ -d third_party/SingleStepTests/z80/.git ] || \
  git clone https://github.com/SingleStepTests/z80.git third_party/SingleStepTests/z80
ls third_party/SingleStepTests/z80/v1/ | wc -l    # expect ~1812 JSON files
```

The `[ -d ... ] || git clone ...` guard makes this idempotent — safe to re-run after a pod rotation.

### 1.6 Verify ROMs landed on the pod

ROMs were transferred in Step 1.4 (laptop → pod tar/rsync). Confirm the 8 files are at the project-root path:

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk
ls rom/berzerk/ | wc -l                            # expect 8
ls rom/berzerk/                                    # expect: 6 RC31A ROMs + 2 voice ROMs
```

Expected filenames (per `cdoc/architecture.md`):

```
berzerk_rc31_1c.rom0.1c
berzerk_rc31_1d.rom1.1d
berzerk_rc31_3d.rom2.3d
berzerk_rc31_5d.rom3.5d
berzerk_rc31_6d.rom4.6d
berzerk_rc31a_5c.rom5.5c
berzerk_r_vo_1c.1c
berzerk_r_vo_2c.2c
```

If `ls rom/berzerk/ | wc -l` is less than 8, Step 1.4's tar/rsync failed for ROMs. Either:

- Re-run Step 1.4's tar pipe (idempotent — re-extracting overwrites with same content).
- Or rsync just the ROMs: `rsync -av rom/berzerk/ "$POD:/home/user/sudnya/checkout/orbits/games/arcade/berzerk/rom/berzerk/"` from the laptop.

ROMs are *inputs*, not work product, so rule R4 explicitly permits this transfer without per-file approval — they're treated like the SingleStepTests corpus.

### 1.7 (Recommended) Run the bootstrap script yourself

`scripts/host-bootstrap.sh` ships with the `c-cowork/` bundle (Step 1.4 deploys it). It's idempotent — re-running is a no-op once all packages are installed. Run it once at setup so the toolchain is ready before OpenCode starts; that way Phase A.1 just verifies presence instead of installing.

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk
test -x scripts/host-bootstrap.sh && echo "OK script present"
sudo bash scripts/host-bootstrap.sh
command -v g++ notangle noweave pdflatex python3   # expect 5 non-empty paths
```

**If `scripts/host-bootstrap.sh` is missing**, Step 1.4's deploy didn't include the `scripts/` directory. Two fixes:

- Re-run Step 1.4's first tar pipe from the laptop (the `c-cowork/` bundle now includes `scripts/`).
- Or paste the canonical script into your pod shell directly — heredoc copy of the same content lives in `phases/phase_a.md` A.1 Step 4.

**Option A vs B trade-off:** Step 1.7 (this step) is the "Option B" path — you install the toolchain manually so A.1 becomes a thin verify. The "Option A" alternative is to skip Step 1.7 and let Gemma write+run the script as A.1's canary test (good for stress-testing Gemma's multi-step bash discipline, but adds an OpenCode round-trip). Pick A or B based on whether you want to debug Gemma's drift surface or the toolchain first. The default recommendation here is **B** — installs are deterministic; let Gemma earn its keep on the harder phases.

### 1.8 OpenCode auth on the pod

```bash
opencode auth login    # or whatever the current scalarlm-auth command is
# Confirm the scalarlm provider + model are reachable:
opencode models | grep -i gemma     # expect at least one Gemma-4-31B line
```

If `opencode` is missing, install it per scalarlm's docs (probably `curl -fsSL https://opencode.ai/install | bash` or similar — check current docs). Verify version with `opencode --version`.

---

## Pre-flight check (after Step 0 + Step 1 are done)

Run `phases/phase_a.md` → **Before you start — entry criteria** in Terminal 2 on the pod. Every line should print `OK` or the expected count. If anything fails, fix it before launching OpenCode.

When pre-flight passes, launch OpenCode in Terminal 1:

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk
opencode --agent berzerk
```

…and follow `phases/phase_a.md` from "Session start (Terminal 1 — OpenCode)" onward.

---

## Recovery after a pod rotation

If the pod gets rescheduled (new pod name, fresh disk), almost everything in Step 1 has to be redone:

- 1.1 SSH in (new pod name).
- 1.2 Re-clone the reference repo.
- 1.3 Re-create project root.
- 1.4 Re-deploy `c-cowork/` **+ ROMs** from laptop (combined tar — ROMs travel with the bundle).
- 1.5 SingleStepTests git clone (idempotency guard makes this a no-op if disk is reused; safe to run).
- 1.6 Verify ROMs landed (no copy step — they came in via 1.4).
- 1.7 (optional) Re-run bootstrap.
- 1.8 OpenCode re-auth.

The `session_status.md` file may or may not persist depending on whether the pod's `/home/user/` is on a persistent volume. Check before assuming. If it's gone, restart from Phase A; if it's preserved, M1 will resume from the last `pass` line.

---

## Things you can skip on subsequent SSH sessions (after the first time)

Once the pod is set up, every subsequent SSH session needs only:

1. SSH in.
2. `cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk`.
3. Open two terminals (Terminal 1 for OpenCode, Terminal 2 for verify).
4. Run pre-flight check (the entry-criteria block in `phases/phase_a.md`).
5. `opencode --agent berzerk` in Terminal 1.
6. First message: "Begin. Execute the three M1 startup reads. Report and STOP."

You do not need to redo Step 0 (laptop SSH config persists), Step 1.2–1.6 (reference repo + ROMs + SingleStepTests persist on the pod's disk if the volume is persistent), Step 1.7 (bootstrap is idempotent — re-running is harmless but unnecessary), or Step 1.8 (auth persists across SSH sessions until token expires).
