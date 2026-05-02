# /next-step

You are an orchestrator. Your job is to identify the single best next piece of
work for this project, confirm it with the user, then run the full pipeline
autonomously: implement → review → open PR → monitor CI. The only gate that
requires user input is the initial task confirmation (Step 3). Everything after
that runs straight through unless a decision is needed that you cannot resolve.

---

## Step 1 — Check conversation context

Before looking anywhere else, review the current conversation thread for any
development path that has already been discussed and agreed upon. If one exists,
that is the task. Skip to Step 3.

---

## Step 2 — Identify the task

If no task was agreed in conversation, determine the best next step by checking
these sources in priority order:

1. **Open PRs** — run `gh pr list --state open` and review. If any PR exists
   with unresolved CI failures, that takes priority over all new work. Resume
   from Step 8 (CI monitoring) with that PR rather than starting something new.
2. **Open GitHub issues** — run `gh issue list --state open` and review. A
   bug report or explicitly filed issue takes priority over backlog items.
3. **`BACKLOG.md`** — scan for unchecked items across all phases. Prefer items
   that are near the top of their phase (higher priority / lower dependency) or
   that unblock other items.
4. **Generate options** — if no issue or backlog item stands out as clearly
   next, generate exactly **3 options**. Each option should be a mix of:
   - An unstarted or deprioritized BACKLOG item worth revisiting `[BACKLOG]`
   - An innovation you are proposing based on the project's vision `[NEW IDEA]`

Before proposing, read **`docs/product-vision.md`** and **`docs/architecture.md`**
to ensure the chosen task (or generated options) aligns with the project's
audiences, platform goals, design principles, and technical constraints.

---

## Step 3 — Propose and confirm

Present the proposed task (or 3 options) to the user in a short paragraph:
- What the task is
- Why it is the right next step (which audience or principle it serves)
- Rough scope (a few hours? a day?)

**Stop here and wait for explicit confirmation before writing any code,
creating any branch, or running any commands.**

If the user modifies the proposal, confirm the adjusted scope before proceeding.

---

## Step 4 — Resolve or create the working branch

Before creating any branch, check for an existing one:

1. Run `git branch --show-current` — if not on `main`, you are already on a
   working branch; use it.
2. Run `git fetch` then `git branch -r --no-merged main` to list all remote
   branches ahead of main. If any appear, present them to the user and ask
   whether one should be used for this task.
3. Run `gh pr list --state open` and check whether any open PR already targets
   this task's scope.

If an existing branch is identified, check it out (`git checkout <branch>`) rather
than creating a new one.

If no matching branch exists, ensure main is current before branching:
- Run `git checkout main`
- Run `git pull`
- Run `git checkout -b feature/<name>`

Never create a branch from any base other than an up-to-date main.

---

## Step 5 — Hand off to implementation agent

Once the user confirms and the branch is resolved, spawn a focused implementation
sub-agent with this context:
- The agreed task description
- The branch name to work on
- Relevant files and components to read first
- Any specific constraints or file paths particularly relevant to this task

The implementation agent should:
1. Read `docs/architecture.md` and `docs/product-vision.md` fully before writing
   any code (`CLAUDE.md` is loaded automatically as project instructions)
2. Run `npx tsc --noEmit`, `npm run lint`, and `npm test` before making changes
   to establish a clean baseline, then again after all changes are complete
3. Make small, focused commits (`feat:` / `fix:` / `refactor:` prefix)
4. Update `BACKLOG.md` to check off any completed items and add new items that
   emerged from the work; update `docs/product-vision.md` or `docs/architecture.md`
   if new design principles, platform constraints, or architectural decisions were
   established
5. **Do not open a PR** — report back with the branch name and a summary of
   all changed files when done

---

## Step 6 — Review sub-agent (up to 5 rounds)

Spawn a focused review sub-agent. Give it:
- The branch name and list of changed files

The review sub-agent should read `docs/architecture.md` and every changed file,
then check for violations of all constraints defined in `CLAUDE.md` and
`docs/architecture.md`. It derives its checklist from those files — the
constraints are fully specified there.

The review sub-agent reports findings. For each finding, apply these rules:

**Fix autonomously (send back to implementation agent):**
- Clear rule violation of any constraint in `CLAUDE.md` or `docs/architecture.md`
- Mechanical style issue: formatting, naming inconsistency

**Stop, summarize, and ask the user:**
- Uncertainty about whether a pattern is intentional or a violation
- A finding that requires a design decision to resolve
- Any situation where you are not confident what the correct fix is

After each autonomous fix round: re-run the review sub-agent. Repeat up to
**5 rounds total**. If issues remain after 5 rounds, report to the user with a
summary of what is unresolved.

---

## Step 7 — Open the PR

Once the review sub-agent gives a clean pass (no findings), open a PR:

```
gh pr create --base main
```

PR description must include:
- What changed and why
- How to test it
- Link to any related GitHub issue in the body so it closes on merge

Report the PR URL to the user and proceed to Step 8 automatically (no pause
needed — CI monitoring is low cost and expected).

---

## Step 8 — Monitor CI and iterate (up to 5 rounds)

Check CI status with `gh pr checks <number>`. Wait 30 seconds between polls;
use `gh run watch` to stream a job that is actively running. For each failure,
apply these rules:

**Fix autonomously:**
- Type error, lint violation, or broken import caused by the implementation
- Failing test caused by the implementation changes

**Stop, summarize, and ask the user:**
- CI failure whose root cause is unclear or requires a design decision
- Any situation where you are not confident what the correct fix is

After each autonomous fix: commit, push, and wait for CI to re-run.

**After 5 rounds**, regardless of status, stop and report to the user:
- What was resolved
- What remains open
- A recommendation for what to do next

---

## Notes

- Token budget: each sub-agent starts with a fresh context window. Keep handoff
  prompts focused — include only what is needed, not the full conversation.
- The `.claude/` directory is version-controlled in this repo (except
  `settings.json` and `settings.local.json`, which are gitignored). Changes to
  commands should be committed on a feature branch like any other code change.
- Shell commands: use one Bash call per action — no `||`, `&&`, or `|` chains
  in diagnostic or discovery commands. Each command runs individually so
  auto-approval can work. This applies to validation gates too: run
  `npx tsc --noEmit`, `npm run lint`, and `npm test` as separate calls.
