# Ariadeck Board JSON Format Specification (`BOARD_JSON_FORMAT.md`)

This document specifies the versioned JSON exchange format (`ariadeck-board`, `schemaVersion: 1`) used by **Ariadeck** for lossless board backup, sharing, and validated import across `@ariadeck/core`, `@ariadeck/mcp-server`, `@ariadeck/desktop`, and `@ariadeck/android`.

> **Note**: For human-readable publishing, Ariadeck also supports single-file Markdown export (`ariadeck-{board_slug}.md`). Use the JSON format (`ariadeck-{board_slug}.json`) whenever lossless round-trip import is required.

---

## 1. File Naming & Encoding

- **Default Filename**: `ariadeck-{board_slug}.json` (e.g., `ariadeck-story-plot.json`, falling back to `ariadeck-board.json` if the title produces an empty slug).
- **Character Encoding**: UTF-8 JSON (`application/json`).

---

## 2. Top-Level Envelope

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `format` | `string` | Yes | Must be exactly `"ariadeck-board"`. |
| `schemaVersion` | `number` | Yes | Schema version integer. Currently `1`. |
| `exportedAt` | `string` | No | ISO 8601 timestamp indicating when the file was exported. |
| `board` | `object` | Yes | Board metadata (`title`, optional `description`). |
| `cards` | `Card[]` | Yes | Array of card definitions. |
| `edges` | `Edge[]` | No | Array of directed dependency edges (defaults to `[]`). |
| `attachments` | `Attachment[]` | No | Array of attachment metadata records (defaults to `[]`). |

---

## 3. Object Schemas

### 3.1 `board`

| Field | Type | Required | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `title` | `string` | Yes | — | Non-empty board title. |
| `description` | `string` | No | `""` | Optional board description. |

### 3.2 `cards[]`

| Field | Type | Required | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `string` | Yes | — | Unique non-empty local identifier referenced by `edges` and `attachments`. |
| `title` | `string` | Yes | — | Non-empty card title. |
| `content` | `string` | No | `""` | GitHub Flavored Markdown (GFM) body text. |
| `cardType` | `enum` | No | `"idea"` | One of `"task"`, `"idea"`, `"plot_event"`, `"note"`. |
| `status` | `enum` | No | `"todo"` | One of `"todo"`, `"in_progress"`, `"done"`, `"archived"`. |
| `tags` | `string[]` | No | `[]` | Array of tag strings. |
| `posX` | `number` | No | grid fallback | Finite horizontal canvas coordinate. |
| `posY` | `number` | No | grid fallback | Finite vertical canvas coordinate. |
| `timelineOrder` | `integer \| null` | No | `null` | Non-negative topological/manual step index, or `null`. |
| `startAt` | `string \| null` | No | `null` | Optional ISO 8601 start timestamp or date string. |
| `endAt` | `string \| null` | No | `null` | Optional ISO 8601 end timestamp or date string. |

### 3.3 `edges[]`

| Field | Type | Required | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `sourceCardId` | `string` | Yes | — | Prerequisite / cause card `id` (must exist in `cards`). |
| `targetCardId` | `string` | Yes | — | Dependent / effect card `id` (must exist in `cards`, must differ from `sourceCardId`). |
| `relationType` | `enum` | No | `"blocks"` | One of `"blocks"`, `"causes"`, `"relates_to"`. |
| `label` | `string` | No | _(omitted)_ | Optional edge annotation label. |

### 3.4 `attachments[]`

| Field | Type | Required | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `cardId` | `string` | Yes | — | Owner card `id` (must exist in `cards`). |
| `kind` | `enum` | Yes | — | One of `"image"`, `"audio"`. |
| `localUri` | `string` | Yes | — | Relative media URI or data URI. |
| `mimeType` | `string` | Yes | — | MIME type (e.g. `"image/webp"`, `"audio/mp4"`). |
| `fileSize` | `number` | No | `0` | Non-negative file size in bytes. |
| `durationMs` | `number \| null` | No | `null` | Audio duration in milliseconds (`null` for images). |
| `transcript` | `string \| null` | No | `null` | Searchable voice transcript or image OCR/caption. |

---

## 4. Import Validation Rules & Semantics

Every import passes through `parseAndValidateBoardJson` in `@ariadeck/core` before any database write occurs:

1. **Syntax & Envelope**: Must be valid JSON with `format === "ariadeck-board"` and `schemaVersion === 1`.
2. **Field-Level Type & Enum Checks**: All malformed fields are collected and returned in a single `ValidationError` (`HTTP 400`) identifying exact paths (e.g., `cards[2].title`, `edges[0].targetCardId`).
3. **Referential Integrity**:
   - All `cards[].id` values must be unique within the file.
   - Every `edges[].sourceCardId`, `edges[].targetCardId`, and `attachments[].cardId` must match a card `id` in `cards`.
   - Self-loops (`sourceCardId === targetCardId`) are rejected.
   - Identical `(sourceCardId, targetCardId, relationType)` edge triples are deduplicated automatically.
4. **DAG Acyclicity**: A Depth-First Search (DFS) runs across all `blocks` and `causes` edges. If any cycle is found, import is aborted with `CyclicDependencyError` (`HTTP 409`) without persisting partial data.
5. **Transactional UUID Remapping**:
   - On successful validation, `BoardGraphService.importBoardFromJson` generates fresh UUID v4 identifiers for the new board, every card, every edge, and every attachment inside a single SQLite transaction.
   - Importing the same JSON file multiple times (or sharing board templates) therefore never collides with existing boards.

---

## 5. Complete Example

```json
{
  "format": "ariadeck-board",
  "schemaVersion": 1,
  "exportedAt": "2026-11-21T14:00:00.000Z",
  "board": {
    "title": "Sample Story Plot",
    "description": "Minimal 3-card causal sequence with a thematic link."
  },
  "cards": [
    {
      "id": "beat-1",
      "title": "Inciting Incident",
      "content": "## Scene 1\nThe protagonist discovers an old map.",
      "cardType": "plot_event",
      "status": "done",
      "tags": ["act1"],
      "posX": 80,
      "posY": 80,
      "timelineOrder": 0,
      "startAt": null,
      "endAt": null
    },
    {
      "id": "beat-2",
      "title": "Crossing the Threshold",
      "content": "Sets sail for the uncharted island.",
      "cardType": "plot_event",
      "status": "in_progress",
      "tags": ["act2"],
      "posX": 420,
      "posY": -40,
      "timelineOrder": 1,
      "startAt": null,
      "endAt": null
    },
    {
      "id": "beat-3",
      "title": "Resolution",
      "content": "Returns home with the recovered artifact.",
      "cardType": "plot_event",
      "status": "todo",
      "tags": ["act3"],
      "posX": 760,
      "posY": 80,
      "timelineOrder": 2,
      "startAt": null,
      "endAt": null
    }
  ],
  "edges": [
    {
      "sourceCardId": "beat-1",
      "targetCardId": "beat-2",
      "relationType": "causes"
    },
    {
      "sourceCardId": "beat-2",
      "targetCardId": "beat-3",
      "relationType": "causes"
    },
    {
      "sourceCardId": "beat-1",
      "targetCardId": "beat-3",
      "relationType": "relates_to",
      "label": "foreshadowing"
    }
  ],
  "attachments": []
}
```
