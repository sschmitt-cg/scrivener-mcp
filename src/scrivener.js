import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import { deflateRawSync } from 'zlib';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipSingleFile(filename, data) {
  const nameBuf = Buffer.from(filename, 'utf8');
  const compressed = deflateRawSync(data);
  const crc = crc32(data);
  const uncompSize = data.length;
  const compSize = compressed.length;

  const now = new Date();
  const dosTime = ((now.getHours() & 0x1F) << 11) | ((now.getMinutes() & 0x3F) << 5) | ((now.getSeconds() >>> 1) & 0x1F);
  const dosDate = (((now.getFullYear() - 1980) & 0x7F) << 9) | (((now.getMonth() + 1) & 0xF) << 5) | (now.getDate() & 0x1F);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compSize, 18);
  local.writeUInt32LE(uncompSize, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(0x033F, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt16LE(dosTime, 12);
  cd.writeUInt16LE(dosDate, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(compSize, 20);
  cd.writeUInt32LE(uncompSize, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(0, 30);
  cd.writeUInt16LE(0, 32);
  cd.writeUInt16LE(0, 34);
  cd.writeUInt16LE(0, 36);
  cd.writeUInt32LE(0, 38);
  cd.writeUInt32LE(0, 42);

  const cdSize = cd.length + nameBuf.length;
  const cdOffset = local.length + nameBuf.length + compSize;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, nameBuf, compressed, cd, nameBuf, eocd]);
}

const RTF_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'filetbl',
  'listtable', 'listoverridetable', 'revtbl', 'rsidtbl',
  'themedata', 'latentstyles', 'datastore', 'generator',
  'operator', 'author', 'title', 'subject', 'keywords',
  'comment', 'doccomm', 'company', 'pict', 'shppict',
  'nonshppict', 'object', 'objclass', 'objdata', 'result',
  'falt', 'panose', 'fontemb', 'fontfile', 'xmlnstbl',
  'wgrffmtfilter', 'protusertbl', 'header', 'footer',
  'headerl', 'headerr', 'headerf', 'footerl', 'footerr',
  'footerf', 'footnote', 'annotation', 'bkmkstart', 'bkmkend',
  'field', 'fldinst', 'datafield', 'private', 'pntext',
  'category',
]);

const RTF_SYMBOLS = {
  par: '\n', line: '\n', sect: '\n', tab: '\t',
  emdash: '\u2014', endash: '\u2013',
  lquote: '\u2018', rquote: '\u2019',
  ldblquote: '\u201C', rdblquote: '\u201D',
  bullet: '\u2022',
};

function stripRtf(rtf) {
  let out = '';
  let depth = 0;
  let skipDepth = 0;
  let i = 0;
  const len = rtf.length;

  while (i < len) {
    const ch = rtf[i];

    if (ch === '{') {
      depth++;
      let j = i + 1;
      let isDestination = false;
      if (rtf[j] === '\\' && rtf[j + 1] === '*') {
        isDestination = true;
      } else if (rtf[j] === '\\' && /[a-zA-Z]/.test(rtf[j + 1])) {
        let k = j + 1;
        let word = '';
        while (k < len && /[a-zA-Z]/.test(rtf[k])) word += rtf[k++];
        if (RTF_DESTINATIONS.has(word)) isDestination = true;
      }
      if (isDestination && skipDepth === 0) skipDepth = depth;
      i++;
      continue;
    }

    if (ch === '}') {
      if (skipDepth > 0 && depth === skipDepth) skipDepth = 0;
      depth--;
      i++;
      continue;
    }

    if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (skipDepth === 0) out += next;
        i += 2;
        continue;
      }
      if (next === '\n' || next === '\r') {
        if (skipDepth === 0) out += '\n';
        i += 2;
        continue;
      }
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        if (skipDepth === 0 && /^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
        }
        i += 4;
        continue;
      }
      if (/[a-zA-Z]/.test(next)) {
        let k = i + 1;
        let word = '';
        while (k < len && /[a-zA-Z]/.test(rtf[k])) word += rtf[k++];
        let param = '';
        if (rtf[k] === '-' || /\d/.test(rtf[k])) {
          while (k < len && (rtf[k] === '-' || /\d/.test(rtf[k]))) param += rtf[k++];
        }
        if (rtf[k] === ' ') k++;

        if (skipDepth === 0) {
          if (word === 'u' && param) {
            let code = parseInt(param, 10);
            if (code < 0) code += 65536;
            if (!isNaN(code)) out += String.fromCharCode(code);
            if (rtf[k] === '?') k++;
            else if (rtf[k] === '\\' && rtf[k + 1] === "'") k += 4;
            else if (k < len && rtf[k] !== '\\' && rtf[k] !== '{' && rtf[k] !== '}') k++;
          } else if (word in RTF_SYMBOLS) {
            out += RTF_SYMBOLS[word];
          }
        }
        i = k;
        continue;
      }
      i += 2;
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if (skipDepth === 0) out += ch;
    i++;
  }

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['BinderItem', 'Label', 'Status'].includes(name),
};

