import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import {
  AriadeckError,
  BoardGraphService,
  BoardSyncEngine,
  CyclicDependencyError,
  NotFoundError,
  ValidationError,
  type ConflictResolutionAction,
  type MutationContext,
} from '@ariadeck/core';
import {
  parseCookies,
  SESSION_COOKIE_NAME,
  SessionAuthManager,
} from './auth.js';

export interface HttpAppOptions {
  syncEngine?: BoardSyncEngine;
  authToken?: string | null;
  authManager?: SessionAuthManager;
  allowedOrigins?: string[];
}

export const MCP_SERVER_NAME = 'ariadeck-mcp';
export const MCP_SERVER_VERSION = '0.1.0';

function getMutationContext(req: Request): MutationContext {
  const headerDevice = req.header('x-ariadeck-device-id');
  return {
    deviceId: headerDevice && headerDevice.trim() ? headerDevice.trim() : 'ariadeck-http-client',
  };
}

function paramId(req: Request, key = 'id'): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function sendDomainError(res: Response, error: unknown): void {
  if (error instanceof CyclicDependencyError) {
    res.status(409).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ValidationError) {
    res.status(400).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof AriadeckError) {
    res.status(400).json({ error: { code: error.code, message: error.message } });
    return;
  }
  const message = error instanceof Error ? error.message : 'Internal server error';
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
}

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch((err) => sendDomainError(res, err));
  };
}

function isAllowedOrigin(origin: string | undefined, extraOrigins: string[]): boolean {
  if (!origin) return true; // Non-browser / same-origin requests
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) {
    return true;
  }
  return extraOrigins.includes(origin);
}

/**
 * Creates the Express HTTP application exposing Ariadeck's REST API
 * and Server-Sent Events (/api/events) real-time synchronization bridge.
 */
