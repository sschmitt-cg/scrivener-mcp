/**
 * Scrivener round-trip compatibility tests.
 *
 * Verifies that:
 *  1. Projects we generate survive a Scrivener open/save cycle without
 *     data loss or ID-scheme rewrites (regression guard for the status-ID
 *     bug caught in fix/scrivener-id-format).
 *  2. Every write operation we support (content, synopsis, metadata,
 *     addItem, moveItem) produces output that Scrivener preserves when
 *     it opens and re-saves the project.
 *
 * The suite automatically skips when /Applications/Scrivener.app is absent.
 * Set SCRIV_WAIT_SECS in the environment to override the default open delay
 * on slower machines (default: 6).
 *
 * Run with:  npm run test:compat
 * (Takes ~15–25 s — two Scrivener open/save cycles.)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createTestProject, buildTitleMap, findOutlineNode,
} from './helpers.js';
import { STATUS_IDS, LABEL_IDS, EXPECTED_ITEM_COUNT } from './fixtures.js';

// Scrivener may live inside a .localized bundle or in ~/Applications
const SCRIVENER_SEARCH_PATHS = [
  '/Applications/Scrivener.app',
  '/Applications/Scrivener.localized/Scrivener.app',
  `${process.env.HOME}/Applications/Scrivener.app`,
];
const SCRIVENER_FOUND = SCRIVENER_SEARCH_PATHS.some(existsSync);
const WAIT_SECS = parseInt(process.env.SCRIV_WAIT_SECS ?? '6', 10);

const SKIP_REASON = SCRIVENER_FOUND
  ? undefined
  : 'Scrivener.app not found in /Applications — install Scrivener to run compatibility tests';



// Opens a .scriv project in Scrivener and waits for format processing.
// Scrivener rewrites the .scrivx on first open (ID normalisation, missing
// elements, etc.) and auto-saves within ~2 s of the change, so waitSecs
// guarantees the rewrite is flushed to disk before we check.
//
// After the wait we attempt to close the document cleanly. Scrivener 3's
// AppleScript dictionary does not expose close on the object returned by
// `open`, so we close by document name via the standard suite. If that
// also fails the project stays open in Scrivener — the data is already on
// disk from auto-save, so the assertions can proceed normally.
function scrivenerRoundTrip(scrivPath, waitSecs = WAIT_SECS) {
  const safePath = scrivPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  // Document name as Scrivener displays it: filename without .scriv
  const docName  = scrivPath.split('/').pop().replace(/\.scriv$/, '');
  const safeDoc  = docName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const runScript = (lines, opts = {}) => {
    const f = join(tmpdir(), `scriv-${Date.now()}.applescript`);
    writeFileSync(f, lines.join('\n'), 'utf8');
    try {
      execSync(`osascript "${f}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        ...opts,
      });
    } finally {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  };

  // Step 1: Open + wait (hard failure — if Scrivener can't open, abort)
  runScript([
    'tell application "Scrivener"',
    '    activate',
    `    open POSIX file "${safePath}"`,
    `    delay ${waitSecs}`,
    'end tell',
  ], { timeout: (waitSecs + 20) * 1000 });

  // Step 2: Close by name (soft failure — auto-save already flushed data)
  try {
    runScript([
      'tell application "Scrivener"',
      `    close document "${safeDoc}"`,
      'end tell',
    ], { timeout: 10000 });
  } catch {
    // Project stays open in Scrivener — pause briefly to let any
    // in-flight write finish before the caller reads the file.
    execSync('sleep 1', { stdio: 'ignore' });
  }
}

describe('Scrivener round-trip compatibility', { skip: SKIP_REASON }, () => {

  // ── Phase 1: creation integrity ────────────────────────────────────────────
  // Create a fresh project → Scrivener open/save → verify nothing was lost
  // or corrupted. This is the primary regression guard: if Scrivener rewrites
  // our ID scheme (as it did before fix/scrivener-id-format), the status and
  // label assertions will catch it immediately.

  describe('Phase 1 — creation integrity after Scrivener open/save', () => {
    let project;
    let uuids;

    before(() => {
      project = createTestProject('MCP Compat — Creation');
      uuids = buildTitleMap(project);
      console.log(`\nPhase 1 project: ${project.scrivPath}`);
      console.log(`  Opening in Scrivener (waiting ${WAIT_SECS}s for format processing)…`);
      scrivenerRoundTrip(project.scrivPath);
      project.reload();
      console.log('  Done.');
    });

    // ── Binder structure ──────────────────────────────────────────────────────

    it('all binder items are still present', () => {
      assert.equal(project.flattenBinder().length, EXPECTED_ITEM_COUNT);
    });

    it('Manuscript hierarchy is intact — Act I has 2 chapters', () => {
      const actI = findOutlineNode(project.getOutline(), 'Act I — Setup');
      assert.equal(actI.children.length, 2);
    });

    it('Research hierarchy is intact — Characters has 2 profiles', () => {
      const chars = findOutlineNode(project.getOutline(), 'Characters');
      assert.equal(chars.children.length, 2);
    });

    // ── Statuses (regression guard) ───────────────────────────────────────────
    // Before fix/scrivener-id-format, Scrivener replaced our status list with
    // its own defaults on open, shifting every status by +1.

    it('getStatuses() still contains all five custom status names', () => {
      const names = new Set(Object.values(project.getStatuses()));
      for (const name of ['To Do', 'In Progress', 'First Draft', 'Revised Draft', 'Done']) {
        assert.ok(names.has(name), `Status "${name}" missing after Scrivener round-trip`);
      }
    });

    it('[regression] Scene 1.3 status resolves to "To Do"', () => {
      assert.equal(
        findOutlineNode(project.getOutline(), 'Scene 1.3 — EXCLUDED').status,
        'To Do',
      );
    });

    it('[regression] Scene 2.2 status resolves to "In Progress"', () => {
      assert.equal(
        findOutlineNode(project.getOutline(), 'Scene 2.2 — First Meeting').status,
        'In Progress',
      );
    });

    it('Scene 1.1 status resolves to "Done"', () => {
      assert.equal(
        findOutlineNode(project.getOutline(), 'Scene 1.1 — Opening Image').status,
        'Done',
      );
    });

    it('Scene 2.1 status resolves to "Revised Draft"', () => {
      assert.equal(
        findOutlineNode(project.getOutline(), 'Scene 2.1 — The Letter Arrives').status,
        'Revised Draft',
      );
    });

    // ── Labels ────────────────────────────────────────────────────────────────

    it('getLabels() still contains all four custom label names', () => {
      const names = new Set(Object.values(project.getLabels()));
      for (const name of ['Action', 'Romance', 'Character', 'World-Building']) {
        assert.ok(names.has(name), `Label "${name}" missing after Scrivener round-trip`);
      }
    });

    it('Scene 1.1 label resolves to "Action"', () => {
      assert.equal(
        findOutlineNode(project.getOutline(), 'Scene 1.1 — Opening Image').label,
        'Action',
      );
    });

    it('Scene 2.2 label resolves to "Romance"', () => {
      assert.equal(
        findOutlineNode(project.getOutline(), 'Scene 2.2 — First Meeting').label,
        'Romance',
      );
    });

    it('Hero Profile label resolves to "Character"', () => {
      assert.equal(
        findOutlineNode(project.getOutline(), 'Hero Profile').label,
        'Character',
      );
    });

    // ── IncludeInCompile ──────────────────────────────────────────────────────

    it('Scene 1.3 includeInCompile is still "No"', () => {
      assert.equal(
        project.findItem(uuids['Scene 1.3 — EXCLUDED']).MetaData.IncludeInCompile,
        'No',
      );
    });

    it('Scene 1.1 includeInCompile is still "Yes"', () => {
      assert.equal(
        project.findItem(uuids['Scene 1.1 — Opening Image']).MetaData.IncludeInCompile,
        'Yes',
      );
    });

    // ── Content & synopsis ────────────────────────────────────────────────────

    it('Scene 1.1 plain-text content is preserved through RTF round-trip', () => {
      assert.equal(
        project.readContent(uuids['Scene 1.1 — Opening Image']),
        'The sun rose over the hills.',
      );
    });

    it('multi-line content (Hero Profile) is preserved', () => {
      const text = project.readContent(uuids['Hero Profile']);
      assert.ok(text.includes('Name: Alex'), 'missing Name line');
      assert.ok(text.includes('Age: 28'),    'missing Age line');
    });

    it('Scene 2.2 has no content (empty string) after round-trip', () => {
      assert.equal(project.readContent(uuids['Scene 2.2 — First Meeting']), '');
    });

    it('Scene 1.1 synopsis is preserved', () => {
      assert.equal(
        project.readSynopsis(uuids['Scene 1.1 — Opening Image']),
        'The hero wakes at dawn.',
      );
    });

    it('Act I synopsis is preserved', () => {
      assert.equal(
        project.readSynopsis(uuids['Act I — Setup']),
        'The world and hero are introduced.',
      );
    });

    after(() => {
      console.log(`  Phase 1 project left at: ${project.scrivPath}`);
    });
  });

  // ── Phase 2: write round-trip ──────────────────────────────────────────────
  // Apply every write operation → Scrivener open/save → verify all mutations
  // survived. One round-trip covers all write types in a single pass.

  describe('Phase 2 — write operations survive Scrivener open/save', () => {
    let project;
    let uuids;
    let addedUuid;

    before(() => {
      project = createTestProject('MCP Compat — Writes');
      uuids = buildTitleMap(project);
      console.log(`\nPhase 2 project: ${project.scrivPath}`);

      // writeContent ──────────────────────────────────────────────────────────
      project.writeContent(uuids['Scene 1.1 — Opening Image'], 'The stars shone at midnight.');
      project.writeContent(uuids['Scene 2.2 — First Meeting'], 'Their hands touched briefly.');

      // writeSynopsis ─────────────────────────────────────────────────────────
      project.writeSynopsis(
        uuids['Scene 4.1 — All Is Lost'],
        'The hero stands alone in the wreckage.',
        'Scene 4.1 — All Is Lost',
      );

      // updateMetadata — title ────────────────────────────────────────────────
      project.updateMetadata(uuids['Scene 1.2 — The Ordinary World'], {
        title: 'Scene 1.2 — A New Day',
      });

      // updateMetadata — statusId ─────────────────────────────────────────────
      project.updateMetadata(uuids['Scene 3.1 — The Complication'], {
        statusId: STATUS_IDS['Revised Draft'],
      });

      // updateMetadata — labelId ──────────────────────────────────────────────
      project.updateMetadata(uuids['Scene 2.1 — The Letter Arrives'], {
        labelId: LABEL_IDS['Action'],
      });

      // updateMetadata — includeInCompile ─────────────────────────────────────
      project.updateMetadata(uuids['Scene 1.1 — Opening Image'], {
        includeInCompile: false,
      });

      // addItem ───────────────────────────────────────────────────────────────
      addedUuid = project.addItem(uuids['Chapter 4 — Midpoint'], {
        title:    'Scene 4.2 — The Comeback',
        synopsis: 'Against all odds, the hero rises again.',
        content:  'She found her footing.',
        label:    'Action',
        status:   'First Draft',
      });

      // moveItem ──────────────────────────────────────────────────────────────
      project.moveItem(
        uuids['Scene 1.3 — EXCLUDED'],
        uuids['Chapter 2 — Inciting Incident'],
      );

      // ── Round-trip ─────────────────────────────────────────────────────────
      console.log(`  Opening in Scrivener (waiting ${WAIT_SECS}s for format processing)…`);
      scrivenerRoundTrip(project.scrivPath);
      project.reload();
      console.log('  Done.');
    });

    // writeContent ────────────────────────────────────────────────────────────

    it('writeContent: overwritten content survives round-trip', () => {
      assert.equal(
        project.readContent(uuids['Scene 1.1 — Opening Image']),
        'The stars shone at midnight.',
      );
    });

    it('writeContent: new content on a previously-empty document survives', () => {
      assert.equal(
        project.readContent(uuids['Scene 2.2 — First Meeting']),
        'Their hands touched briefly.',
      );
    });

    // writeSynopsis ───────────────────────────────────────────────────────────

    it('writeSynopsis: written synopsis survives round-trip', () => {
      assert.equal(
        project.readSynopsis(uuids['Scene 4.1 — All Is Lost']),
        'The hero stands alone in the wreckage.',
      );
    });

    // updateMetadata ──────────────────────────────────────────────────────────

    it('updateMetadata: renamed title survives round-trip', () => {
      assert.equal(
        project.findItem(uuids['Scene 1.2 — The Ordinary World']).Title,
        'Scene 1.2 — A New Day',
      );
    });

    it('updateMetadata: updated status resolves to correct name after round-trip', () => {
      assert.equal(
        findOutlineNode(project.getOutline(), 'Scene 3.1 — The Complication').status,
        'Revised Draft',
      );
    });

    it('updateMetadata: updated label resolves to correct name after round-trip', () => {
      assert.equal(
        findOutlineNode(project.getOutline(), 'Scene 2.1 — The Letter Arrives').label,
        'Action',
      );
    });

    it('updateMetadata: includeInCompile=false survives round-trip', () => {
      assert.equal(
        project.findItem(uuids['Scene 1.1 — Opening Image']).MetaData.IncludeInCompile,
        'No',
      );
    });

    // addItem ─────────────────────────────────────────────────────────────────

    it('addItem: new item is present in binder after round-trip', () => {
      const ch4 = findOutlineNode(project.getOutline(), 'Chapter 4 — Midpoint');
      assert.ok(
        ch4.children.some((c) => c.title === 'Scene 4.2 — The Comeback'),
        'added item not found under Chapter 4',
      );
    });

    it('addItem: new item content survives round-trip', () => {
      assert.equal(project.readContent(addedUuid), 'She found her footing.');
    });

    it('addItem: new item synopsis survives round-trip', () => {
      assert.equal(
        project.readSynopsis(addedUuid),
        'Against all odds, the hero rises again.',
      );
    });

    it('addItem: new item status resolves correctly after round-trip', () => {
      assert.equal(
        findOutlineNode(project.getOutline(), 'Scene 4.2 — The Comeback').status,
        'First Draft',
      );
    });

    it('addItem: new item label resolves correctly after round-trip', () => {
      assert.equal(
        findOutlineNode(project.getOutline(), 'Scene 4.2 — The Comeback').label,
        'Action',
      );
    });

    // moveItem ────────────────────────────────────────────────────────────────

    it('moveItem: item appears in new parent after round-trip', () => {
      const ch2 = findOutlineNode(project.getOutline(), 'Chapter 2 — Inciting Incident');
      assert.ok(
        ch2.children.some((c) => c.title === 'Scene 1.3 — EXCLUDED'),
        'moved item not found in Chapter 2',
      );
    });

    it('moveItem: item is absent from original parent after round-trip', () => {
      const ch1 = findOutlineNode(project.getOutline(), 'Chapter 1 — The World Begins');
      assert.ok(
        !ch1.children.some((c) => c.title === 'Scene 1.3 — EXCLUDED'),
        'moved item still present in Chapter 1',
      );
    });

    it('moveItem: item content is preserved after round-trip', () => {
      assert.equal(project.readContent(uuids['Scene 1.3 — EXCLUDED']), 'This was cut.');
    });

    it('moveItem: item synopsis is preserved after round-trip', () => {
      assert.equal(project.readSynopsis(uuids['Scene 1.3 — EXCLUDED']), 'A cut scene.');
    });

    after(() => {
      console.log(`  Phase 2 project left at: ${project.scrivPath}`);
    });
  });
});
