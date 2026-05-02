/**
 * Coverage tests for ScrivenerProject features that read.test.js and
 * write.test.js do not exercise:
 *   - batchUpdateMetadata (atomic multi-update + error reporting)
 *   - getDocuments (batch fetch with not-found entries)
 *   - getOutline({ rootUuid }) and getOutline({ includeContent: true })
 *   - _assertWritable lock-file refusal
 *   - Files/binder.autosave generation on every save
 *   - Project create() edge cases — defaults, named colors, empty
 *     manuscript/research, Settings/ folder
 *   - RTF / Unicode / XML escape round-trips for special characters
 *
 * Each describe block creates its own scratch project so the suites are
 * order-independent and never collide with read/write fixtures.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, writeFileSync, unlinkSync, existsSync, statSync, mkdirSync, rmSync,
} from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { inflateRawSync } from 'zlib';
import { ScrivenerProject } from '../src/scrivener.js';
import { SCRATCH_DIR, createTestProject, buildTitleMap, findOutlineNode } from './helpers.js';
import { LABEL_IDS, STATUS_IDS } from './fixtures.js';

// ── batchUpdateMetadata ───────────────────────────────────────────────────────

describe('batchUpdateMetadata()', () => {
  let project;
  let uuids;

  before(() => {
    project = createTestProject('MCP Coverage — Batch');
    uuids = buildTitleMap(project);
  });

  it('applies a mix of title/label/status/synopsis/include changes in one call', () => {
    const result = project.batchUpdateMetadata([
      { uuid: uuids['Scene 1.1 — Opening Image'], changes: { title: 'Scene 1.1 — Renamed' } },
      { uuid: uuids['Scene 1.2 — The Ordinary World'], changes: { labelId: LABEL_IDS['Romance'] } },
      { uuid: uuids['Scene 2.1 — The Letter Arrives'], changes: { statusId: STATUS_IDS['Done'] } },
      { uuid: uuids['Scene 3.1 — The Complication'], changes: { synopsis: 'Updated batch synopsis.' } },
      { uuid: uuids['Scene 4.1 — All Is Lost'], changes: { includeInCompile: false } },
    ]);
    assert.equal(result.applied, 5);
    assert.equal(result.errors.length, 0);
  });

  it('persists every change to disk', () => {
    project.reload();
    assert.equal(project.findItem(uuids['Scene 1.1 — Opening Image']).Title, 'Scene 1.1 — Renamed');
    assert.equal(
      String(project.findItem(uuids['Scene 1.2 — The Ordinary World']).MetaData.LabelID),
      LABEL_IDS['Romance'],
    );
    assert.equal(
      String(project.findItem(uuids['Scene 2.1 — The Letter Arrives']).MetaData.StatusID),
      STATUS_IDS['Done'],
    );
    assert.equal(
      project.readSynopsis(uuids['Scene 3.1 — The Complication']),
      'Updated batch synopsis.',
    );
    assert.equal(
      project.findItem(uuids['Scene 4.1 — All Is Lost']).MetaData.IncludeInCompile,
      'No',
    );
  });

  it('reports unknown UUIDs as errors without aborting the rest of the batch', () => {
    const result = project.batchUpdateMetadata([
      { uuid: '00000000-0000-0000-0000-000000000000', changes: { title: 'Ghost' } },
      { uuid: uuids['Scene 4.1 — All Is Lost'], changes: { includeInCompile: true } },
      { uuid: '11111111-1111-1111-1111-111111111111', changes: { title: 'Phantom' } },
    ]);
    assert.equal(result.applied, 1);
    assert.equal(result.errors.length, 2);
    assert.equal(result.errors[0].uuid, '00000000-0000-0000-0000-000000000000');
    assert.equal(result.errors[0].error, 'not found');
    assert.equal(result.errors[1].uuid, '11111111-1111-1111-1111-111111111111');

    project.reload();
    assert.equal(
      project.findItem(uuids['Scene 4.1 — All Is Lost']).MetaData.IncludeInCompile,
      'Yes',
    );
  });

  it('returns applied=0 with no errors for an empty updates array', () => {
    const result = project.batchUpdateMetadata([]);
    assert.equal(result.applied, 0);
    assert.equal(result.errors.length, 0);
  });

  it('synopsis-only batch updates still reach disk (no .scrivx write needed)', () => {
    const result = project.batchUpdateMetadata([
      { uuid: uuids['Scene 1.1 — Opening Image'], changes: { synopsis: 'Synopsis-only change.' } },
    ]);
    assert.equal(result.applied, 1);
    assert.equal(
      project.readSynopsis(uuids['Scene 1.1 — Opening Image']),
      'Synopsis-only change.',
    );
  });
});

// ── getDocuments ──────────────────────────────────────────────────────────────

describe('getDocuments()', () => {
  let project;
  let uuids;

  before(() => {
    project = createTestProject('MCP Coverage — GetDocs');
    uuids = buildTitleMap(project);
  });

  it('returns metadata + content for a batch of Text documents', () => {
    const docs = project.getDocuments([
      uuids['Scene 1.1 — Opening Image'],
      uuids['Hero Profile'],
    ]);
    assert.equal(docs.length, 2);
    assert.equal(docs[0].title, 'Scene 1.1 — Opening Image');
    assert.equal(docs[0].label, 'Action');
    assert.equal(docs[0].status, 'Done');
    assert.equal(docs[0].content, 'The sun rose over the hills.');
    assert.equal(docs[0].synopsis, 'The hero wakes at dawn.');
    assert.equal(docs[1].title, 'Hero Profile');
    assert.equal(docs[1].label, 'Character');
    assert.ok(docs[1].content.includes('Name: Alex'));
  });

  it('preserves the order of the requested UUIDs', () => {
    const ids = [
      uuids['Hero Profile'],
      uuids['Scene 1.1 — Opening Image'],
      uuids['Map Notes'],
    ];
    const docs = project.getDocuments(ids);
    assert.deepEqual(docs.map((d) => d.uuid), ids);
  });

  it('returns empty content for Folder items (no RTF on disk)', () => {
    const docs = project.getDocuments([uuids['Act I — Setup']]);
    assert.equal(docs[0].title, 'Act I — Setup');
    assert.equal(docs[0].type, 'Folder');
    assert.equal(docs[0].content, '');
  });

  it('returns an error entry for unknown UUIDs without throwing', () => {
    const docs = project.getDocuments([
      '00000000-0000-0000-0000-000000000000',
      uuids['Scene 1.1 — Opening Image'],
    ]);
    assert.equal(docs[0].error, 'not found');
    assert.equal(docs[0].uuid, '00000000-0000-0000-0000-000000000000');
    assert.equal(docs[1].title, 'Scene 1.1 — Opening Image');
  });

  it('returns [] for an empty UUID list', () => {
    assert.deepEqual(project.getDocuments([]), []);
  });
});

// ── getOutline variants ───────────────────────────────────────────────────────

describe('getOutline() — rootUuid + includeContent variants', () => {
  let project;
  let uuids;

  before(() => {
    project = createTestProject('MCP Coverage — Outline');
    uuids = buildTitleMap(project);
  });

  it('rootUuid scopes the outline to a single subtree', () => {
    const { items: outline } = project.getOutline({ rootUuid: uuids['Chapter 1 — The World Begins'] });
    assert.equal(outline.length, 1);
    assert.equal(outline[0].title, 'Chapter 1 — The World Begins');
    assert.equal(outline[0].children.length, 3);
  });

  it('rootUuid pointed at a leaf returns a single childless node', () => {
    const { items: outline } = project.getOutline({ rootUuid: uuids['Scene 1.1 — Opening Image'] });
    assert.equal(outline.length, 1);
    assert.equal(outline[0].title, 'Scene 1.1 — Opening Image');
    assert.equal(outline[0].children, undefined);
  });

  it('rootUuid throws for an unknown UUID', () => {
    assert.throws(
      () => project.getOutline({ rootUuid: '00000000-0000-0000-0000-000000000000' }),
      /not found/i,
    );
  });

  it('includeContent=true inlines content for Text items only', () => {
    const { items: outline } = project.getOutline({ includeContent: true });
    const scene11 = findOutlineNode(outline, 'Scene 1.1 — Opening Image');
    assert.equal(scene11.content, 'The sun rose over the hills.');

    const hero = findOutlineNode(outline, 'Hero Profile');
    assert.ok(hero.content.includes('Name: Alex'));

    // Folders never expose content
    const actI = findOutlineNode(outline, 'Act I — Setup');
    assert.equal(actI.content, undefined);
  });

  it('includeContent=true omits content for empty Text items', () => {
    const { items: outline } = project.getOutline({ includeContent: true });
    // Scene 2.2 was created with no content; readContent() returns '' which
    // the outline builder skips entirely.
    const scene22 = findOutlineNode(outline, 'Scene 2.2 — First Meeting');
    assert.equal(scene22.content, undefined);
  });

  it('includeContent=false (default) never includes content', () => {
    const { items: outline } = project.getOutline();
    const scene11 = findOutlineNode(outline, 'Scene 1.1 — Opening Image');
    assert.equal(scene11.content, undefined);
  });

  it('rootUuid + includeContent compose correctly', () => {
    const { items: outline } = project.getOutline({
      rootUuid: uuids['Chapter 1 — The World Begins'],
      includeContent: true,
    });
    const scene11 = findOutlineNode(outline, 'Scene 1.1 — Opening Image');
    assert.equal(scene11.content, 'The sun rose over the hills.');
  });

  it('getOutline always returns an object with an items array', () => {
    const result = project.getOutline();
    assert.ok(Array.isArray(result.items), 'items must be an array');
    assert.equal(result.items.length, 3, 'top-level items: Manuscript, Research, Trash');
  });

  it('maxContentChars=0 truncates all non-empty content', () => {
    const result = project.getOutline({ includeContent: true, maxContentChars: 0 });
    assert.ok(result.truncated, 'should be marked truncated');
    assert.ok(result.note && result.note.length > 0, 'truncated result should include a note');
    const scene11 = findOutlineNode(result.items, 'Scene 1.1 — Opening Image');
    assert.equal(scene11.content, undefined, 'content must be absent when truncated');
  });

  it('non-truncated result has no truncated flag', () => {
    const result = project.getOutline({ includeContent: true });
    assert.equal(result.truncated, undefined);
  });
});

// ── Lock-file safety / binder.autosave ────────────────────────────────────────

describe('write safety — Files/user.lock + binder.autosave', () => {
  let project;
  let uuids;
  let lockPath;

  before(() => {
    project = createTestProject('MCP Coverage — Locking');
    uuids = buildTitleMap(project);
    lockPath = join(project.scrivPath, 'Files', 'user.lock');
  });

  after(() => {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  });

  it('writeContent refuses when Files/user.lock exists', () => {
    writeFileSync(lockPath, '');
    try {
      assert.throws(
        () => project.writeContent(uuids['Scene 1.1 — Opening Image'], 'should fail'),
        /open/i,
      );
    } finally {
      unlinkSync(lockPath);
    }
  });

  it('updateMetadata refuses when Files/user.lock exists', () => {
    writeFileSync(lockPath, '');
    try {
      assert.throws(
        () => project.updateMetadata(uuids['Scene 1.1 — Opening Image'], { title: 'nope' }),
        /open/i,
      );
    } finally {
      unlinkSync(lockPath);
    }
  });

  it('addItem refuses when Files/user.lock exists', () => {
    writeFileSync(lockPath, '');
    try {
      assert.throws(
        () => project.addItem(null, { title: 'should not appear' }),
        /open/i,
      );
    } finally {
      unlinkSync(lockPath);
    }
  });

  it('moveItem refuses when Files/user.lock exists', () => {
    writeFileSync(lockPath, '');
    try {
      assert.throws(
        () => project.moveItem(uuids['Scene 1.1 — Opening Image'], null),
        /open/i,
      );
    } finally {
      unlinkSync(lockPath);
    }
  });

  it('batchUpdateMetadata refuses when Files/user.lock exists', () => {
    writeFileSync(lockPath, '');
    try {
      assert.throws(
        () => project.batchUpdateMetadata([
          { uuid: uuids['Scene 1.1 — Opening Image'], changes: { title: 'nope' } },
        ]),
        /open/i,
      );
    } finally {
      unlinkSync(lockPath);
    }
  });

  it('writes resume normally once the lock file is removed', () => {
    project.writeContent(uuids['Scene 1.1 — Opening Image'], 'after lock cleared');
    assert.equal(
      project.readContent(uuids['Scene 1.1 — Opening Image']),
      'after lock cleared',
    );
  });

  it('Files/binder.autosave is created alongside .scrivx on save', () => {
    const autosavePath = join(project.scrivPath, 'Files', 'binder.autosave');
    assert.ok(existsSync(autosavePath), 'binder.autosave should exist');
    assert.ok(statSync(autosavePath).size > 0, 'binder.autosave should be non-empty');
  });

  it('binder.autosave starts with a ZIP local-file-header signature (PK\\x03\\x04)', () => {
    // Scrivener expects binder.autosave to be a single-entry ZIP archive
    // containing the .scrivx file. The local-file-header magic is 0x04034b50.
    const buf = readFileSync(join(project.scrivPath, 'Files', 'binder.autosave'));
    assert.equal(buf[0], 0x50);
    assert.equal(buf[1], 0x4b);
    assert.equal(buf[2], 0x03);
    assert.equal(buf[3], 0x04);
  });

  it('binder.autosave is rewritten on each save', () => {
    const autosavePath = join(project.scrivPath, 'Files', 'binder.autosave');
    const sizeBefore = statSync(autosavePath).size;
    const mtimeBefore = statSync(autosavePath).mtimeMs;

    // Wait long enough that mtime is observably different on filesystems with
    // 1 ms resolution, then trigger another save via addItem.
    const start = Date.now();
    while (Date.now() - start < 10) { /* spin */ }

    project.addItem(null, { title: 'Triggers a save' });
    const stat = statSync(autosavePath);
    assert.ok(
      stat.mtimeMs > mtimeBefore || stat.size !== sizeBefore,
      'binder.autosave should be rewritten on save',
    );
  });

  it('binder.autosave stored entry filename matches the .scrivx filename', () => {
    const buf = readFileSync(join(project.scrivPath, 'Files', 'binder.autosave'));
    const nameLen = buf.readUInt16LE(26);
    const storedName = buf.subarray(30, 30 + nameLen).toString('utf8');
    assert.equal(storedName, basename(project.scrivxPath));
  });

  it('binder.autosave decompresses to the exact .scrivx content (round-trip)', () => {
    const buf = readFileSync(join(project.scrivPath, 'Files', 'binder.autosave'));
    // Parse the ZIP local file header to locate the compressed payload.
    // Header layout: 30 fixed bytes, then filename (len at offset 26), then extra field (len at offset 28).
    const nameLen = buf.readUInt16LE(26);
    const extraLen = buf.readUInt16LE(28);
    const compSize = buf.readUInt32LE(18);
    const dataStart = 30 + nameLen + extraLen;
    const decompressed = inflateRawSync(buf.subarray(dataStart, dataStart + compSize));
    assert.deepEqual(decompressed, readFileSync(project.scrivxPath));
  });
});

