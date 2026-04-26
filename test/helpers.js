import { mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ScrivenerProject } from '../src/scrivener.js';
import { TEST_PROJECT } from './fixtures.js';

// Stable output directory — gitignored, persists across runs so the projects
// can be opened in Scrivener after the test suite finishes.
export const SCRATCH_DIR = join(dirname(fileURLToPath(import.meta.url)), 'scratch');

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
