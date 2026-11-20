# Ariadeck Phase 1 Implementation Guide (IMPLEMENTATION_GUIDE_PHASE1.md)

This document provides step-by-step instructions for the coding agent (**Antigravity**) to implement **Ariadeck Phase 1**: the TypeScript monorepo foundation, `@ariadeck/core`, `@ariadeck/mcp-server` (`ariadeck-mcp`), and the `@ariadeck/desktop` modeless graph UI, strictly adhering to `DESIGN.md`, `DESIGN_SPEC.md`, and `DESIGN_MCP.md`.

---

## 0. Mandatory Engineering & Repository Rules

1. **Strict Specification Compliance**:
   * All TypeScript interfaces, SQLite DDL, and graph algorithms must match `DESIGN_SPEC.md`.
   * All MCP tool names, schemas, and resource URIs (`ariadeck://board/{board_id}/graph`, etc.) must match `DESIGN_MCP.md`.
   * UI component boundaries and naming must match `DESIGN.md`.
   * Package names (`@ariadeck/*`), CLI name (`ariadeck-mcp`), DB filename (`ariadeck.db`), and environment variable prefix (`ARIADECK_`) must remain consistent across the entire codebase.
2. **English-Only Codebase & Git Conventions**:
   * All source code comments, JSDoc blocks, error messages, test descriptions, and MCP tool/resource descriptions must be written in clear, idiomatic **English**.
   * All Git commit messages must be written in **English** following the **Conventional Commits** specification (e.g., `feat(core): implement splitCard and mergeCards with lineage tracking`, `feat(mcp): expose ariadeck://board/{board_id}/graph resource`).
3. **Zero UI/DOM Coupling in `@ariadeck/core`**:
   * `packages/core` (`@ariadeck/core`) must never import React or reference browser globals (`window`, `document`), ensuring full compatibility across Node.js, Desktop browsers, and Capacitor Android.
   * Always import core modules via `@ariadeck/core` rather than relative cross-package paths.
4. **Future-Proof Schema Initialization**:
   * Even though Phase 1 focuses on text cards and graph editing, create all tables and fields defined in `DESIGN_SPEC.md` upfront (`card_attachments`, `timeline_order`, `sync_outbox`, `conflicts`, `split_from_card_id`, `merged_from_card_ids_json`, `replaced_by_card_ids_json`, `deleted_at`, `version`, `updated_by_device_id`).
5. **Step-by-Step Verification**:
   * Verify `tsc --noEmit` and unit tests pass at the end of each step before proceeding to the next.

---

## Step 1: Initialize Monorepo & Workspace Packages

### Objective
Set up the `ariadeck/` pnpm workspace monorepo and establish internal dependencies across `@ariadeck/*` packages.

### Tasks
1. Create the following directory structure:
   ```text
   ariadeck/
   ├── package.json               # name: "ariadeck", private: true
   ├── pnpm-workspace.yaml        # packages: ["packages/*", "apps/*"]
   ├── tsconfig.base.json         # strict: true
   ├── docs/                      # DESIGN.md, DESIGN_SPEC.md, DESIGN_MCP.md, IMPLEMENTATION_GUIDE_PHASE1.md
   ├── packages/
   │   ├── core/                  # name: "@ariadeck/core"
   │   └── mcp-server/            # name: "@ariadeck/mcp-server", bin: { "ariadeck-mcp": "./dist/cli.js" }
   └── apps/
       └── desktop/               # name: "@ariadeck/desktop" (React + Vite + Tailwind CSS + @xyflow/react)
   ```
2. Add `"@ariadeck/core": "workspace:*"` to `dependencies` in both `packages/mcp-server/package.json` and `apps/desktop/package.json`.
3. Configure `tsconfig.base.json` with `strict: true` and ES2022/NodeNext module resolution.

### Acceptance Criteria
* `pnpm install` completes cleanly and `@ariadeck/core` exports resolve without errors in both `@ariadeck/mcp-server` and `@ariadeck/desktop`.

---

## Step 2: Implement `@ariadeck/core` Data Models & Storage Abstraction

### Objective
Implement the domain types, SQLite DDL (`ariadeck.db`), and pluggable storage adapters specified in `DESIGN_SPEC.md`.

