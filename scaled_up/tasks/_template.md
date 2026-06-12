# T<phase>.<n> — <Title>
Phase: <n>   Depends-on: <task ids or "none">   Status: pending | in-progress | awaiting-human | done | blocked
(awaiting-human: machine-checkable work complete, HUMAN-GATE items unverified.
Only the human may set `done` on tasks containing HUMAN-GATE items.)

## Context
2–3 sentences. Link the exact cdoc sections needed — do not make the session
read the whole plan.

## Entry criteria
Checkable preconditions (normally the verification commands of dependencies).
- [ ] ...

## Task
What to build/change. Files expected to be touched.

## Out of scope
Explicit non-goals to prevent scope creep mid-session.

## Definition of done
- [ ] Each item phrased as a runnable check, or marked HUMAN-GATE.

## Verification
```
<literal command(s); task is done iff exit 0>
```
