# /next-step

You are an orchestrator. Your job is to identify the single best next piece of
work for this project, confirm it with the user, then run the full pipeline
autonomously: implement → review → open PR → monitor CI. The only gate that
requires user input is the initial task confirmation (Step 3). Everything after
that runs straight through unless a decision is needed that you cannot resolve.

---

## Pre-flight

Check for `.claude/settings.local.json`. If the file exists, a previous session
may not have cleaned up. Report to the user: "A session-permissions file from a
previous run exists at `.claude/settings.local.json`. Delete it before
continuing?" Stop and wait for confirmation before proceeding.

---

## Step 1 — Check conversation context

Before looking anywhere else, review the current conversation thread for any
development path that has already been discussed and agreed upon. If one exists,
that is the task. Skip to Step 3.

---

## Step 2 — Identify the task

Check these sources in priority order, **stopping as soon as one yields a clear task**:

1. **Open PRs** — run `gh pr list --state open`. If any PR has unresolved CI
   failures, resume from Step 9 with that PR. Stop here.
2. **Open GitHub issues** — run `gh issue list --state open`. If any exist,
   the highest-priority issue is the task. Stop here.
3. **`BACKLOG.md`** — only if no open issues. Prefer items near the top of
   their phase or that unblock others. If a clear prioritized item exists,
   use it. Stop here.

   **Recurring security audit:** If `BACKLOG.md` contains a security audit item
   with a `last completed` date, run `git log --oneline --after="<date>" | wc -l`
   to count commits since that audit. Treat as immediately due if `last completed`
   is "never"; treat as high priority if more than 20 commits or more than 28 days
   have elapsed since the last audit.

   If `BACKLOG.md` has no `Maintenance` section or no security audit item, include
   adding one as a secondary note in the Step 3 proposal — mention it alongside the
   primary task and give the user the option to decline. Only add it if they agree.
4. **Generate options** — only if no open issues and no clear backlog item.
   Read `docs/project-vision.md` now, then generate **3 options**. Mix backlog
   items and new ideas based on what's available — prefer variety:
   - An unstarted or deprioritized BACKLOG item worth revisiting `[BACKLOG]`
   - An innovation based on the project's vision `[NEW IDEA]`
   - A third option of whichever type adds the most distinct value `[BACKLOG]` or `[NEW IDEA]`

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

Once the user confirms and the branch is resolved:

**5a. Write `.build/session-plan.md`** (create the `.build/` directory if it does not exist):

```
Task: [one sentence]
Approach: [2–3 sentences on implementation strategy]
Key files: [list files most relevant to this task]
Open questions: [any unresolved questions, or "none"]
```

**5b. Generate `.claude/settings.local.json`** tailored to this project's stack.

Inspect the project the same way auto-build does: check for `pnpm-lock.yaml`,
`package.json`, `requirements.txt`/`pyproject.toml`, `.venv/`, `venv/`.

Build the allow list and write it to `.claude/settings.local.json`:

