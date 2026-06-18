# c-cowork/ — driver-mode Berzerk runbook

This folder contains everything authored in the Cowork session that pivoted the Berzerk experiment from "give Gemma a 582-line contract and hope" to "the user drives turn-by-turn." It is a deployable bundle: tar this folder to the pod and the layout drops in cleanly on top of the project root.

## What's here

```
c-cowork/
├── README.md                       ← this file
├── SETUP.md                        ← one-time pod pre-flight (SSH, deploy, ROMs, test corpus, auth)
├── goals.md                        ← agent contract (Gemma reads at session start)
├── MILESTONES.md                   ← your runbook (you read this)
├── phases/
│   └── phase_a.md                  ← Phase A subtasks (B-H to follow)
├── scripts/
│   └── host-bootstrap.sh           ← idempotent apt installer (canonical; SETUP.md Step 1.7 runs it)
└── .opencode/
    └── agent/
        └── berzerk.md              ← OpenCode system prompt + YAML config
```

## Who reads what

| File | Audience | When |
|---|---|---|
| `.opencode/agent/berzerk.md` | Gemma (in OpenCode) | Every turn — this IS the system prompt OpenCode loads. The YAML frontmatter declares the model, tools, and permissions; the markdown body is the literal system message. |
| `goals.md` | Gemma | Once per session, via the Read tool at M1 startup. The minimum contract: paths, no-Docker fact, labeled tool-use rules, the M1 startup ritual itself. |
| `MILESTONES.md` | You | Whenever you're between phases or need the panic table. Top-level index — how to drive Gemma, phase summary, format conventions, panic responses, definition of done. |
| `phases/phase_*.md` | You | When driving a phase. Each subtask has a literal "Paste this to Gemma" block plus a "Run this yourself in Terminal 2" verify line. |

You drive from `MILESTONES.md` and the per-phase files. The agent files (`goals.md` + `.opencode/agent/berzerk.md`) exist so Gemma has a tiny, consistent bedrock to refer to. The two-layer split is intentional:

- **System prompt** (`.opencode/agent/berzerk.md`, ~60 lines) is short so it doesn't eat Gemma's context window. It's always loaded into the system message.
- **Contract** (`goals.md`, ~95 lines) is the deeper reference Gemma reads on demand at session start. It contains the labeled rules (E1–E4, B1–B2, W1–W3, R1, R4, F1, F3, C4, C5) and the path invariants.

## How OpenCode finds the system prompt

OpenCode looks for agent files at `<cwd>/.opencode/agent/<agent-name>.md`. When you run:

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk
opencode --agent berzerk
```

OpenCode reads `.opencode/agent/berzerk.md` from the cwd. The YAML frontmatter at the top of that file (`model:`, `tools:`, `permission:`, etc.) configures the session; the body becomes Gemma's system prompt.

So when you deploy this bundle to the pod, the `.opencode/agent/berzerk.md` file lands at the project root and OpenCode picks it up automatically.

## How to deploy to the pod

From your laptop, at the repo root:

```bash
cd /Users/sudnya/checkout/smi/gfx-challenge
POD=pod-XXXXXXXX

# Tar only the c-cowork contents (not the c-cowork/ folder itself),
# so files land at the project root on the pod.
COPYFILE_DISABLE=1 tar czf - -C c-cowork . \
  | ssh "$POD" "tar xzf - -C /home/user/sudnya/checkout/orbits/games/arcade/berzerk"
```

After this, the pod has:

```
/home/user/sudnya/checkout/orbits/games/arcade/berzerk/
├── goals.md
├── MILESTONES.md
├── phases/phase_a.md
├── .opencode/agent/berzerk.md
└── (existing project files: rom/, third_party/, session_status.md, etc.)
```

Then in OpenCode on the pod:

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk
opencode --agent berzerk
```

…and follow `phases/phase_a.md` from there.

## Relationship to the retired V3 docs

The V3 attempt is preserved in `../cdoc/_retired/`:

- `PROMPTING_GUIDE.md` — the 860-line human runbook V3 used. Most of its content is folded into `MILESTONES.md` and `phases/phase_*.md` in the new bundle.
- `PHASE_EXPECTATIONS.md` — per-phase expected outcomes from the reference build. Folded into the per-phase files' Known Gotchas and Exit Criterion sections.
- `atomic_tasks.md` — V3's Phase A task queue (12 tasks). Replaced by `phases/phase_a.md` (6 subtasks).
- `goals.md.v3` — the 582-line V3 contract. Replaced by `c-cowork/goals.md` (~95 lines).
- `opencode-agent-berzerk.md.v3` — the V3 system prompt. Replaced by `c-cowork/.opencode/agent/berzerk.md` (~60 lines).

You can `diff` any pair if you want to see what changed.

## When to come back to this folder

- After each Phase X is complete: add `phases/phase_x+1.md` (Cowork-authored).
- If a Phase B–H session reveals format problems: edit the relevant `phases/phase_*.md` and re-deploy.
- If Gemma's drift patterns shift: edit `goals.md` (labeled rules) and `.opencode/agent/berzerk.md` (system prompt cheatsheet), then re-deploy.

Everything in this folder is meant to be edited and re-deployed. It is not a museum piece.
