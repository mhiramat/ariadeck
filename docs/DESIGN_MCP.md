# Ariadeck MCP (Model Context Protocol) Server Specification (DESIGN_MCP.md)

This document specifies the Model Context Protocol (MCP) server (`packages/mcp-server` / `@ariadeck/mcp-server`, CLI binary: `ariadeck-mcp`) that enables AI agents (such as Antigravity, Claude Desktop, and other MCP clients) to inspect **Ariadeck** boards and perform structured graph transformations.

## 1. Server Overview & Transport Modes

`@ariadeck/mcp-server` directly imports `BoardGraphService` from `@ariadeck/core` to operate on the shared local database (`ariadeck.db`).

* **Package Name**: `@ariadeck/mcp-server`
* **CLI Executable (`bin`)**: `ariadeck-mcp`
* **MCP Server Metadata**:
  * `name`: `"ariadeck-mcp"`
  * `version`: `"0.1.0"`
* **Environment Variables**:
  * `ARIADECK_DB_PATH`: Path to the SQLite database file (default: `./ariadeck.db`)
  * `ARIADECK_PORT`: Port for the local HTTP / SSE bridge server (default: `3456`)
* **Supported Transports**:
  * **Stdio Transport**: Standard child-process transport for local AI assistants and CLI MCP clients.
  * **Streamable HTTP / SSE Transport**: Allows `@ariadeck/desktop` and external MCP clients to share the same `ariadeck.db` instance concurrently and push real-time updates to the UI.
* **Real-Time UI Synchronization**:
  * Whenever an MCP tool mutates graph state (either in-process over `/mcp` or from a separate stdio MCP worker writing to the same SQLite database), `@ariadeck/mcp-server --http` broadcasts a coalesced `GraphEvent` over Server-Sent Events (`/api/events`), causing `@ariadeck/desktop` to update immediately without a page reload. Cross-process SQLite commits are detected cheaply via `PRAGMA data_version` and replayed from `sync_outbox` while SSE clients are connected.

### Client Configuration Example (Antigravity / Claude Desktop)

```json
{
  "mcpServers": {
    "ariadeck": {
      "command": "npx",
      "args": ["-y", "@ariadeck/mcp-server"],
      "env": {
        "ARIADECK_DB_PATH": "/path/to/ariadeck.db"
      }
    }
  }
}
```

*(During local monorepo development, use `"command": "pnpm"` and `"args": ["--filter", "@ariadeck/mcp-server", "start"]`.)*

---

## 2. MCP Resources (Read-Only Context)

Read-only resources allowing AI agents to inspect Ariadeck boards, dependency graphs, and attachment transcripts/captions.

| URI Template | MIME Type | Description |
| :--- | :--- | :--- |
| `ariadeck://board/list` | `application/json` | Returns a JSON list of all active Ariadeck boards (`id`, `title`, `description`, `updatedAt`). |
| `ariadeck://board/{board_id}/graph` | `application/json` | Returns the full structured JSON graph of the specified Ariadeck board, including active cards, directed edges, conflict flags, and attachment `transcript` / caption strings. |
| `ariadeck://board/{board_id}/summary` | `text/markdown` | Returns a concise, token-efficient Markdown overview of the board's dependency chains, orphan cards, and unresolved conflicts. |

---

## 3. MCP Tools (Graph Mutations & AI Assistance)

All MCP tool descriptions explicitly reference "Ariadeck board" so AI agents can distinguish Ariadeck tools when multiple MCP servers are active. Every mutation records `updatedByDeviceId = "ariadeck-mcp-server"`.

### 3.1 Basic CRUD & Edge Tools

#### `create_card`
Create a new card on an Ariadeck board.
* **Input Schema**:
  * `boardId` (string, required)
  * `title` (string, required)
  * `content` (string, optional): Markdown content
  * `cardType` (`'task' | 'idea' | 'plot_event' | 'note'`, optional, default: `'idea'`)
  * `tags` (string[], optional)
* **Output**: The newly created `Card` object.

