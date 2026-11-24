# Ariadeck Phase 3 Design Specification
## JPEG/PNG Image Cards, Media Sync, MCP Image Tools, and Unified Export

> **Document Scope**: This specification defines incremental Phase 3 additions on top of Phase 1 and Phase 2 of **Ariadeck** (`DESIGN.md`, `DESIGN_SPEC.md`, `DESIGN_MCP.md`, `DESIGN_PHASE2.md`).  
> **Conventions**: All source code comments, TypeScript symbols, MCP tool descriptions, error messages, and Git commits (Conventional Commits) MUST be written in English.

---

## 1. Overview & Objectives

Phase 3 brings rich visual media and portable publishing to **Ariadeck**, enabling users and AI assistants to attach scene illustrations, character portraits, diagrams, and reference screenshots directly onto cards and export entire boards cleanly:

1. **JPEG & PNG Image Card Support**:
   - Attach one or more `image/jpeg` or `image/png` files to any card on both `flow` and `flat` boards.
   - Flexible card rendering modes (`standard`, `image_cover`, `image_only`) tailored for storyboards, character charts, and visual brainstorming.
   - Content-addressed local storage (SHA-256) with automatic lightweight thumbnail generation to maintain smooth 60fps canvas pan/zoom.
2. **Asynchronous Google Drive Media Sync**:
   - Decoupled binary synchronization under `Ariadeck/media/{sha256}.{ext}` with aspect-ratio-preserving placeholders, viewport-prioritized downloads, and safe reference-counted garbage collection.
3. **MCP Image Integration (`@ariadeck/mcp-server`)**:
   - Tools allowing AI agents (e.g., Antigravity) to attach newly generated scene art or character illustrations directly from local file paths or Base64 buffers in one atomic step.
4. **Unified Markdown & Mermaid Export**:
   - Single-document Markdown export (with optional ZIP media bundle) tailored to both `flow` boards (timeline-ordered with `jump_back` anchor links) and `flat` boards (grouped catalog + Mermaid relationship diagram).

---

## 2. Database Schema Migration (`ariadeck.db`: v2 -> v3)

Builds directly upon the `card_attachments` extension table reserved in Phase 1.

### 2.1 Migration SQL (`003_phase3_image_attachments.sql`)

```sql
BEGIN TRANSACTION;

-- 1. Extend cards table with visual display_mode
ALTER TABLE cards
  ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK (display_mode IN ('standard', 'image_cover', 'image_only'));

-- 2. Extend card_attachments table for image dimensions, hashing, thumbnails, and cover selection
ALTER TABLE card_attachments ADD COLUMN sha256 TEXT;
ALTER TABLE card_attachments ADD COLUMN width INTEGER;
ALTER TABLE card_attachments ADD COLUMN height INTEGER;
ALTER TABLE card_attachments ADD COLUMN thumbnail_uri TEXT;
ALTER TABLE card_attachments ADD COLUMN is_cover INTEGER NOT NULL DEFAULT 0;
ALTER TABLE card_attachments ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Index for fast card rendering and deduplication/GC reference counting
CREATE INDEX idx_card_attachments_card_active
  ON card_attachments (card_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_card_attachments_sha256
  ON card_attachments (sha256);

COMMIT;
```

---

## 3. Media Asset Management & Storage Architecture (`@ariadeck/core`)

### 3.1 Supported Formats & Constraints

- **Allowed MIME Types**: `image/jpeg` (`.jpg`), `image/png` (`.png`).
- **Magic-Byte Verification**: `@ariadeck/core` MUST inspect file headers (`FF D8 FF` for JPEG, `89 50 4E 47 0D 0A 1A 0A` for PNG) rather than relying solely on file extensions.
- **Size Limit**: Configurable via `ARIADECK_MAX_IMAGE_BYTES` (default: `15 * 1024 * 1024` = 15 MB per image).
- **Thumbnail Specification**:
  - Max dimension: `480px` on the longest edge (aspect ratio preserved, no upscaling).
  - Format: WebP (preferred) or JPEG quality `80`.
  - **Local Cache Only**: Thumbnails are generated locally per device and NEVER uploaded to Google Drive.