### Tasks
1. **Domain Types (`packages/core/src/types/`)**:
   * Define `SyncMetadata`, `Board`, `Card`, `Edge`, `CardAttachment`, `BoardGraph`, `SyncOutboxEntry`, and `ConflictRecord`.
   * Include full sync metadata (`createdAt`, `updatedAt`, `updatedByDeviceId`, `version`, `deletedAt`) on all primary entities.
   * Include lineage properties (`splitFromCardId`, `mergedFromCardIds`, `replacedByCardIds`) on `Card` and conflict flags (`isConflicted`, `conflictReason`) on `Edge`.
2. **Storage Interface (`packages/core/src/storage/StorageAdapter.ts`)**:
   * Define an abstract persistence interface supporting transactional CRUD for boards, cards, edges, attachments, `sync_outbox`, and `conflicts`.
3. **SQLite & In-Memory Adapters**:
   * Implement `SqliteStorageAdapter` (using `better-sqlite3`, defaulting to `ariadeck.db`) with automatic idempotent schema migrations on initialization.
   * Implement `InMemoryStorageAdapter` for fast unit testing and browser-only previews.

### Acceptance Criteria
* Schema migrations run cleanly on startup and persist/soft-delete boards, cards, and edges in `ariadeck.db`.

---

## Step 3: Implement `BoardGraphService` (DAG Validation & Split/Merge) + Unit Tests

### Objective
Implement Ariadeck's core graph operations, cycle detection, `splitCard`, `mergeCards`, and `insertIntermediateCard`, backed by comprehensive unit tests.

### Tasks
1. **Event Bus (`GraphEventBus`)**:
   * Emit typed change events (e.g., `board:updated`) whenever cards or edges are created, updated, deleted, split, or merged.
2. **CRUD & Outbox Logging**:
   * Implement `getBoardGraph`, `createCard`, `updateCard`, and `deleteCard` (cascading soft-deletes to incident edges and attachments).
   * Increment `version` and record an entry in `sync_outbox` on every mutation.
3. **Edge Wiring & DAG Cycle Detection (`connectCards`)**:
   * Reject self-loops (`sourceId === targetId`) with `CyclicDependencyError`.
   * For `'blocks'` and `'causes'` relations, execute a Depth-First Search (DFS) from `targetId` to verify `sourceId` is unreachable; throw `CyclicDependencyError` if a cycle would form.
4. **High-Level Graph Transformations**:
   * **`splitCard`**:
     * Within a transaction, create child cards offset from the parent card's `(posX, posY)` with `splitFromCardId` set.
     * For `'sequential'` mode, chain child cards (`sub[0] -> sub[1] -> ...`), attach incoming edges to `sub[0]`, and attach outgoing edges to `sub[last]`.
     * For `'parallel'` mode, leave child cards disconnected from each other and duplicate incoming/outgoing edges across all child cards.
     * Record `replacedByCardIds` on the parent card and soft-delete it.
   * **`mergeCards`**:
     * Compute the centroid of target cards and create the consolidated card with `mergedFromCardIds` set.
     * Re-route all external incoming and outgoing edges to the merged card (deduplicating identical triples).
     * Soft-delete internal edges between merged cards, set `replacedByCardIds` on each source card, and soft-delete the source cards.
   * **`insertIntermediateCard`**:
     * Soft-delete the existing `sourceId -> targetId` edge and create `sourceId -> newCard -> targetId`.
5. **Unit Tests (Vitest)**:
   * Add tests executable via `pnpm --filter @ariadeck/core test` covering DAG cycle rejection, sequential/parallel `splitCard` lineage and edge re-routing, and `mergeCards` edge deduplication.

### Acceptance Criteria
* `pnpm --filter @ariadeck/core test` passes 100%.

---

## Step 4: Implement `@ariadeck/mcp-server` (`ariadeck-mcp`) & Local API Bridge

### Objective
Build the backend server exposing both the MCP protocol (`ariadeck-mcp`) and a lightweight REST + SSE bridge so AI agents and `@ariadeck/desktop` share `ariadeck.db` in real time.

