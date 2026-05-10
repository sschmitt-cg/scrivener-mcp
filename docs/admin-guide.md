# [Project Name] — Admin Guide

> **Template:** Replace this content with documentation for administrators and operators. Cover configuration, deployment, and maintenance. Keep it current as the system evolves — the `Factual accuracy` rule in CLAUDE.md applies here.

---

## Overview

[What this system does at a high level, from an operational perspective. 2–3 sentences.]

## Requirements

[Infrastructure, runtime dependencies, and access requirements.]

- Node.js vXX / Python 3.X / etc.
- [Database or service]
- [Any required external accounts or credentials]

## Configuration

### Environment Variables

| Variable | Required | Description | Example |
|---|---|---|---|
| `EXAMPLE_VAR` | Yes | [What it controls] | `value` |
| `OPTIONAL_VAR` | No | [What it controls] | `default` |

Copy `.env.example` to `.env` and fill in values before running.

## Deployment

[How to deploy the application — commands, platform, and any manual steps.]

```bash
# example
npm run build
npm start
```

## Database / Migrations

[How to run migrations or seed data, if applicable.]

## Monitoring & Logs

[What to watch and where to find logs. Include any alerting setup.]

## Backup & Recovery

[What needs to be backed up and how to restore it.]

## Troubleshooting

### [Common Issue]

**Symptom:** [What the admin sees]
**Cause:** [Why it happens]
**Resolution:** [How to fix it]

### [Common Issue]

**Symptom:** [What the admin sees]
**Cause:** [Why it happens]
**Resolution:** [How to fix it]
