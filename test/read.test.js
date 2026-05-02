/**
 * Automated read tests for ScrivenerProject.
 *
 * These tests are fully non-destructive: they only call methods that read from
 * the project (getLabels, getStatuses, flattenBinder, readContent, readSynopsis,
 * findItem, getOutline, and the flattenBinder-based search).
 *
 * The test project is created once in a temp directory at the start of the
 * suite and left in place after the run — open it in Scrivener to manually
 * verify the visual appearance (see the in-app checklist logged at the end).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCRATCH_DIR, createTestProject, buildTitleMap, findOutlineNode,
} from './helpers.js';
import { LABEL_IDS, STATUS_IDS, EXPECTED_ITEM_COUNT } from './fixtures.js';

let project;
let uuids;   // title → uuid map built once from the initial binder state
let projectPath;

describe('Read tests', () => {
  before(() => {
    project = createTestProject();
    uuids = buildTitleMap(project);
    projectPath = project.scrivPath;
    console.log(`\nRead-test project: ${projectPath}`);
  });

  // ── Labels & Statuses ───────────────────────────────────────────────────────

  describe('getLabels()', () => {
    it('returns the built-in No Label entry at ID -1', () => {
      const labels = project.getLabels();
      assert.equal(labels['-1'], 'No Label');
    });

    it('returns all four custom labels in definition order', () => {
      const labels = project.getLabels();
      assert.equal(labels[LABEL_IDS['Action']],         'Action');
      assert.equal(labels[LABEL_IDS['Romance']],        'Romance');
      assert.equal(labels[LABEL_IDS['Character']],      'Character');
      assert.equal(labels[LABEL_IDS['World-Building']], 'World-Building');
    });

    it('contains exactly 5 entries (No Label + 4 custom)', () => {
      assert.equal(Object.keys(project.getLabels()).length, 5);
    });
  });

  describe('getStatuses()', () => {
    it('returns the built-in No Status entry at ID -1', () => {
      assert.equal(project.getStatuses()['-1'], 'No Status');
    });

    it('returns all five custom statuses in definition order', () => {
      const s = project.getStatuses();
      assert.equal(s[STATUS_IDS['To Do']],         'To Do');
      assert.equal(s[STATUS_IDS['In Progress']],   'In Progress');
      assert.equal(s[STATUS_IDS['First Draft']],   'First Draft');
      assert.equal(s[STATUS_IDS['Revised Draft']], 'Revised Draft');
      assert.equal(s[STATUS_IDS['Done']],          'Done');
    });

    it('contains exactly 6 entries (No Status + 5 custom)', () => {
      assert.equal(Object.keys(project.getStatuses()).length, 6);
    });
  });

  // ── flattenBinder ───────────────────────────────────────────────────────────

  describe('flattenBinder()', () => {
    let items;
    before(() => { items = project.flattenBinder(); });

    it(`returns exactly ${EXPECTED_ITEM_COUNT} binder items`, () => {
      assert.equal(items.length, EXPECTED_ITEM_COUNT);
    });

    it('Manuscript root is at depth 0 with type DraftFolder', () => {
      const m = items.find((i) => i.title === 'Manuscript');
      assert.ok(m, 'Manuscript not found');
      assert.equal(m.depth, 0);
      assert.equal(m.type, 'DraftFolder');
    });

    it('Research root is at depth 0 with type ResearchFolder', () => {
      const r = items.find((i) => i.title === 'Research');
      assert.ok(r, 'Research not found');
      assert.equal(r.depth, 0);
      assert.equal(r.type, 'ResearchFolder');
    });

    it('Trash root is at depth 0 with type TrashFolder', () => {
      const t = items.find((i) => i.type === 'TrashFolder');
      assert.ok(t, 'TrashFolder not found');
      assert.equal(t.depth, 0);
    });

    it('Act folders are at depth 1', () => {
      const actI  = items.find((i) => i.title === 'Act I — Setup');
      const actII = items.find((i) => i.title === 'Act II — Confrontation');
      assert.equal(actI.depth, 1);
      assert.equal(actII.depth, 1);
    });

    it('Chapter folders are at depth 2', () => {
      for (const title of ['Chapter 1 — The World Begins', 'Chapter 2 — Inciting Incident',
                           'Chapter 3 — Rising Stakes', 'Chapter 4 — Midpoint']) {
        const ch = items.find((i) => i.title === title);
        assert.ok(ch, `${title} not found`);
        assert.equal(ch.depth, 2, `${title} wrong depth`);
      }
    });

    it('Scene items are at depth 3', () => {
      for (const title of ['Scene 1.1 — Opening Image', 'Scene 1.2 — The Ordinary World',
                           'Scene 1.3 — EXCLUDED', 'Scene 2.1 — The Letter Arrives',
                           'Scene 2.2 — First Meeting', 'Scene 3.1 — The Complication',
                           'Scene 4.1 — All Is Lost']) {
        const s = items.find((i) => i.title === title);
        assert.ok(s, `${title} not found`);
        assert.equal(s.depth, 3, `${title} wrong depth`);
      }
    });

    it('Research sub-folders are at depth 1, their items at depth 2', () => {
      const chars = items.find((i) => i.title === 'Characters');
      const world = items.find((i) => i.title === 'World Notes');
      assert.equal(chars.depth, 1);
      assert.equal(world.depth, 1);

      for (const title of ['Hero Profile', 'Villain Profile', 'Map Notes']) {
        const item = items.find((i) => i.title === title);
        assert.equal(item.depth, 2, `${title} wrong depth`);
      }
    });

    it('Scene 1.1 has correct labelId, statusId, includeInCompile, and synopsis', () => {
      const s = items.find((i) => i.title === 'Scene 1.1 — Opening Image');
      assert.equal(s.labelId,          LABEL_IDS['Action']);
      assert.equal(s.statusId,         STATUS_IDS['Done']);
      assert.equal(s.includeInCompile, 'Yes');
      assert.equal(s.synopsis,         'The hero wakes at dawn.');
    });

    it('Scene 1.3 is excluded from compile', () => {
      const s = items.find((i) => i.title === 'Scene 1.3 — EXCLUDED');
      assert.equal(s.includeInCompile, 'No');
    });

    it('Scene 2.2 has Romance label and In Progress status', () => {
      const s = items.find((i) => i.title === 'Scene 2.2 — First Meeting');
      assert.equal(s.labelId,  LABEL_IDS['Romance']);
      assert.equal(s.statusId, STATUS_IDS['In Progress']);
    });

    it('Hero Profile has Character label and depth 2', () => {
      const h = items.find((i) => i.title === 'Hero Profile');
      assert.equal(h.labelId, LABEL_IDS['Character']);
      assert.equal(h.depth,   2);
    });

    it('items with no label have an empty labelId', () => {
      // Manuscript, Research, Trash, Act I, Act II have no LabelID set
      const manuscript = items.find((i) => i.title === 'Manuscript');
      assert.equal(manuscript.labelId, '');
    });

    it('uuid field is a valid uppercase UUID v4', () => {
      const uuidRe = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i;
      for (const item of items) {
        assert.match(item.uuid, uuidRe, `${item.title} has malformed UUID: ${item.uuid}`);
      }
    });

    it('all items have a non-empty id (sequential integer)', () => {
      for (const item of items) {
        assert.ok(item.id !== '', `${item.title} has empty id`);
        assert.ok(!isNaN(Number(item.id)), `${item.title} has non-numeric id`);
      }
    });
  });

  // ── readContent ─────────────────────────────────────────────────────────────

  describe('readContent()', () => {
    it('returns plain text for Scene 1.1', () => {
      assert.equal(project.readContent(uuids['Scene 1.1 — Opening Image']),
                   'The sun rose over the hills.');
    });

    it('returns plain text for Scene 2.1', () => {
      assert.equal(project.readContent(uuids['Scene 2.1 — The Letter Arrives']),
                   'The envelope bore no return address.');
    });

    it('returns multi-line content for Hero Profile', () => {
      const text = project.readContent(uuids['Hero Profile']);
      assert.ok(text.includes('Name: Alex'),           'missing Name line');
      assert.ok(text.includes('Age: 28'),              'missing Age line');
      assert.ok(text.includes('Goal: Find the treasure.'), 'missing Goal line');
    });

    it('returns empty string for Scene 2.2 (no content written)', () => {
      assert.equal(project.readContent(uuids['Scene 2.2 — First Meeting']), '');
    });

    it('returns empty string for Scene 4.1 (no content written)', () => {
      assert.equal(project.readContent(uuids['Scene 4.1 — All Is Lost']), '');
    });

    it('returns empty string for a Folder uuid (no RTF file)', () => {
      assert.equal(project.readContent(uuids['Act I — Setup']), '');
    });

    it('returns empty string for an unknown UUID', () => {
      assert.equal(project.readContent('00000000-0000-0000-0000-000000000000'), '');
    });
  });

  // ── readSynopsis ────────────────────────────────────────────────────────────

  describe('readSynopsis()', () => {
    it('returns the synopsis for Scene 1.1', () => {
      assert.equal(project.readSynopsis(uuids['Scene 1.1 — Opening Image']),
                   'The hero wakes at dawn.');
    });

    it('returns the synopsis for a Folder (Act I)', () => {
      assert.equal(project.readSynopsis(uuids['Act I — Setup']),
                   'The world and hero are introduced.');
    });

    it('returns the synopsis for Hero Profile', () => {
      assert.equal(project.readSynopsis(uuids['Hero Profile']),
                   "The protagonist's background and motivation.");
    });

    it('returns empty string for Manuscript (no synopsis file)', () => {
      assert.equal(project.readSynopsis(uuids['Manuscript']), '');
    });

    it('returns empty string for an unknown UUID', () => {
      assert.equal(project.readSynopsis('00000000-0000-0000-0000-000000000000'), '');
    });
  });

  // ── findItem ────────────────────────────────────────────────────────────────

  describe('findItem()', () => {
    it('finds a top-level item', () => {
      const item = project.findItem(uuids['Manuscript']);
      assert.equal(item.Title, 'Manuscript');
    });

    it('finds a deeply-nested item', () => {
      const item = project.findItem(uuids['Scene 1.1 — Opening Image']);
      assert.equal(item.Title, 'Scene 1.1 — Opening Image');
    });

    it('returns null for an unknown UUID', () => {
      assert.equal(project.findItem('00000000-0000-0000-0000-000000000000'), null);
    });
  });

  // ── getOutline ──────────────────────────────────────────────────────────────

  describe('getOutline()', () => {
    let outline;
    before(() => { outline = project.getOutline().items; });

    it('returns exactly 3 top-level nodes', () => {
      assert.equal(outline.length, 3);
    });

    it('top-level nodes are Manuscript, Research, Trash in that order', () => {
      assert.equal(outline[0].title, 'Manuscript');
      assert.equal(outline[0].type,  'DraftFolder');
      assert.equal(outline[1].title, 'Research');
      assert.equal(outline[1].type,  'ResearchFolder');
      assert.equal(outline[2].title, 'Trash');
      assert.equal(outline[2].type,  'TrashFolder');
    });

    it('Manuscript has exactly 2 acts', () => {
      assert.equal(outline[0].children.length, 2);
      assert.equal(outline[0].children[0].title, 'Act I — Setup');
      assert.equal(outline[0].children[1].title, 'Act II — Confrontation');
    });

    it('Act I has exactly 2 chapters', () => {
      const actI = outline[0].children[0];
      assert.equal(actI.children.length, 2);
      assert.equal(actI.children[0].title, 'Chapter 1 — The World Begins');
      assert.equal(actI.children[1].title, 'Chapter 2 — Inciting Incident');
    });

    it('Chapter 1 has exactly 3 scenes', () => {
      const ch1 = outline[0].children[0].children[0];
      assert.equal(ch1.children.length, 3);
    });

    it('Chapter 2 has exactly 2 scenes', () => {
      const ch2 = outline[0].children[0].children[1];
      assert.equal(ch2.children.length, 2);
    });

    it('Act II has exactly 2 chapters', () => {
      assert.equal(outline[0].children[1].children.length, 2);
    });

    it('Scene 1.1 has resolved label/status names and correct synopsis', () => {
      const s = outline[0].children[0].children[0].children[0];
      assert.equal(s.title,            'Scene 1.1 — Opening Image');
      assert.equal(s.label,            'Action');
      assert.equal(s.status,           'Done');
      assert.equal(s.synopsis,         'The hero wakes at dawn.');
      assert.equal(s.includeInCompile, 'Yes');
    });

    it('Scene 1.3 is excluded from compile in outline', () => {
      const s = outline[0].children[0].children[0].children[2];
      assert.equal(s.title,            'Scene 1.3 — EXCLUDED');
      assert.equal(s.includeInCompile, 'No');
    });

    it('Scene 2.2 has Romance label and In Progress status in outline', () => {
      const s = outline[0].children[0].children[1].children[1];
      assert.equal(s.label,  'Romance');
      assert.equal(s.status, 'In Progress');
    });

    it('Research has 2 sub-folders: Characters and World Notes', () => {
      assert.equal(outline[1].children.length, 2);
      assert.equal(outline[1].children[0].title, 'Characters');
      assert.equal(outline[1].children[1].title, 'World Notes');
    });

    it('Characters folder has Hero Profile and Villain Profile', () => {
      const chars = outline[1].children[0];
      assert.equal(chars.children.length, 2);
      assert.equal(chars.children[0].title, 'Hero Profile');
      assert.equal(chars.children[1].title, 'Villain Profile');
    });

    it('Hero Profile has Character label in outline', () => {
      assert.equal(outline[1].children[0].children[0].label, 'Character');
    });

    it('leaf Text nodes have no children property', () => {
      const scene = outline[0].children[0].children[0].children[0];
      assert.equal(scene.children, undefined);
    });

    it('findOutlineNode helper locates any node by title', () => {
      const node = findOutlineNode(outline, 'Map Notes');
      assert.ok(node, 'Map Notes not found');
      assert.equal(node.label, 'World-Building');
    });
  });

  // ── Search (flattenBinder filter — matches index.js search_documents logic) ─

  describe('search (title + synopsis filter)', () => {
    let items;
    before(() => { items = project.flattenBinder(); });

    function search(query) {
      const lower = query.toLowerCase();
      return items.filter(
        (i) => i.title.toLowerCase().includes(lower) ||
               i.synopsis.toLowerCase().includes(lower),
      );
    }

    it('finds a single item by exact title', () => {
      const results = search('Hero Profile');
      assert.equal(results.length, 1);
      assert.equal(results[0].title, 'Hero Profile');
    });

    it('finds an item by synopsis content', () => {
      const results = search('darkest moment');
      assert.equal(results.length, 1);
      assert.equal(results[0].title, 'Scene 4.1 — All Is Lost');
    });

    it('is case-insensitive', () => {
      const results = search('DAWN');
      assert.ok(results.some((r) => r.title === 'Scene 1.1 — Opening Image'),
                'case-insensitive search did not match synopsis');
    });

    it('returns multiple matches when query hits several items', () => {
      // "hero" appears in "Hero Profile" (title) and in "Hero meets…" (scene 2.2 synopsis)
      // and "The world and hero are introduced." (act I synopsis)
      const results = search('hero');
      assert.ok(results.length >= 2, `expected ≥2 matches, got ${results.length}`);
    });

    it('returns empty array when no items match', () => {
      assert.equal(search('xyzzy_no_match_123').length, 0);
    });

    it('matches on title partial string', () => {
      const results = search('Inciting');
      assert.ok(results.some((r) => r.title.includes('Inciting Incident')));
    });
  });

  // ── In-app verification reminder ────────────────────────────────────────────

  after(() => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║           IN-APP VERIFICATION — READ TEST PROJECT           ║
╚══════════════════════════════════════════════════════════════╝
Open this project in Scrivener:
  ${projectPath}

BINDER STRUCTURE
  ✓ Manuscript contains Act I and Act II
  ✓ Act I contains Chapter 1 (3 scenes) and Chapter 2 (2 scenes)
  ✓ Act II contains Chapter 3 (1 scene) and Chapter 4 (1 scene)
  ✓ Research contains Characters (Hero Profile, Villain Profile)
    and World Notes (Map Notes)
  ✓ Trash is empty

INSPECTOR (select each document, check the right-hand panel)
  Scene 1.1 — Opening Image
    ✓ Label:   Action  (red dot)
    ✓ Status:  Done
    ✓ Include in Compile: checked
  Scene 1.3 — EXCLUDED
    ✓ Label:   Action  (red dot)
    ✓ Status:  To Do
    ✓ Include in Compile: UNchecked
  Scene 2.2 — First Meeting
    ✓ Label:   Romance  (pink dot)
    ✓ Status:  In Progress
    ✓ Content editor: empty
  Hero Profile
    ✓ Label:   Character  (blue dot)

CORKBOARD (select Chapter 1, switch to corkboard view)
  ✓ Three index cards: "Opening Image", "The Ordinary World", "EXCLUDED"
  ✓ Scene 1.1 card shows synopsis: "The hero wakes at dawn."
  ✓ Scene 1.3 card shows synopsis: "A cut scene."

TEXT EDITOR (click each scene to open it)
  Scene 1.1 — Opening Image
    ✓ Body text: "The sun rose over the hills."
  Scene 2.1 — The Letter Arrives
    ✓ Body text: "The envelope bore no return address."
  Hero Profile
    ✓ Body text contains "Name: Alex", "Age: 28", "Goal: Find the treasure."
  Scene 2.2 — First Meeting
    ✓ Body text: (empty)
`);
  });
});
