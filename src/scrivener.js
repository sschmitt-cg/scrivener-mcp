import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

function stripRtf(rtf) {
  // Remove RTF header/groups and control words, leaving plain text
  let text = rtf
    .replace(/\{\\[^{}]*\}/g, '')          // remove nested groups like {\fonttbl...}
    .replace(/\\par\b\*?/g, '\n')           // paragraph breaks → newlines
    .replace(/\\line\b\*?/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\\n/g, '\n')
    .replace(/\\u(\d+)\??/g, (_, code) =>  // unicode escapes
      String.fromCharCode(parseInt(code, 10))
    )
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => // hex char escapes
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\[a-z*]+\d*\b\*?/g, '')     // remaining control words
    .replace(/[{}\\]/g, '')                 // remaining braces and backslashes
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['BinderItem', 'Label', 'Status'].includes(name),
};

export class ScrivenerProject {
  constructor(scrivPath) {
    this.scrivPath = scrivPath;
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
    const parser = new XMLParser(PARSER_OPTIONS);
    this._doc = parser.parse(xml);
  }

  _save() {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      indentBy: '   ',
      suppressEmptyNode: false,
    });
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build(this._doc);
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
    const children = item.Children?.BinderItem ?? [];
    for (const child of children) {
      results.push(...this._flattenItem(child, depth + 1));
    }
    return results;
  }

  flattenBinder() {
    const flat = [];
    for (const item of this._getBinderItems()) {
      flat.push(...this._flattenItem(item, 0));
    }
    return flat;
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
      const children = item.Children?.BinderItem ?? [];
      if (children.length) {
        const found = this._findItemInTree(children, uuid);
        if (found) return found;
      }
    }
    return null;
  }

  findItem(uuid) {
    return this._findItemInTree(this._getBinderItems(), uuid);
  }

  readContent(uuid) {
    const rtfPath = join(this.scrivPath, 'Files', 'Data', uuid, 'content.rtf');
    try {
      const rtf = readFileSync(rtfPath, 'utf8');
      return stripRtf(rtf);
    } catch {
      return '';
    }
  }

  writeContent(uuid, plainText) {
    const dir = join(this.scrivPath, 'Files', 'Data', uuid);
    const rtfPath = join(dir, 'content.rtf');

    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const escaped = plainText
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/[^\x00-\x7F]/g, (ch) => `\\uc1\\u${ch.charCodeAt(0)}?`)
      .replace(/\r?\n/g, '\\par\n');

    const rtf = [
      '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761',
      '{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}',
      '{\\colortbl;\\red255\\green255\\blue255;}',
      '\\paperw11900\\paperh16840\\margl1440\\margr1440\\vieww11520\\viewh8400\\viewkind0',
      '\\pard\\tx566\\tx1133\\tx1700\\tx2267\\tx2834\\tx3401\\tx3968\\tx4535\\tx5102\\tx5669\\tx6236\\tx6803\\pardirnatural\\partightenfactor0',
      '\\f0\\fs24 \\cf0 ' + escaped,
      '}',
    ].join('\n');

    writeFileSync(rtfPath, rtf, 'utf8');
  }

  updateMetadata(uuid, changes) {
    const item = this.findItem(uuid);
    if (!item) throw new Error(`Item not found: ${uuid}`);

    if (!item.MetaData) item.MetaData = {};

    if ('title' in changes) item.Title = changes.title;
    if ('synopsis' in changes) item.Synopsis = changes.synopsis;
    if ('labelId' in changes) item.MetaData.LabelID = String(changes.labelId);
    if ('statusId' in changes) item.MetaData.StatusID = String(changes.statusId);
    if ('includeInCompile' in changes) {
      item.MetaData.IncludeInCompile = changes.includeInCompile ? 'Yes' : 'No';
    }

    this._save();
  }
}
