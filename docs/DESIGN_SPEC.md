# Ariadeck Shared Backend Data Models & Function Specification (DESIGN_SPEC.md)

This document defines the data structures, SQLite schema, synchronization and conflict-resolution mechanisms, and public APIs for the shared core library (`packages/core` / `@ariadeck/core`), which is consumed uniformly by the Desktop UI (`@ariadeck/desktop`), Android UI (`@ariadeck/android`), and MCP Server (`@ariadeck/mcp-server`).

```typescript
// Standard import convention across all consumer packages
import {
  BoardGraphService,
  type Board,
  type Card,
  type Edge,
  type CardAttachment,
  type BoardGraph,
} from '@ariadeck/core';
```

---

## 1. Domain Data Models (TypeScript Definitions)

Every primary entity embeds `SyncMetadata` (`updatedAt`, `updatedByDeviceId`, `version`, `deletedAt`) to support offline-first editing and deterministic conflict resolution during Google Drive synchronization.

```typescript
export type CardType = 'task' | 'idea' | 'plot_event' | 'note';
export type CardStatus = 'todo' | 'in_progress' | 'done' | 'archived';
export type RelationType = 'blocks' | 'causes' | 'relates_to';
export type AttachmentKind = 'image' | 'audio';
export type AssetSyncStatus = 'local_only' | 'uploading' | 'synced' | 'missing_remote';

/**
 * Shared synchronization and conflict-resolution metadata.
 * Examples of updatedByDeviceId:
 * - ariadeck-desktop-<uuid>
 * - ariadeck-android-<uuid>
 * - ariadeck-mcp-<client>
 */
export interface SyncMetadata {
  createdAt: string;            // ISO 8601 timestamp
  updatedAt: string;            // ISO 8601 timestamp
  updatedByDeviceId: string;    // Identifier of the modifying device or MCP client
  version: number;              // Monotonically increasing logical revision per entity
  deletedAt: string | null;     // Soft-delete tombstone timestamp
}

/**
 * Workspace representing a project, task board, or story plot.
 */
export interface Board extends SyncMetadata {
  id: string;                   // UUID v4
  title: string;
  description: string;
}

/**
 * Card (Node in the dependency graph).
 */
export interface Card extends SyncMetadata {
  id: string;                   // UUID v4
  boardId: string;
  title: string;
  content: string;              // Markdown body
  cardType: CardType;
  status: CardStatus;
  tags: string[];

  // 2D graph canvas coordinates (used in Desktop Canvas & Mobile Relation Map)
  posX: number;
  posY: number;

  // Timeline attributes (used in Phase 2+)
  timelineOrder: number | null; // Computed topological step or manual sequence index
  startAt: string | null;       // Optional concrete start timestamp (ISO 8601)
  endAt: string | null;         // Optional concrete end timestamp (ISO 8601)

  // Split & Merge Lineage (used during sync to re-route edges and preserve edits)
  splitFromCardId: string | null;     // Parent card ID if created via splitCard
  mergedFromCardIds: string[] | null; // Source card IDs if created via mergeCards
  replacedByCardIds: string[] | null; // Replacement card IDs when this card was split or merged
}

/**
 * Dependency relation (Directed edge: sourceCardId -> targetCardId).
 */
export interface Edge extends SyncMetadata {
  id: string;                   // UUID v4
  boardId: string;
  sourceCardId: string;         // Prerequisite / cause card ID
  targetCardId: string;         // Dependent / effect card ID
  relationType: RelationType;
  label?: string;               // Optional edge annotation

  // Set when an offline sync merge introduces a cycle into the DAG
  isConflicted?: boolean;
  conflictReason?: string | null;
}

/**
 * Media attachment metadata (Extensible slot for future image and audio inputs).
 */
export interface CardAttachment extends SyncMetadata {
  id: string;                   // UUID v4
  cardId: string;
  boardId: string;
  kind: AttachmentKind;         // 'image' | 'audio'
  localUri: string;             // Device-relative storage path (e.g., media/<id>.m4a)
  remoteFileId: string | null;  // Google Drive file ID
  mimeType: string;             // e.g., 'image/webp', 'audio/mp4'
  fileSize: number;
  durationMs: number | null;    // Audio duration in milliseconds (null for images)
  transcript: string | null;    // Speech-to-text transcript or image OCR/caption (searchable & MCP-readable)
  syncStatus: AssetSyncStatus;
}

/**
 * Complete active snapshot of a board's graph.
 */
export interface BoardGraph {
  board: Board;
  cards: Card[];
  edges: Edge[];
  attachments: CardAttachment[];
}
```