### 3.2 Content-Addressed Storage (CAS) Layout

Using SHA-256 content hashes eliminates duplicate uploads, prevents filename collisions, and guarantees immutability across devices:

- **Local Storage Root** (`ARIADECK_MEDIA_DIR` or platform app data directory):
  - Originals: `media/originals/{sha256}.{ext}`
  - Thumbnails: `media/thumbs/{sha256}.webp` (fallback `.jpg`)
- **Google Drive Sync Root**:
  - Originals: `Ariadeck/media/{sha256}.{ext}`

### 3.3 `MediaStorageAdapter` Interface (`@ariadeck/core`)

Platform packages (`@ariadeck/desktop`, `@ariadeck/android`, `@ariadeck/mcp-server`) inject concrete implementations:

```ts
export type CardDisplayMode = 'standard' | 'image_cover' | 'image_only';

export type SupportedImageMimeType = 'image/jpeg' | 'image/png';

export type AttachmentSyncStatus =
  | 'local_only'
  | 'uploading'
  | 'synced'
  | 'downloading'
  | 'missing_remote';

export interface CardAttachment {
  id: string;
  card_id: string;
  board_id: string;
  kind: 'image' | 'audio';
  mime_type: string;
  file_size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  local_uri: string;
  thumbnail_uri: string | null;
  caption: string | null;
  transcript: string | null;
  is_cover: boolean;
  sort_order: number;
  sync_status: AttachmentSyncStatus;
  created_at: string;
  updated_at: string;
  updated_by_device_id: string;
  version: number;
  deleted_at: string | null;
}

export interface MediaStorageAdapter {
  writeOriginal(sha256: string, ext: 'jpg' | 'png', bytes: Uint8Array): Promise<string>;
  readOriginal(localUri: string): Promise<Uint8Array | null>;
  existsOriginal(sha256: string, ext: 'jpg' | 'png'): Promise<boolean>;
  deleteOriginal(localUri: string): Promise<void>;
  generateThumbnail(
    originalBytes: Uint8Array,
    mimeType: SupportedImageMimeType,
    sha256: string,
    maxEdgePx?: number
  ): Promise<{ thumbnailUri: string; width: number; height: number }>;
  resolveRenderUrl(localUri: string): Promise<string>; // file://, blob:, or capacitor:// URL
}
```

### 3.4 Core Media Service Operations

Implemented in `packages/core/src/services/mediaService.ts`:

