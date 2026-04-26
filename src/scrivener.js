import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

function stripRtf(rtf) {
  return rtf
    .replace(/\{\\[^{}]*\}/g, '')
    .replace(/\\par\b\*?/g, '\n')
    .replace(/\\line\b\*?/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\\n/g, '\n')
    .replace(/\\u(\d+)\??/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\[a-z*]+\d*\b\*?/g, '')
    .replace(/[{}\\]/g, '')
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

  writeSynopsis(uuid, text) {
    const dir = join(this.scrivPath, 'Files', 'Data', uuid);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'synopsis.txt'), text, 'utf8');
  }

  updateMetadata(uuid, changes) {
    const item = this.findItem(uuid);
    if (!item) throw new Error(`Item not found: ${uuid}`);
    if (!item.MetaData) item.MetaData = {};

    if ('synopsis' in changes) this.writeSynopsis(uuid, changes.synopsis);

    let xmlDirty = false;
    if ('title' in changes) { item.Title = changes.title; xmlDirty = true; }
    if ('labelId' in changes) { item.MetaData.LabelID = String(changes.labelId); xmlDirty = true; }
    if ('statusId' in changes) { item.MetaData.StatusID = String(changes.statusId); xmlDirty = true; }
    if ('includeInCompile' in changes) {
      item.MetaData.IncludeInCompile = changes.includeInCompile ? 'Yes' : 'No';
      xmlDirty = true;
    }
    if (xmlDirty) this._save();
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

    const node = {
      '@_UUID': uuid,
      '@_ID': this._getNextId(),
      '@_Type': itemDef.type ?? 'Text',
      Title: itemDef.title ?? 'Untitled',
    };

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

    if (itemDef.content) this.writeContent(uuid, itemDef.content);
    if (itemDef.synopsis) this.writeSynopsis(uuid, itemDef.synopsis);

    return uuid;
  }

  moveItem(uuid, newParentUuid) {
    const found = this._findWithParent(this._getBinderItems(), uuid);
    if (!found) throw new Error(`Item not found: ${uuid}`);
    found.siblings.splice(found.index, 1);
    this._targetChildren(newParentUuid ?? null).push(found.item);
    this._save();
  }

  // ── Outline ──────────────────────────────────────────────────────────────────

  _outlineItem(item, labels, statuses) {
    const meta = item.MetaData ?? {};
    const node = {
      uuid: item['@_UUID'] ?? '',
      type: item['@_Type'] ?? '',
      title: item.Title ?? '',
      synopsis: this.readSynopsis(item['@_UUID'] ?? ''),
      label: labels[String(meta.LabelID ?? '')] ?? '',
      status: statuses[String(meta.StatusID ?? '')] ?? '',
      includeInCompile: meta.IncludeInCompile ?? '',
    };
    const children = item.Children?.BinderItem ?? [];
    if (children.length) node.children = children.map((c) => this._outlineItem(c, labels, statuses));
    return node;
  }

  getOutline() {
    const labels = this.getLabels();
    const statuses = this.getStatuses();
    return this._getBinderItems().map((item) => this._outlineItem(item, labels, statuses));
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
      const node = {
        '@_UUID': uuid,
        '@_ID': String(nextId++),
        '@_Type': item.type ?? 'Text',
        Title: item.title ?? 'Untitled',
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

      if (item.content || item.synopsis) pendingContent.push({ uuid, content: item.content, synopsis: item.synopsis });

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
    for (const { uuid, content, synopsis } of pendingContent) {
      if (content) project.writeContent(uuid, content);
      if (synopsis) project.writeSynopsis(uuid, synopsis);
    }
    return project;
  }
}