const BUILDER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '   ',
  suppressEmptyNode: false,
};

const LABEL_COLORS_NAMED = {
  red:    '0.698 0.132 0.132',
  orange: '0.698 0.412 0.132',
  yellow: '0.698 0.698 0.132',
  green:  '0.132 0.557 0.132',
  blue:   '0.132 0.412 0.698',
  purple: '0.412 0.132 0.698',
  pink:   '0.698 0.132 0.412',
  cyan:   '0.132 0.698 0.698',
};

const LABEL_COLORS = Object.values(LABEL_COLORS_NAMED);

function decodeUnicodeEscapes(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function buildRtf(plainText, platform = 'mac') {
  const escaped = plainText
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/[^\x00-\x7F]/g, (ch) => `\\uc1\\u${ch.charCodeAt(0)}?`)
    .replace(/\r?\n/g, '\\par\n');

  if (platform === 'windows') {
    return [
      '{\\rtf1\\ansi\\ansicpg1252\\deff0',
      '{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}',
      '\\f0\\fs24 ' + escaped,
      '}',
    ].join('\r\n');
  }

  return [
    '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761',
    '{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}',
    '{\\colortbl;\\red255\\green255\\blue255;}',
    '\\paperw11900\\paperh16840\\margl1440\\margr1440\\vieww11520\\viewh8400\\viewkind0',
    '\\pard\\tx566\\tx1133\\tx1700\\tx2267\\tx2834\\tx3401\\tx3968\\tx4535\\tx5102\\tx5669\\tx6236\\tx6803\\pardirnatural\\partightenfactor0',
    '\\f0\\fs24 \\cf0 ' + escaped,
    '}',
  ].join('\n');
}

export class ScrivenerProject {
  constructor(scrivPath, { platform = 'mac' } = {}) {
    this.scrivPath = scrivPath;
    this.platform = platform;
    this.scrivxPath = this._findScrivxFile();
    this._load();
  }

  _findScrivxFile() {
    const files = readdirSync(this.scrivPath);
    const scrivx = files.find((f) => f.endsWith('.scrivx'));
    if (!scrivx) throw new Error(`No .scrivx file found in ${this.scrivPath}`);
    return join(this.scrivPath, scrivx);
  }

  _load() {
    const xml = readFileSync(this.scrivxPath, 'utf8');
    this._doc = new XMLParser(PARSER_OPTIONS).parse(xml);
    // XMLParser stores the XML declaration as "?xml"; if we leave it in _doc,
    // XMLBuilder will re-emit it and _save() would prepend a second one.
    delete this._doc['?xml'];
  }

  reload() {
    this._load();
  }

