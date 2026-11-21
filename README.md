# Ariadeck

**Ariadeck** is a spatial and temporal organization tool for tasks, ideas, and story plots. Organize thoughts as cards on a modeless dependency graph (DAG), edit them seamlessly, and collaborate in real time with AI agents through a native Model Context Protocol (MCP) server.

## Architecture

Ariadeck is organized as a TypeScript `pnpm` monorepo:

- `packages/core` (`@ariadeck/core`): Platform-agnostic domain models, SQLite/in-memory `StorageAdapter` backends (`@ariadeck/core/sqlite`), `BoardGraphService` with DFS-based DAG cycle validation, atomic `splitCard` / `mergeCards` / `insertIntermediateCard` transformations, Kahn's topological sort (`computeTimelineLayout`) with longest-path layering and violation detection, single-file Markdown export (`exportBoardToMarkdown`), Google Drive sync (`GoogleDriveSyncAdapter` + 5-rule `BoardSyncEngine`), sync outbox logging, and `GraphEventBus`.
- `packages/mcp-server` (`@ariadeck/mcp-server`, CLI: `ariadeck-mcp`): Model Context Protocol server exposing read-only board resources, graph mutation/timeline/export tools, reusable AI workflow prompts, and a local REST + Server-Sent Events (SSE) bridge with optional Google Drive sync and conflict resolution endpoints.
- `apps/desktop` (`@ariadeck/desktop`): Modeless React + Vite + Tailwind CSS + `@xyflow/react` desktop graph canvas, interactive horizontal Timeline view, non-modal Board List sidebar with inline renaming, GFM Markdown rendering, one-click Markdown export (`ariadeck-{board_slug}.md`), Conflict Resolver modal, and live SSE synchronization.
- `apps/android` (`@ariadeck/android`): Mode-separated, touch-optimized Capacitor mobile UI (`ListModeView`, `CardEditorView` with camera/gallery photo capture and voice memo recording with searchable transcripts, touch-safe `RelationMapView` with Pan/Connect toggle, and vertical `MobileTimelineView`).

For detailed architecture and specifications, see the documents in `docs/`:

- [Overall Design](docs/DESIGN.md)
- [Shared Core & Schema Specification](docs/DESIGN_SPEC.md)
- [MCP Server Specification](docs/DESIGN_MCP.md)
- [Board JSON Import/Export Format Specification](docs/BOARD_JSON_FORMAT.md)
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

Start both the backend HTTP/SSE/MCP server (with automatic restart via `tsx watch`) and the Desktop Vite dev server concurrently with a single command:

```bash
pnpm dev
```

Or run them in separate terminals if you prefer:

```bash
pnpm dev:mcp      # Backend HTTP/SSE/MCP bridge on http://localhost:3456 (db: ./ariadeck.db)
pnpm dev:desktop  # Desktop web UI on http://localhost:5173 (proxies /api -> :3456)
```

In the Desktop UI:

- **Double-click** empty canvas space (or use the bottom quick toolbar) to create a new card.
- **Drag** cards freely to arrange them; positions persist automatically to SQLite.
- **Double-click** a card title for inline renaming, or **single-click** a card to open the non-modal right Inspector Panel.
- **Drag** from a card's right handle to another card's left handle to add a dependency edge. Cyclic dependencies are automatically rejected with a toast notification.
- Use **Split Card** in the Inspector Panel to decompose a card into sequential or parallel child cards while preserving edges.
- Switch to the **Timeline** tab in the header and click **Auto-Sort Timeline** to arrange cards horizontally by topological dependency depth. Drag cards across step columns (or use the arrow buttons) to adjust order manually; any dependency ordering violations are highlighted in real time.
- Click the **Ariadeck** logo in the top-left corner to open the main menu (**Boards**, **New Board**, **Export MD**, **Export JSON**, and **Import JSON**).
- Use **Export MD** to download a human-readable timeline-ordered Markdown document (`ariadeck-{board_slug}.md`), or **Export JSON** / **Import JSON** for lossless schema-validated backups and board templates (`ariadeck-{board_slug}.json`; see [BOARD_JSON_FORMAT.md](docs/BOARD_JSON_FORMAT.md)).
- Use the **Sync** / **Conflict** badge in the header to synchronize with Google Drive (`Ariadeck/`) and review or resolve any offline sync conflicts in the Conflict Resolver modal.

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
| `ARIADECK_ALLOW_REMOTE` | `false` | Set to `true` (or pass `--allow-remote`) to bind beyond `127.0.0.1` for LAN/remote access. |
| `ARIADECK_HOST` | `0.0.0.0` (with `--allow-remote`) | Bind address when remote access is explicitly enabled (otherwise locked to `127.0.0.1`). |
| `ARIADECK_AUTH_TOKEN` | _(auto-generated in remote mode)_ | Access token required for browser login (`HttpOnly` session cookie) and HTTP `/mcp` Bearer authentication. |
| `ARIADECK_CORS_ORIGINS` | _(loopback only)_ | Comma-separated extra allowed browser origins when accessing remotely (e.g. `http://192.168.1.10:5173`). |
| `ARIADECK_GDRIVE_ACCESS_TOKEN` | _(unset)_ | Optional Google Drive OAuth bearer token enabling remote sync under `Ariadeck/`. |

#### Security & Remote Access

By default, `@ariadeck/mcp-server --http` binds strictly to `127.0.0.1` so other devices on the network cannot reach your local database. To enable remote/LAN access safely:

```bash
ARIADECK_AUTH_TOKEN="your-strong-passphrase" \
ARIADECK_CORS_ORIGINS="http://<host-ip>:5173" \
pnpm --filter @ariadeck/mcp-server exec tsx src/cli.ts --http --allow-remote
```

- If `ARIADECK_AUTH_TOKEN` is omitted with `--allow-remote`, the server automatically generates and prints a 256-bit random access token on startup so remote mode never runs unauthenticated.
- Browsers sign in once via the **Unlock Workspace** screen (which issues an `HttpOnly; SameSite=Strict` session cookie for both REST and SSE).
- External HTTP MCP clients authenticate via `Authorization: Bearer <token>`.

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
  - `create_board`, `update_board`
  - `create_card`, `update_card`, `delete_card`
  - `connect_cards`, `disconnect_cards`
  - `split_card`, `merge_cards`, `insert_intermediate_card`
  - `compute_timeline_layout`, `export_board_markdown`, `export_board_json`, `import_board_json`
- **Prompts**:
  - `analyze_and_split_complex_cards`
  - `find_and_merge_duplicates`
  - `check_plot_or_task_gaps`

### 3. Cross-LLM Agent Skill (`.agents/skills/ariadeck-mcp`)

Ariadeck includes a portable Agent Skill at [`.agents/skills/ariadeck-mcp/SKILL.md`](.agents/skills/ariadeck-mcp/SKILL.md) that teaches LLM agents how to inspect boards, preserve DAG invariants, apply atomic splits/merges, fill dependency gaps, and sort timelines via `ariadeck-mcp`.

- **Antigravity, Gemini CLI, and OpenAI Codex CLI**: Automatically discover `.agents/skills/ariadeck-mcp/`.
- **Claude Code / Cursor**: Copy or symlink `.agents/skills/ariadeck-mcp` into `.claude/skills/ariadeck-mcp` (or `.cursor/skills/ariadeck-mcp`).
- See [Client Setup Guide](.agents/skills/ariadeck-mcp/references/client-setup.md) for client-specific MCP configuration snippets.

### 4. Run the Android Mobile UI (`@ariadeck/android`)

Preview the touch-optimized mobile UI in your browser:

```bash
pnpm dev:android
```

Build and sync with Capacitor for native Android Studio builds (customize `appId` in `apps/android/capacitor.config.ts` before publishing):

```bash
pnpm --filter @ariadeck/android build
pnpm --filter @ariadeck/android cap:sync
pnpm --filter @ariadeck/android cap:open
```

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
pnpm --filter @ariadeck/android test
```

## License

Ariadeck is licensed under the [Apache License, Version 2.0](LICENSE).
