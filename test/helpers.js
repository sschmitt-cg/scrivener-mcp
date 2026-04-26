import { mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ScrivenerProject } from '../src/scrivener.js';
import { TEST_PROJECT } from './fixtures.js';

// If SCRIV_DIR is configured (the same env var the MCP server uses), put test
// projects there under a /test subfolder so Scrivener can find them alongside
// real projects. Falls back to test/scratch/ when SCRIV_DIR is not set.
export const SCRATCH_DIR = process.env.SCRIV_DIR
  ? join(process.env.SCRIV_DIR, 'test')
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