**Always include** — universal git, filesystem, and gh operations:
```
"Bash(ls *)", "Bash(find *)", "Bash(cat *)",
"Bash(git -C * status)", "Bash(git -C * add *)", "Bash(git -C * commit *)",
"Bash(git -C * push *)", "Bash(git -C * pull)", "Bash(git -C * pull *)",
"Bash(git -C * checkout *)", "Bash(git -C * branch *)", "Bash(git -C * diff *)",
"Bash(git -C * log *)", "Bash(git -C * stash *)", "Bash(git -C * show *)",
"Bash(git -C * remote *)",
"Bash(gh pr create *)", "Bash(gh pr view *)", "Bash(gh pr list *)",
"Bash(gh pr checks *)", "Bash(gh run *)", "Bash(gh issue *)"
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

Note: `gh pr merge *` is intentionally excluded — merges require explicit user confirmation in next-step.

**5c. Spawn a focused implementation sub-agent** with this context:
- The agreed task description
- The branch name to work on
- The contents of `.build/session-plan.md`
- Relevant files the agent cannot reasonably discover on its own (non-obvious entry points, key type definitions, config files with non-standard locations)
- Any constraints specific to this task not already covered by CLAUDE.md

Do not include full conversation history in the handoff prompt.

The implementation agent should:
1. **As its absolute first action**, write `.claude/settings.local.json` to its
   current working directory. The orchestrator must supply the **literal JSON
   content** (not a description of it) in the sub-agent's handoff prompt, copied
   verbatim from what was written in Step 5b. This is required because the
   sub-agent may run in a git worktree that does not inherit the orchestrator's
   project settings, and passing literal content prevents the sub-agent from
   reconstructing a different (potentially more permissive) allow list.
2. Read `docs/architecture.md` and `docs/project-vision.md` fully before writing
   any code (`CLAUDE.md` is loaded automatically as project instructions)
3. Run all validation gates (per CLAUDE.md) before changes to establish a clean baseline, and again after all changes are complete
4. Follow commit conventions from CLAUDE.md
5. Update `BACKLOG.md` to check off any completed items and add new items that
   emerged from the work; update `docs/project-vision.md` or `docs/architecture.md`
   if new design principles, platform constraints, or architectural decisions were
   established
6. If the work implements user-visible behavior, check whether `docs/user-guide.md`
   exists and is populated (no `> **Template:**` stub marker). If populated, update
   it to reflect the new behavior as part of this task. Same check for
   `docs/admin-guide.md` if the work touches config, environment variables, or
   deployment. Do not attempt to populate a stub inline — that is handled separately
   in Step 10.
7. If the work adds or removes commands, changes the file/directory structure, or
   affects how the template is used, update `README.md` to reflect the current state.
8. **Do not open a PR** — report back with the branch name and a summary of
   all changed files when done

---

## Step 6 — Review sub-agent (up to 5 rounds)

**Round 1:** Spawn a focused review sub-agent. Give it:
- The branch name and full list of changed files

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

**Rounds 2–5 (follow-up reviews):** After each autonomous fix round, spawn a
new review sub-agent scoped only to what changed. Give it:
- The exact files modified in the most recent fix (not the full original file list)
- A one-line summary of each finding already resolved in prior rounds, so they
  are not re-flagged (e.g. "Round 1: removed what-comments in X — cleared")
- Any files that depend on the changed files and could be affected

The follow-up reviewer reads only those files and checks only for: (a) new
violations introduced by the fix, and (b) any unresolved findings carried
forward. It does not re-read the full diff or re-check files that were not
touched.

After **5 rounds total**, if issues remain, report to the user with a summary
of what is unresolved.

---

## Step 7 — Security review

Spawn a focused security sub-agent. Give it:
- The branch name and full list of changed files

The security sub-agent reads every changed file and checks specifically for:
- Exposed secrets, API keys, or credentials in code, config, or any file that could be committed
- Injection vulnerabilities: SQL, shell command injection, XSS, path traversal
- Sensitive data (tokens, PII, passwords) leaking into logs, error messages, or API responses
- Insecure defaults: disabled TLS validation, overly permissive CORS, missing auth checks
- Dependencies with known CVEs — run `npm audit` or `pip-audit` if applicable and report any findings

Apply the same rules as Step 6 for findings:

**Fix autonomously:**
- Clear security violation with an unambiguous fix (e.g., remove a hardcoded secret, add input sanitization)

**Stop, summarize, and ask the user:**
- Anything requiring a design decision or where the correct fix is unclear

Once the security sub-agent gives a clean pass, proceed to Step 8.

---

## Step 8 — Open the PR

Once both the review and security sub-agents give a clean pass, open a PR:

```
gh pr create --base main
```

Follow CLAUDE.md PR requirements for the description, including the three-section test plan format.

Report the PR URL to the user and proceed to Step 9 automatically (no pause needed — CI monitoring is low cost and expected).

---

## Step 9 — Monitor CI and iterate (up to 5 rounds)

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

## Step 10 — Docs update and cleanup

**Stub check:** Review the list of files changed in this session's PR.

- If any changed file implements user-visible behavior and `docs/user-guide.md`
  still contains the `> **Template:**` stub marker: propose a dedicated follow-on
  docs task to the user. Do not attempt to populate it inline.
- If any changed file touches config, environment variables, or deployment and
  `docs/admin-guide.md` still contains the stub marker: same.
- If the guide docs are already populated, they were updated by the implementation
  agent in Step 5 — no action needed here.
- If neither condition applies (pure refactor, tooling, infrastructure): skip.

Mention any stub docs that need a dedicated pass alongside the PR URL and let the
user decide whether to act now or defer.

**Cleanup:** Delete `.claude/settings.local.json` if it exists. Delete `.build/session-plan.md` if it exists.

---

## Notes

- Token budget: each sub-agent starts with a fresh context window and has no memory of prior sub-agent runs.
- The `.claude/` directory is version-controlled in this repo (except
  `settings.json`, `settings.local.json`, and `.build/`, which are gitignored).
  Changes to commands should be committed on a feature branch like any other code change.
