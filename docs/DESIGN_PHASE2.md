# Ariadeck Phase 2 Design Specification
## Timeline Engine, Jump-Back Loops, and Flat-Type Relationship Boards

> **Document Scope**: This specification defines incremental Phase 2 additions on top of the Phase 1 Ariadeck baseline (`DESIGN.md`, `DESIGN_SPEC.md`, `DESIGN_MCP.md`, `IMPLEMENTATION_GUIDE_PHASE1.md`).
> **Conventions**: All source code comments, TypeScript symbols, MCP tool descriptions, error messages, and Git commits (Conventional Commits) MUST be written in English.

---

## 1. Overview & Objectives

Phase 2 expands **Ariadeck** from a strict Directed Acyclic Graph (DAG) editor into a dual-mode visual thinking environment capable of modeling both **temporal/causal workflows with loops** and **non-temporal relationship networks**:

1. **Timeline Engine & View (`flow` boards)**:
   - Automatic topological layering of temporal edges (`blocks`, `causes`) into sequential steps/phases.
   - Interactive Timeline View supporting manual ordering, date ranges, and dependency contradiction warnings.
2. **Jump-Back Edges (`jump_back`)**:
   - Dedicated backward-pointing edges in `flow` boards to express loops, retries, and narrative callbacks without introducing cycles into the temporal DAG.
   - Excluded from DAG cycle validation and topological sorting, and visualized via dedicated curved return arcs on both Canvas and Timeline views.
3. **Flat-Type Boards (`board_type = 'flat'`)**:
   - A new board mode designed for entity/component architecture diagrams, character relationship maps, and concept networks.
   - Cycles are explicitly permitted.
   - Supports **directed** (`->`), **bidirectional** (`<->`, e.g., rivalry/exclusivity), and **undirected** (`---`, e.g., symbiosis/shared trait) edges with custom labels and visual variants.

---

## 2. Database Schema Migration (`ariadeck.db`: v1 -> v2)

All changes MUST preserve backward compatibility with existing Phase 1 SQLite databases. Existing boards default to `'flow'` and existing edges default to `'directed'`.

### 2.1 Migration SQL (`002_phase2_board_types_and_edges.sql`)

```sql
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- 1. Extend boards table with board_type
ALTER TABLE boards
  ADD COLUMN board_type TEXT NOT NULL DEFAULT 'flow'
  CHECK (board_type IN ('flow', 'flat'));

-- 2. Rebuild edges table to expand relation_type, add direction/label/style,
--    and update uniqueness rules for symmetric and multi-relation edges.
CREATE TABLE edges_v2 (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'blocks'
    CHECK (relation_type IN ('blocks', 'causes', 'relates_to', 'jump_back', 'custom')),
  direction TEXT NOT NULL DEFAULT 'directed'
    CHECK (direction IN ('directed', 'bidirectional', 'undirected')),
  label TEXT,
  style_variant TEXT NOT NULL DEFAULT 'solid'
    CHECK (style_variant IN ('solid', 'dashed', 'dotted')),
  color TEXT,
  is_conflicted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

INSERT INTO edges_v2 (
  id, board_id, source_id, target_id, relation_type,
  direction, label, style_variant, color, is_conflicted,
  created_at, updated_at, updated_by_device_id, version, deleted_at
)
SELECT
  id, board_id, source_id, target_id, relation_type,
  'directed', NULL, 'solid', NULL, COALESCE(is_conflicted, 0),
  created_at, updated_at, updated_by_device_id, version, deleted_at
FROM edges;

DROP TABLE edges;
ALTER TABLE edges_v2 RENAME TO edges;

-- Active edge uniqueness constraint:
-- Allows a forward edge (A -> B, blocks) and a return edge (B -> A, jump_back),
-- as well as distinct relationship types between the same pair on flat boards.
CREATE UNIQUE INDEX idx_edges_active_unique
  ON edges (board_id, source_id, target_id, relation_type, direction)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_edges_board_active
  ON edges (board_id)
  WHERE deleted_at IS NULL;

COMMIT;
PRAGMA foreign_keys = ON;
```

---

## 3. Core Domain Logic & Graph Engine (`@ariadeck/core`)

### 3.1 TypeScript Domain Types