1. `attachImageToCard(params)`:
   - Validates MIME type via magic bytes and enforces `ARIADECK_MAX_IMAGE_BYTES`.
   - Computes `sha256` digest.
   - Writes original only if not already present in CAS (`existsOriginal`).
   - Extracts natural `width` / `height` and generates local thumbnail.
   - Inserts `card_attachments` row inside a transaction; if `setAsCover` is `true` (or if it is the card's first image), clears `is_cover` on sibling attachments and optionally updates `cards.display_mode` (e.g., to `'image_cover'`).
   - Enqueues attachment metadata + blob upload task in `sync_outbox`.
2. `createImageCard(params)`:
   - Atomically creates a new card at `(pos_x, pos_y)` and calls `attachImageToCard` with `setAsCover = true` and default `display_mode = 'image_cover'`.
3. `setCoverImage(cardId, attachmentId)`:
   - Marks a specific image attachment as the card's cover image.
4. `removeAttachment(attachmentId)`:
   - Sets `deleted_at` (soft delete) and clears `display_mode` back to `'standard'` if no active image attachments remain.

---

## 4. Google Drive Media Synchronization & Garbage Collection

### 4.1 Sync State Machine

Metadata (SQLite records exported to `Ariadeck/boards/`) and binary assets (`Ariadeck/media/`) synchronize independently so board editing remains instantaneous even over slow mobile connections:

1. **Upload Flow**:
   - New attachment starts as `sync_status = 'local_only'`.
   - Background sync worker transitions state to `'uploading'`, checks if `Ariadeck/media/{sha256}.{ext}` already exists on Drive (deduplication), uploads if missing, and transitions to `'synced'`.
2. **Download Flow (Lazy / On-Demand)**:
   - When Device B pulls board metadata referencing a `sha256` not yet on disk, Device B stores the row with `sync_status = 'missing_remote'`.
   - UI immediately renders an aspect-ratio-locked placeholder using `width / height` to prevent canvas layout shift.
   - When the card enters the viewport (or is opened in Inspector/Lightbox), the media loader requests download (`'downloading'` -> `'synced'`), saves to CAS, and generates the local thumbnail.
   - If the remote file has not yet finished uploading from Device A, Device B displays a subtle *"Waiting for media sync"* state with a manual retry button.

### 4.2 Safe Reference-Counted Garbage Collection (GC)

Physical deletion of media binaries is deferred to prevent race conditions during offline sync:

- A scheduled maintenance routine (`runMediaGarbageCollection(retentionDays = 30)`) queries `sha256` values where:
  1. `COUNT(*) WHERE deleted_at IS NULL` equals `0`, AND
  2. `MAX(deleted_at) < NOW() - retentionDays`.
- Only qualifying hashes are permanently deleted from local `media/originals/`, `media/thumbs/`, and Google Drive `Ariadeck/media/`.

---

## 5. UI/UX & Component Specifications (`@ariadeck/desktop` & `@ariadeck/android`)

### 5.1 Image-Enabled Card Node (`IdeaCardNode.tsx`)

Canvas nodes render thumbnails (`thumbnail_uri`) to keep GPU/memory usage low when hundreds of cards are visible:

- **`standard`**: Standard text-first card. If images are attached, displays a compact media count badge (e.g., `🖼 2`) and small strip preview.
- **`image_cover`**: Displays the cover image across the top edge of the card (constrained aspect ratio with `object-cover`), followed by card title, tags, and excerpt below.
- **`image_only`**: Displays the cover image full-bleed across the card frame with a translucent bottom/hover title overlay—ideal for character portraits on `flat` relationship boards or storyboard frames on `flow` boards.

### 5.2 Desktop Image Workflows (`@ariadeck/desktop`)

- **Canvas Drag & Drop**:
  - Dropping `.jpg` / `.png` file(s) onto empty canvas space automatically creates new `image_cover` card(s) positioned at the drop coordinates (staggered neatly when multiple files are dropped).
  - Dropping an image directly onto an existing card attaches it to that card.
- **Clipboard Paste (`Ctrl/Cmd + V`)**:
  - If an image is in the clipboard and a card is selected, attaches the image to the selected card.
  - If no card is selected, creates a new image card at the viewport center.
- **Inspector & Lightbox (`InspectorPanel.tsx`, `ImageLightboxModal.tsx`)**:
  - Inspector displays an attachment gallery with drag-reorder (`sort_order`), **"Set as Cover"** toggle, `display_mode` selector, caption editor, and delete button.
  - Clicking an image opens `ImageLightboxModal.tsx` loading the full-resolution original (`local_uri`) with zoom and caption display.

### 5.3 Android Mobile Workflows (`@ariadeck/android` + Capacitor)

- **Plugins**: `@capacitor/camera` (Photo Library & Camera capture) and `@capacitor/filesystem`.
- **Entry Points**:
  - Quick-Capture Floating Action Button (FAB): *"New Image Card"* (Camera / Gallery).
  - Card Edit Mode: *"Add Image"* toolbar action with gallery multi-select support.
- **Mobile Bandwidth Guard**: Optional setting *"Sync original images on Wi-Fi only"* (`ARIADECK_MOBILE_WIFI_ONLY_MEDIA`, default `false`).

---

## 6. MCP Specification Delta (`@ariadeck/mcp-server`)

### 6.1 Updated Resource: `ariadeck://board/{board_id}/graph`

To keep LLM context windows compact, the graph resource includes **metadata only** for attachments and MUST NEVER inline Base64 image data:

```json
{
  "id": "crd_hero",
  "title": "Elena (Protagonist)",
  "display_mode": "image_only",
  "attachments": [
    {
      "id": "att_01",
      "kind": "image",
      "mime_type": "image/png",
      "width": 1024,
      "height": 1024,
      "caption": "Character portrait in winter cloak",
      "is_cover": true,
      "sync_status": "synced"
    }
  ]
}
```

### 6.2 New MCP Tools

#### 1. `attach_image_to_card`
- **Description**: *"Attach a JPEG or PNG image to an existing Ariadeck card from a local file path or Base64 string, automatically computing its content hash and generating a canvas thumbnail."*
- **Input Schema**:
  ```json
  {
    "type": "object",
    "required": ["card_id", "source"],
    "properties": {
      "card_id": { "type": "string" },
      "source": {
        "oneOf": [
          {
            "type": "object",
            "required": ["type", "path"],
            "properties": {
              "type": { "const": "file_path" },
              "path": { "type": "string", "description": "Absolute or allowed workspace path to a .jpg or .png file." }
            }
          },
          {
            "type": "object",
            "required": ["type", "data", "mime_type"],
            "properties": {
              "type": { "const": "base64" },
              "data": { "type": "string", "description": "Raw Base64-encoded image payload without data URI prefix." },
              "mime_type": { "enum": ["image/jpeg", "image/png"] }
            }
          }
        ]
      },
      "caption": { "type": "string" },
      "set_as_cover": { "type": "boolean", "default": true },
      "display_mode": { "enum": ["standard", "image_cover", "image_only"] }
    }
  }
  ```
- **Security Note**: When `source.type === 'file_path'`, `ariadeck-mcp` MUST validate the resolved path against `ARIADECK_ALLOWED_MEDIA_DIRS` (if configured) and verify image magic bytes before reading into CAS.

#### 2. `create_image_card`
- **Description**: *"Create a new Ariadeck card and attach a JPEG or PNG image in a single atomic operation. Ideal for placing AI-generated scene art or character illustrations directly onto a board."*
- **Parameters**: `board_id`, `title`, `source` (same union as `attach_image_to_card`), `content?`, `caption?`, `card_type?`, `display_mode?` (default `'image_cover'`), `pos_x?`, `pos_y?`.

#### 3. `remove_card_attachment`
- **Description**: *"Soft-delete an image attachment from an Ariadeck card."*
- **Parameters**: `attachment_id`.

#### 4. `export_board_markdown`
- **Description**: *"Export an Ariadeck board (flow or flat) into a single structured Markdown document, including Mermaid diagrams, jump-back anchor links, and relative image paths."*
- **Parameters**: `board_id`, `include_mermaid?: boolean` (default `true`), `media_base_path?: string` (default `'./media'`).

---

## 7. Unified Markdown & Mermaid Export (`@ariadeck/core`)

Implemented in `packages/core/src/export/markdownExporter.ts`. Default filename convention: `ariadeck-{board_slug}.md` (or `ariadeck-{board_slug}.zip` when exporting a self-contained bundle with `media/` files).

### 7.1 Common YAML Frontmatter

```yaml
---
generator: Ariadeck
board_id: brd_01
board_type: flow
title: "Act 1 Storyboard"
exported_at: "2026-11-24T14:00:00.000Z"
---
```

### 7.2 Flow Board Export Format

1. **Optional Mermaid Flowchart Overview** (`flowchart LR` showing temporal edges `-->` and `jump_back` edges `-. label .->`).
2. **Chronological Sections**:
   - Cards ordered by `computeTimeline(boardId)` (`effective_order`, grouped under `## Step N` headings when multiple cards share a rank, or sequential `## N. Card Title`).
   - Cover and gallery images rendered as standard Markdown:
     ```markdown
     ![Character portrait in winter cloak](./media/a1b2c3...9f.png)
     ```
   - Card Markdown body (`content`).
   - Outgoing `jump_back` edges appended as structured callout anchor links:
     ```markdown
     > ↩ **Jump back to:** [Hero enters the vault](#card-crd_01) — *Trap triggers reset*
     ```

### 7.3 Flat Board Export Format

Because `flat` boards have no linear timeline:

1. **Mermaid Relationship Diagram**:
   - Emits a `graph LR` block mapping edge directions cleanly:
     - `directed`: `A -->|label| B`
     - `bidirectional`: `A <-->|label| B`
     - `undirected`: `A ---|label| B`
2. **Card Catalog**:
   - Grouped by primary tag (or `Uncategorized`), then sorted alphabetically by `title`.
   - Includes attached images, captions, Markdown body, and an inline list of related cards with their edge labels.

---

## 8. Antigravity Implementation Checklist & Verification Plan

### Step-by-Step Implementation Order
1. **Step 1 — Schema & Migrations (`@ariadeck/core`)**: Implement SQLite migration `v2 -> v3` (`cards.display_mode`, extended `card_attachments` columns and indexes).
2. **Step 2 — CAS Media Storage & Service (`@ariadeck/core`)**: Implement magic-byte validation, SHA-256 hashing, `MediaStorageAdapter` interface, Node/Desktop adapter (using `sharp` or canvas-based thumbnailer), and `attachImageToCard` / `createImageCard` / `runMediaGarbageCollection`.
3. **Step 3 — Unified Markdown & Mermaid Exporter (`@ariadeck/core`)**: Implement `exportBoardToMarkdown()` for both `flow` and `flat` boards plus ZIP bundle packaging helper.
4. **Step 4 — MCP Image & Export Tools (`@ariadeck/mcp-server`)**: Add `attach_image_to_card`, `create_image_card`, `remove_card_attachment`, `export_board_markdown`, and update `ariadeck://board/{board_id}/graph` with attachment metadata.
5. **Step 5 — Desktop Image UX & Export UI (`@ariadeck/desktop`)**: Update `IdeaCardNode.tsx` for `standard` / `image_cover` / `image_only`, add drag-and-drop, clipboard paste, `ImageLightboxModal.tsx`, and Export Markdown / ZIP dialog.
6. **Step 6 — Android Media Capture & Drive Sync (`@ariadeck/android` & `@ariadeck/core`)**: Wire `@capacitor/camera` + `@capacitor/filesystem`, implement `Ariadeck/media/` Drive sync worker, lazy viewport downloads, and aspect-ratio placeholders.

### Core Test Matrix
- Reject non-JPEG/PNG payloads (e.g., renamed `.txt` or `.svg` file) via magic-byte check.
- Verify identical image attached to 2 cards stores only 1 physical file under `media/originals/{sha256}.{ext}` and survives soft-deleting 1 of the 2 attachments during GC.
- Verify `attach_image_to_card` via MCP works for both `file_path` and `base64` inputs and updates `cards.display_mode`.
- Verify Flow export preserves topological order, renders `jump_back` anchor links, and emits valid Mermaid syntax for both `flow` and `flat` boards.

### Commit Convention Examples
- `feat(core): add content-addressed JPEG/PNG image attachment storage`
- `feat(core): implement unified Markdown and Mermaid board exporter`
- `feat(mcp): add attach_image_to_card and create_image_card tools`
- `feat(desktop): support image card modes, drag-and-drop, and lightbox`
- `feat(android): integrate Capacitor camera capture and lazy media sync`