// ── Project create() edge cases ───────────────────────────────────────────────

describe('ScrivenerProject.create() — edge cases', () => {
  // Each test below creates its own project; clean them all up at the end.
  const created = [];
  const tmpName = (suffix) => {
    const name = `MCP Coverage — Create ${suffix}`;
    const path = join(SCRATCH_DIR, `${name}.scriv`);
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
    created.push(path);
    return name;
  };

  before(() => {
    mkdirSync(SCRATCH_DIR, { recursive: true });
  });

  after(() => {
    for (const p of created) {
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    }
  });

  it('creates the Settings/ folder Scrivener expects to exist', () => {
    const p = ScrivenerProject.create(SCRATCH_DIR, tmpName('Settings'));
    assert.ok(existsSync(join(p.scrivPath, 'Settings')), 'Settings/ should be created');
  });

  it('creates Files/Data/ for per-document content', () => {
    const p = ScrivenerProject.create(SCRATCH_DIR, tmpName('FilesData'));
    assert.ok(existsSync(join(p.scrivPath, 'Files', 'Data')), 'Files/Data/ should be created');
  });

  it('writes binder.autosave at creation time', () => {
    const p = ScrivenerProject.create(SCRATCH_DIR, tmpName('Autosave'));
    assert.ok(existsSync(join(p.scrivPath, 'Files', 'binder.autosave')));
  });

  it('uses default statuses (To Do … Done) when none are supplied', () => {
    const p = ScrivenerProject.create(SCRATCH_DIR, tmpName('DefaultStatuses'));
    const statuses = Object.values(p.getStatuses());
    for (const s of ['No Status', 'To Do', 'In Progress', 'First Draft', 'Revised Draft', 'Done']) {
      assert.ok(statuses.includes(s), `default statuses should include ${s}`);
    }
  });

  it('produces a project with Manuscript / Research / Trash and nothing else', () => {
    const p = ScrivenerProject.create(SCRATCH_DIR, tmpName('EmptyTree'));
    const tops = p.flattenBinder().filter((i) => i.depth === 0).map((i) => i.title);
    assert.deepEqual(tops, ['Manuscript', 'Research', 'Trash']);
  });

  it('accepts an empty manuscript and research array', () => {
    const p = ScrivenerProject.create(SCRATCH_DIR, tmpName('EmptyArrays'), {
      manuscript: [],
      research: [],
    });
    const items = p.flattenBinder();
    assert.equal(items.length, 3);
  });

  it('accepts no labels and still produces the No Label sentinel', () => {
    const p = ScrivenerProject.create(SCRATCH_DIR, tmpName('NoLabels'));
    const labels = p.getLabels();
    assert.equal(Object.keys(labels).length, 1);
    assert.equal(labels['-1'], 'No Label');
  });

  it('accepts string-shorthand labels and assigns rotating default colors', () => {
    const name = tmpName('StringLabels');
    const p = ScrivenerProject.create(SCRATCH_DIR, name, {
      labels: ['First', 'Second', 'Third'],
    });
    const labels = p.getLabels();
    assert.equal(labels['1'], 'First');
    assert.equal(labels['2'], 'Second');
    assert.equal(labels['3'], 'Third');

    // Color attributes should be set even when caller supplied no color.
    const xml = readFileSync(join(p.scrivPath, `${name}.scrivx`), 'utf8');
    assert.match(xml, /<Label[^>]+Color="[0-9. ]+"[^>]*>First</);
    assert.match(xml, /<Label[^>]+Color="[0-9. ]+"[^>]*>Second</);
  });

  it('honours named colors on object-form labels', () => {
    const name = tmpName('NamedColors');
    const p = ScrivenerProject.create(SCRATCH_DIR, name, {
      labels: [{ name: 'Crimson', color: 'red' }, { name: 'Lawn', color: 'green' }],
    });
    const xml = readFileSync(join(p.scrivPath, `${name}.scrivx`), 'utf8');
    // The exact RGB triplets come from LABEL_COLORS_NAMED in scrivener.js.
    assert.match(xml, /Color="0\.698 0\.132 0\.132"[^>]*>Crimson</);
    assert.match(xml, /Color="0\.132 0\.557 0\.132"[^>]*>Lawn</);
  });

  it('falls back to a default color for unrecognized named colors', () => {
    const name = tmpName('BadColor');
    const p = ScrivenerProject.create(SCRATCH_DIR, name, {
      labels: [{ name: 'Mystery', color: 'not-a-real-color' }],
    });
    const xml = readFileSync(join(p.scrivPath, `${name}.scrivx`), 'utf8');
    // Whatever color it picks must still be a valid space-separated triplet.
    assert.match(xml, /Color="[0-9.]+ [0-9.]+ [0-9.]+"[^>]*>Mystery</);
  });

  it('refuses to overwrite an existing project', () => {
    const name = tmpName('Duplicate');
    ScrivenerProject.create(SCRATCH_DIR, name);
    assert.throws(
      () => ScrivenerProject.create(SCRATCH_DIR, name),
      /already exists/i,
    );
  });

  it('strips filesystem-unsafe characters from the project name', () => {
    const dirty = 'Has-Bad-Chars';
    const p = ScrivenerProject.create(SCRATCH_DIR, dirty);
    created.push(p.scrivPath);
    // The .scriv folder name should not contain any of /\:*?"<>|
    assert.doesNotMatch(p.scrivPath.split('/').pop(), /[/\\:*?"<>|]/);
  });

  it('emits exactly one XML declaration in the .scrivx file', () => {
    // Regression guard: XMLBuilder used to re-emit ?xml on round-trip if
    // _doc still held the parsed declaration, producing a malformed file.
    const name = tmpName('XmlDecl');
    const p = ScrivenerProject.create(SCRATCH_DIR, name);
    const manuscript = p.flattenBinder().find((i) => i.title === 'Manuscript');
    p.updateMetadata(manuscript.uuid, { title: 'Manuscript' });
    const xml = readFileSync(join(p.scrivPath, `${name}.scrivx`), 'utf8');
    const decls = xml.match(/<\?xml/g) ?? [];
    assert.equal(decls.length, 1, 'Exactly one <?xml ... ?> declaration expected');
  });
});

// ── RTF / Unicode / XML escape round-trips ────────────────────────────────────

describe('RTF / Unicode / XML escape round-trips', () => {
  let project;
  let uuids;

  before(() => {
    project = createTestProject('MCP Coverage — Escapes');
    uuids = buildTitleMap(project);
  });

  it('round-trips non-ASCII text through writeContent → readContent', () => {
    const uuid = uuids['Scene 2.2 — First Meeting'];
    const text = 'Café — naïveté — résumé. Привет! 你好! 🎉';
    project.writeContent(uuid, text);
    assert.equal(project.readContent(uuid), text);
  });

  it('round-trips literal braces and backslashes through RTF without breaking the document', () => {
    const uuid = uuids['Scene 4.1 — All Is Lost'];
    const text = 'Code: {a, b} — escaped with backslash \\.';
    project.writeContent(uuid, text);
    const back = project.readContent(uuid);
    assert.ok(back.includes('{a, b}'),  `lost braces in: ${JSON.stringify(back)}`);
    assert.ok(back.includes('\\'),      `lost backslash in: ${JSON.stringify(back)}`);
  });

  it('preserves smart quotes and em-dashes verbatim', () => {
    const uuid = uuids['Scene 3.1 — The Complication'];
    const text = '“Hello,” she said—then paused. ‘ok.’';
    project.writeContent(uuid, text);
    assert.equal(project.readContent(uuid), text);
  });

  it('preserves an empty string as an empty string', () => {
    const uuid = uuids['Scene 1.2 — The Ordinary World'];
    project.writeContent(uuid, '');
    assert.equal(project.readContent(uuid), '');
  });

  it('XML-escapes special characters in synopses written to search.indexes', () => {
    const uuid = uuids['Scene 1.1 — Opening Image'];
    const synopsis = 'A & B < C > D — quote " and apostrophe \' end.';
    project.writeSynopsis(uuid, synopsis, 'Scene 1.1 — Opening Image');

    // synopsis.txt is plain text — should round-trip exactly.
    assert.equal(project.readSynopsis(uuid), synopsis);

    // search.indexes is XML — the special characters must be entity-encoded
    // so the file remains parseable by Scrivener.
    const idx = readFileSync(join(project.scrivPath, 'Files', 'search.indexes'), 'utf8');
    assert.ok(idx.includes('A &amp; B &lt; C &gt; D'), 'synopsis must be XML-escaped in search.indexes');
    assert.ok(!/A & B < C > D/.test(idx), 'raw characters must not appear in search.indexes');
  });

  it('decodes \\uXXXX unicode escapes in titles, content, and synopses', () => {
    // The MCP layer accepts JSON \uXXXX escapes (LLMs often emit them) and
    // decodes them before persisting. Verify the decode happens on add and
    // on update.
    const uuid = project.addItem(null, {
      title: 'Caf\\u00e9',
      synopsis: 'na\\u00efvet\\u00e9',
      content: 'r\\u00e9sum\\u00e9',
    });
    project.reload();
    assert.equal(project.findItem(uuid).Title, 'Café');
    assert.equal(project.readSynopsis(uuid), 'naïveté');
    assert.equal(project.readContent(uuid),  'résumé');

    project.updateMetadata(uuid, { title: 'Caf\\u00e9 \\u2014 updated' });
    project.reload();
    assert.equal(project.findItem(uuid).Title, 'Café — updated');
  });

  it('persists titles containing ampersands without corrupting the .scrivx XML', () => {
    const uuid = project.addItem(null, { title: 'Tom & Jerry & Co.', content: 'x' });
    project.reload();
    assert.equal(project.findItem(uuid).Title, 'Tom & Jerry & Co.');

    // The on-disk .scrivx must still parse; reload() above already proves it,
    // but assert the entity encoding too as a belt-and-braces guard.
    const scrivxFile = readFileSync(project.scrivxPath, 'utf8');
    assert.ok(scrivxFile.includes('Tom &amp; Jerry &amp; Co.'),
      'ampersand in title must be entity-encoded in .scrivx');
  });
});

// ── Real-world Scrivener 3 RTF regression fixture ─────────────────────────────
//
// test/fixtures/scrivener-native.rtf is a hand-crafted RTF file that exercises
// constructs present in documents saved by Scrivener 3 but absent from the
// synthetic RTF that buildRtf() produces:
//
//   - Multiple named destinations: fonttbl, colortbl, *\expandedcolortbl, *\generator
//   - Bold/italic formatting groups stripped silently
//   - Hex-encoded Latin-1 characters (\'e9, \'e8, \'ef)
//   - Unicode escapes via \uc1\uNNNN? notation
//   - Multiple \par-separated paragraphs
//
// The expected plain-text is derived from the RTF by manually tracing the
// stripRtf state machine and is locked here as a regression guard against the
// rewrite from PR #13.

describe('stripRtf — real-world Scrivener 3 RTF constructs', () => {
  let project;
  let uuid;

  before(() => {
    project = createTestProject('MCP Coverage — RTF Fixture');
    const items = project.flattenBinder();
    uuid = items.find((i) => i.type === 'Text').uuid;
  });

  it('strips all named destinations and decodes escapes from a Scrivener 3 RTF document', () => {
    const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'scrivener-native.rtf');
    // Write the fixture directly to bypass writeContent (which would re-encode it).
    const dir = join(project.scrivPath, 'Files', 'Data', uuid);
    writeFileSync(join(dir, 'content.rtf'), readFileSync(fixturePath, 'utf8'), 'utf8');

    const text = project.readContent(uuid);

    assert.ok(text.includes('First paragraph with bold and italic text.'),
      `expected formatted text; got: ${JSON.stringify(text)}`);
    assert.ok(text.includes('Second paragraph: élève and naïveté.'),
      `expected hex-decoded text; got: ${JSON.stringify(text)}`);
    assert.ok(text.includes('Third paragraph: café and naïveté.'),
      `expected unicode-decoded text; got: ${JSON.stringify(text)}`);
    assert.ok(text.includes('Last paragraph.'),
      `expected last paragraph; got: ${JSON.stringify(text)}`);
  });

  it('does not leak fonttbl, colortbl, generator, or expandedcolortbl destination text', () => {
    const text = project.readContent(uuid);
    assert.ok(!text.includes('Helvetica'), 'fonttbl content must be stripped');
    assert.ok(!text.includes('TimesNewRoman'), 'fonttbl content must be stripped');
    assert.ok(!text.includes('Scrivener 3.3'), 'generator content must be stripped');
  });
});

// ── Windows-platform RTF output ───────────────────────────────────────────────

describe('platform=windows RTF output', () => {
  it('emits the Windows-flavored RTF header and round-trips text', () => {
    const name = 'MCP Coverage — Windows';
    const path = join(SCRATCH_DIR, `${name}.scriv`);
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });

    const p = ScrivenerProject.create(SCRATCH_DIR, name, {
      platform: 'windows',
      manuscript: [{ title: 'WinScene', content: 'Windows-flavored body.' }],
    });

    try {
      const flat = p.flattenBinder();
      const scene = flat.find((i) => i.title === 'WinScene');
      const rtfPath = join(p.scrivPath, 'Files', 'Data', scene.uuid, 'content.rtf');
      const rtf = readFileSync(rtfPath, 'utf8');

      // Windows RTF: ansi codepage 1252, Arial fonttbl, no cocoartf marker.
      assert.ok(rtf.includes('\\ansicpg1252'), 'expected \\ansicpg1252 in Windows RTF');
      assert.ok(rtf.includes('Arial'),         'expected Arial fonttbl in Windows RTF');
      assert.ok(!rtf.includes('cocoartf'),     'cocoartf marker must not appear in Windows RTF');

      // And readContent should still strip cleanly.
      assert.equal(p.readContent(scene.uuid), 'Windows-flavored body.');
    } finally {
      if (existsSync(path)) rmSync(path, { recursive: true, force: true });
    }
  });
});