---

## 2. Database Schema (SQLite: `ariadeck.db`)

SQLite (`ariadeck.db` by default, configurable via `ARIADECK_DB_PATH`) serves as the local-first database. Data access is abstracted behind a `StorageAdapter` interface so implementations can be swapped across Node/Desktop (`better-sqlite3`), Web (`sql.js` / WASM), and Android (`@capacitor-community/sqlite`).

### Table Definitions (DDL Overview)

```sql
CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  card_type TEXT NOT NULL DEFAULT 'idea',
  status TEXT NOT NULL DEFAULT 'todo',
  tags_json TEXT NOT NULL DEFAULT '[]',
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  timeline_order INTEGER,
  start_at TEXT,
  end_at TEXT,
  split_from_card_id TEXT,
  merged_from_card_ids_json TEXT,
  replaced_by_card_ids_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  FOREIGN KEY (board_id) REFERENCES boards(id)
);

CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  source_card_id TEXT NOT NULL,
  target_card_id TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'blocks',
  label TEXT,
  is_conflicted INTEGER NOT NULL DEFAULT 0,
  conflict_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  FOREIGN KEY (board_id) REFERENCES boards(id),
  FOREIGN KEY (source_card_id) REFERENCES cards(id),
  FOREIGN KEY (target_card_id) REFERENCES cards(id)
);

CREATE TABLE card_attachments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  local_uri TEXT NOT NULL,
  remote_file_id TEXT,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  transcript TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local_only',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  FOREIGN KEY (card_id) REFERENCES cards(id),
  FOREIGN KEY (board_id) REFERENCES boards(id)
);

-- Local mutation log (Outbox for delta detection and conflict evaluation during sync)
CREATE TABLE sync_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, -- 'board' | 'card' | 'edge' | 'attachment'
  entity_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  operation TEXT NOT NULL,   -- 'create' | 'update' | 'delete' | 'split' | 'merge'
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  synced_at TEXT
);

-- Conflicts requiring user review and resolution
CREATE TABLE conflicts (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  conflict_type TEXT NOT NULL, -- 'content_collision' | 'cyclic_edge' | 'deleted_target_edit'
  local_snapshot_json TEXT NOT NULL,
  remote_snapshot_json TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_cards_board_id ON cards(board_id);
CREATE INDEX idx_edges_board_id ON edges(board_id);
CREATE INDEX idx_attachments_card_id ON card_attachments(card_id);
CREATE INDEX idx_sync_outbox_unsynced ON sync_outbox(board_id, synced_at);
```

---

## 3. Core Service Function Specification (`BoardGraphService`)

UI clients and `@ariadeck/mcp-server` must never query SQLite directly; all operations must flow through `BoardGraphService`. Every mutating operation increments `version`, appends an entry to `sync_outbox`, and emits an internal event via `GraphEventBus`.

### 3.1 Basic CRUD Operations
* `getBoardGraph(boardId: string): Promise<BoardGraph>`
  * Fetches all active (`deletedAt IS NULL`) cards, edges, and attachments belonging to `boardId`.
* `createCard(input: CreateCardInput): Promise<Card>`
  * Creates a new card. If coordinates are omitted, calculates a non-overlapping default position on the canvas.
* `updateCard(cardId: string, patch: UpdateCardInput): Promise<Card>`
  * Updates card properties (`title`, `content`, `posX`, `posY`, `status`, `tags`, etc.), bumps `version`, and updates `updatedAt`.
