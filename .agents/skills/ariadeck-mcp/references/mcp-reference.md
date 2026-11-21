# Ariadeck MCP Reference

Server metadata: `name: "ariadeck-mcp"`, `version: "0.1.0"`.
All MCP mutations automatically stamp `updatedByDeviceId = "ariadeck-mcp-server"` and broadcast real-time updates to connected Desktop UIs over `/api/events`.

## Resources (Read-Only)

| URI | MIME Type | Purpose |
| :--- | :--- | :--- |
| `ariadeck://board/list` | `application/json` | Active boards (`id`, `title`, `description`, `updatedAt`). |
| `ariadeck://board/{board_id}/graph` | `application/json` | Full board snapshot: `board`, `cards`, `edges`, and `attachments` (including `transcript`). |
| `ariadeck://board/{board_id}/summary` | `text/markdown` | Token-efficient Markdown summary of dependency edges, orphan cards, and conflicted edges. |

## Tools

### `create_card`
Create a new card on an Ariadeck board.
- `boardId` (string, required)
- `title` (string, required)
- `content` (string, optional): GFM Markdown body
- `cardType` (`"task" | "idea" | "plot_event" | "note"`, optional, default `"idea"`)
- `tags` (`string[]`, optional)

### `update_card`
Update properties of an existing card.
- `cardId` (string, required)
- `title` (string, optional)
- `content` (string, optional)
- `status` (`"todo" | "in_progress" | "done" | "archived"`, optional)
- `tags` (`string[]`, optional)

### `delete_card`
Soft-delete a card and cascade soft-deletion to its incident edges and attachments.
- `cardId` (string, required)

### `connect_cards`
Create a directed edge `sourceCardId -> targetCardId`.
- `boardId` (string, required)
- `sourceCardId` (string, required): Prerequisite / cause card ID
- `targetCardId` (string, required): Dependent / effect card ID
- `relationType` (`"blocks" | "causes" | "relates_to"`, optional, default `"blocks"`)

### `disconnect_cards`
Soft-delete a dependency edge.
- `edgeId` (string, required)

### `split_card`
Atomically split one card into 2+ child cards, re-routing edges and recording lineage.
- `targetCardId` (string, required)
- `subCards` (array, min 2, required): `[{ title, content, cardType? }]`
- `linkMode` (`"sequential" | "parallel"`, optional, default `"sequential"`)

### `merge_cards`
Atomically merge 2+ cards on the same board into one consolidated card, deduplicating external edges.
- `targetCardIds` (`string[]`, min 2, required)
- `mergedTitle` (string, required)
- `mergedContent` (string, required)
- `cardType` (`"task" | "idea" | "plot_event" | "note"`, optional)

### `insert_intermediate_card`
Replace an existing edge `sourceCardId -> targetCardId` with `sourceCardId -> newCard -> targetCardId`.
- `sourceCardId` (string, required)
- `targetCardId` (string, required)
- `title` (string, required)
- `content` (string, optional)

### `compute_timeline_layout`
Run Kahn's topological sort with longest-path layering and persist `timelineOrder` on every active card.
- `boardId` (string, required)

## Prompts

- `analyze_and_split_complex_cards(board_id)`
- `find_and_merge_duplicates(board_id)`
- `check_plot_or_task_gaps(board_id)`

## Domain Error Codes

| Code | Meaning & Recovery |
| :--- | :--- |
| `CYCLIC_DEPENDENCY` | Edge or merge would introduce a cycle among `blocks`/`causes` edges. Re-check direction, use `relates_to`, or remove a conflicting edge first. |
| `NOT_FOUND` | Referenced board, card, or edge does not exist or was soft-deleted. Re-read `ariadeck://board/{board_id}/graph` to refresh IDs. |
| `VALIDATION_ERROR` | Missing required field, empty title, fewer than 2 cards for split/merge, or cross-board merge attempt. Fix arguments and retry. |
