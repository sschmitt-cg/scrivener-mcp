# scrivener-mcp

A local MCP server that exposes your Scrivener projects to Claude (or any MCP-compatible client). Create new projects from scratch, navigate the binder, read and write document content, and update metadata — all without opening Scrivener.

---

## Requirements

- Node.js 18 or later
- Scrivener 3 on macOS (`.scriv` packages)

---

## Setup

```bash
cd scrivener-mcp
npm install
```

---

## Environment variables

| Variable | Description |
|---|---|
| `SCRIV_DIR` | Path to a directory containing `.scriv` packages. Enables `list_projects`, `open_project`, and `create_project`. |
| `SCRIV_PATH` | Path to a single `.scriv` package. Opens it immediately on startup. |
| `SCRIV_PLATFORM` | `mac` (default) or `windows`. Controls the RTF format used when writing document content. |

At least one of `SCRIV_DIR` or `SCRIV_PATH` must be set. Both can be set simultaneously.

---

## Running manually

```bash
# Multi-project mode (recommended)
SCRIV_DIR="/path/to/ScrivenerProjects" npm start

# Single-project mode
SCRIV_PATH="/path/to/MyProject.scriv" npm start
```

---

## Configuring Claude Desktop

Edit the Claude Desktop config file:
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

**Mac:**
```json
{
  "mcpServers": {
    "scrivener": {
      "command": "node",
      "args": ["/absolute/path/to/scrivener-mcp/src/index.js"],
      "env": {
        "SCRIV_DIR": "/Users/you/Writing/ScrivenerProjects"
      }
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "scrivener": {
      "command": "node",
      "args": ["C:\\path\\to\\scrivener-mcp\\src\\index.js"],
      "env": {
        "SCRIV_DIR": "C:\\Users\\you\\Documents\\ScrivenerProjects",
        "SCRIV_PLATFORM": "windows"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

---

## Available tools

### Project management

| Tool | Description |
|---|---|
| `list_projects` | Lists all `.scriv` packages in `SCRIV_DIR`. |
| `open_project(name)` | Opens a project by name, making it active for all document tools. |
| `create_project(name, ...)` | Creates a new project and opens it. See below. |

### Document tools (require an open project)

| Tool | Description |
|---|---|
| `get_outline(rootUuid?, includeContent?)` | Returns the binder as a nested tree with synopses, labels, and statuses. Pass `rootUuid` to scope to a subtree, and `includeContent: true` to inline prose directly into the tree (one call instead of many `get_document` calls). The best starting point for understanding and working on a project's structure. |
| `list_documents` | Returns the binder as a flat list with depth indicators. Useful for getting UUIDs. |
| `get_document(uuid)` | Returns metadata and plain text content for a single document. |
| `get_documents(uuids)` | Batch version of `get_document` — returns metadata and content for many documents in a single call. |
| `add_document(...)` | Adds a new document or folder to the binder. |
| `move_document(uuid, newParentUuid)` | Moves a binder item to a different parent folder. |
| `write_document(uuid, content)` | Writes new plain text content to a document (stored as RTF). |
| `update_metadata(uuid, changes)` | Updates title, synopsis, label, status, or compile inclusion. |
| `batch_update_metadata(updates)` | Batch version of `update_metadata` — applies many changes in a single `.scrivx` write. |
| `search_documents(query)` | Searches titles and synopses across the binder. |

---

## Creating a project

`create_project` accepts a full binder structure so Claude can scaffold an entire project from an idea in one call.

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `name` | string | Project name (becomes the `.scriv` package name). |
| `labels` | array | Label definitions. Each is a string or `{name, color}`. Colors: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `cyan`. |
| `statuses` | array | Status names. Defaults to: To Do, In Progress, First Draft, Revised Draft, Done. |
| `manuscript` | array | Binder items in the Draft (Manuscript) folder. |
| `research` | array | Binder items in the Research folder. |

### Binder item structure

```json
{
  "title": "Chapter 1",
  "type": "Folder",
  "synopsis": "Alice finds the letter and confronts Bob.",
  "content": "Optional initial body text (Text items only).",
  "label": "POV: Alice",
  "status": "To Do",
  "includeInCompile": true,
  "children": [...]
}
```

- **`type`**: `"Folder"` for containers (acts, parts, chapters); `"Text"` for documents (scenes, notes). Defaults to `"Text"`.
- **`synopsis`**: The virtual index card text — appears in Scrivener's corkboard and outliner views. Write a 1–3 sentence summary of what happens or what this item covers.
- **`label`** and **`status`** must match names defined in the project's `labels` and `statuses` arrays.

### Example

```json
{
  "name": "My Novel",
  "labels": [
    { "name": "POV: Alice", "color": "blue" },
    { "name": "POV: Bob", "color": "red" }
  ],
  "statuses": ["To Do", "First Draft", "Revised", "Done"],
  "manuscript": [
    {
      "title": "Act One",
      "type": "Folder",
      "synopsis": "Alice discovers the conspiracy.",
      "children": [
        {
          "title": "Chapter 1",
          "type": "Folder",
          "synopsis": "A normal Tuesday turns strange.",
          "children": [
            {
              "title": "The Letter",
              "type": "Text",
              "synopsis": "Alice finds an unsigned letter in her mailbox.",
              "label": "POV: Alice",
              "status": "To Do"
            }
          ]
        }
      ]
    }
  ],
  "research": [
    {
      "title": "Characters",
      "type": "Folder",
      "children": [
        {
          "title": "Alice",
          "type": "Text",
          "synopsis": "Protagonist. Mid-30s journalist, sceptical but curious."
        }
      ]
    }
  ]
}
```

---

## Collaborative workflow

The intended pattern is to work with Claude on the structure and content of a project together, using Scrivener's own organisational features:

1. **Start with `get_outline`** — Claude reads the full nested structure with synopses before suggesting or making any changes. This is how it understands the story shape.
2. **Build structure with `add_document`** — Add scenes, chapters, acts, or research notes at any point in the hierarchy. Always include a synopsis; it is what appears on the index card in Scrivener's corkboard.
3. **Reorganise with `move_document`** — Move items between parents to restructure the narrative without losing any content or metadata.
4. **Write prose with `write_document`** — Once structure is agreed, populate scenes with content.
5. **Track progress with `update_metadata`** — Update labels (e.g. POV, scene type) and statuses (e.g. First Draft, Revised) as work progresses.

## Notes

- **Close Scrivener before writing.** `write_document`, `update_metadata`, `add_document`, and `move_document` modify project files directly. The server detects an open Scrivener instance via the `Files/user.lock` file Scrivener creates and refuses to write while it exists, so concurrent edits won't silently corrupt the project. Close Scrivener and retry.
- **Mutations re-read state automatically.** Each mutating call reloads the `.scrivx` from disk before writing, so external edits made between MCP calls aren't overwritten.
- **`binder.autosave` is kept in sync.** Every binder write also refreshes `Files/binder.autosave` (the zipped snapshot Scrivener cross-references on launch). Without this, Scrivener can decide the on-disk binder is "newer than expected" and shunt MCP-added items into a "Recovered Files" folder.
- `write_document` generates minimal RTF compatible with Scrivener 3. Non-ASCII characters are Unicode-escaped.
- Label and status IDs are discoverable via `list_documents` — `labelId`/`statusId` are raw IDs, `label`/`status` are the resolved names.