  _assertWritable() {
    const lockPath = join(this.scrivPath, 'Files', 'user.lock');
    if (existsSync(lockPath)) {
      const msg = `scrivener-mcp: refusing write — ${lockPath} is present (Scrivener has this project open)`;
      console.error(msg);
      throw new Error(
        'Scrivener has this project open (Files/user.lock exists). ' +
        'Close the project in Scrivener and retry. ' +
        "If you're sure no Scrivener instance is running, delete Files/user.lock manually."
      );
    }
  }

  _save() {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      new XMLBuilder(BUILDER_OPTIONS).build(this._doc);
    const xmlBuf = Buffer.from(xml, 'utf8');
    writeFileSync(this.scrivxPath, xmlBuf);
    this._writeBinderAutosave(xmlBuf);
  }

  _writeBinderAutosave(xmlBuf) {
    const filesDir = join(this.scrivPath, 'Files');
    if (!existsSync(filesDir)) mkdirSync(filesDir, { recursive: true });
    const autosavePath = join(filesDir, 'binder.autosave');
    const innerName = basename(this.scrivxPath);
    writeFileSync(autosavePath, zipSingleFile(innerName, xmlBuf));
  }

  _getBinderItems() {
    return this._doc?.ScrivenerProject?.Binder?.BinderItem ?? [];
  }

  _flattenItem(item, depth = 0) {
    const meta = item.MetaData ?? {};
    const node = {
      uuid: item['@_UUID'] ?? '',
      id: item['@_ID'] ?? '',
      type: item['@_Type'] ?? '',
      title: item.Title ?? '',
      depth,
      synopsis: this.readSynopsis(item['@_UUID'] ?? ''),
      labelId: String(meta.LabelID ?? ''),
      statusId: String(meta.StatusID ?? ''),
      includeInCompile: meta.IncludeInCompile ?? '',
      created: meta.Created ?? '',
      modified: meta.Modified ?? '',
    };
    const results = [node];
    for (const child of item.Children?.BinderItem ?? []) {
      results.push(...this._flattenItem(child, depth + 1));
    }
    return results;
  }

  flattenBinder() {
    return this._getBinderItems().flatMap((item) => this._flattenItem(item, 0));
  }

  getLabels() {
    const labels = this._doc?.ScrivenerProject?.LabelSettings?.Labels?.Label ?? [];
    return Object.fromEntries(
      labels.map((l) => [String(l['@_ID'] ?? ''), l['#text'] ?? String(l)])
    );
  }

  getStatuses() {
    const st = this._doc?.ScrivenerProject?.StatusSettings;
    // Scrivener's native format uses StatusItems; our create() also writes StatusItems.
    // Fall back to Statuses for any projects created by older versions of this code.
    const statuses = st?.StatusItems?.Status ?? st?.Statuses?.Status ?? [];
    return Object.fromEntries(
      statuses.map((s) => [String(s['@_ID'] ?? ''), s['#text'] ?? String(s)])
    );
  }

  _findItemInTree(items, uuid) {
    for (const item of items) {
      if ((item['@_UUID'] ?? '') === uuid) return item;
      const found = this._findItemInTree(item.Children?.BinderItem ?? [], uuid);
      if (found) return found;
    }
    return null;
  }

  findItem(uuid) {
    return this._findItemInTree(this._getBinderItems(), uuid);
  }

  readContent(uuid) {
    const rtfPath = join(this.scrivPath, 'Files', 'Data', uuid, 'content.rtf');
    try {
      return stripRtf(readFileSync(rtfPath, 'utf8'));
    } catch {
      return '';
    }
  }

  writeContent(uuid, plainText) {
    this._assertWritable();
    this.reload();
    if (!this.findItem(uuid)) {
      throw new Error(
        `Cannot write content: UUID ${uuid} is not in the binder. ` +
        'Use add_document to create a new document and obtain a valid UUID.'
      );
    }
    this._writeContentRaw(uuid, decodeUnicodeEscapes(plainText));
  }

