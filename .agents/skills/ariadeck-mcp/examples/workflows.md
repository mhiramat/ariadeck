# Ariadeck MCP Workflow Examples

## 1. Sequential Split of a Coarse Task

When a single card `"Build Auth System"` combines sequential engineering phases:

```json
{
  "tool": "split_card",
  "arguments": {
    "targetCardId": "<card-id>",
    "linkMode": "sequential",
    "subCards": [
      {
        "title": "Design Auth Schema",
        "content": "- Define users and sessions tables\n- Document token expiry policy",
        "cardType": "task"
      },
      {
        "title": "Implement Login & Refresh Endpoints",
        "content": "- Add password hashing\n- Issue signed session tokens",
        "cardType": "task"
      },
      {
        "title": "Add Auth Integration Tests",
        "content": "- Verify login, logout, and expired token rejection",
        "cardType": "task"
      }
    ]
  }
}
```

## 2. Parallel Split for Independent Tracks

When a release milestone splits into independent frontend and backend tracks:

```json
{
  "tool": "split_card",
  "arguments": {
    "targetCardId": "<card-id>",
    "linkMode": "parallel",
    "subCards": [
      {
        "title": "Implement Desktop Graph UI",
        "content": "Build interactive node canvas and inspector panel.",
        "cardType": "task"
      },
      {
        "title": "Implement MCP Backend Tools",
        "content": "Expose graph mutation tools and SSE event bridge.",
        "cardType": "task"
      }
    ]
  }
}
```

## 3. Merging Duplicate Cards

```json
{
  "tool": "merge_cards",
  "arguments": {
    "targetCardIds": ["<card-a-id>", "<card-b-id>"],
    "mergedTitle": "Finalize API Specification",
    "mergedContent": "Consolidated requirements from both draft cards:\n\n- REST endpoints\n- SSE event schema",
    "cardType": "task"
  }
}
```

## 4. Inserting a Missing Intermediate Step

```json
{
  "tool": "insert_intermediate_card",
  "arguments": {
    "sourceCardId": "<upstream-card-id>",
    "targetCardId": "<downstream-card-id>",
    "title": "Security & QA Review",
    "content": "Verify access controls and regression tests before release."
  }
}
```

## 5. Computing Topological Timeline Layout

```json
{
  "tool": "compute_timeline_layout",
  "arguments": {
    "boardId": "<board-id>"
  }
}
```