```ts
export type BoardType = 'flow' | 'flat';

export type EdgeDirection = 'directed' | 'bidirectional' | 'undirected';

export type EdgeRelationType =
  | 'blocks'
  | 'causes'
  | 'relates_to'
  | 'jump_back'
  | 'custom';

export type EdgeStyleVariant = 'solid' | 'dashed' | 'dotted';

export type SplitEdgeInheritance = 'sequential' | 'broadcast' | 'none';

export interface Board {
  id: string;
  title: string;
  description: string | null;
  board_type: BoardType;
  // ...Phase 1 sync metadata
}

export interface Edge {
  id: string;
  board_id: string;
  source_id: string;
  target_id: string;
  relation_type: EdgeRelationType;
  direction: EdgeDirection;
  label: string | null;
  style_variant: EdgeStyleVariant;
  color: string | null;
  is_conflicted: boolean;
  // ...Phase 1 sync metadata
}

export interface TimelineItem {
  card_id: string;
  computed_rank: number;      // 0-based topological layer
  effective_order: number;    // Manual timeline_order if set, else computed_rank
  has_dependency_conflict: boolean;
  conflicting_prerequisite_ids: string[];
}

export interface JumpBackWarning {
  edge_id: string;
  source_id: string;
  target_id: string;
  code: 'JUMP_BACK_POINTS_FORWARD';
  message: string;
}

export interface TimelineComputationResult {
  board_id: string;
  items: TimelineItem[];
  jump_back_edges: Edge[];
  warnings: JumpBackWarning[];
  has_temporal_cycle: boolean;
}

export interface BoardConversionAnalysis {
  board_id: string;
  current_type: BoardType;
  target_type: BoardType;
  can_convert_cleanly: boolean;
  symmetric_edge_ids: string[];       // undirected or bidirectional edges
  custom_relation_edge_ids: string[]; // custom edges unsupported as temporal
  cycle_edge_ids: string[];           // edges participating in directed cycles
}
```

### 3.2 Temporal vs. Non-Temporal Edge Classification

`@ariadeck/core` strictly separates edges that constrain chronological order from edges that express associative or looping relationships:

| Board Type | `relation_type` | Allowed `direction` | Participates in DAG Check | Participates in Topological Sort | Self-Loop Allowed |
| :--- | :--- | :--- | :---: | :---: | :---: |
| `flow` | `blocks`, `causes` | `directed` only | **Yes** | **Yes** | No |
| `flow` | `relates_to` | `directed` (default) | No | No | No |
| `flow` | `jump_back` | `directed` only | No | No | **Yes** (e.g., retry state) |
| `flow` | `custom` | Not recommended (disallowed by default) | No | No | No |
| `flat` | `relates_to`, `custom`, `blocks`, `causes` | `directed`, `bidirectional`, `undirected` | **No** (cycles allowed) | N/A | Optional (`relates_to`/`custom`) |
| `flat` | `jump_back` | Disallowed (flow-only semantic) | N/A | N/A | N/A |

#### Validation Error Codes
- `ERR_INVALID_EDGE_FOR_BOARD_TYPE`: Attempting to create an `undirected` or `bidirectional` edge on a `flow` board, or a `jump_back` edge on a `flat` board.
- `ERR_TEMPORAL_CYCLE_DETECTED`: Adding a `blocks` or `causes` edge on a `flow` board creates a cycle in the temporal subgraph.
- `ERR_SELF_LOOP_NOT_ALLOWED`: Attempting a self-loop on a `blocks` or `causes` edge.

### 3.3 Symmetric Edge Canonicalization

To prevent duplicate logical edges (e.g., `A --- B` created on Desktop and `B --- A` created on Android while offline), `@ariadeck/core` MUST normalize endpoints before persistence and lookup:

```ts
export function canonicalizeEdgeEndpoints(
  sourceId: string,
  targetId: string,
  direction: EdgeDirection
): { source_id: string; target_id: string } {
  if (direction === 'undirected' || direction === 'bidirectional') {
    return sourceId <= targetId
      ? { source_id: sourceId, target_id: targetId }
      : { source_id: targetId, target_id: sourceId };
  }
  return { source_id: sourceId, target_id: targetId };
}
```

### 3.4 Topological Sort & Timeline Engine

Implemented in `packages/core/src/graph/timeline.ts`:

