#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { BoardGraphService } from '@ariadeck/core';
import { SqliteStorageAdapter } from '@ariadeck/core/sqlite';
import { createHttpApp } from './httpServer.js';
import { createAriadeckMcpServer, MCP_DEVICE_ID } from './mcpServer.js';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const httpMode = args.has('--http') || process.env.ARIADECK_HTTP === 'true';
  const dbPath = process.env.ARIADECK_DB_PATH ?? './ariadeck.db';
  const port = Number(process.env.ARIADECK_PORT ?? '3456');

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.initialize();

  const service = new BoardGraphService(storage, { deviceId: MCP_DEVICE_ID });

  if (httpMode) {
    const app = createHttpApp(service);

    // Expose stateless Streamable HTTP MCP transport alongside the REST + SSE bridge
    app.post('/mcp', async (req, res) => {
      const mcpServer = createAriadeckMcpServer(service);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on('close', () => {
        void transport.close();
        void mcpServer.close();
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    const server = app.listen(port, () => {
      console.error(
        `[ariadeck-mcp] HTTP/SSE bridge and MCP endpoint listening on http://localhost:${port} (db: ${dbPath})`
      );
    });

    const shutdown = async () => {
      server.close();
      await storage.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  } else {
    const mcpServer = createAriadeckMcpServer(service);
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error(`[ariadeck-mcp] Stdio MCP server running (db: ${dbPath})`);

    const shutdown = async () => {
      await mcpServer.close();
      await storage.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  }
}

void main().catch((error) => {
  console.error('[ariadeck-mcp] Fatal startup error:', error);
  process.exit(1);
});
