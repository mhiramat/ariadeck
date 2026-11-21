---
name: ariadeck-mcp
description: >-
  Interact with Ariadeck task, idea, and story-plot boards through the
  ariadeck-mcp Model Context Protocol (MCP) server. Use this skill whenever the
  user asks to inspect, organize, split, merge, connect, gap-check, or
  timeline-sort cards on an Ariadeck board.
---

# Ariadeck MCP Agent Skill

Use this skill to safely inspect and refactor **Ariadeck** dependency graphs (DAGs) and timelines via the `ariadeck-mcp` MCP server.

## 1. Core Principles

1. **Inspect Before Mutating**:
   - Start by reading `ariadeck://board/list` to identify the target `board_id`.
   - Read `ariadeck://board/{board_id}/summary` for a token-efficient overview of dependency chains, orphan cards, and conflicts.
   - Read `ariadeck://board/{board_id}/graph` when you need full card Markdown bodies, coordinates, tags, or attachment transcripts.
2. **Prefer Atomic Structural Tools**:
   - Always use `split_card`, `merge_cards`, and `insert_intermediate_card` instead of manually deleting and recreating cards.
   - Atomic tools preserve upstream/downstream edges and record lineage (`splitFromCardId`, `mergedFromCardIds`, `replacedByCardIds`) for conflict-free sync.
3. **Preserve DAG Invariants**:
   - `blocks` and `causes` edges must remain acyclic. Connecting `sourceCardId -> targetCardId` when a path already exists from `targetCardId` to `sourceCardId` fails with `CYCLIC_DEPENDENCY`.
   - Use `relates_to` for non-blocking thematic associations that do not enforce execution order.
4. **Write Clean Markdown Card Content**:
   - Ariadeck renders card bodies as GitHub Flavored Markdown (GFM). Use concise headings, bullet lists, `- [ ]` checklists, and inline code where helpful.

## 2. Standard Workflows

### A. Decompose an Oversized Card (`split_card`)
1. Identify a card combining multiple distinct tasks or story beats from `ariadeck://board/{board_id}/graph`.
2. Choose `linkMode`:
   - `sequential`: Use when child cards must happen in order (`sub[0] -> sub[1] -> ...`). Incoming edges attach to `sub[0]`; outgoing edges attach to `sub[last]`.
   - `parallel`: Use when child cards are independent tracks. Incoming and outgoing edges replicate to all child cards.
3. Call `split_card` with at least 2 `subCards`.

### B. Consolidate Redundant Cards (`merge_cards`)
1. Identify 2 or more semantically overlapping cards on the same board.
2. Combine their details into `mergedTitle` and `mergedContent` so no notes are lost.
3. Call `merge_cards` with `targetCardIds`. External incoming/outgoing edges are automatically re-wired and deduplicated.
4. If `merge_cards` returns `CYCLIC_DEPENDENCY`, explain which intermediate dependency prevents merging those cards together.

### C. Bridge Missing Steps or Plot Holes (`insert_intermediate_card`)
1. Traverse dependency chains in `ariadeck://board/{board_id}/summary` from roots to terminals.
2. When an existing edge `A -> B` skips a necessary prerequisite or transition, call `insert_intermediate_card` with `sourceCardId: A` and `targetCardId: B` to produce `A -> C -> B`.

### D. Auto-Sort into a Chronological Timeline (`compute_timeline_layout`)
1. After adding or restructuring dependencies, call `compute_timeline_layout` with `boardId`.
2. Review the returned `steps` array (Step 0 = roots with no prerequisites) and confirm `violations` is empty.

## 3. Verification After Mutations

- Re-read `ariadeck://board/{board_id}/summary` after batch refactoring to confirm there are no unintended orphan cards or broken chains.
- Summarize the exact changes made (created, split, merged, or re-linked card titles and IDs) back to the user.

## 4. Reference Material

- Complete MCP resources, tool schemas, prompts, and error codes: [MCP Reference](./references/mcp-reference.md)
- Configuring `ariadeck-mcp` across LLM clients (Antigravity, Claude, Codex, Cursor, Gemini CLI): [Client Setup Guide](./references/client-setup.md)
- Concrete JSON tool-call examples: [Workflow Examples](./examples/workflows.md)
