#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  BoardGraphService,
  BoardSyncEngine,
  GoogleDriveSyncAdapter,
} from '@ariadeck/core';
import { SqliteStorageAdapter } from '@ariadeck/core/sqlite';
import { generateSecureAuthToken, SessionAuthManager } from './auth.js';
import { createHttpApp } from './httpServer.js';
import { createAriadeckMcpServer, MCP_DEVICE_ID } from './mcpServer.js';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const httpMode = args.has('--http') || process.env.ARIADECK_HTTP === 'true';
  const allowRemote =
    args.has('--allow-remote') || process.env.ARIADECK_ALLOW_REMOTE === 'true';

  const dbPath = process.env.ARIADECK_DB_PATH ?? './ariadeck.db';
  const port = Number(process.env.ARIADECK_PORT ?? '3456');

  // Bind strictly to loopback by default; require --allow-remote for non-loopback access.
  const host = allowRemote
    ? (process.env.ARIADECK_HOST ?? '0.0.0.0')
    : '127.0.0.1';

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.initialize();

  const service = new BoardGraphService(storage, { deviceId: MCP_DEVICE_ID });

  if (httpMode) {
    const gdriveToken = process.env.ARIADECK_GDRIVE_ACCESS_TOKEN;
    const syncEngine = gdriveToken
      ? new BoardSyncEngine(
          storage,
          new GoogleDriveSyncAdapter({ getAccessToken: async () => gdriveToken }),
          { deviceId: MCP_DEVICE_ID, eventBus: service.eventBus }
        )
      : undefined;

    let authToken: string | null = process.env.ARIADECK_AUTH_TOKEN?.trim() || null;
    let generatedToken = false;
    if (allowRemote && !authToken) {
      authToken = generateSecureAuthToken();
      generatedToken = true;
    }

    const authManager = new SessionAuthManager(authToken);
    const allowedOrigins = (process.env.ARIADECK_CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const app = createHttpApp(service, {
      syncEngine,
      authManager,
      allowedOrigins,
    });

    // Expose stateless Streamable HTTP MCP transport protected by the same auth middleware
    app.post('/mcp', authManager.middleware(), async (req, res) => {
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

    const server = app.listen(port, host, () => {
      console.error(
        `[ariadeck-mcp] HTTP/SSE bridge and MCP endpoint listening on http://${host}:${port} (db: ${dbPath})`
      );
      if (allowRemote) {
        console.error(
          `[ariadeck-mcp] Remote access ENABLED (--allow-remote). Token authentication is enforced.`
        );
      } else {
        console.error(
          `[ariadeck-mcp] Local-only mode (127.0.0.1). Pass --allow-remote to allow LAN access.`
        );
      }
      if (generatedToken && authToken) {
        console.error(
          `[ariadeck-mcp] Generated one-time session access token (set ARIADECK_AUTH_TOKEN to persist):\n  ${authToken}`
        );
      }
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
