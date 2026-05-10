# CLAUDE.md

Instructions for Claude Code. These rules apply to all work unless a prompt explicitly overrides them.

---

## Standard project files

Every project using this template contains these files. Read them at the start of
every session — they are the authoritative source for product context, technical
constraints, and current work status.

| File | What it contains |
|---|---|
| `docs/project-vision.md` | Product goals, target audiences, and design principles |
| `docs/architecture.md` | Tech stack, architectural constraints, and key file map |
| `BACKLOG.md` | Phased feature backlog and current development status |
| `INBOX.md` | Raw ideas routed here from the Apple Notes inbox — not authoritative |
| `SCRATCH.md` | In-session working space for discussion and exploration before committing |
| `.claude/commands/next-step.md` | Orchestration logic for the `/next-step` slash command |
| `.claude/commands/auto-build.md` | Orchestration logic for the `/auto-build` slash command |

---

## Behavior rules

### Firm document protection
`docs/project-vision.md` and `BACKLOG.md` are authoritative records. Before making
any edit to either file — including wording changes, priority shifts, or additions —
propose the change clearly and wait for explicit confirmation. Never edit them silently.

`INBOX.md` and `SCRATCH.md` are working surfaces. They can be freely updated during
sessions without confirmation.

### Documentation maintenance
`docs/user-guide.md` and `docs/admin-guide.md` are user-facing documents — keep them current alongside code changes:
- When implementing a feature with user-visible behavior, update `docs/user-guide.md`.
- When making configuration, environment variable, or deployment changes, update `docs/admin-guide.md`.
- If either file still contains the stub template (check for the `> **Template:**` marker), propose a comprehensive docs update as a dedicated follow-on task rather than attempting it inline.

### Inbox workflow
When the user asks to process the inbox, read `INBOX.md`, discuss how the items map
to the project vision and backlog, propose any changes to `docs/project-vision.md` or
`BACKLOG.md`, and wait for confirmation before writing those changes. Once applied,
clear the processed items from `INBOX.md`.

### Before writing any code
For any **significant design or architectural decision** (new component structure,
state shape change, API design, navigation pattern, data model, etc.), propose
**3 distinct options with tradeoffs** and wait for a choice before writing code.
For small, unambiguous tasks this step can be skipped.

### When requirements are unclear
Ask rather than assume. One short clarifying question is better than building
the wrong thing.

### Factual accuracy
- **Claude in session:** Verify claims before asserting them. Do not rely on training data for specifics that change over time (library versions, API behavior, current events). Search for current information, check official docs, or explicitly flag uncertainty. Never fabricate citations, version numbers, URLs, or behavior descriptions.
- **App runtime:** When the project presents factual data to end users, source it from a reliable, current source rather than a static snapshot or hardcoded value. Any code path that generates factual content via an LLM or AI model must include a runtime verification step before presenting it to the user — grounding against a trusted source, a fact-check pass, or explicit attribution. Never allow unverified model output to reach the user as fact. Code review must flag any fact-generation path that lacks this verification layer.

### TypeScript
- Never use `any` without a comment on the same line explaining why.
- Prefer explicit return types on exported functions.
- Prefix intentionally unused parameters with `_` (e.g., `_event`) to satisfy
  `noUnusedParameters` — do not disable the rule.

### Code style
- Comments explain *why*, never *what*.
- No boilerplate or generated comments.
- Favor naming clarity over inline documentation.
- Do not add comments or type annotations to code you didn't change.

### Shell commands
Run each shell command as a separate Bash call. Do not chain commands with `&&`, `||`, or `|` unless the compound form is the only practical way to achieve the result.

**Acceptable pipes** — these are the only cases where `|` or `||` is justified:
- `cmd | head -N` / `cmd | tail -N` — capping verbose output
- `cmd | grep <pattern>` — filtering output from a read-only source command
- `cmd | jq <expr>` — transforming structured output
- `cmd | base64 -d` — decoding (e.g. `gh api` content fields)
- `read-only-cmd 2>/dev/null || echo "fallback"` — existence/probe checks where the
  source is a read-only command (`cat`, `ls`, `lsof`, `test`, etc.). Never use this
  form with a mutating source — `rm … || echo` is not acceptable.

**Never use `cd <path> && <command>` as a single call.** This is the most common
violation. `cd` persists between Bash calls — always issue it as its own call first:
```
# Wrong
cd "/path/to/project" && npm run typecheck

# Right
cd "/path/to/project"
npm run typecheck
```

All other `&&` and `||` chains are prohibited. Run them as separate Bash calls.

### Scope discipline
- Only modify files relevant to the current task.
- Do not refactor surrounding code opportunistically.
- Do not add features, error handling, or validation beyond what was asked.

---

## Git workflow

### Branching
- All work happens on a feature or fix branch: `feature/<name>` or `fix/<name>`.
- Never commit directly to `main`.
- Never merge branches automatically.
- Never force-push.

**Before every `git commit`:** run `git branch --show-current` as a separate prior Bash call and confirm the output is not `main`. If it is `main`, stop and tell the user instead of committing.

### Commits
- Small, focused commits with present-tense messages
  (e.g., `feat: add HarmonyGrid component`, `fix: enharmonic pref not persisting`).
- One logical change per commit — don't batch unrelated edits.

### Pull requests
- Open PRs with `gh pr create` targeting `main`.
- PR description must include: what changed, why, and a test plan (see format below).
- Link any related GitHub issue in the body so it closes on merge.
- Do not create a PR for exploratory or review-only work.

**Test plan format** — three explicit sections:
- **CI (automatic):** tests that run on every push (type check, lint, unit tests via GitHub Actions)
- **Automated:** commands a reviewer can run locally to verify (e.g., `npm test -- --testPathPattern=foo`)
- **Manual:** steps requiring human interaction (e.g., launch the app, tap X, confirm Y)

### Validation before every commit
Run all three gates and confirm zero errors:
```
npm run typecheck
npm run lint
npm test
```

### Git safety
- If a git operation fails (conflict, missing remote, permissions), stop, report
  the issue, and suggest the minimal manual resolution.
- Do not attempt to resolve merge conflicts automatically.