#### `update_card`
Update the title, Markdown content, status, or tags of an existing card on an Ariadeck board.
* **Input Schema**:
  * `cardId` (string, required)
  * `title` (string, optional)
  * `content` (string, optional)
  * `status` (`'todo' | 'in_progress' | 'done' | 'archived'`, optional)
  * `tags` (string[], optional)

#### `delete_card`
Soft-delete a card on an Ariadeck board (`deletedAt` timestamp) and cascade soft-deletion to its incident edges.
* **Input Schema**:
  * `cardId` (string, required)

#### `connect_cards`
Create a directed dependency edge (`sourceCardId -> targetCardId`) between two cards on an Ariadeck board. Returns a descriptive error if the connection would introduce a cycle.
* **Input Schema**:
  * `boardId` (string, required)
  * `sourceCardId` (string, required): Prerequisite or cause card ID
  * `targetCardId` (string, required): Dependent or effect card ID
  * `relationType` (`'blocks' | 'causes' | 'relates_to'`, optional, default: `'blocks'`)

#### `disconnect_cards`
Soft-delete a dependency edge on an Ariadeck board.
* **Input Schema**:
  * `edgeId` (string, required)

### 3.2 High-Level Structural Transformation Tools

#### `split_card`
Split an overly broad task, complex idea, or multi-beat story card on an Ariadeck board into multiple granular child cards while preserving upstream and downstream dependencies and recording lineage metadata (`splitFromCardId` / `replacedByCardIds`).
* **Input Schema**:
  * `targetCardId` (string, required): ID of the card to split
  * `subCards` (array, required, minItems: 2): Ordered array of child cards
    * `title` (string, required)
    * `content` (string, required)
    * `cardType` (`'task' | 'idea' | 'plot_event' | 'note'`, optional)
  * `linkMode` (`'sequential' | 'parallel'`, optional, default: `'sequential'`):
    * `'sequential'`: Links child cards in a linear chain (`sub[0] -> sub[1] -> ...`).
    * `'parallel'`: Leaves child cards unconnected to represent parallel tracks.
* **Output**: Created child card IDs and re-wired edge summary.

#### `merge_cards`
Merge two or more duplicate or closely related cards on an Ariadeck board into a single consolidated card, re-routing all external incoming and outgoing edges and recording lineage metadata (`mergedFromCardIds` / `replacedByCardIds`).
* **Input Schema**:
  * `targetCardIds` (string[], required, minItems: 2): IDs of the cards to merge
  * `mergedTitle` (string, required): Title for the consolidated card
  * `mergedContent` (string, required): Consolidated Markdown body
  * `cardType` (`'task' | 'idea' | 'plot_event' | 'note'`, optional)
* **Output**: The newly created consolidated `Card` object.

#### `insert_intermediate_card`
Insert a missing prerequisite step or intermediate event (`A -> C -> B`) between two already-connected cards (`A -> B`) on an Ariadeck board.
* **Input Schema**:
  * `sourceCardId` (string, required): Upstream card ID (`A`)
  * `targetCardId` (string, required): Downstream card ID (`B`)
  * `title` (string, required): Title of the intermediate card (`C`)
  * `content` (string, optional): Markdown content of the intermediate card

---

## 4. MCP Prompts (Reusable AI Workflows)

Pre-configured prompt templates enabling one-click graph refactoring workflows in MCP clients:

* **`analyze_and_split_complex_cards(board_id)`**
  * Reads `ariadeck://board/{board_id}/graph`, identifies oversized tasks or multi-scene plot cards, and decomposes them into actionable steps using `split_card`.
* **`find_and_merge_duplicates(board_id)`**
  * Scans the Ariadeck board for semantically overlapping tasks or redundant idea cards, proposes consolidations, and executes `merge_cards`.
* **`check_plot_or_task_gaps(board_id)`**
  * Traverses `ariadeck://board/{board_id}/graph` from root prerequisites to terminal outcomes to spot missing prerequisites or plot holes, inserting bridging cards via `insert_intermediate_card`.