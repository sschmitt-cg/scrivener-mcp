# /auto-build

Autonomous multi-phase build mode. Carries the project forward from its current
state as far as the user specifies, running the full implementation pipeline on
each backlog item and proceeding automatically when all quality gates pass. Stops
only when something is truly broken or a decision cannot be safely deferred.

---

## Pre-flight

Check for existing session artifacts:

- If `.build/BUILD_PLAN.md` exists: offer to resume the previous build or start
  fresh. If resuming, skip to Phase 3 and continue from the first uncompleted
  item in BUILD_PLAN.md.
- If `.claude/settings.local.json` exists without a BUILD_PLAN.md: warn that a
  stale permissions file exists and offer to clean it up before continuing.

---

## Phase 1 — Clarification

### 1a. Read project state

Read in full: `BACKLOG.md`, `docs/project-vision.md`, `docs/architecture.md`.
Run `gh pr list --state open` and `gh issue list --state open` to check for
in-flight work.

### 1b. Present scope options

List each backlog phase with a one-line summary of its contents. Ask the user
how far they want to build — they may choose a phase boundary (e.g., "through
Phase 1"), specific items by number, or the full backlog. Also offer a custom
option to exclude individual items.

For the selected scope, identify items that appear underspecified or have
implicit prerequisites not yet in the backlog. Flag these with a brief note.

### 1c. Recommend exclusions

Review each item in scope. If an item:
- Requires infrastructure or a dependency not established earlier in the sequence
- Has scope that would likely require revisiting other items
- Is marked as a stretch goal or clearly post-launch

— recommend excluding it and explain why. Present the recommended exclusion list
and ask the user to confirm or override each item.

### 1d. Clarifying questions

Generate the full list of questions needed to implement the selected scope
without interruption. For each question, note what decision it affects and what
the reasonable default is if the user does not specify.

Present all questions at once. Wait for answers before proceeding.

### 1e. Self-check before confirming

Before presenting the final plan, check the following against the answers and
selected scope:

- Is the development sequence dependency-clean? (infrastructure before features,
  data models before UI, auth before protected routes)
- Does every item have enough spec to implement with a reasonable default — i.e.,
  no item requires a cross-cutting design decision to proceed?
- Are there any environment variables, third-party services, or local setup steps
  that must happen before the first item can run?

If gaps are found, resolve them via additional questions before proceeding. If
clean, continue.

### 1f. Confirm with user

Present:
- The final numbered development sequence
- Key decisions made (one line each)
- Items excluded and why
- Prerequisites to run before the build starts (env setup, installs, etc.)

**Stop here and wait for explicit confirmation before proceeding.**

The user may adjust the sequence, swap items in or out, or override any decision.
Incorporate changes and confirm the final plan.

### 1g. Write `.build/BUILD_PLAN.md`

```markdown
# Build Plan

## Scope
[Selected phase(s) or item list]

## Development Sequence
1. [Item name] — [one-line description]
2. ...

## Key Decisions
- [Decision]: [choice made and why]

## Deferred Decisions
- [Decision]: [default chosen, revisit condition]

## Exclusions
- [Item]: [reason]

## Prerequisites
- [Any env setup, global installs, or manual steps to complete before starting]

## Open Questions
[Empty at start — populated during the build]
```

---

## Phase 2 — Setup

### 2a. Front-load prerequisites

For each item in the Prerequisites list from BUILD_PLAN.md:
- Present all prerequisite commands as a grouped list
- Get one confirmation from the user
- Run them sequentially, stopping if any fails

These are the only commands that may operate outside the project directory
(e.g., `npm install -g`, `brew install`, database setup). All subsequent
commands are scoped to the project.

### 2b. Generate `.claude/settings.local.json`

Inspect the project to determine what commands the build will need, then write a
tailored allow list. Check each of the following:

- **Package manager**: presence of `pnpm-lock.yaml` or `pnpm-workspace.yaml` → pnpm;
  else `package.json` → npm. Read `package.json` scripts to confirm the exact test,
  lint, and typecheck command names.
- **Python stack**: presence of `requirements.txt`, `pyproject.toml`, or `setup.py`.
- **Virtual environment**: whether `.venv/` or `venv/` exists (check both).

Build the allow list from these layers and write it to `.claude/settings.local.json`:

**Always include** — universal git, filesystem, and gh operations:
```
"Bash(ls *)", "Bash(find *)", "Bash(cat *)",
"Bash(git -C * status)", "Bash(git -C * add *)", "Bash(git -C * commit *)",
"Bash(git -C * push *)", "Bash(git -C * pull)", "Bash(git -C * pull *)",
"Bash(git -C * checkout *)", "Bash(git -C * branch *)", "Bash(git -C * diff *)",
"Bash(git -C * log *)", "Bash(git -C * stash *)", "Bash(git -C * show *)",
"Bash(git -C * remote *)",
"Bash(gh pr create *)", "Bash(gh pr merge *)", "Bash(gh pr view *)",
"Bash(gh pr list *)", "Bash(gh pr checks *)", "Bash(gh run *)", "Bash(gh issue *)"
```

**npm project**: also add
```
"Bash(npm install *)", "Bash(npm run *)", "Bash(npm test *)",
"Bash(npm audit *)", "Bash(npx tsc *)", "Bash(npx eslint *)", "Bash(npx prettier *)", "Bash(npx create-*)"
```

**pnpm project**: also add
```
"Bash(pnpm install *)", "Bash(pnpm add *)", "Bash(pnpm run *)",
"Bash(pnpm test *)", "Bash(pnpm exec *)", "Bash(npx tsc *)", "Bash(npx eslint *)", "Bash(npx prettier *)", "Bash(npx create-*)"
```

**Python project**: also add
```
"Bash(python -m pytest *)", "Bash(python3 -m pytest *)",
"Bash(python3 -m mypy *)", "Bash(python3 -m ruff *)",
"Bash(pip install *)", "Bash(pip3 install *)"
```

**Python with `.venv/`**: also add
```
"Bash(./.venv/bin/python *)", "Bash(./.venv/bin/python3 *)",
"Bash(./.venv/bin/pip *)", "Bash(./.venv/bin/pytest *)",
"Bash(./.venv/bin/mypy *)", "Bash(./.venv/bin/ruff *)"
```

**Python with `venv/`**: also add
```
"Bash(./venv/bin/python *)", "Bash(./venv/bin/python3 *)",
"Bash(./venv/bin/pip *)", "Bash(./venv/bin/pytest *)",
"Bash(./venv/bin/mypy *)", "Bash(./venv/bin/ruff *)"
```

### 2c. Initialize tracking files

Create `.build/BUILD_QUESTIONS.md`:

```markdown
# Build Questions

## Decisions Made

[Populated as the build proceeds — one entry per decision, in sequence.]

## Open Questions

[Populated if a question arises during the build that is logged and deferred.]
```

Create `.build/BUILD_SUMMARY.md`:

```markdown
# Build Summary

## Status: In Progress

## Items Completed
[Populated as each item merges.]

## Items Remaining
[Full sequence from BUILD_PLAN.md — items removed as they complete.]
```

---

## Phase 3 — Build loop

For each item in the development sequence from BUILD_PLAN.md:

### Per-item pipeline

**3a. Write `.build/session-plan.md`** for this item:

```
Task: [item name and one-sentence description]
Approach: [2–3 sentences on implementation strategy for this specific item]
Key files: [files most relevant to this item]
Decisions: [any decisions from BUILD_PLAN.md relevant to this item]
Open questions: [none, or any item-specific questions to resolve]
```

**3b. Spawn the implementation sub-agent.** Give it:
- The item description from BUILD_PLAN.md
- The branch name to create (`feature/<item-slug>`)
- The contents of `.build/session-plan.md`
- Relevant non-obvious files (entry points, type definitions, config)

The implementation sub-agent must:
1. **As its absolute first action**, write `.claude/settings.local.json` to its
   current working directory. The orchestrator must supply the **literal JSON
   content** (not a description of it) in the sub-agent's handoff prompt, copied
   verbatim from what was written in Phase 2b. This is required because the
   sub-agent may run in a git worktree that does not inherit the orchestrator's
   project settings, and passing literal content prevents the sub-agent from
   reconstructing a different (potentially more permissive) allow list.
2. Read `docs/architecture.md` and `docs/project-vision.md` before writing code
3. Run validation gates before and after all changes
4. Update `BACKLOG.md` to mark the item complete
5. If the work implements user-visible behavior, check whether `docs/user-guide.md`
   exists and is populated (no `> **Template:**` stub marker). If populated, update
   it to reflect the new behavior as part of this task. Same check for
   `docs/admin-guide.md` if the work touches config, environment variables, or
   deployment. Do not attempt to populate a stub inline.
6. If the work adds or removes commands, changes the file/directory structure, or
   affects how the template is used, update `README.md` to reflect the current state.
7. **Do not open a PR** — return only: branch name, changed file list, 3-sentence summary

**3c. Spawn the review sub-agent** (per Step 6 of `/next-step`).

**3d. Spawn the security sub-agent** (per Step 7 of `/next-step`).

**3e. Open PR and monitor CI** (per Steps 8–9 of `/next-step`, up to 5 rounds each).

**3f. Docs and stub check** (per Step 10 of `/next-step`).

**3g. Merge and continue.** Once CI passes:
- Run `gh pr merge <number> --merge --delete-branch`
- Run `git checkout main`
- Run `git pull`
- Append to `.build/BUILD_SUMMARY.md`:
  ```
  ✓ [Item name] — [3-sentence summary] — PR #[n]
  ```
- Proceed to the next item

### Stop conditions

Stop the loop and report to the user when:
- CI fails and the fix requires a design decision (cannot be resolved with a
  reasonable default that is refactorable later without touching other items)
- Two items have a dependency conflict that makes safe ordering impossible
- A prerequisite from Phase 2 was skipped and is now blocking progress
- The build runner context approaches its limit (see Notes)

**Log and continue** (do not stop) when:
- An open question arises that has a reasonable default answer — log it to
  BUILD_QUESTIONS.md (Open Questions section) and proceed with the default
- An item requires a minor refactor to a previously completed item that does
  not affect unrelated code — fold it into the current PR
- CI fails with a mechanical fix (type error, lint, broken import) — fix
  autonomously per the standard pipeline

### Context discipline

Sub-agents return only: branch name, changed file list, 3-sentence summary.
After each merge, write completion status to BUILD_SUMMARY.md and treat the
files as the source of truth. Re-read BUILD_PLAN.md and BUILD_SUMMARY.md from
disk when needed rather than relying on accumulated context.

---

## Phase 4 — Wrap-up

### 4a. Update BUILD_QUESTIONS.md

Move all decisions made during the build into the "Decisions Made" section in
sequence. Summarize all unresolved open questions at the bottom under "Open
Questions". Each entry should note: what the question is, what default was used,
and what condition would trigger revisiting it.

### 4b. Spawn a test-plan sub-agent

Give it:
- The full item list from BUILD_SUMMARY.md
- The complete list of changed files across the build
- `docs/user-guide.md` if it exists and is populated (no `> **Template:**` stub
  marker) — for user-facing flow coverage

The sub-agent produces a comprehensive end-to-end test plan organized by user
flow. It should cover happy paths, key edge cases, and any areas flagged during
security review.

### 4c. Complete BUILD_SUMMARY.md

```markdown
# Build Summary

## Status: Complete

## Items Built
[Full list with PR numbers]

## Items Excluded
[From BUILD_PLAN.md exclusions]

## Key Decisions
[From BUILD_QUESTIONS.md — decisions made]

## Open Questions
[From BUILD_QUESTIONS.md — unresolved, with defaults used]

## End-to-End Test Plan
[From test-plan sub-agent]
```

### 4d. Cleanup

Delete `.claude/settings.local.json`.

Report to the user:
- Build complete (or partial, with reason for stopping)
- PR list with merge status
- Link to `.build/BUILD_SUMMARY.md`
- Any open questions requiring follow-up

---

## Notes

- **Context budget:** Each sub-agent starts fresh. The orchestrator accumulates
  roughly one brief summary per item — for most projects (5–20 items) this is
  well within limits. For very large builds (30+ items), if the orchestrator
  context grows large, stop at a natural phase boundary, report status, and
  offer to continue in a new session (BUILD_PLAN.md and BUILD_SUMMARY.md
  preserve full state for resuming).
- **`.build/` is gitignored.** These files are session artifacts, not project
  history. Add `.build/` to `.gitignore` if not already present.
- **Settings cleanup on crash.** If the build aborts unexpectedly,
  `.claude/settings.local.json` may persist. The Pre-flight check will catch
  this on the next run.
