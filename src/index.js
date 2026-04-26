import { readdirSync } from 'fs';
import { join } from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ScrivenerProject } from './scrivener.js';

const SCRIV_DIR = process.env.SCRIV_DIR ?? null;
const SCRIV_PATH = process.env.SCRIV_PATH ?? null;
const SCRIV_PLATFORM = (['mac', 'windows'].includes(process.env.SCRIV_PLATFORM))
  ? process.env.SCRIV_PLATFORM
  : 'mac';

if (!SCRIV_DIR && !SCRIV_PATH) {
  console.error('Error: SCRIV_DIR or SCRIV_PATH environment variable is required');
  process.exit(1);
}

let currentProject = SCRIV_PATH ? new ScrivenerProject(SCRIV_PATH, { platform: SCRIV_PLATFORM }) : null;

function requireProject() {
  if (!currentProject) {
    throw new Error("No project open. Call list_projects to see what's available, then open_project.");
  }
  return currentProject;
}

function requireDir() {
  if (!SCRIV_DIR) {
    throw new Error('SCRIV_DIR is not configured. Set SCRIV_DIR to enable multi-project support.');
  }
  return SCRIV_DIR;
}

// ── Binder item schema (used inline in create_project) ───────────────────────

const BINDER_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    type: {
      type: 'string',
      enum: ['Text', 'Folder'],
      description: 'Folder for containers (acts, parts, chapters); Text for documents (scenes, notes).',
    },
    synopsis: {
      type: 'string',
      description: "Index card text shown in Scrivener's corkboard view. Write a 1–3 sentence summary of what happens or what this item covers.",
    },
    content: {
      type: 'string',
      description: 'Initial plain-text body. Only used for Text items.',
    },
    label: {
      type: 'string',
      description: 'Label name — must match one of the labels defined for this project.',
    },
    status: {
      type: 'string',
      description: 'Status name — must match one of the statuses defined for this project.',
    },
    includeInCompile: {
      type: 'boolean',
      description: 'Whether to include in compile output. Defaults to true.',
    },
    children: {
      type: 'array',
      description: 'Nested binder items — scenes inside a chapter, chapters inside a part, etc.',
      items: { type: 'object', description: 'Same structure as a binder item (recursive).' },
    },
  },
  required: ['title'],
};

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_projects',
    description: 'Lists all Scrivener projects (.scriv packages) in the configured projects directory.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'open_project',
    description: 'Opens a Scrivener project by name, making it the active project for all other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name (with or without .scriv extension).' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_project',
    description: `Creates a new Scrivener project with full binder structure, labels, statuses, and optional initial content. The new project becomes the active project.

Use this to scaffold a writing project from an idea: define the manuscript structure as a hierarchy of Folders (acts/parts/chapters) and Text items (scenes/documents), populate synopsis on every item (this is the virtual index card shown in Scrivener's corkboard), and optionally seed initial content. Define labels for categorisation (e.g. POV character, scene type, story thread) and statuses for workflow tracking.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Project name. Used as the .scriv package name.',
        },
        labels: {
          type: 'array',
          description: 'Label definitions for categorising documents (e.g. POV character, scene type, story thread). Each entry is a string name or {name, color} where color is one of: red, orange, yellow, green, blue, purple, pink, cyan.',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  color: {
                    type: 'string',
                    enum: ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'cyan'],
                  },
                },
                required: ['name'],
              },
            ],
          },
        },
        statuses: {
          type: 'array',
          description: 'Status names for tracking document progress. Defaults to: To Do, In Progress, First Draft, Revised Draft, Done.',
          items: { type: 'string' },
        },
        manuscript: {
          type: 'array',
          description: 'Top-level items in the Draft (Manuscript) folder. Structure these as the creative work itself — acts or parts containing chapters containing scenes.',
          items: BINDER_ITEM_SCHEMA,
        },
        research: {
          type: 'array',
          description: 'Items in the Research folder. Use for world-building notes, character sheets, outlines, reference material.',
          items: BINDER_ITEM_SCHEMA,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_documents',
    description: 'Returns the flattened binder of the active project with label and status names resolved.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_document',
    description: 'Returns metadata and plain text content for one document.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'The UUID of the document.' },
      },
      required: ['uuid'],
    },
  },
  {
    name: 'write_document',
    description: 'Writes new plain text content to an existing document. The UUID must already be in the binder (use add_document to create a new document). The call will fail with a clear error if Scrivener has the project open — close Scrivener first.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'The UUID of the document.' },
        content: { type: 'string', description: 'The plain text content to write.' },
      },
      required: ['uuid', 'content'],
    },
  },
  {
    name: 'update_metadata',
    description: 'Updates title, synopsis, label, status, or includeInCompile for a document. Will fail with a clear error if Scrivener has the project open — close Scrivener first.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'The UUID of the document.' },
        changes: {
          type: 'object',
          description: 'Fields to update.',
          properties: {
            title: { type: 'string' },
            synopsis: { type: 'string' },
            labelId: { type: 'string' },
            statusId: { type: 'string' },
            includeInCompile: { type: 'boolean' },
          },
        },
      },
      required: ['uuid', 'changes'],
    },
  },
  {
    name: 'search_documents',
    description: 'Searches title and synopsis across all binder items in the active project.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query string.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_outline',
    description: `Returns the binder as a nested tree with synopses, labels, and statuses — the single best tool for understanding a project's structure before suggesting or making changes.

