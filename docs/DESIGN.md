# Ariadeck Overall Design Document (DESIGN.md)

## 1. Project Overview & Core Concept
**Ariadeck** is a cross-platform (Desktop / Android) spatial and temporal organization tool for Todos, tasks, ideas, and story plots. Users record thoughts as "Cards" and organize them across two complementary dimensions: **dependency graphs (DAG)** and **chronological sequences (Timeline)**.

### Core Design Principles
1. **Strict Separation of Core Logic and UI**: All data persistence, directed acyclic graph (DAG) validation, card splitting/merging, topological sorting, and Google Drive synchronization/conflict-resolution logic are centralized in a shared core package (`@ariadeck/core`).
2. **Device-Optimized, Distinct UIs**:
   * **Desktop (`@ariadeck/desktop`)**: A **modeless UI** tailored for wide screens. Users can freely scatter cards across an infinite canvas, edit them inline, and connect dependencies directly (switching modes only for the Timeline view).
   * **Mobile / Android (`@ariadeck/android`)**: A **mode-separated UI** tailored for small screens and touch gestures, cleanly separating list browsing, focused single-card editing, and touch-optimized relation mapping (pinch-to-zoom/pan).
3. **AI (MCP) Native Integration**: Exposes a Model Context Protocol (MCP) server (`@ariadeck/mcp-server` / CLI: `ariadeck-mcp`) enabling external AI agents to inspect graph structures and perform safe, atomic card splits and task merges.
4. **Multimodal Extensibility & Document Export**: Designed from day one to accommodate future image and audio attachments (`card_attachments`) as well as exporting timeline-sorted boards into a single structured Markdown document.
5. **English-First OSS Standard**: All documentation, source code comments, MCP tool descriptions, error messages, and Git commit messages (following Conventional Commits) must be written in English.

---

## 2. Recommended Technology Stack

| Layer | Selected Technology | Rationale |
| :--- | :--- | :--- |
| **Language & Monorepo** | TypeScript (pnpm workspaces) | Enables 100% sharing of domain types and business logic across `@ariadeck/core`, `@ariadeck/mcp-server`, and UI apps. |
| **Desktop UI** | React + Vite + Tailwind CSS | Lightweight, fast, and ideal for building a responsive, modeless canvas UI. |
| **Mobile UI (Android)** | React + Vite + **Capacitor** + Tailwind CSS | Allows building mobile-specific web UIs while accessing native Android APIs (SQLite, camera/gallery, microphone recording, Google Drive API) via plugins.<br>• `appName`: `Ariadeck`<br>• `appId`: `io.github.<username>.ariadeck` |
| **Graph Rendering** | `@xyflow/react` (React Flow) | Flexibly supports custom card nodes (including future image thumbnails and audio players), directed edges, and pinch-to-zoom/pan gestures. |
| **Local Database** | SQLite (`ariadeck.db`) | Ensures fast local-first execution with a unified schema across Node, Web (WASM), and Android via a pluggable `StorageAdapter`. |
| **AI / MCP** | `@modelcontextprotocol/sdk` (TypeScript) | Directly imports `@ariadeck/core` to expose safe, atomic graph manipulation tools to AI agents. |

---

## 3. System Architecture & Monorepo Structure

```text
ariadeck/
├── package.json               # Root manifest (name: "ariadeck", private: true)
├── pnpm-workspace.yaml
├── docs/
│   ├── DESIGN.md              # This document (Architecture & UI Design)
│   ├── DESIGN_SPEC.md         # Data models, core APIs, sync & conflict resolution
│   ├── DESIGN_MCP.md          # MCP server, tools, and resources specification
│   └── IMPLEMENTATION_GUIDE_PHASE1.md
├── packages/
│   ├── core/                  # @ariadeck/core: Shared backend (DB/media adapters, graph ops, sort, sync)
│   └── mcp-server/            # @ariadeck/mcp-server (CLI: ariadeck-mcp): MCP server & local HTTP/SSE bridge
└── apps/
    ├── desktop/               # @ariadeck/desktop: Desktop Web/App UI (Modeless canvas + Timeline)
    └── android/               # @ariadeck/android: Android Mobile UI (Capacitor-based, mode-separated, touch-first)
```

