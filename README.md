# Ariadeck

**Ariadeck** is a spatial and temporal organization tool for tasks, ideas, and story plots. Organize thoughts as cards on a modeless dependency graph (DAG), edit them seamlessly, and collaborate in real time with AI agents through a native Model Context Protocol (MCP) server.

## Architecture

Ariadeck is organized as a TypeScript `pnpm` monorepo:

- `packages/core` (`@ariadeck/core`): Platform-agnostic domain models, SQLite/in-memory `StorageAdapter` backends (`@ariadeck/core/sqlite`), `BoardGraphService` with DFS-based DAG cycle validation, atomic `splitCard` / `mergeCards` / `insertIntermediateCard` transformations, Kahn's topological sort (`computeTimelineLayout`) with longest-path layering and violation detection, sync outbox logging, and `GraphEventBus`.
- `packages/mcp-server` (`@ariadeck/mcp-server`, CLI: `ariadeck-mcp`): Model Context Protocol server exposing read-only board resources, graph mutation and timeline sorting tools, reusable AI workflow prompts, and a local REST + Server-Sent Events (SSE) bridge.
- `apps/desktop` (`@ariadeck/desktop`): Modeless React + Vite + Tailwind CSS + `@xyflow/react` desktop graph canvas and interactive horizontal Timeline view with GFM Markdown rendering, inline card editing, drag-to-connect dependency wiring, a non-modal inspector panel, and live SSE synchronization.

For detailed architecture and specifications, see the documents in `docs/`:

- [Overall Design](docs/DESIGN.md)
- [Shared Core & Schema Specification](docs/DESIGN_SPEC.md)
- [MCP Server Specification](docs/DESIGN_MCP.md)
- [Phase 1 Implementation Guide](docs/IMPLEMENTATION_GUIDE_PHASE1.md)

## Prerequisites

- **Node.js** `>= 20.0.0`
- **pnpm** `9.x` (managed automatically via `corepack enable`)

## Installation

Clone the repository and install workspace dependencies:

```bash
git clone <repository-url>
cd ariadeck
corepack enable
pnpm install
pnpm build
```

## Usage

### 1. Run the Backend & Desktop UI Locally

Start the local HTTP/SSE bridge and MCP server in one terminal (defaults to `./ariadeck.db` on port `3456`):

```bash
pnpm dev:mcp
```

Start the Desktop web UI in a second terminal (opens on `http://localhost:5173` and proxies `/api` to `http://localhost:3456`):

```bash
pnpm dev:desktop
```

In the Desktop UI:

- **Double-click** empty canvas space (or use the bottom quick toolbar) to create a new card.
- **Drag** cards freely to arrange them; positions persist automatically to SQLite.
- **Double-click** a card title for inline renaming, or **single-click** a card to open the non-modal right Inspector Panel.
- **Drag** from a card's right handle to another card's left handle to add a dependency edge. Cyclic dependencies are automatically rejected with a toast notification.
- Use **Split Card** in the Inspector Panel to decompose a card into sequential or parallel child cards while preserving edges.
- Switch to the **Timeline** tab in the header and click **Auto-Sort Timeline** to arrange cards horizontally by topological dependency depth. Drag cards across step columns (or use the arrow buttons) to adjust order manually; any dependency ordering violations are highlighted in real time.

### 2. Run the MCP Server (`ariadeck-mcp`)

The `ariadeck-mcp` CLI supports two transport modes:

- **Stdio Transport (default)** — for local MCP clients:
  ```bash
  pnpm --filter @ariadeck/mcp-server start
  ```
- **HTTP / SSE + Streamable HTTP MCP Transport** — for sharing `ariadeck.db` concurrently with `@ariadeck/desktop`:
  ```bash
  pnpm --filter @ariadeck/mcp-server dev
  ```
  This exposes:
  - REST API under `http://localhost:3456/api/*`
  - Real-time SSE stream at `http://localhost:3456/api/events`
  - Streamable HTTP MCP endpoint at `http://localhost:3456/mcp`

#### Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `ARIADECK_DB_PATH` | `./ariadeck.db` | Relative or custom path to the local SQLite database file. |
| `ARIADECK_PORT` | `3456` | Port for the HTTP / SSE / Streamable HTTP MCP server. |
| `ARIADECK_HTTP` | `false` | Set to `true` to start in HTTP mode without passing `--http`. |

#### Example MCP Client Configuration

Configure an MCP-compatible AI client (such as Antigravity or Claude Desktop) from the repository root:

```json
{
  "mcpServers": {
    "ariadeck": {
      "command": "pnpm",
      "args": ["--filter", "@ariadeck/mcp-server", "start"],
      "env": {
        "ARIADECK_DB_PATH": "./ariadeck.db"
      }
    }
  }
}
```

#### Exposed MCP Capabilities

- **Resources**:
  - `ariadeck://board/list`
  - `ariadeck://board/{board_id}/graph`
  - `ariadeck://board/{board_id}/summary`
- **Tools**:
  - `create_card`, `update_card`, `delete_card`
  - `connect_cards`, `disconnect_cards`
  - `split_card`, `merge_cards`, `insert_intermediate_card`
  - `compute_timeline_layout`
- **Prompts**:
  - `analyze_and_split_complex_cards`
  - `find_and_merge_duplicates`
  - `check_plot_or_task_gaps`

### 3. Cross-LLM Agent Skill (`.agents/skills/ariadeck-mcp`)

Ariadeck includes a portable Agent Skill at [`.agents/skills/ariadeck-mcp/SKILL.md`](.agents/skills/ariadeck-mcp/SKILL.md) that teaches LLM agents how to inspect boards, preserve DAG invariants, apply atomic splits/merges, fill dependency gaps, and sort timelines via `ariadeck-mcp`.

- **Antigravity, Gemini CLI, and OpenAI Codex CLI**: Automatically discover `.agents/skills/ariadeck-mcp/`.
- **Claude Code / Cursor**: Copy or symlink `.agents/skills/ariadeck-mcp` into `.claude/skills/ariadeck-mcp` (or `.cursor/skills/ariadeck-mcp`).
- See [Client Setup Guide](.agents/skills/ariadeck-mcp/references/client-setup.md) for client-specific MCP configuration snippets.

## Development & Testing

Run typechecking, production builds, and the full Vitest test suite across all workspace packages:

```bash
pnpm typecheck
pnpm build
pnpm test
```

Run tests for an individual package:

```bash
pnpm --filter @ariadeck/core test
pnpm --filter @ariadeck/mcp-server test
pnpm --filter @ariadeck/desktop test
```