  _writeContentRaw(uuid, plainText) {
    const dir = join(this.scrivPath, 'Files', 'Data', uuid);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'content.rtf'), buildRtf(plainText, this.platform), 'utf8');
  }

  readSynopsis(uuid) {
    const synopsisPath = join(this.scrivPath, 'Files', 'Data', uuid, 'synopsis.txt');
    try {
      return readFileSync(synopsisPath, 'utf8');
    } catch {
      return '';
    }
  }

  _escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Scrivener renders corkboard/outline synopses from Files/search.indexes,
  // not by reading synopsis.txt directly on open. Keep both in sync.
  _updateSearchIndex(uuid, title, synopsis) {
    const indexPath = join(this.scrivPath, 'Files', 'search.indexes');
    let content;
    try {
      content = readFileSync(indexPath, 'utf8');
    } catch {
      content = '<?xml version="1.0" encoding="UTF-8"?>\n<SearchIndexes Version="1.0">\n    <Documents>\n    </Documents>\n</SearchIndexes>\n';
    }

    const synopsisTag = `<Synopsis>${this._escapeXml(synopsis)}</Synopsis>`;
    const docRe = new RegExp(`(        <Document ID="${uuid}">[\\s\\S]*?        </Document>)`);
    const docMatch = content.match(docRe);

    if (docMatch) {
      let block = docMatch[1];
      if (/<Synopsis>/.test(block)) {
        block = block.replace(/<Synopsis>[\s\S]*?<\/Synopsis>/, synopsisTag);
      } else {
        block = block.replace(/(<\/Title>)/, `$1\n            ${synopsisTag}`);
      }
      content = content.replace(docRe, block);
    } else {
      const newDoc = [
        `        <Document ID="${uuid}">`,
        `            <Title>${this._escapeXml(title)}</Title>`,
        `            ${synopsisTag}`,
        `        </Document>`,
      ].join('\n');
      content = content.replace('    </Documents>', `${newDoc}\n    </Documents>`);
    }

    writeFileSync(indexPath, content, 'utf8');
  }

  writeSynopsis(uuid, text, title = '') {
    const dir = join(this.scrivPath, 'Files', 'Data', uuid);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'synopsis.txt'), text, 'utf8');
    this._updateSearchIndex(uuid, title, text);
  }

  // Returns true if the .scrivx XML was modified. Synopsis-only changes
  // persist to disk via writeSynopsis and don't dirty the binder XML.
  _applyMetadataChanges(item, changes) {
    if (!item.MetaData) item.MetaData = {};
    let xmlDirty = false;
    if ('title' in changes) {
      item.Title = decodeUnicodeEscapes(changes.title);
      xmlDirty = true;
    }
    if ('synopsis' in changes) {
      this.writeSynopsis(
        item['@_UUID'] ?? '',
        decodeUnicodeEscapes(changes.synopsis),
        item.Title ?? ''
      );
    }
    if ('labelId' in changes) {
      item.MetaData.LabelID = String(changes.labelId);
      xmlDirty = true;
    }
    if ('statusId' in changes) {
      item.MetaData.StatusID = String(changes.statusId);
      xmlDirty = true;
    }
    if ('includeInCompile' in changes) {
      item.MetaData.IncludeInCompile = changes.includeInCompile ? 'Yes' : 'No';
      xmlDirty = true;
    }
    return xmlDirty;
  }

  updateMetadata(uuid, changes) {
    this._assertWritable();
    this.reload();
    const item = this.findItem(uuid);
    if (!item) throw new Error(`Item not found: ${uuid}`);
    const xmlDirty = this._applyMetadataChanges(item, changes);
    if (xmlDirty) this._save();
  }

  batchUpdateMetadata(updates) {
    this._assertWritable();
    this.reload();
    const errors = [];
    let anyXmlDirty = false;
    for (const { uuid, changes } of updates) {
      const item = this.findItem(uuid);
      if (!item) {
        errors.push({ uuid, error: 'not found' });
        continue;
      }
      if (this._applyMetadataChanges(item, changes)) anyXmlDirty = true;
    }
    if (anyXmlDirty) this._save();
    return { applied: updates.length - errors.length, errors };
  }

  // ── Binder mutation ─────────────────────────────────────────────────────────

  _getNextId() {
    const max = this.flattenBinder().reduce((m, i) => Math.max(m, parseInt(i.id) || 0), 0);
    return String(max + 1);
  }

  _findWithParent(items, uuid) {
    for (let i = 0; i < items.length; i++) {
      if ((items[i]['@_UUID'] ?? '') === uuid) return { item: items[i], siblings: items, index: i };
      const children = items[i].Children?.BinderItem;
      if (children?.length) {
        const found = this._findWithParent(children, uuid);
        if (found) return found;
      }
    }
    return null;
  }

  _targetChildren(parentUuid) {
    if (parentUuid) {
      const parent = this.findItem(parentUuid);
      if (!parent) throw new Error(`Parent not found: ${parentUuid}`);
      if (!parent.Children) parent.Children = {};
      if (!parent.Children.BinderItem) parent.Children.BinderItem = [];
      return parent.Children.BinderItem;
    }
    const draft = this._getBinderItems().find((i) => i['@_Type'] === 'DraftFolder');
    if (!draft) throw new Error('No Manuscript folder found');
    if (!draft.Children) draft.Children = {};
    if (!draft.Children.BinderItem) draft.Children.BinderItem = [];
    return draft.Children.BinderItem;
  }

  addItem(parentUuid, itemDef) {
    this._assertWritable();
    this.reload();
    const labels = this.getLabels();
    const statuses = this.getStatuses();
    const labelId = itemDef.label
      ? Object.entries(labels).find(([, n]) => n === itemDef.label)?.[0]
      : undefined;
    const statusId = itemDef.status
      ? Object.entries(statuses).find(([, n]) => n === itemDef.status)?.[0]
      : undefined;

    const uuid = randomUUID().toUpperCase();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const type = itemDef.type ?? 'Text';
    const node = {
      '@_UUID': uuid,
      '@_ID': this._getNextId(),
      '@_Type': type,
      Title: decodeUnicodeEscapes(itemDef.title ?? 'Untitled'),
    };

    const meta = {
      IncludeInCompile: itemDef.includeInCompile === false ? 'No' : 'Yes',
      Created: now,
      Modified: now,
    };
    if (labelId !== undefined) meta.LabelID = labelId;
    if (statusId !== undefined) meta.StatusID = statusId;
    node.MetaData = meta;

    // Write supporting files BEFORE saving the binder XML. Two reasons:
    //   - FSEvents safety: if Scrivener is watching, supporting files are
    //     in place by the time the .scrivx write fires the watcher.
    //   - Synopsis-only Text items: writing an empty content.rtf gives
    //     Scrivener something concrete to bind to, preventing recovery
    //     passes from garbage-collecting metadata-only documents.
    // Use _writeContentRaw (not writeContent) to skip the reload that
    // would clobber our in-memory binder before we push the new node.
    if (itemDef.synopsis) {
      this.writeSynopsis(
        uuid,
        decodeUnicodeEscapes(itemDef.synopsis),
        decodeUnicodeEscapes(itemDef.title ?? 'Untitled')
      );
    }
    if (type === 'Text') {
      this._writeContentRaw(uuid, decodeUnicodeEscapes(itemDef.content ?? ''));
    }

    this._targetChildren(parentUuid).push(node);
    this._save();

    return uuid;
  }

  moveItem(uuid, newParentUuid) {
    this._assertWritable();
    this.reload();
    const found = this._findWithParent(this._getBinderItems(), uuid);
    if (!found) throw new Error(`Item not found: ${uuid}`);
    found.siblings.splice(found.index, 1);
    this._targetChildren(newParentUuid ?? null).push(found.item);
    this._save();
  }

  // ── Outline ──────────────────────────────────────────────────────────────────

  _outlineItem(item, labels, statuses, includeContent, state) {
    const meta = item.MetaData ?? {};
    const uuid = item['@_UUID'] ?? '';
    const type = item['@_Type'] ?? '';
    const node = {
      uuid,
      type,
      title: item.Title ?? '',
      synopsis: this.readSynopsis(item['@_UUID'] ?? ''),
      label: labels[String(meta.LabelID ?? '')] ?? '',
      status: statuses[String(meta.StatusID ?? '')] ?? '',
      includeInCompile: meta.IncludeInCompile ?? '',
    };
    if (includeContent && type === 'Text' && uuid && !state.truncated) {
      const text = this.readContent(uuid);
      if (text) {
        if (state.chars + text.length > state.maxChars) {
          state.truncated = true;
        } else {
          node.content = text;
          state.chars += text.length;
        }
      }
    }
    const children = item.Children?.BinderItem ?? [];
    if (children.length) {
      node.children = children.map((c) => this._outlineItem(c, labels, statuses, includeContent, state));
    }
    return node;
  }

  // Returns { items, truncated?, note? }.
  // When includeContent is true and total prose exceeds maxContentChars,
  // items past the limit have no content field and truncated/note are set.
  getOutline({ rootUuid = null, includeContent = false, maxContentChars = 200_000 } = {}) {
    const labels = this.getLabels();
    const statuses = this.getStatuses();
    const state = { chars: 0, maxChars: maxContentChars, truncated: false };
    let items;
    if (rootUuid) {
      const item = this.findItem(rootUuid);
      if (!item) throw new Error(`Item not found: ${rootUuid}`);
      items = [this._outlineItem(item, labels, statuses, includeContent, state)];
    } else {
      items = this._getBinderItems().map((i) => this._outlineItem(i, labels, statuses, includeContent, state));
    }
    const result = { items };
    if (state.truncated) {
      result.truncated = true;
      result.note = `Content truncated at ${maxContentChars} characters. Use rootUuid to scope to a subtree for a smaller result.`;
    }
    return result;
  }

  getDocuments(uuids) {
    const labels = this.getLabels();
    const statuses = this.getStatuses();
    const flat = this.flattenBinder();
    const byUuid = new Map(flat.map((i) => [i.uuid, i]));
    return uuids.map((uuid) => {
      const item = byUuid.get(uuid);
      if (!item) return { uuid, error: 'not found' };
      return {
        ...item,
        label: labels[item.labelId] ?? item.labelId,
        status: statuses[item.statusId] ?? item.statusId,
        content: item.type === 'Text' ? this.readContent(uuid) : '',
      };
    });
  }

  // ── Static factory ──────────────────────────────────────────────────────────

  static create(projectsDir, name, options = {}) {
    const {
      platform = 'mac',
      labels = [],
      statuses = ['To Do', 'In Progress', 'First Draft', 'Revised Draft', 'Done'],
      manuscript = [],
      research = [],
    } = options;

    const safeName = name.replace(/[/\\:*?"<>|]/g, '-').trim();
    const packageName = safeName.endsWith('.scriv') ? safeName : `${safeName}.scriv`;
    const scrivPath = join(projectsDir, packageName);

    if (existsSync(scrivPath)) throw new Error(`Project already exists: ${packageName}`);

    mkdirSync(join(scrivPath, 'Files', 'Data'), { recursive: true });
    mkdirSync(join(scrivPath, 'Settings'), { recursive: true });

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    let nextId = 1;
    const pendingContent = [];

    const labelMap = Object.fromEntries(
      labels.map((l, i) => [typeof l === 'string' ? l : l.name, String(i + 1)])
    );
    const statusMap = Object.fromEntries(statuses.map((s, i) => [s, String(i)]));

    function buildItem(item) {
      const uuid = randomUUID().toUpperCase();
      const type = item.type ?? 'Text';
      const node = {
        '@_UUID': uuid,
        '@_ID': String(nextId++),
        '@_Type': type,
        Title: decodeUnicodeEscapes(item.title ?? 'Untitled'),
      };

      const meta = {
        IncludeInCompile: item.includeInCompile === false ? 'No' : 'Yes',
        Created: now,
        Modified: now,
      };
      if (item.label && labelMap[item.label] !== undefined) meta.LabelID = labelMap[item.label];
      if (item.status && statusMap[item.status] !== undefined) meta.StatusID = statusMap[item.status];
      node.MetaData = meta;

      const children = item.children ?? [];
      if (children.length > 0) node.Children = { BinderItem: children.map(buildItem) };

      // Always queue Text items so an empty content.rtf gets written for
      // synopsis-only items (otherwise Scrivener's recovery pass garbage-
      // collects them). Queue any item with a synopsis so writeSynopsis
      // populates synopsis.txt + search.indexes.
      if (type === 'Text' || item.synopsis) {
        pendingContent.push({
          uuid,
          type,
          title: decodeUnicodeEscapes(item.title ?? 'Untitled'),
          content: decodeUnicodeEscapes(item.content ?? ''),
          synopsis: item.synopsis ? decodeUnicodeEscapes(item.synopsis) : undefined,
        });
      }

      return node;
    }

    const manuscriptNodes = manuscript.map(buildItem);
    const researchNodes = research.map(buildItem);

    const binderItems = [
      {
        '@_UUID': randomUUID().toUpperCase(),
        '@_ID': String(nextId++),
        '@_Type': 'DraftFolder',
        Title: 'Manuscript',
        MetaData: { IncludeInCompile: 'Yes', Created: now, Modified: now },
        Children: manuscriptNodes.length > 0 ? { BinderItem: manuscriptNodes } : {},
      },
      {
        '@_UUID': randomUUID().toUpperCase(),
        '@_ID': String(nextId++),
        '@_Type': 'ResearchFolder',
        Title: 'Research',
        MetaData: { IncludeInCompile: 'No', Created: now, Modified: now },
        Children: researchNodes.length > 0 ? { BinderItem: researchNodes } : {},
      },
      {
        '@_UUID': randomUUID().toUpperCase(),
        '@_ID': String(nextId++),
        '@_Type': 'TrashFolder',
        Title: 'Trash',
        MetaData: { IncludeInCompile: 'No', Created: now, Modified: now },
        Children: {},
      },
    ];

    const labelNodes = [
      { '@_ID': '-1', '#text': 'No Label' },
      ...labels.map((l, i) => {
        const labelName = typeof l === 'string' ? l : l.name;
        const colorKey = typeof l === 'object' ? l.color : undefined;
        const color = (colorKey && LABEL_COLORS_NAMED[colorKey]) ?? LABEL_COLORS[i % LABEL_COLORS.length];
        return { '@_ID': String(i + 1), '@_Color': color, '#text': labelName };
      }),
    ];

    const statusNodes = [
      { '@_ID': '-1', '#text': 'No Status' },
      ...statuses.map((s, i) => ({ '@_ID': String(i), '#text': s })),
    ];

    const doc = {
      ScrivenerProject: {
        '@_Version': '2.0',
        '@_Creator': 'scrivener3',
        '@_Modified': now,
        Binder: { BinderItem: binderItems },
        LabelSettings: { DefaultLabelID: '-1', Labels: { Label: labelNodes } },
        StatusSettings: { Title: 'Status', DefaultStatusID: '-1', StatusItems: { Status: statusNodes } },
      },
    };

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      new XMLBuilder(BUILDER_OPTIONS).build(doc);
    const xmlBuf = Buffer.from(xml, 'utf8');
    const scrivxName = `${safeName}.scrivx`;
    writeFileSync(join(scrivPath, scrivxName), xmlBuf);
    writeFileSync(join(scrivPath, 'Files', 'binder.autosave'), zipSingleFile(scrivxName, xmlBuf));

    const project = new ScrivenerProject(scrivPath, { platform });
    for (const { uuid, type, title, content, synopsis } of pendingContent) {
      if (type === 'Text') project._writeContentRaw(uuid, content);
      if (synopsis) project.writeSynopsis(uuid, synopsis, title);
    }
    return project;
  }
}