export function createHttpApp(
  service: BoardGraphService,
  options: HttpAppOptions = {}
): Express {
  const { syncEngine } = options;
  const auth =
    options.authManager ?? new SessionAuthManager(options.authToken ?? null);
  const extraOrigins = options.allowedOrigins ?? [];

  const app = express();
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin, extraOrigins)) {
          callback(null, true);
        } else {
          callback(new Error('Origin not allowed by Ariadeck CORS policy.'));
        }
      },
      credentials: true,
    })
  );
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      authRequired: auth.isAuthRequired(),
    });
  });

  // Authentication endpoints (always accessible prior to auth middleware)
  app.get('/api/auth/status', (req, res) => {
    res.json({
      authRequired: auth.isAuthRequired(),
      authenticated: auth.isRequestAuthenticated(req),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    if (!auth.isAuthRequired()) {
      res.json({ authRequired: false, authenticated: true });
      return;
    }
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!auth.verifyToken(token)) {
      res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid access token.',
        },
      });
      return;
    }
    const sessionId = auth.createSession();
    auth.setSessionCookie(req, res, sessionId);
    res.json({ authRequired: true, authenticated: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    const cookies = parseCookies(req.header('cookie'));
    auth.revokeSession(cookies[SESSION_COOKIE_NAME]);
    auth.clearSessionCookie(res);
    res.json({ authRequired: auth.isAuthRequired(), authenticated: false });
  });

  // Protect all subsequent /api/* routes when authentication is enabled
  app.use('/api', auth.middleware());

  // SSE event stream for real-time desktop UI updates
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`);

    const unsubscribe = service.eventBus.subscribe((event) => {
      res.write(`event: graph\ndata: ${JSON.stringify(event)}\n\n`);
    });

    const keepAliveTimer = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAliveTimer);
      unsubscribe();
      res.end();
    });
  });

  // Boards
  app.get(
    '/api/boards',
    asyncHandler(async (_req, res) => {
      const boards = await service.listBoards();
      res.json({ boards });
    })
  );

  app.post(
    '/api/boards',
    asyncHandler(async (req, res) => {
      const { title, description } = req.body ?? {};
      if (typeof title !== 'string') {
        throw new ValidationError('Field "title" is required and must be a string.');
      }
      const board = await service.createBoard(
        { title, description: typeof description === 'string' ? description : '' },
        getMutationContext(req)
      );
      res.status(201).json({ board });
    })
  );

  app.post(
    '/api/boards/import',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const input = typeof body.json === 'string' ? body.json : body;
      const titleOverride =
        typeof body.titleOverride === 'string' ? body.titleOverride : undefined;
      const graph = await service.importBoardFromJson(
        input,
        { titleOverride },
        getMutationContext(req)
      );
      res.status(201).json({ graph });
    })
  );

  app.patch(
    '/api/boards/:id',
    asyncHandler(async (req, res) => {
      const { title, description } = req.body ?? {};
      const board = await service.updateBoard(
        paramId(req),
        {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
        },
        getMutationContext(req)
      );
      res.json({ board });
    })
  );

  app.delete(
    '/api/boards/:id',
    asyncHandler(async (req, res) => {
      await service.deleteBoard(paramId(req), getMutationContext(req));
      res.status(204).send();
    })
  );

  app.get(
    '/api/boards/:id/graph',
    asyncHandler(async (req, res) => {
      const graph = await service.getBoardGraph(paramId(req));
      res.json(graph);
    })
  );

  app.post(
    '/api/boards/:id/timeline/compute',
    asyncHandler(async (req, res) => {
      const result = await service.computeTimelineLayout(
        paramId(req),
        getMutationContext(req)
      );
      res.json(result);
    })
  );

  app.get(
    '/api/boards/:id/export/markdown',
    asyncHandler(async (req, res) => {
      const includeTranscripts = req.query.includeTranscripts !== 'false';
      const result = await service.exportBoardToMarkdown(paramId(req), {
        includeTranscripts,
      });
      if (req.query.raw === 'true') {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${result.filename}"`
        );
        res.send(result.markdown);
        return;
      }
      res.json(result);
    })
  );

  app.get(
    '/api/boards/:id/export/json',
    asyncHandler(async (req, res) => {
      const result = await service.exportBoardToJson(paramId(req));
      if (req.query.raw === 'true') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${result.filename}"`
        );
        res.send(result.json);
        return;
      }
      res.json(result);
    })
  );

  app.get(
    '/api/boards/:id/conflicts',
    asyncHandler(async (req, res) => {
      if (!syncEngine) {
        res.json({ conflicts: [], syncConfigured: false });
        return;
      }
      const conflicts = await syncEngine.listConflicts(paramId(req), false);
      res.json({ conflicts, syncConfigured: true });
    })
  );

  app.post(
    '/api/boards/:id/conflicts/:conflictId/resolve',
    asyncHandler(async (req, res) => {
      if (!syncEngine) {
        res.status(501).json({
          error: {
            code: 'SYNC_NOT_CONFIGURED',
            message: 'Sync engine is not configured on this server.',
          },
        });
        return;
      }
      const action = req.body as ConflictResolutionAction;
      const resolved = await syncEngine.resolveConflict(
        paramId(req, 'id'),
        paramId(req, 'conflictId'),
        action
      );
      res.json({ conflict: resolved });
    })
  );

  app.post(
    '/api/boards/:id/sync',
    asyncHandler(async (req, res) => {
      if (!syncEngine) {
        res.status(501).json({
          error: {
            code: 'SYNC_NOT_CONFIGURED',
            message:
              'Google Drive sync is not configured. Set ARIADECK_GDRIVE_ACCESS_TOKEN to enable remote sync.',
          },
        });
        return;
      }
      const result = await syncEngine.syncBoard(paramId(req));
      res.json(result);
    })
  );

  // Cards
  app.post(
    '/api/cards',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      if (typeof body.boardId !== 'string' || typeof body.title !== 'string') {
        throw new ValidationError('Fields "boardId" and "title" are required strings.');
      }
      const card = await service.createCard(
        {
          boardId: body.boardId,
          title: body.title,
          content: body.content,
          cardType: body.cardType,
          status: body.status,
          tags: body.tags,
          posX: body.posX,
          posY: body.posY,
          timelineOrder: body.timelineOrder,
          startAt: body.startAt,
          endAt: body.endAt,
        },
        getMutationContext(req)
      );
      res.status(201).json({ card });
    })
  );

  app.post(
    '/api/cards/merge',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      if (!Array.isArray(body.targetCardIds) || !body.mergedCard) {
        throw new ValidationError('Fields "targetCardIds" and "mergedCard" are required.');
      }
      const card = await service.mergeCards(
        {
          targetCardIds: body.targetCardIds,
          mergedCard: body.mergedCard,
        },
        getMutationContext(req)
      );
      res.status(201).json({ card });
    })
  );

  app.post(
    '/api/cards/insert-intermediate',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      if (
        typeof body.sourceCardId !== 'string' ||
        typeof body.targetCardId !== 'string' ||
        typeof body.title !== 'string'
      ) {
        throw new ValidationError(
          'Fields "sourceCardId", "targetCardId", and "title" are required.'
        );
      }
      const card = await service.insertIntermediateCard(
        body.sourceCardId,
        body.targetCardId,
        {
          title: body.title,
          content: body.content,
          cardType: body.cardType,
          status: body.status,
          tags: body.tags,
        },
        getMutationContext(req)
      );
      res.status(201).json({ card });
    })
  );

  app.patch(
    '/api/cards/:id',
    asyncHandler(async (req, res) => {
      const card = await service.updateCard(
        paramId(req),
        req.body ?? {},
        getMutationContext(req)
      );
      res.json({ card });
    })
  );

  app.delete(
    '/api/cards/:id',
    asyncHandler(async (req, res) => {
      await service.deleteCard(paramId(req), getMutationContext(req));
      res.status(204).send();
    })
  );

  app.post(
    '/api/cards/:id/split',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      if (!Array.isArray(body.subCards)) {
        throw new ValidationError('Field "subCards" must be an array.');
      }
      const linkMode = body.linkMode === 'parallel' ? 'parallel' : 'sequential';
      const result = await service.splitCard(
        {
          targetCardId: paramId(req),
          subCards: body.subCards,
          linkMode,
        },
        getMutationContext(req)
      );
      res.status(201).json(result);
    })
  );

  // Edges
  app.post(
    '/api/edges',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      if (
        typeof body.boardId !== 'string' ||
        typeof body.sourceCardId !== 'string' ||
        typeof body.targetCardId !== 'string'
      ) {
        throw new ValidationError(
          'Fields "boardId", "sourceCardId", and "targetCardId" are required.'
        );
      }
      const edge = await service.connectCards(
        body.boardId,
        body.sourceCardId,
        body.targetCardId,
        body.relationType,
        body.label,
        getMutationContext(req)
      );
      res.status(201).json({ edge });
    })
  );

  app.delete(
    '/api/edges/:id',
    asyncHandler(async (req, res) => {
      await service.disconnectCards(paramId(req), getMutationContext(req));
      res.status(204).send();
    })
  );

  return app;
}