1. **Eligibility Guard**: Reject `computeTimeline(boardId)` with `ERR_TIMELINE_NOT_SUPPORTED_ON_FLAT_BOARD` if `board.board_type === 'flat'`.
2. **Subgraph Extraction**: Filter active edges where `deleted_at IS NULL`, `is_conflicted = 0`, `direction = 'directed'`, and `relation_type IN ('blocks', 'causes')`.
3. **Longest-Path Layer Assignment**:
   - Execute Kahn's algorithm in $O(V + E)$ time.
   - Root nodes (in-degree `0`) receive `computed_rank = 0`.
   - For each directed temporal edge `u -> v`, set `rank[v] = max(rank[v], rank[u] + 1)`.
   - Tie-break nodes within the same rank deterministically by `(timeline_order ?? Infinity, pos_x, created_at, id)`.
4. **Manual Override & Contradiction Detection**:
   - If a card has a manual `timeline_order` (or `start_at`), verify that every temporal prerequisite `u` satisfies `effective_order(u) < effective_order(v)` (or `start_at(u) <= start_at(v)`).
   - Flag violations in `has_dependency_conflict` and populate `conflicting_prerequisite_ids` without blocking the user from experimenting.
5. **Jump-Back Direction Soft Warning**:
   - Collect all active `jump_back` edges.
   - If `effective_order(edge.source_id) < effective_order(edge.target_id)` (meaning the jump-back points *forward* in time rather than backward or to itself), emit a non-blocking `JUMP_BACK_POINTS_FORWARD` warning for the UI.

### 3.5 Board Type Conversion Rules

Implemented in `packages/core/src/services/boardService.ts`:

- `analyzeBoardTypeConversion(boardId, targetType)`: Dry-run inspector returning `BoardConversionAnalysis`.
- `convertBoardType(boardId, targetType, strategy)`:
  - **`flow` -> `flat`**: Always succeeds losslessly. Existing `jump_back` edges are converted to `relates_to` with `style_variant = 'dashed'` (preserving their label) so no semantic link is lost.
  - **`flat` -> `flow`**:
    - If `can_convert_cleanly === true`: Updates `board_type = 'flow'` directly.
    - If `can_convert_cleanly === false`:
      - `strategy = 'abort'` (default): Throws `ERR_BOARD_CONVERSION_REQUIRES_RESOLUTION` with the analysis payload.
      - `strategy = 'demote_incompatible'`: Converts symmetric edges (`undirected`/`bidirectional`) to `directed` with `relation_type = 'relates_to'`, demotes `custom` edges to `relates_to`, and converts cycle-breaking edges into `jump_back` (dashed) or `relates_to`, then sets `board_type = 'flow'`.

### 3.6 `splitCard` and `mergeCards` Extensions

- **`splitCard(cardId, subCardsData, options)`**:
  - Adds `edgeInheritance?: SplitEdgeInheritance`.
  - Default on `flow` boards: `'sequential'` (Phase 1 behavior: incoming temporal edges -> first child; outgoing temporal edges -> last child; internal chain created between children). Incoming/outgoing `jump_back` edges reattach to the last/first child respectively (or user-specified target).
  - Default on `flat` boards: `'broadcast'` (no forced sequential chain between children; existing incident edges of the original card can be replicated to all resulting child cards, or omitted if `'none'`).
- **`mergeCards(cardIds, mergedData)`**:
  - Reattaches all external incident edges while applying `canonicalizeEdgeEndpoints` and deduplicating identical `(source_id, target_id, relation_type, direction)` tuples.
  - Drops internal edges whose both endpoints belonged to `cardIds` (except optionally preserving a `jump_back` self-loop if explicitly requested).

---

## 4. UI/UX & Component Specifications (`@ariadeck/desktop` & `@ariadeck/android`)

### 4.1 Graph Canvas Enhancements (`GraphCanvas.tsx`, `RelationshipEdge.tsx`)

- **Edge Rendering Styles**:
  - `directed` (`blocks` / `causes`): Solid arrow with `markerEnd`.
  - `bidirectional`: Arrow markers on both ends (`markerStart` + `markerEnd`). Supports quick presets (e.g., *Rivalry / Conflict* in crimson, *Mutual Dependency* in indigo).
  - `undirected`: Markerless line (`solid` or `dotted`), suitable for *Symbiosis*, *Shared Group*, or *Co-occurrence*.
  - `jump_back`: Amber/violet **dashed** path (`strokeDasharray: "6 4"`) with a loop-return icon badge (`↩`) and custom Bezier control-point offset (`curvatureOffset`) so a backward edge `B -> A` never visually overlaps a forward edge `A -> B`.
  - **Edge Labels**: Rendered via React Flow `<EdgeLabelRenderer>` as a compact clickable pill at the midpoint. Clicking opens an inline popover to edit `label`, `direction`, `relation_type`, `style_variant`, and `color`.