* `deleteCard(cardId: string): Promise<void>`
  * Soft-deletes the card (`deletedAt = now()`) and cascades soft-deletion to all incident edges and associated attachments.

### 3.2 Edge Operations & DAG Cycle Validation
* `connectCards(boardId: string, sourceId: string, targetId: string, relationType?: RelationType): Promise<Edge>`
  * **Validation Rules**:
    1. Throws `CyclicDependencyError` if `sourceId === targetId` (self-loop).
    2. When `relationType` is `'blocks'` or `'causes'`, runs a Depth-First Search (DFS) starting from `targetId` to verify no existing path reaches `sourceId`. If reachable, throws `CyclicDependencyError` to preserve DAG invariants.
    3. Rejects or deduplicates identical `(sourceId, targetId, relationType)` edges.
* `disconnectCards(edgeId: string): Promise<void>`
  * Soft-deletes the specified edge.

### 3.3 Atomic Graph Transformations (AI / MCP & Batch Operations)

#### `splitCard(params: SplitCardParams): Promise<SplitCardResult>`
Atomically decomposes a coarse card into multiple granular child cards while preserving upstream and downstream dependencies.

* **Input (`SplitCardParams`)**:
  * `targetCardId: string`: ID of the card to split.
  * `subCards: Array<{ title: string; content: string; cardType?: CardType }>`: Ordered list of child card definitions (minimum 2).
  * `linkMode: 'sequential' | 'parallel'`:
    * `'sequential'`: Chains child cards linearly (`sub[0] -> sub[1] -> ... -> sub[n]`).
    * `'parallel'`: Leaves child cards unconnected to each other as parallel tasks.
* **Execution Steps (Transactional)**:
  1. Collect all active `Incoming` edges (`* -> targetCardId`) and `Outgoing` edges (`targetCardId -> *`).
  2. Create the child cards near the parent's `(posX, posY)` with `splitFromCardId = targetCardId`.
  3. If `linkMode === 'sequential'`, connect `sub[i] -> sub[i+1]`, attach all `Incoming` edges to `sub[0]`, and attach all `Outgoing` edges to `sub[n-1]`. If `linkMode === 'parallel'`, replicate `Incoming` and `Outgoing` edges across all child cards.
  4. Record `replacedByCardIds = [childIds...]` on `targetCardId` and soft-delete `targetCardId` along with its original edges.

#### `mergeCards(params: MergeCardsParams): Promise<Card>`
Atomically consolidates multiple redundant or closely related cards into a single card, re-wiring external dependencies.

* **Input (`MergeCardsParams`)**:
  * `targetCardIds: string[]`: IDs of the cards to merge (minimum 2).
  * `mergedCard: { title: string; content: string; cardType?: CardType; tags?: string[] }`
* **Execution Steps (Transactional)**:
  1. Compute the centroid `(avgPosX, avgPosY)` of `targetCardIds` and create the new merged card with `mergedFromCardIds = targetCardIds`.
  2. Re-wire all external incoming edges (`source ∉ targetCardIds`, `target ∈ targetCardIds`) to point to the merged card, deduplicating identical `(source, mergedCard, relationType)` triples.
  3. Re-wire all external outgoing edges (`source ∈ targetCardIds`, `target ∉ targetCardIds`) to originate from the merged card, deduplicating identical triples.
  4. Soft-delete all internal edges between `targetCardIds`, set `replacedByCardIds = [mergedCard.id]` on each source card, and soft-delete the source cards.

#### `insertIntermediateCard(sourceId: string, targetId: string, cardData: CreateCardInput): Promise<Card>`
Splits an existing edge `sourceId -> targetId` by soft-deleting it and inserting `newCard` to form `sourceId -> newCard -> targetId`.

---

## 4. Timeline Auto-Sorting Specification (Phase 2)