Each node corresponds to a Scrivener index card. The synopsis is what appears on the corkboard. Use this to see the story shape at a glance: which acts exist, how chapters are distributed, which scenes have synopses and which are blank, where structural gaps or imbalances are, and how labels and statuses are distributed.

Token-efficient context loading: pass includeContent=true to inline document text directly into the tree, collapsing what would otherwise be many separate get_document calls into one. To stay within reasonable context limits on large projects, scope to a subtree with rootUuid (e.g. one chapter or act) when you only need part of the manuscript.`,
    inputSchema: {
      type: 'object',
      properties: {
        rootUuid: {
          type: 'string',
          description: 'UUID of a binder item to use as the root of the returned tree. Omit to return the full binder.',
        },
        includeContent: {
          type: 'boolean',
          description: 'If true, include the full plain-text content of every Text item in the tree (Folders never have content). Useful for loading prose context in a single call. Defaults to false.',
        },
      },
    },
  },
  {
    name: 'get_documents',
    description: `Batch version of get_document. Returns metadata and plain text content for many documents in a single call.

Use this when you need the prose for several specific documents (e.g. the previous three scenes for continuity, or every Text item with a particular label). Cheaper than calling get_document repeatedly. Items not found are returned with an "error" field rather than throwing.`,
    inputSchema: {
      type: 'object',
      properties: {
        uuids: {
          type: 'array',
          description: 'UUIDs of documents to fetch. Order is preserved in the response.',
          items: { type: 'string' },
        },
      },
      required: ['uuids'],
    },
  },
  {
    name: 'add_document',
    description: `Adds a new document or folder to the binder of the active project. Will fail with a clear error if Scrivener has the project open — close Scrivener first.

Use this to extend the structure of an existing project: add a new scene to a chapter, a new chapter to an act, a new research note, or a whole new folder. Always populate synopsis — it is the index card text that makes the corkboard and outliner useful for structural reasoning.

If parentUuid is omitted, the item is appended to the top level of the Manuscript folder. Returns the new item's UUID.`,
    inputSchema: {
      type: 'object',
      properties: {
        parentUuid: {
          type: 'string',
          description: "UUID of the parent folder. Omit to append to the Manuscript folder's top level.",
        },
        title: { type: 'string' },
        type: {
          type: 'string',
          enum: ['Text', 'Folder'],
          description: 'Folder for containers (chapters, acts, parts); Text for documents (scenes, notes). Defaults to Text.',
        },
        synopsis: {
          type: 'string',
          description: "Index card text — shown in Scrivener's corkboard and outliner. Always populate this.",
        },
        content: { type: 'string', description: 'Initial plain-text body (Text items only).' },
        label: { type: 'string', description: 'Label name — must match a label defined in the project.' },
        status: { type: 'string', description: 'Status name — must match a status defined in the project.' },
        includeInCompile: { type: 'boolean', description: 'Whether to include in compile. Defaults to true.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'move_document',
    description: `Moves a binder item to a different parent folder. Will fail with a clear error if Scrivener has the project open — close Scrivener first.

Use this to restructure the project: move a scene from one chapter to another, promote a scene to chapter level, reorganise acts, or move a document into the Research folder. The item retains all its content and metadata; only its position in the hierarchy changes.

If newParentUuid is omitted, the item is moved to the top level of the Manuscript folder. Call get_outline first to understand the current structure before reorganising.`,
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'UUID of the item to move.' },
        newParentUuid: {
          type: 'string',
          description: 'UUID of the destination folder. Omit to move to the top level of the Manuscript folder.',
        },
      },
      required: ['uuid'],
    },
  },
];