- **Handle Topology by Board Type**:
  - `flow` boards: Left handle (`target`) and Right handle (`source`) to reinforce left-to-right causality, plus an optional bottom/top loop handle for `jump_back` creation.
  - `flat` boards: 4-side handles (`top`, `right`, `bottom`, `left`) or floating edge anchor calculation so relationship lines connect along the shortest unobstructed perimeter point.
- **Flat Board Toolbar & Auto-Layout**:
  - When viewing a `flat` board, render a compact contextual toolbar on the canvas:
    - Edge creation mode toggle: `Arrow (->)` | `Bidirectional (<->)` | `Undirected (---)`.
    - Quick label presets (user-customizable per board).
    - **Auto-Arrange (Force Layout)** button powered by `d3-force` (many-body repulsion + link distance + collision box based on node dimensions) to untangle complex relationship maps.

### 4.2 Timeline View (`TimelineView.tsx`)

- **Header Navigation (`AppHeader.tsx`)**:
  - `flow` boards: Both **Graph** and **Timeline** tabs are active.
  - `flat` boards: **Timeline** tab is disabled with tooltip `"Timeline view is available for Flow boards"`.
- **Layout & Interactions**:
  - Horizontal swimlanes/columns grouped by `computed_rank` (Step 1, Step 2, ...) or calendar axis (`start_at` / `end_at`).
  - Drag-and-drop reordering updates `timeline_order` and immediately re-evaluates dependency contradictions (highlighted with a warning badge and red prerequisite indicator).
  - **"Auto-Sort from Graph"** action resets manual `timeline_order` overrides to follow topological ranks.
- **Jump-Back Return Arcs (SVG Overlay)**:
  - Dedicated header lane above timeline columns renders `jump_back` edges as smooth overhead quadratic/cubic SVG arcs sweeping from right (source) back to left (target), displaying the edge label at the apex.
  - Controls:
    - **"Show Loops" toggle** (default ON when `jump_back` edges exist).
    - **Hover Focus**: Hovering over any card highlights its connected `jump_back` arcs and dims unrelated arcs to prevent visual clutter.
    - Soft warnings (`JUMP_BACK_POINTS_FORWARD`) display a subtle amber caution icon on the arc label.

### 4.3 Android Mobile Adaptations (`@ariadeck/android`)

- **Board Creation Modal**: Adds a clear segmented selector: **Flow Board** (*Tasks, plots & timelines*) vs. **Flat Board** (*Characters, systems & relationship maps*).
- **Relationship Edit Mode**:
  - Connecting two cards on a `flat` board opens a compact bottom sheet to pick `direction` (`->`, `<->`, `---`) and an optional `label`.
  - Connecting two cards on a `flow` board where `target` is an ancestor of `source` automatically offers **"Create as Jump-Back Loop?"** instead of simply failing with a cycle error.
- **Mobile Timeline View**: Vertical chronological list grouped by topological step headers, with compact inline jump-back chips (`↩ Jumps back to: [Card Title]`) that smoothly scroll to the target card on tap.

---

## 5. MCP Specification Delta (`@ariadeck/mcp-server`)

### 5.1 Updated Resource: `ariadeck://board/{board_id}/graph`

The JSON representation returned by `ariadeck-mcp` is extended with `board_type`, rich edge metadata, and optional timeline ranks:

```json
{
  "board": {
    "id": "brd_01",
    "title": "Chapter 3 Plot",
    "board_type": "flow"
  },
  "cards": [
    {
      "id": "crd_01",
      "title": "Hero enters the vault",
      "timeline_rank": 0,
      "timeline_order": null
    }
  ],
  "edges": [
    {
      "id": "edg_01",
      "source_id": "crd_03",
      "target_id": "crd_01",
      "relation_type": "jump_back",
      "direction": "directed",
      "label": "Trap triggers reset",
      "style_variant": "dashed"
    }
  ]
}
```

### 5.2 Updated & New MCP Tools

