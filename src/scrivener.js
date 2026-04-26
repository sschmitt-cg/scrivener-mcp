import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

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
  }

  reload() {
    this._load();
  }

  _assertWritable() {
    const lockPath = join(this.scrivPath, 'Files', 'user.lock');
    if (existsSync(lockPath)) {
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
    writeFileSync(this.scrivxPath, xml, 'utf8');
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
      synopsis: item.Synopsis ?? meta.Synopsis ?? '',
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
    const statuses = this._doc?.ScrivenerProject?.StatusSettings?.Statuses?.Status ?? [];
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

  _applyMetadataChanges(item, changes) {
    if (!item.MetaData) item.MetaData = {};
    if ('title' in changes) item.Title = decodeUnicodeEscapes(changes.title);
    if ('synopsis' in changes) item.Synopsis = decodeUnicodeEscapes(changes.synopsis);
    if ('labelId' in changes) item.MetaData.LabelID = String(changes.labelId);
    if ('statusId' in changes) item.MetaData.StatusID = String(changes.statusId);
    if ('includeInCompile' in changes) {
      item.MetaData.IncludeInCompile = changes.includeInCompile ? 'Yes' : 'No';
    }
  }

  updateMetadata(uuid, changes) {
    this._assertWritable();
    this.reload();
    const item = this.findItem(uuid);
    if (!item) throw new Error(`Item not found: ${uuid}`);
    this._applyMetadataChanges(item, changes);
    this._save();
  }

  batchUpdateMetadata(updates) {
    this._assertWritable();
    this.reload();
    const errors = [];
    for (const { uuid, changes } of updates) {
      const item = this.findItem(uuid);
      if (!item) {
        errors.push({ uuid, error: 'not found' });
        continue;
      }
      this._applyMetadataChanges(item, changes);
    }
    this._save();
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

    if (itemDef.synopsis) node.Synopsis = decodeUnicodeEscapes(itemDef.synopsis);

    const meta = {
      IncludeInCompile: itemDef.includeInCompile === false ? 'No' : 'Yes',
      Created: now,
      Modified: now,
    };
    if (labelId !== undefined) meta.LabelID = labelId;
    if (statusId !== undefined) meta.StatusID = statusId;
    node.MetaData = meta;

    this._targetChildren(parentUuid).push(node);
    this._save();

    if (type === 'Text') {
      this._writeContentRaw(uuid, decodeUnicodeEscapes(itemDef.content ?? ''));
    }

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

  _outlineItem(item, labels, statuses, includeContent) {
    const meta = item.MetaData ?? {};
    const uuid = item['@_UUID'] ?? '';
    const type = item['@_Type'] ?? '';
    const node = {
      uuid,
      type,
      title: item.Title ?? '',
      synopsis: item.Synopsis ?? meta.Synopsis ?? '',
      label: labels[String(meta.LabelID ?? '')] ?? '',
      status: statuses[String(meta.StatusID ?? '')] ?? '',
      includeInCompile: meta.IncludeInCompile ?? '',
    };
    if (includeContent && type === 'Text' && uuid) {
      const text = this.readContent(uuid);
      if (text) node.content = text;
    }
    const children = item.Children?.BinderItem ?? [];
    if (children.length) {
      node.children = children.map((c) => this._outlineItem(c, labels, statuses, includeContent));
    }
    return node;
  }

  getOutline({ rootUuid = null, includeContent = false } = {}) {
    const labels = this.getLabels();
    const statuses = this.getStatuses();
    if (rootUuid) {
      const item = this.findItem(rootUuid);
      if (!item) throw new Error(`Item not found: ${rootUuid}`);
      return [this._outlineItem(item, labels, statuses, includeContent)];
    }
    return this._getBinderItems().map((item) => this._outlineItem(item, labels, statuses, includeContent));
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

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    let nextId = 1;
    const pendingContent = [];

    const labelMap = Object.fromEntries(
      labels.map((l, i) => [typeof l === 'string' ? l : l.name, String(i + 1)])
    );
    const statusMap = Object.fromEntries(statuses.map((s, i) => [s, String(i + 1)]));

    function buildItem(item) {
      const uuid = randomUUID().toUpperCase();
      const type = item.type ?? 'Text';
      const node = {
        '@_UUID': uuid,
        '@_ID': String(nextId++),
        '@_Type': type,
        Title: decodeUnicodeEscapes(item.title ?? 'Untitled'),
      };

      if (item.synopsis) node.Synopsis = decodeUnicodeEscapes(item.synopsis);

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

      if (type === 'Text') {
        pendingContent.push({ uuid, content: decodeUnicodeEscapes(item.content ?? '') });
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
      { '@_ID': '0', '#text': 'No Label' },
      ...labels.map((l, i) => {
        const labelName = typeof l === 'string' ? l : l.name;
        const colorKey = typeof l === 'object' ? l.color : undefined;
        const color = (colorKey && LABEL_COLORS_NAMED[colorKey]) ?? LABEL_COLORS[i % LABEL_COLORS.length];
        return { '@_ID': String(i + 1), '@_Color': color, '#text': labelName };
      }),
    ];

    const statusNodes = [
      { '@_ID': '0', '#text': 'No Status' },
      ...statuses.map((s, i) => ({ '@_ID': String(i + 1), '#text': s })),
    ];

    const doc = {
      ScrivenerProject: {
        '@_Version': '2.0',
        '@_Creator': 'scrivener3',
        '@_Modified': now,
        Binder: { BinderItem: binderItems },
        LabelSettings: { Labels: { Label: labelNodes } },
        StatusSettings: { Statuses: { Status: statusNodes } },
      },
    };

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      new XMLBuilder(BUILDER_OPTIONS).build(doc);
    writeFileSync(join(scrivPath, `${safeName}.scrivx`), xml, 'utf8');

    const project = new ScrivenerProject(scrivPath, { platform });
    for (const { uuid, content } of pendingContent) {
      project._writeContentRaw(uuid, content);
    }
    return project;
  }
}
