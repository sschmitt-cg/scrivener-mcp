# Testing the Scrivener MCP

There are three kinds of tests:

- **Automated** — `node:test` assertions that create Scrivener projects, call the `ScrivenerProject` class directly, and verify every read and write operation produces the expected output. No human needed; all 85 pass or fail on their own.
- **Compatibility** — A second automated suite that pushes test projects through a real Scrivener open/save cycle and re-asserts all values, catching format mismatches that only manifest inside Scrivener. Requires macOS with Scrivener installed; auto-skips otherwise.
- **In-app** — After the automated tests run, open the generated projects in Scrivener and work through the checklists below to confirm the data looks correct in the UI.

---

## Running the tests

```bash
npm test              # fast suite (read + write, ~270 ms) — no Scrivener required
npm run test:read     # read tests only  (~60 ms)
npm run test:write    # write tests only (~200 ms)
npm run test:compat   # Scrivener round-trip compatibility (~15–25 s, macOS + Scrivener required)
```

### Compatibility tests

`test:compat` opens each test project in Scrivener via AppleScript, waits for Scrivener to process and auto-save it, closes the document, then re-reads the project with our code and asserts all values are intact. This catches bugs that only appear when Scrivener rewrites the XML (e.g. the `fix/scrivener-id-format` regression).

**Prerequisites:**
- macOS with `/Applications/Scrivener.app` installed
- Scrivener should not already have the test projects open
- If tests are unexpectedly slow or flaky, set `SCRIV_WAIT_SECS=10` to give Scrivener more processing time

The suite auto-skips gracefully when Scrivener is not present, so it is safe to run on any machine.

Each run **recreates** two Scrivener projects from scratch. Where they land depends on whether `SCRIV_DIR` is set:

| `SCRIV_DIR` set? | Project location |
|-----------------|-----------------|
| Yes | `$SCRIV_DIR/test/MCP Test Suite.scriv` and `$SCRIV_DIR/test/MCP Write Tests.scriv` |
| No  | `test/scratch/MCP Test Suite.scriv` and `test/scratch/MCP Write Tests.scriv` |

Using `SCRIV_DIR` puts the test projects right alongside your real projects, so Scrivener's file browser finds them without any extra navigation. The `test/scratch/` fallback is gitignored.

The projects are overwritten on every run, so they always reflect the most recent test execution.

> **Important:** Close Scrivener before running the write tests, or Scrivener's auto-save will overwrite the changes the tests make. Reopen the projects after `npm test` finishes.

---

## What the test data covers

Both projects are created from the same fixture (`test/fixtures.js`):

### Labels
| Name | Color |
|------|-------|
| Action | Red |
| Romance | Pink |
| Character | Blue |
| World-Building | Green |

### Statuses
`To Do` · `In Progress` · `First Draft` · `Revised Draft` · `Done`

### Manuscript structure
```
Manuscript
└── Act I — Setup
│   ├── Chapter 1 — The World Begins
│   │   ├── Scene 1.1 — Opening Image       (Action / Done / compile ✓)
│   │   ├── Scene 1.2 — The Ordinary World  (Action / First Draft / compile ✓)
│   │   └── Scene 1.3 — EXCLUDED            (Action / To Do / compile ✗)
│   └── Chapter 2 — Inciting Incident
│       ├── Scene 2.1 — The Letter Arrives  (Romance / Revised Draft)
│       └── Scene 2.2 — First Meeting       (Romance / In Progress / no content)
└── Act II — Confrontation
    ├── Chapter 3 — Rising Stakes
    │   └── Scene 3.1 — The Complication    (Action / First Draft)
    └── Chapter 4 — Midpoint
        └── Scene 4.1 — All Is Lost         (Action / To Do / no content)
```

### Research structure
```
Research
├── Characters
│   ├── Hero Profile    (Character label)
│   └── Villain Profile (Character label)
└── World Notes
    └── Map Notes       (World-Building label)
```

---

## In-app verification — Read test project

Open `test/scratch/MCP Test Suite.scriv` in Scrivener.  
This project is **not modified** by the tests — it should look exactly as created.

### Binder
- [ ] Manuscript › Act I › Chapter 1 contains three scenes
- [ ] Manuscript › Act I › Chapter 2 contains two scenes
- [ ] Manuscript › Act II › Chapter 3 contains one scene
- [ ] Manuscript › Act II › Chapter 4 contains one scene
- [ ] Research › Characters contains Hero Profile and Villain Profile
- [ ] Research › World Notes contains Map Notes
- [ ] Trash is empty

