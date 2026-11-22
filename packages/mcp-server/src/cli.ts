#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  BoardGraphService,
  BoardSyncEngine,
  GoogleDriveSyncAdapter,
} from '@ariadeck/core';
import { SqliteStorageAdapter } from '@ariadeck/core/sqlite';
import { SessionAuthManager } from './auth.js';
import { createHttpApp } from './httpServer.js';
import { createAriadeckMcpServer, MCP_DEVICE_ID } from './mcpServer.js';
import {
  ensurePrivateDirectory,
  loadOrCreateAuthTokenFile,
  resolveDbPath,
  resolveTokenFilePath,
  restrictSqliteFilePermissions,
} from './userPaths.js';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const httpMode = args.has('--http') || process.env.ARIADECK_HTTP === 'true';
  const allowRemote =
    args.has('--allow-remote') || process.env.ARIADECK_ALLOW_REMOTE === 'true';
  const noAuth = args.has('--no-auth') || process.env.ARIADECK_NO_AUTH === 'true';

  if (allowRemote && noAuth) {
    console.error(
      '[ariadeck-mcp] Refusing to start: --no-auth cannot be combined with --allow-remote.'
    );
    process.exit(1);
  }

  const customDbPath = Boolean(process.env.ARIADECK_DB_PATH?.trim());
  const dbPath = resolveDbPath();
  const port = Number(process.env.ARIADECK_PORT ?? '3456');

  // Ensure DB parent directory exists (0700 when using default XDG data dir)
  if (dbPath !== ':memory:') {
    if (customDbPath) {
      mkdirSync(dirname(dbPath), { recursive: true });
    } else {
      ensurePrivateDirectory(dirname(dbPath));
    }
  }

  // Bind strictly to loopback by default; require --allow-remote for non-loopback access.
  const host = allowRemote
    ? (process.env.ARIADECK_HOST ?? '0.0.0.0')
    : '127.0.0.1';

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.initialize();
  restrictSqliteFilePermissions(dbPath);

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

    let authToken: string | null = null;
    let tokenFileUsed: string | null = null;
    let tokenFileCreated = false;
    let tokenPermissionsRepaired = false;

    if (!noAuth) {
      const envToken = process.env.ARIADECK_AUTH_TOKEN?.trim();
      if (envToken) {
        authToken = envToken;
      } else {
        const loaded = loadOrCreateAuthTokenFile(resolveTokenFilePath());
        authToken = loaded.token;
        tokenFileUsed = loaded.tokenFilePath;
        tokenFileCreated = loaded.created;
        tokenPermissionsRepaired = loaded.repairedPermissions;
      }
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
      } else if (noAuth) {
        console.error(
          `[ariadeck-mcp] WARNING: Loopback authentication disabled (--no-auth). Any local user can connect to 127.0.0.1:${port}.`
        );
      } else {
        console.error(
          `[ariadeck-mcp] Local-only mode (127.0.0.1) with token authentication ENABLED.`
        );
      }

      if (tokenFileUsed) {
        if (tokenFileCreated) {
          console.error(
            `[ariadeck-mcp] Created user-private access token (0600): ${tokenFileUsed}`
          );
        } else {
          console.error(
            `[ariadeck-mcp] Loaded user-private access token: ${tokenFileUsed}`
          );
        }
        if (tokenPermissionsRepaired) {
          console.error(
            `[ariadeck-mcp] Tightened overly permissive permissions on ${tokenFileUsed} to 0600.`
          );
        }
      }

      if (authToken) {
        const uiPort = process.env.ARIADECK_DESKTOP_PORT ?? '5173';
        console.error(
          `[ariadeck-mcp] Open Desktop UI with one-click sign-in:\n  http://127.0.0.1:${uiPort}/#token=${authToken}`
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