### Tasks
1. **Server & Transport Setup (Hono/Express + `@modelcontextprotocol/sdk`)**:
   * Read `ARIADECK_DB_PATH` (default: `./ariadeck.db`) and `ARIADECK_PORT` (default: `3456`).
   * Expose REST endpoints (`/api/boards`, `/api/boards/:id/graph`, `/api/cards`, `/api/edges`, `/api/cards/:id/split`, `/api/cards/merge`) and an SSE endpoint (`/api/events`) forwarding `GraphEventBus` updates.
   * Configure MCP server metadata (`name: "ariadeck-mcp"`, `version: "0.1.0"`) supporting both Stdio (`cli.ts`) and Streamable HTTP / SSE transports.
2. **MCP Resources (`DESIGN_MCP.md`)**:
   * Implement `ariadeck://board/list`, `ariadeck://board/{board_id}/graph`, and `ariadeck://board/{board_id}/summary`.
3. **MCP Tools (`DESIGN_MCP.md`)**:
   * Implement `create_card`, `update_card`, `delete_card`, `connect_cards`, `disconnect_cards`, `split_card`, `merge_cards`, and `insert_intermediate_card`.
   * Stamp `updatedByDeviceId = "ariadeck-mcp-server"` on all MCP-originated changes.
   * Return clear, actionable English error messages when validation fails (e.g., `CyclicDependencyError`).
4. **MCP Prompts**:
   * Register `analyze_and_split_complex_cards`, `find_and_merge_duplicates`, and `check_plot_or_task_gaps`.

### Acceptance Criteria
* `pnpm --filter @ariadeck/mcp-server dev` starts cleanly, responds to MCP resource reads (`ariadeck://board/{board_id}/graph`) and tool calls (`split_card`, `merge_cards`), and broadcasts updates over `/api/events`.

---

## Step 5: Implement `@ariadeck/desktop` Modeless Graph UI

### Objective
Build the modeless desktop canvas UI with free card placement, inline editing, drag-to-connect dependency wiring, and live updates from `ariadeck-mcp`.

### Tasks
1. **Client State Store (`useBoardStore.ts` via Zustand)**:
   * Load initial board graph via REST API and subscribe to `/api/events` (SSE) to apply live updates triggered by MCP clients.
   * Track selected card ID(s), inspector drawer open state, and active view mode (`Graph` / `Timeline`).
2. **Header (`AppHeader.tsx`)**:
   * Display the **Ariadeck** title/logo, board switcher/creator, `Graph` / `Timeline` view tabs (`Timeline` marked as Phase 2 placeholder), and live server/MCP status indicator.
3. **Modeless Graph Canvas (`GraphCanvas.tsx` via `@xyflow/react`)**:
   * **`IdeaCardNode.tsx`**: Render card type badge (`task`, `idea`, `plot_event`, `note`), status, tags, and title. Support double-clicking the title for inline editing and persist coordinates on `onNodeDragStop`.
   * **`DependencyEdge.tsx`**: Render directed arrows with relation labels (`blocks`, `causes`, `relates_to`). Wire handle connections to `connectCards` and show a non-blocking English toast notification if `CyclicDependencyError` occurs.
   * Double-clicking empty canvas space creates a new card at the cursor position.
4. **Non-Modal Inspector (`InspectorPanel.tsx`)**:
   * Slide open on the right when a card is selected without blocking canvas interactions.
   * Allow editing title, Markdown content, card type, status, tags, and manual card splitting.

### Acceptance Criteria
* Running `pnpm --filter @ariadeck/desktop dev` allows creating, dragging, inline-editing, and connecting cards persisted to `ariadeck.db`.
* Executing `split_card` or `merge_cards` from an external `ariadeck-mcp` client updates the open desktop canvas immediately without a manual refresh.

---

## Upcoming Phases (Reference)
* **Phase 2**: Add `computeTimelineLayout` topological sorting to `@ariadeck/core` and implement `TimelineView` in `@ariadeck/desktop`.
* **Phase 3**: Implement Google Drive (`Ariadeck/`) sync adapter, conflict resolution UI, and single-file Markdown export (`ariadeck-{board_slug}.md`).
* **Phase 4**: Build `@ariadeck/android` (`io.github.<username>.ariadeck` via Capacitor) with mode-separated touch UI and camera/microphone multimodal attachments.