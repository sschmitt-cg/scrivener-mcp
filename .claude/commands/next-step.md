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

Check these sources in priority order, **stopping as soon as one yields a clear task**:

1. **Open PRs** — run `gh pr list --state open`. If any PR has unresolved CI
   failures, resume from Step 8 with that PR. Stop here.
2. **Open GitHub issues** — run `gh issue list --state open`. If any exist,
   the highest-priority issue is the task. Stop here.
3. **`BACKLOG.md`** — only if no open issues. Prefer items near the top of
   their phase or that unblock others. If a clear prioritized item exists,
   use it. Stop here.
4. **Generate options** — only if no open issues and no clear backlog item.
   Read `docs/project-vision.md` now, then generate exactly **3 options**:
   - An unstarted or deprioritized BACKLOG item worth revisiting `[BACKLOG]`
   - An innovation based on the project's vision `[NEW IDEA]`

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
- Relevant files the agent cannot reasonably discover on its own (non-obvious entry points, key type definitions, config files with non-standard locations)
- Any constraints specific to this task not already covered by CLAUDE.md

Do not include full conversation history in the handoff prompt.

The implementation agent should:
1. Read `docs/architecture.md` and `docs/project-vision.md` fully before writing
   any code (`CLAUDE.md` is loaded automatically as project instructions)
2. Run all validation gates (per CLAUDE.md) before changes to establish a clean baseline, and again after all changes are complete
3. Follow commit conventions from CLAUDE.md
4. Update `BACKLOG.md` to check off any completed items and add new items that
   emerged from the work; update `docs/project-vision.md` or `docs/architecture.md`
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

Once the review sub-agent gives a clean pass, open a PR:

```
gh pr create --base main
```

Follow CLAUDE.md PR requirements for the description, including the three-section test plan format.

Report the PR URL to the user and proceed to Step 8 automatically (no pause needed — CI monitoring is low cost and expected).

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

After each autonomous fix: record the failure and fix in one line, commit, push, and wait for CI to re-run. Carry only the summary forward — drop raw CI log output.

**After 5 rounds**, regardless of status, stop and report to the user:
- What was resolved
- What remains open
- A recommendation for what to do next

---

## Notes

- Token budget: each sub-agent starts with a fresh context window and has no memory of prior sub-agent runs.
- The `.claude/` directory is version-controlled in this repo (except
  `settings.json` and `settings.local.json`, which are gitignored). Changes to
  commands should be committed on a feature branch like any other code change.
- Shell commands: use one Bash call per action — no `||`, `&&`, or `|` chains
  in diagnostic or discovery commands. Each command runs individually so
  auto-approval can work. This applies to validation gates too: run
  `npm run typecheck`, `npm run lint`, and `npm test` as separate calls.
