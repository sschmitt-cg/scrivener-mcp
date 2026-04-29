/**
 * Automated write tests for ScrivenerProject.
 *
 * Every mutating operation is verified by reading state back from disk
 * (using project.reload() where required so the full serialize→parse→access
 * round-trip is exercised). Tests are ordered so that each describe block
 * starts from a predictable state — earlier blocks do not rename or move the
 * items that later blocks still need to locate by the original title.
 *
 * After the suite runs, a Scrivener in-app verification checklist is printed
 * to stdout. Open the project at the logged path in Scrivener to confirm the
 * changes appear correctly in the UI.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createTestProject, buildTitleMap, findOutlineNode,
} from './helpers.js';
import { STATUS_IDS, LABEL_IDS } from './fixtures.js';

let project;
let uuids;
let projectPath;

describe('Write tests', () => {
  before(() => {
    project = createTestProject('MCP Write Tests');
    uuids = buildTitleMap(project);
    projectPath = project.scrivPath;
    console.log(`\nWrite-test project: ${projectPath}`);
  });

  // ── writeContent ─────────────────────────────────────────────────────────────

  describe('writeContent()', () => {
    it('writes content to a document that had none and reads it back', () => {
      const uuid = uuids['Scene 2.2 — First Meeting'];
      project.writeContent(uuid, 'They locked eyes across the crowded room.');
      assert.equal(project.readContent(uuid), 'They locked eyes across the crowded room.');
    });

    it('overwrites existing content', () => {
      const uuid = uuids['Scene 1.1 — Opening Image'];
      project.writeContent(uuid, 'The moon set over quiet hills.');
      assert.equal(project.readContent(uuid), 'The moon set over quiet hills.');
    });

    it('round-trips multi-line content', () => {
      const uuid = uuids['Scene 3.1 — The Complication'];
      const text = 'First line.\nSecond line.\nThird line.';
      project.writeContent(uuid, text);
      const result = project.readContent(uuid);
      assert.ok(result.includes('First line.'),  'missing first line');
      assert.ok(result.includes('Second line.'), 'missing second line');
      assert.ok(result.includes('Third line.'),  'missing third line');
    });

    it('creates the Files/Data/{uuid}/ directory if it does not exist', () => {
      // Act I is a folder with no prior content file; writeContent must create its dir.
      const uuid = uuids['Act I — Setup'];
      project.writeContent(uuid, 'Folder notes.');
      assert.equal(project.readContent(uuid), 'Folder notes.');
    });
  });

  // ── writeSynopsis ────────────────────────────────────────────────────────────

  describe('writeSynopsis()', () => {
    it('writes a synopsis and reads it back', () => {
      const uuid = uuids['Scene 4.1 — All Is Lost'];
      project.writeSynopsis(uuid, 'Everything the hero built comes crashing down.', 'Scene 4.1 — All Is Lost');
      assert.equal(
        project.readSynopsis(uuid),
        'Everything the hero built comes crashing down.',
      );
    });

    it('updates search.indexes so Scrivener corkboard stays in sync', () => {
      const uuid   = uuids['Scene 4.1 — All Is Lost'];
      const idxPath = join(projectPath, 'Files', 'search.indexes');
      const content = readFileSync(idxPath, 'utf8');
      assert.ok(
        content.includes('Everything the hero built comes crashing down.'),
        'search.indexes does not contain the new synopsis',
      );
    });

    it('overwrites an existing synopsis', () => {
      const uuid = uuids['Scene 1.1 — Opening Image'];
      project.writeSynopsis(uuid, 'Updated synopsis text.', 'Scene 1.1 — Opening Image');
      assert.equal(project.readSynopsis(uuid), 'Updated synopsis text.');
    });
  });

  // ── updateMetadata ───────────────────────────────────────────────────────────

  describe('updateMetadata()', () => {
    it('updates the title and persists it to disk', () => {
      const uuid = uuids['Scene 1.2 — The Ordinary World'];
      project.updateMetadata(uuid, { title: 'Scene 1.2 — The New Normal' });
      project.reload();
      assert.equal(project.findItem(uuid).Title, 'Scene 1.2 — The New Normal');
    });

    it('updates the synopsis via the metadata path', () => {
      const uuid = uuids['Scene 2.1 — The Letter Arrives'];
      project.updateMetadata(uuid, { synopsis: 'A coded message changes the hero\'s destiny.' });
      assert.equal(
        project.readSynopsis(uuid),
        "A coded message changes the hero's destiny.",
      );
    });

    it('updates labelId', () => {
      const uuid = uuids['Scene 3.1 — The Complication'];
      project.updateMetadata(uuid, { labelId: LABEL_IDS['Romance'] });
      project.reload();
      // fast-xml-parser re-parses numeric content as integers on reload;
      // coerce to string for a stable comparison.
      assert.equal(String(project.findItem(uuid).MetaData.LabelID), LABEL_IDS['Romance']);
    });

    it('updates statusId', () => {
      const uuid = uuids['Scene 4.1 — All Is Lost'];
      project.updateMetadata(uuid, { statusId: STATUS_IDS['Revised Draft'] });
      project.reload();
      assert.equal(String(project.findItem(uuid).MetaData.StatusID), STATUS_IDS['Revised Draft']);
    });

    it('sets includeInCompile to false', () => {
      const uuid = uuids['Scene 1.1 — Opening Image'];
      project.updateMetadata(uuid, { includeInCompile: false });
      project.reload();
      assert.equal(project.findItem(uuid).MetaData.IncludeInCompile, 'No');
    });

    it('sets includeInCompile back to true', () => {
      const uuid = uuids['Scene 1.3 — EXCLUDED'];
      project.updateMetadata(uuid, { includeInCompile: true });
      project.reload();
      assert.equal(project.findItem(uuid).MetaData.IncludeInCompile, 'Yes');
    });

    it('updates multiple fields in a single call', () => {
      const uuid = uuids['Scene 2.2 — First Meeting'];
      project.updateMetadata(uuid, {
        title:     'Scene 2.2 — Eyes Meet',
        synopsis:  'A chance encounter in the market square.',
        statusId:  STATUS_IDS['First Draft'],
      });
      project.reload();
      const item = project.findItem(uuid);
      assert.equal(item.Title,               'Scene 2.2 — Eyes Meet');
      assert.equal(project.readSynopsis(uuid), 'A chance encounter in the market square.');
      assert.equal(String(item.MetaData.StatusID), STATUS_IDS['First Draft']);
    });

    it('throws for an unknown UUID', () => {
      assert.throws(
        () => project.updateMetadata('00000000-0000-0000-0000-000000000000', { title: 'nope' }),
        /not found/i,
      );
    });
  });

  // ── addItem ──────────────────────────────────────────────────────────────────

  describe('addItem()', () => {
    let newSceneUuid;
    let newFolderUuid;
    let topLevelUuid;

    it('adds a Text document inside an existing chapter and returns its UUID', () => {
      const parentUuid = uuids['Chapter 4 — Midpoint'];
      newSceneUuid = project.addItem(parentUuid, {
        title:    'Scene 4.2 — The Twist',
        synopsis: 'An unexpected reversal changes everything.',
        content:  'Nobody saw it coming.',
        label:    'Action',
        status:   'To Do',
      });
      assert.ok(newSceneUuid, 'addItem should return a UUID');
    });

    it('new scene appears under Chapter 4 in the outline', () => {
      const outline = project.getOutline();
      const ch4 = findOutlineNode(outline, 'Chapter 4 — Midpoint');
      assert.equal(ch4.children.length, 2, 'Chapter 4 should now have 2 children');
      assert.equal(ch4.children[1].title, 'Scene 4.2 — The Twist');
    });

    it('new scene has correct content and synopsis on disk', () => {
      assert.equal(project.readContent(newSceneUuid),  'Nobody saw it coming.');
      assert.equal(project.readSynopsis(newSceneUuid), 'An unexpected reversal changes everything.');
    });

    it('new scene defaults to includeInCompile = Yes', () => {
      project.reload();
      assert.equal(project.findItem(newSceneUuid).MetaData.IncludeInCompile, 'Yes');
    });

    it('adds a Folder to an act', () => {
      const parentUuid = uuids['Act II — Confrontation'];
      newFolderUuid = project.addItem(parentUuid, {
        title:    'Chapter 5 — Resolution',
        type:     'Folder',
        synopsis: 'The final confrontation.',
      });
      const outline = project.getOutline();
      const actII = findOutlineNode(outline, 'Act II — Confrontation');
      assert.equal(actII.children.length, 3, 'Act II should now have 3 chapters');
      assert.equal(actII.children[2].title, 'Chapter 5 — Resolution');
    });

    it('adds a Text document to Manuscript top level when parentUuid is null', () => {
      topLevelUuid = project.addItem(null, {
        title:    'Epilogue',
        synopsis: 'What happened after.',
      });
      const outline = project.getOutline();
      const manuscript = outline[0];
      assert.ok(
        manuscript.children.some((c) => c.title === 'Epilogue'),
        'Epilogue should be at Manuscript top level',
      );
    });

    it('throws when parentUuid does not exist', () => {
      assert.throws(
        () => project.addItem('00000000-0000-0000-0000-000000000000', { title: 'Orphan' }),
        /not found/i,
      );
    });
  });

  // ── moveItem ─────────────────────────────────────────────────────────────────

  describe('moveItem()', () => {
    it('moves a scene from Chapter 1 to Chapter 2', () => {
      const sceneUuid  = uuids['Scene 1.3 — EXCLUDED'];
      const targetUuid = uuids['Chapter 2 — Inciting Incident'];
      project.moveItem(sceneUuid, targetUuid);

      const outline = project.getOutline();
      const ch2 = findOutlineNode(outline, 'Chapter 2 — Inciting Incident');
      const ch1 = findOutlineNode(outline, 'Chapter 1 — The World Begins');

      assert.ok(
        ch2.children.some((c) => c.title === 'Scene 1.3 — EXCLUDED'),
        'Scene 1.3 should now be in Chapter 2',
      );
      assert.ok(
        !ch1.children.some((c) => c.title === 'Scene 1.3 — EXCLUDED'),
        'Scene 1.3 should no longer be in Chapter 1',
      );
    });

    it('moved scene retains its original content and synopsis', () => {
      const uuid = uuids['Scene 1.3 — EXCLUDED'];
      assert.equal(project.readContent(uuid),  'This was cut.');
      assert.equal(project.readSynopsis(uuid), 'A cut scene.');
    });

    it('Chapter 1 now has 2 children after the move', () => {
      const outline = project.getOutline();
      const ch1 = findOutlineNode(outline, 'Chapter 1 — The World Begins');
      assert.equal(ch1.children.length, 2);
    });

    it('Chapter 2 now has 3 children after the move', () => {
      const outline = project.getOutline();
      const ch2 = findOutlineNode(outline, 'Chapter 2 — Inciting Incident');
      assert.equal(ch2.children.length, 3);
    });

    it('moves an item to Manuscript top level when newParentUuid is null', () => {
      const sceneUuid = uuids['Scene 2.1 — The Letter Arrives'];
      project.moveItem(sceneUuid, null);

      const outline = project.getOutline();
      const manuscript = outline[0];
      assert.ok(
        manuscript.children.some((c) => c.title === 'Scene 2.1 — The Letter Arrives'),
        'Scene 2.1 should be at Manuscript top level',
      );
    });

    it('throws for an unknown item UUID', () => {
      assert.throws(
        () => project.moveItem('00000000-0000-0000-0000-000000000000', null),
        /not found/i,
      );
    });
  });

  // ── In-app verification reminder ─────────────────────────────────────────────

  after(() => {
    const ch2uuid = uuids['Chapter 2 — Inciting Incident'];
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║          IN-APP VERIFICATION — WRITE TEST PROJECT           ║
╚══════════════════════════════════════════════════════════════╝
Open this project in Scrivener (make sure Scrivener is CLOSED
while tests run — reopen it after):
  ${projectPath}

writeContent — TEXT EDITOR
  Scene 2.2 (now "Eyes Meet")
    ✓ Body: "They locked eyes across the crowded room."
  Scene 1.1 — Opening Image
    ✓ Body: "The moon set over quiet hills."  (overwritten)
  Scene 3.1 — The Complication
    ✓ Body contains "First line." / "Second line." / "Third line."

writeSynopsis — CORKBOARD / INSPECTOR
  Scene 4.1 — All Is Lost
    ✓ Index-card synopsis: "Everything the hero built comes crashing down."
  Scene 1.1 — Opening Image
    ✓ Index-card synopsis: "Updated synopsis text."

updateMetadata — INSPECTOR (select each item)
  Scene 1.2 (was "The Ordinary World")
    ✓ Binder title now reads: "Scene 1.2 — The New Normal"
  Scene 2.1 — The Letter Arrives
    ✓ Synopsis: "A coded message changes the hero's destiny."
  Scene 3.1 — The Complication
    ✓ Label: Romance  (pink dot)
  Scene 4.1 — All Is Lost
    ✓ Status: Revised Draft
  Scene 1.1 — Opening Image
    ✓ Include in Compile: UNchecked
  Scene 1.3 — EXCLUDED
    ✓ Include in Compile: checked  (toggled back to true)
  Scene 2.2 (now "Eyes Meet")
    ✓ Binder title: "Scene 2.2 — Eyes Meet"
    ✓ Synopsis: "A chance encounter in the market square."
    ✓ Status: First Draft

addItem — BINDER STRUCTURE
  Chapter 4 — Midpoint
    ✓ Now has 2 children: "Scene 4.1 — All Is Lost" and "Scene 4.2 — The Twist"
    ✓ Scene 4.2 body: "Nobody saw it coming."
  Act II — Confrontation
    ✓ Now has 3 children: Chapter 3, Chapter 4, and "Chapter 5 — Resolution"
  Manuscript top level
    ✓ "Epilogue" appears as a direct child of Manuscript

moveItem — BINDER STRUCTURE
  Chapter 2 — Inciting Incident (UUID ${ch2uuid})
    ✓ Now has 3 children including "Scene 1.3 — EXCLUDED"
  Chapter 1 — The World Begins
    ✓ Now has only 2 children (Scene 1.3 was moved out)
  Scene 1.3 — EXCLUDED (in Chapter 2)
    ✓ Body still reads: "This was cut."
    ✓ Synopsis still reads: "A cut scene."
  Manuscript top level
    ✓ "Scene 2.1 — The Letter Arrives" appears as a direct child
`);
  });
});