| Tool Name | Change | Description & Key Parameters |
| :--- | :--- | :--- |
| `create_board` | **Updated** | Adds `board_type?: 'flow' \| 'flat'` (default `'flow'`). Description explicitly instructs AI clients to choose `'flat'` for relationship diagrams/character maps and `'flow'` for task dependencies/timelines. |
| `connect_cards` | **Updated** | Adds `direction?: 'directed' \| 'bidirectional' \| 'undirected'`, `relation_type?: 'blocks' \| 'causes' \| 'relates_to' \| 'jump_back' \| 'custom'`, `label?: string`, `style_variant?: 'solid' \| 'dashed' \| 'dotted'`, `color?: string`. |
| `update_edge` | **New** | Updates `label`, `direction`, `relation_type`, `style_variant`, or `color` on an existing edge with full board-type validation. |
| `split_card` | **Updated** | Adds `edge_inheritance?: 'sequential' \| 'broadcast' \| 'none'`. |
| `compute_timeline` | **New** | Computes topological timeline ranks, contradiction warnings, and jump-back warnings for a `flow` board. Optional `apply_to_cards?: boolean` persists `timeline_order`. |
| `convert_board_type` | **New** | Runs dry-run analysis (`dry_run: true`) or executes conversion (`strategy: 'abort' \| 'demote_incompatible'`) between `flow` and `flat`. |

---

## 6. Sync & Conflict Resolution Delta

1. **Symmetric Edge Deduplication During Merge**:
   - Before comparing local and remote edges during Google Drive sync, both sides are canonicalized via `canonicalizeEdgeEndpoints()`. Two offline devices creating `A --- B` and `B --- A` with the same `relation_type` merge into a single record via LWW instead of creating duplicate lines.
2. **Board-Type-Aware Post-Merge DAG Check**:
   - Post-merge cycle detection runs **only** on boards where `board_type === 'flow'` and evaluates **only** temporal edges (`blocks`, `causes`).
   - `flat` boards and `jump_back` edges are never flagged with cycle conflicts (`is_conflicted = 1`).
3. **Board Type Conflict**:
   - If one device converts a board from `flow` to `flat` while another edits it offline, LWW on `boards.updated_at` decides the winning `board_type`. If the winner is `flow`, any incoming incompatible edges from the `flat` device are automatically demoted to `relates_to` (or flagged in `conflicts`) rather than corrupting the timeline engine.

---

## 7. Antigravity Implementation Checklist & Verification Plan

### Step-by-Step Implementation Order
1. **Step 1 — Schema & Migrations (`@ariadeck/core`)**: Implement SQLite migration `v1 -> v2`, update entity mappers, and verify migration idempotency on an existing Phase 1 `ariadeck.db`.
2. **Step 2 — Graph Rules & Timeline Engine (`@ariadeck/core`)**: Implement symmetric canonicalization, partial-graph DAG validation, `jump_back` rules, `computeTimeline()`, `convertBoardType()`, and `splitCard` inheritance modes.
3. **Step 3 — Core Unit Tests (`@ariadeck/core`)**:
   - Test `flow` board accepts `A -> B -> C` + `C -jump_back-> A` without cycle error.
   - Test `flow` board rejects `C -blocks-> A` with `ERR_TEMPORAL_CYCLE_DETECTED`.
   - Test `jump_back` forward-pointing warning (`JUMP_BACK_POINTS_FORWARD`).
   - Test `flat` board accepts `A -> B -> C -> A` cycles, `bidirectional`, and `undirected` edges with canonical ordering.
   - Test `flat` -> `flow` dry-run and `demote_incompatible` conversion.
4. **Step 4 — MCP Server Updates (`@ariadeck/mcp-server`)**: Update `ariadeck://board/{board_id}/graph` resource and expose new/updated tool schemas with English descriptions.
5. **Step 5 — Desktop UI (`@ariadeck/desktop`)**: Implement `RelationshipEdge.tsx` (bidirectional/undirected/jump-back/labels), 4-side flat handles, Force-Directed layout button, and `TimelineView.tsx` with SVG Return Arcs.
6. **Step 6 — Android UI (`@ariadeck/android`)**: Add board-type creation picker, edge-direction bottom sheet, automatic jump-back prompt on reverse connection, and mobile timeline list view.

### Commit Convention Examples
- `feat(core): add flat board type and symmetric edge canonicalization`
- `feat(core): support jump_back edges and topological timeline engine`
- `feat(mcp): expose compute_timeline and flat board edge parameters`
- `feat(desktop): render timeline return arcs and flat board relationship toolbar`