### Inspector (select each item below, check the right-hand Inspector panel)

**Scene 1.1 — Opening Image**
- [ ] Label: Action (red dot)
- [ ] Status: Done
- [ ] Include in Compile: ✓ checked

**Scene 1.3 — EXCLUDED**
- [ ] Label: Action (red dot)
- [ ] Status: To Do
- [ ] Include in Compile: ✗ unchecked

**Scene 2.2 — First Meeting**
- [ ] Label: Romance (pink dot)
- [ ] Status: In Progress

**Hero Profile**
- [ ] Label: Character (blue dot)

### Corkboard (select Chapter 1, switch to corkboard view)
- [ ] Three index cards appear: "Opening Image", "The Ordinary World", "EXCLUDED"
- [ ] Scene 1.1 card synopsis: *The hero wakes at dawn.*
- [ ] Scene 1.3 card synopsis: *A cut scene.*

### Text editor (click each scene to open it)
- [ ] Scene 1.1: body text is *The sun rose over the hills.*
- [ ] Scene 2.1: body text is *The envelope bore no return address.*
- [ ] Scene 2.2: body text is **empty**
- [ ] Scene 4.1: body text is **empty**
- [ ] Hero Profile: body contains *Name: Alex*, *Age: 28*, *Goal: Find the treasure.*

---

## In-app verification — Write test project

Open `test/scratch/MCP Write Tests.scriv` in Scrivener.  
This project starts identical to the read project, then the write tests mutate it. The changes below should all be visible.

### `writeContent` — Text editor
- [ ] Scene 2.2 (now "Eyes Meet"): *They locked eyes across the crowded room.*
- [ ] Scene 1.1 — Opening Image: *The moon set over quiet hills.* (original overwritten)
- [ ] Scene 3.1 — The Complication: *First line. / Second line. / Third line.*

### `writeSynopsis` — Corkboard / Inspector synopsis field
- [ ] Scene 4.1 — All Is Lost: *Everything the hero built comes crashing down.*
- [ ] Scene 1.1 — Opening Image: *Updated synopsis text.*

### `updateMetadata` — Inspector (select each item)

| Item | What changed | Expected value |
|------|-------------|----------------|
| Scene 1.2 | Title renamed | *Scene 1.2 — The New Normal* |
| Scene 2.1 — The Letter Arrives | Synopsis | *A coded message changes the hero's destiny.* |
| Scene 3.1 — The Complication | Label | Romance (pink dot) |
| Scene 4.1 — All Is Lost | Status | Revised Draft |
| Scene 1.1 — Opening Image | Include in Compile | ✗ unchecked |
| Scene 1.3 — EXCLUDED | Include in Compile | ✓ checked (toggled back) |
| Scene 2.2 | Title | *Scene 2.2 — Eyes Meet* |
| Scene 2.2 | Synopsis | *A chance encounter in the market square.* |
| Scene 2.2 | Status | First Draft |

### `addItem` — Binder structure
- [ ] Chapter 4 — Midpoint now has **2** children: Scene 4.1 and *Scene 4.2 — The Twist*
- [ ] Scene 4.2 body text: *Nobody saw it coming.*
- [ ] Act II — Confrontation now has **3** chapters (Chapter 3, 4, and *Chapter 5 — Resolution*)
- [ ] *Epilogue* appears as a direct child of Manuscript (top level, after Act II)

### `moveItem` — Binder structure
- [ ] Chapter 1 — The World Begins now has **2** children (Scene 1.3 was moved out)
- [ ] Chapter 2 — Inciting Incident now has **3** children (Scene 1.3 moved in)
- [ ] Scene 1.3 — EXCLUDED body still reads: *This was cut.*
- [ ] Scene 1.3 — EXCLUDED synopsis still reads: *A cut scene.*
- [ ] *Scene 2.1 — The Letter Arrives* appears as a direct child of Manuscript (top level)

---

## Interpreting test failures

```
✖ Scene 1.1 has correct labelId, statusId, includeInCompile, and synopsis
  AssertionError: '1' !== '3'
```

The assertion message always shows `actual !== expected`. If a label or status ID is wrong, the fixture IDs are defined in `test/fixtures.js` under `LABEL_IDS` and `STATUS_IDS` — compare against those values.

For write tests, failures after `project.reload()` mean the change was not persisted to the `.scrivx` file. Failures without `reload()` mean the in-memory state wasn't updated correctly.

If the write test project already existed and Scrivener had it open when you ran the tests, Scrivener's auto-save will have overwritten the changes — close Scrivener first, rerun, then open.