* `computeTimelineLayout(boardId: string): Promise<TimelineSortResult>`
  * **Algorithm**: Kahn's topological sort combined with Longest-Path Layering (ignoring edges flagged with `isConflicted === true` so cyclic conflicts never cause infinite loops).
  * **Logic**:
    1. Assign nodes with in-degree `0` (no prerequisites) to `Step 0`.
    2. For every directed edge `A -> B`, enforce `Step(B) >= Step(A) + 1`.
    3. Persist the computed step index into `card.timelineOrder` and return cards grouped by step.

---

## 5. Google Drive Synchronization & Conflict Resolution (Phase 3)

Ensures safe bidirectional synchronization between local SQLite (`ariadeck.db`) and Google Drive (`Ariadeck/`) even after extended offline edits across Desktop and Android.

### 5.1 Storage Layout & Separation
* **Google Drive Root Folder**: `Ariadeck/`
* **Metadata Snapshots**: Per-board JSON files stored at `Ariadeck/boards/board_{boardId}.json`.
* **Binary Media Assets**: Image and audio binaries are decoupled from JSON metadata and synced asynchronously to `Ariadeck/media/{attachmentId}_{filename}`.

### 5.2 Conflict Resolution Rules (5 Core Scenarios)
1. **Concurrent Card Text/Attribute Edits (`content_collision`)**:
   * Uses Last-Write-Wins (LWW) based on `updatedAt` (breaking ties deterministically via lexicographical comparison of `updatedByDeviceId`).
   * However, if both the local unsynced outbox and a remote device modified `title` or `content` on the same card, LWW applies the winner while storing both snapshots in the `conflicts` table so the user can review and merge lost text in the UI.
2. **Card Split/Merge vs. Remote Edits or New Edges**:
   * If an incoming or local edge references a card that has been soft-deleted with a non-empty `replacedByCardIds`:
     * If `replacedByCardIds.length > 1` (split), incoming edges automatically re-route to `replacedByCardIds[0]` and outgoing edges to `replacedByCardIds[last]`.
     * If `replacedByCardIds.length === 1` (merge), edges automatically re-route to the merged card.
   * If a remote device edited the text of a card that was locally split or merged, a `deleted_target_edit` conflict is recorded so no notes are silently discarded.
3. **Post-Merge DAG Cycles (`cyclic_edge`)**:
   * If Device A adds `X -> Y` offline and Device B adds `Y -> X` offline, merging both produces a cycle.
   * After every sync merge, a full-board DAG cycle check runs. If a cycle is detected, the newer edge is flagged with `isConflicted = true`, `conflictReason = 'cyclic_dependency'`, and logged to `conflicts` while remaining visible in the UI for manual resolution.
4. **Delete vs. Edit/Connect Collisions (Tombstones)**:
   * Soft-delete timestamps (`deletedAt`) are respected via LWW. Any edge referencing a deleted card is automatically soft-deleted or marked invalid. Tombstones are retained for 30 days before compaction.
5. **Delayed Binary Media Sync**:
   * Cards and attachment `transcript` fields sync immediately via JSON even if large audio/image binaries are still uploading (`syncStatus = 'local_only' | 'uploading'`).

---

## 6. Single-File Markdown Export Specification (Phase 3+)

Once Timeline sorting (Phase 2) is complete, users can export an entire board into a single structured Markdown document.

* `exportBoardToMarkdown(boardId: string, options?: MarkdownExportOptions): Promise<string>`
* **Default Output Filename**: `ariadeck-{board_slug}.md` (e.g., `ariadeck-story-plot.md`)
* **Output Format**:
  * Prepends YAML frontmatter (`title`, `generator: Ariadeck`, `board_id`, `exported_at`).
  * Orders cards sequentially by `timelineOrder` (or configured timestamps).
  * Renders each card with a step heading (`## [Step 1] Card Title`), metadata badges (type, status, tags), Markdown body, upstream/downstream dependency links (`Prerequisites`, `Dependents`), and optional blockquotes for attachment `transcript` text.