### External Storage & Sync Directory Conventions
* **Local SQLite Filename**: `ariadeck.db` (overridable via `ARIADECK_DB_PATH`)
* **Google Drive Sync Root Folder**: `Ariadeck/`
  * `Ariadeck/boards/`: Per-board JSON synchronization snapshots
  * `Ariadeck/media/`: Attached image and audio binary files

### Related Documentation
* Data Models, Database Schema, Core Functions, Conflict Resolution & Export: [DESIGN_SPEC.md](./DESIGN_SPEC.md)
* MCP (Model Context Protocol) Tools & Resources Specification: [DESIGN_MCP.md](./DESIGN_MCP.md)
* Phase 1 Implementation Guide: [IMPLEMENTATION_GUIDE_PHASE1.md](./IMPLEMENTATION_GUIDE_PHASE1.md)

---

## 4. State Management Separation

Because UI behaviors differ significantly between Desktop and Android, state is strictly divided into two layers:

1. **Domain State (Managed by `@ariadeck/core`)**:
   * Boards, cards (content, coordinates, order, lineage), edges (dependencies), attachment metadata, and sync/conflict statuses.
   * Persistent data synchronized with local SQLite (`ariadeck.db`) and Google Drive.
2. **UI Local State (Managed independently by `@ariadeck/desktop` and `@ariadeck/android`)**:
   * Currently selected card ID(s).
   * Active view mode (e.g., `Graph` / `Timeline` on Desktop; `List` / `CardEdit` / `RelationEdit` / `Timeline` on Android).
   * Canvas zoom level, pan offset, and active search/tag filters.

---

## 5. Desktop UI Component Architecture (`apps/desktop` / `@ariadeck/desktop`)

### 5.1 Screen Layout Concept (Modeless Design)
The entire viewport acts as an infinite canvas, minimizing modal dialogs. Users can create, drag, inline-edit, and connect cards seamlessly.

```text
+-----------------------------------------------------------------------+
| [AppHeader] Ariadeck | Board Select | [Graph / Timeline] | Sync | MCP |
+-------------------------------------------------------+---------------+
|                                                       |               |
|  [GraphCanvas] (@xyflow/react based)                  | [Inspector    |
|   - Freely positioned IdeaCardNode components         |  Panel]       |
|   - Drag & drop positioning and handle connections    | (Slides open  |
|   - Double-click for inline title editing             |  non-modally) |
|   - Switches to [TimelineView] in Timeline mode       | - MD Editor   |
|                                                       | - AI Split/Mrg|
+-------------------------------------------------------+---------------+
```

### 5.2 Component Inventory
* **`DesktopAppShell`**: Root layout container managing global keyboard shortcuts (Undo/Redo, Delete, Quick Create).
* **`AppHeader`**:
  * `BrandLogo`: **Ariadeck** logo and title.
  * `BoardSelector`: Board switcher, board creation, and Markdown export trigger (Phase 3+).
  * `ViewModeSwitch`: Toggles between `Graph` (modeless free canvas) and `Timeline` (topologically sorted sequence).
  * `SyncStatusBadge`: Displays Google Drive (`Ariadeck/`) sync status and conflict alerts (opens `ConflictResolverModal` on click).
  * `McpStatusIndicator`: Shows `ariadeck-mcp` connection health and toast notifications when AI agents modify the board.
* **`GraphCanvas`**:
  * `IdeaCardNode`: Custom card node displaying title, type badge (`task`, `idea`, `plot_event`, `note`), tags, attachment badges (image thumbnail / audio icon), and source/target handles. Single-click selects; double-click triggers inline title editing.
  * `DependencyEdge`: Directed edge arrow displaying relation labels (`blocks`, `causes`, `relates_to`), cyclic conflict warning styles, and click-to-delete controls.
  * `CanvasQuickToolbar`: Handles double-clicking empty canvas space or clicking a floating button to spawn new cards immediately.
* **`InspectorPanel` (Non-Modal Right Drawer)**:
  * Slides in non-modally on the right when a card is selected without blocking canvas interactions.
  * Provides editors for title, Markdown content, tags, dates/phases, and attachments (future expansion).
  * **AI Assist Actions**: Quick buttons to request card splitting or merging via MCP/AI.
