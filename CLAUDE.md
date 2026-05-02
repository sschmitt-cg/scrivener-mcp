# CLAUDE.md

Instructions for Claude Code. These rules apply to all work unless a prompt explicitly overrides them.

---

## Standard project files

Every project using this template contains these files. Read them at the start of
every session — they are the authoritative source for product context, technical
constraints, and current work status.

| File | What it contains |
|---|---|
| `docs/product-vision.md` | Product goals, target audiences, and design principles |
| `docs/architecture.md` | Tech stack, architectural constraints, and key file map |
| `BACKLOG.md` | Phased feature backlog and current development status |
| `.claude/commands/next-step.md` | Orchestration logic for the `/next-step` slash command |

---

## Behavior rules

### Before writing any code
For any **significant design or architectural decision** (new component structure,
state shape change, audio API design, iOS navigation pattern, etc.), propose
**3 distinct options with tradeoffs** and wait for a choice before writing code.
For small, unambiguous tasks this step can be skipped.

### When requirements are unclear
Ask rather than assume. One short clarifying question is better than building
the wrong thing.

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

### Commits
- Small, focused commits with present-tense messages
  (e.g., `feat: add HarmonyGrid component`, `fix: enharmonic pref not persisting`).
- One logical change per commit — don't batch unrelated edits.

### Pull requests
- Open PRs with `gh pr create` targeting `main`.
- PR description must include: what changed, why, and how to test it.
- Link any related GitHub issue in the body so it closes on merge.
- Do not create a PR for exploratory or review-only work.

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
