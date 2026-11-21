# Connecting `ariadeck-mcp` Across LLM Clients

Ariadeck's MCP server supports **Stdio** (default) and **Streamable HTTP** (`--http`) transports. Both operate on the SQLite file specified by `ARIADECK_DB_PATH` (default: `./ariadeck.db`).

## Prerequisites

Build the monorepo once before connecting external MCP clients:

```bash
pnpm install
pnpm build
```

## Transport Modes

- **Stdio (single-client local process)**:
  ```bash
  pnpm --filter @ariadeck/mcp-server start
  ```
- **Streamable HTTP + Live Desktop Bridge (shared multi-client mode)**:
  ```bash
  pnpm --filter @ariadeck/mcp-server dev
  ```
  - MCP endpoint: `http://localhost:3456/mcp`
  - REST API & SSE bridge for `@ariadeck/desktop`: `http://localhost:3456/api/*`

## Client Configuration Examples

### Antigravity / Gemini CLI (`mcp_config.json`)

This repository already places the skill at `.agents/skills/ariadeck-mcp/`, which Antigravity and Gemini CLI discover automatically.

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

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "ariadeck": {
      "command": "pnpm",
      "args": ["--dir", "<path-to-ariadeck-repo>", "--filter", "@ariadeck/mcp-server", "start"],
      "env": {
        "ARIADECK_DB_PATH": "<path-to-ariadeck.db>"
      }
    }
  }
}
```

### Claude Code (`.mcp.json` + Skill)

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

To make the skill available in Claude Code as well, copy or symlink `.agents/skills/ariadeck-mcp` to `.claude/skills/ariadeck-mcp`.

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "ariadeck": {
      "url": "http://localhost:3456/mcp"
    }
  }
}
```

*(Start the server with `pnpm dev:mcp` when using the HTTP URL transport.)*

### OpenAI Codex CLI (`config.toml`)

Codex automatically discovers skills in `.agents/skills/ariadeck-mcp/`. Register the MCP server in your Codex configuration:

```toml
[mcp_servers.ariadeck]
command = "pnpm"
args = ["--filter", "@ariadeck/mcp-server", "start"]

[mcp_servers.ariadeck.env]
ARIADECK_DB_PATH = "./ariadeck.db"
```