* **`TimelineView` (Phase 2)**:
  * Automatically arranges cards horizontally from left (prerequisites) to right (dependents) based on topological sorting or explicit timestamps.
  * Highlights dependency violations in real time if a user manually drags a card ahead of its prerequisite.

---

## 6. Mobile (Android) UI Component Architecture (`apps/android` / `@ariadeck/android`)

### 6.1 Screen Layout Concept (Mode-Separated & Touch-Optimized)
To prevent accidental edits on small screens and improve readability, responsibilities are separated into dedicated views accessible via a bottom navigation bar.

```text
+-----------------------------------+
| [MobileHeader] Ariadeck | Sync | +|
+-----------------------------------+
|                                   |
|  [Active Mode Viewport]           |
|   1. ListModeView (Search & List) |
|   2. CardEditorView (Focused Edit)|
|   3. RelationMapView (Touch Graph)|
|   4. MobileTimelineView (Vertical)|
|                                   |
+-----------------------------------+
| [BottomNavBar]                    |
|  List  |  Card Edit  |  Relations |
+-----------------------------------+
```

### 6.2 Component Inventory
* **`MobileAppShell`**: Root mobile container handling Android hardware back-button navigation and touch viewport sizing.
* **`MobileHeader`**: Displays the current board name, quick card creation button (`+`), Google Drive (`Ariadeck/`) sync trigger, and conflict alert banner.
* **`BottomNavBar`**: Primary mode switcher tab bar.
* **`ListModeView` (List Mode)**:
  * Scrollable list of all cards in the board with a search bar (searching titles, Markdown bodies, and attachment transcripts/captions) and tag/type filters.
  * Tapping a card opens `CardEditorView`; long-pressing enables multi-select for batch deletion or merging.
* **`CardEditorView` (Card Edit Mode)**:
  * Full-screen focused editor for a single card, optimized for on-screen software keyboards.
  * Edits title, Markdown content, card type, tags, and houses future camera/image attachment and microphone recording buttons.
  * **Simple Relation Editor**: Lists "Prerequisites (Parents)" and "Dependents (Children)" with quick add/remove pickers.
* **`RelationMapView` (Relation Edit Mode — Touch-Specialized Graph)**:
  * 2D interactive map focused on structural overview and edge wiring.
  * **Touch Gesture Optimization**: Smooth two-finger pinch-to-zoom and one-finger canvas panning.
  * **Accidental-Touch Prevention**: Features an explicit toggle between **Pan/Inspect Mode** and **Connect Mode** (tap Card A, then tap Card B to create an edge) so scrolling never creates unintended links.
* **`MobileTimelineView` (Mobile Timeline Mode)**:
  * Vertical top-to-bottom sequence view tailored for portrait screens.

---

## 7. Development Roadmap

1. **Phase 1 (Graph Foundation + Shared Core + MCP)**:
   * Implement `@ariadeck/core` data models (including attachment, sync metadata, and lineage fields), DAG validation, and split/merge logic.
   * Implement `@ariadeck/mcp-server` (CLI: `ariadeck-mcp`) with REST API, SSE event stream, and MCP tools/resources.
   * Implement `@ariadeck/desktop` (`GraphCanvas` and `InspectorPanel`).
2. **Phase 2 (Timeline Auto-Sorting)**:
   * Add topological sorting and longest-path layering algorithms to `@ariadeck/core`.
   * Implement `TimelineView` in `@ariadeck/desktop`.
3. **Phase 3 (Google Drive Sync, Conflict Resolution & Markdown Export)**:
   * Implement Google Drive (`Ariadeck/`) sync adapter, lineage-based edge re-resolution, and conflict resolution UI.
   * Implement single-file Markdown export (`ariadeck-{board_slug}.md`) ordered by timeline sequence.
4. **Phase 4 (Android UI & Multimodal Input)**:
   * Implement `@ariadeck/android` (`io.github.<username>.ariadeck` via Capacitor) with mode-separated touch UI.
   * Integrate native camera/gallery image attachments and microphone voice recording with transcription support.