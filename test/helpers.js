import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { ScrivenerProject } from '../src/scrivener.js';
import { TEST_PROJECT } from './fixtures.js';

// Resolve SCRIV_DIR from (in priority order):
//   1. SCRIV_DIR environment variable set in the shell
//   2. The Claude Desktop config file — the same source Claude uses when
//      launching the MCP server, so `npm test` and Claude see the same path
//      without any manual duplication.
function resolveScrivDir() {
  if (process.env.SCRIV_DIR) return process.env.SCRIV_DIR;

  const claudeConfigs = [
    join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    join(process.env.APPDATA ?? '', 'Claude', 'claude_desktop_config.json'),
  ];

  for (const configPath of claudeConfigs) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      for (const server of Object.values(config.mcpServers ?? {})) {
        if (server.env?.SCRIV_DIR) return server.env.SCRIV_DIR;
      }
    } catch {
      // config not present or unreadable — try next
    }
  }

  return null;
}

const scrivDir = resolveScrivDir();

// Put test projects in $SCRIV_DIR/test/ when a Scrivener directory is
// configured, so they appear alongside real projects in Scrivener's browser.
// Falls back to test/scratch/ (gitignored) when no config is found.
export const SCRATCH_DIR = scrivDir
  ? join(scrivDir, 'test')
  : join(dirname(fileURLToPath(import.meta.url)), 'scratch');

// Creates (or recreates) a test project at SCRATCH_DIR/<name>.scriv.
// Deletes any pre-existing project with the same name so `create()` never
// throws "project already exists".
export function createTestProject(nameOverride) {
  mkdirSync(SCRATCH_DIR, { recursive: true });
  const name = nameOverride ?? TEST_PROJECT.name;
  const scrivPath = join(SCRATCH_DIR, `${name}.scriv`);
  if (existsSync(scrivPath)) rmSync(scrivPath, { recursive: true, force: true });

  return ScrivenerProject.create(SCRATCH_DIR, name, {
    labels:     TEST_PROJECT.labels,
    statuses:   TEST_PROJECT.statuses,
    manuscript: TEST_PROJECT.manuscript,
    research:   TEST_PROJECT.research,
  });
}

// Returns a map of { title → uuid } for every item in the binder.
// All titles in the test fixture are unique, so there are no collisions.
export function buildTitleMap(project) {
  return Object.fromEntries(project.flattenBinder().map((i) => [i.title, i.uuid]));
}

// Depth-first search of an outline tree for a node matching title.
export function findOutlineNode(nodes, title) {
  for (const node of nodes) {
    if (node.title === title) return node;
    if (node.children) {
      const found = findOutlineNode(node.children, title);
      if (found) return found;
    }
  }
  return null;
}
