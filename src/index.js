import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ScrivenerProject } from './scrivener.js';

const scrivPath = process.env.SCRIV_PATH;
if (!scrivPath) {
  console.error('Error: SCRIV_PATH environment variable is required');
  process.exit(1);
}

const project = new ScrivenerProject(scrivPath);

const server = new Server(
  { name: 'scrivener-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: 'list_documents',
    description: 'Returns the flattened binder with label and status names resolved.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
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
    description: 'Writes new plain text content to a document. WARNING: Scrivener must be closed before calling this — if the project is open, Scrivener will overwrite these changes on its next auto-save.',
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
    description: 'Updates title, synopsis, label, status, or includeInCompile for a document. WARNING: Scrivener must be closed before calling this — if the project is open, Scrivener will overwrite these changes on its next auto-save.',
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
    description: 'Searches title and synopsis across all binder items.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query string.' },
      },
      required: ['query'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_documents': {
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
        const { uuid } = args;
        const item = project.findItem(uuid);
        if (!item) throw new Error(`Document not found: ${uuid}`);

        const labels = project.getLabels();
        const statuses = project.getStatuses();
        const flat = project.flattenBinder().find((i) => i.uuid === uuid) ?? {};
        const content = project.readContent(uuid);

        const result = {
          ...flat,
          label: labels[flat.labelId] ?? flat.labelId,
          status: statuses[flat.statusId] ?? flat.statusId,
          content,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'write_document': {
        const { uuid, content } = args;
        project.writeContent(uuid, content);
        return { content: [{ type: 'text', text: `Content written for ${uuid}.\n\nReminder: if Scrivener has this project open, it will overwrite this change on its next auto-save. Close Scrivener before writing.` }] };
      }

      case 'update_metadata': {
        const { uuid, changes } = args;
        project.updateMetadata(uuid, changes);
        return { content: [{ type: 'text', text: `Metadata updated for ${uuid}.\n\nReminder: if Scrivener has this project open, it will overwrite this change on its next auto-save. Close Scrivener before updating metadata.` }] };
      }

      case 'search_documents': {
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