// ── Server ────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'scrivener-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {

      // ── Project management ──────────────────────────────────────────────

      case 'list_projects': {
        const dir = requireDir();
        const entries = readdirSync(dir, { withFileTypes: true });
        const projects = entries
          .filter((e) => e.isDirectory() && e.name.endsWith('.scriv'))
          .map((e) => e.name.replace(/\.scriv$/, ''));
        return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
      }

      case 'open_project': {
        const dir = requireDir();
        const { name: projectName } = args;
        const packageName = projectName.endsWith('.scriv') ? projectName : `${projectName}.scriv`;
        currentProject = new ScrivenerProject(join(dir, packageName), { platform: SCRIV_PLATFORM });
        return { content: [{ type: 'text', text: `Opened project: ${projectName}` }] };
      }

      case 'create_project': {
        const dir = requireDir();
        const { name: projectName, labels, statuses, manuscript, research } = args;
        currentProject = ScrivenerProject.create(dir, projectName, {
          platform: SCRIV_PLATFORM,
          labels: labels ?? [],
          statuses,
          manuscript: manuscript ?? [],
          research: research ?? [],
        });
        return {
          content: [{
            type: 'text',
            text: `Created and opened project: ${projectName}\n\nCall list_documents to see the full binder structure.`,
          }],
        };
      }

      // ── Document tools ──────────────────────────────────────────────────

      case 'list_documents': {
        const project = requireProject();
        const labels = project.getLabels();
        const statuses = project.getStatuses();
        const items = project.flattenBinder().map((item) => ({
          ...item,
          label: labels[item.labelId] ?? item.labelId,
          status: statuses[item.statusId] ?? item.statusId,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
      }

      case 'get_document': {
        const project = requireProject();
        const { uuid } = args;
        const flat = project.flattenBinder().find((i) => i.uuid === uuid);
        if (!flat) throw new Error(`Document not found: ${uuid}`);
        const labels = project.getLabels();
        const statuses = project.getStatuses();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...flat,
              label: labels[flat.labelId] ?? flat.labelId,
              status: statuses[flat.statusId] ?? flat.statusId,
              content: project.readContent(uuid),
            }, null, 2),
          }],
        };
      }

      case 'write_document': {
        const project = requireProject();
        const { uuid, content } = args;
        project.writeContent(uuid, content);
        return {
          content: [{
            type: 'text',
            text: `Content written for ${uuid}.\n\nReminder: if Scrivener has this project open, it will overwrite this change on its next auto-save. Close Scrivener before writing.`,
          }],
        };
      }

      case 'update_metadata': {
        const project = requireProject();
        const { uuid, changes } = args;
        project.updateMetadata(uuid, changes);
        return {
          content: [{
            type: 'text',
            text: `Metadata updated for ${uuid}.\n\nReminder: if Scrivener has this project open, it will overwrite this change on its next auto-save. Close Scrivener before updating metadata.`,
          }],
        };
      }

      case 'search_documents': {
        const project = requireProject();
        const { query } = args;
        const lower = query.toLowerCase();
        const results = project
          .flattenBinder()
          .filter(
            (item) =>
              item.title.toLowerCase().includes(lower) ||
              item.synopsis.toLowerCase().includes(lower)
          );
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      case 'get_outline': {
        const project = requireProject();
        const { rootUuid, includeContent } = args ?? {};
        const outline = project.getOutline({ rootUuid, includeContent });
        return { content: [{ type: 'text', text: JSON.stringify(outline, null, 2) }] };
      }

      case 'get_documents': {
        const project = requireProject();
        const { uuids } = args;
        return { content: [{ type: 'text', text: JSON.stringify(project.getDocuments(uuids), null, 2) }] };
      }

      case 'add_document': {
        const project = requireProject();
        const { parentUuid, title, type, synopsis, content, label, status, includeInCompile } = args;
        const uuid = project.addItem(parentUuid ?? null, {
          title, type, synopsis, content, label, status, includeInCompile,
        });
        return {
          content: [{
            type: 'text',
            text: `Added "${title}" with UUID ${uuid}.\n\nReminder: if Scrivener has this project open, it will overwrite this change on its next auto-save. Close Scrivener before adding documents.`,
          }],
        };
      }

      case 'move_document': {
        const project = requireProject();
        const { uuid, newParentUuid } = args;
        project.moveItem(uuid, newParentUuid ?? null);
        return {
          content: [{
            type: 'text',
            text: `Moved ${uuid}.\n\nReminder: if Scrivener has this project open, it will overwrite this change on its next auto-save. Close Scrivener before moving documents.`,
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
