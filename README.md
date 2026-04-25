# scrivener-mcp

A local MCP server that exposes your Scrivener project to Claude (or any MCP-compatible client). It lets you list, read, write, and search documents directly inside a `.scriv` package without opening Scrivener.

---

## Requirements

- Node.js 18 or later
- A Scrivener 3 project (`.scriv` package on macOS)

---

## Setup

```bash
cd scrivener-mcp
npm install
```

---

## Running manually

```bash
SCRIV_PATH="/path/to/MyProject.scriv" npm start
```

---

## Configuring Claude Desktop

Add the following to your `claude_desktop_config.json` (usually at `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "scrivener": {
      "command": "node",
      "args": ["/absolute/path/to/scrivener-mcp/src/index.js"],
      "env": {
        "SCRIV_PATH": "/absolute/path/to/MyProject.scriv"
      }
    }
  }
}
```

Replace both paths with the actual absolute paths on your system. Restart Claude Desktop after saving.

---

## Available tools

| Tool | Description |
|---|---|
| `list_documents` | Returns the full flattened binder with label and status names resolved. |
| `get_document(uuid)` | Returns metadata and plain text content for a single document. |
| `write_document(uuid, content)` | Writes new plain text content to a document (stored as RTF). |
| `update_metadata(uuid, changes)` | Updates title, synopsis, label, status, or compile inclusion. |
| `search_documents(query)` | Full-text search across titles and synopses. |

---

## Notes

- **The server reads the `.scrivx` file on startup.** If you modify the project in Scrivener while the server is running, restart the server to pick up changes.
- `write_document` generates minimal RTF compatible with Scrivener 3 (cocoartf2761). Non-ASCII characters are Unicode-escaped.
- `update_metadata` saves changes back to the `.scrivx` file immediately. Make sure Scrivener is closed before calling it, as Scrivener will overwrite the file when it saves.
- Label and status IDs can be discovered via `list_documents` — the `labelId`/`statusId` fields contain the raw IDs and `label`/`status` contain the resolved names.
