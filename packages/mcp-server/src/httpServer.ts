import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import {
  AriadeckError,
  BoardConversionError,
  BoardGraphService,
  BoardSyncEngine,
  CyclicDependencyError,
  DEFAULT_MAX_IMAGE_BYTES,
  MediaService,
  NotFoundError,
  ValidationError,
  type BoardType,
  type CardDisplayMode,
  type CardType,
  type ConflictResolutionAction,
  type ExternalChangeSource,
  type MutationContext,
  type SupportedImageMimeType,
} from '@ariadeck/core';
import {
  parseCookies,
  SESSION_COOKIE_NAME,
  SessionAuthManager,
} from './auth.js';
import { ExternalChangeWatcher } from './externalChangeWatcher.js';
import { resolveImageSourceBytes } from './mediaSource.js';

export interface HttpAppOptions {
  syncEngine?: BoardSyncEngine;
  mediaService?: MediaService;
  authToken?: string | null;
  authManager?: SessionAuthManager;
  allowedOrigins?: string[];
  externalChangeSource?: ExternalChangeSource;
  externalChangePollIntervalMs?: number;
  externalChangeWatcher?: ExternalChangeWatcher;
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
  if (error instanceof BoardConversionError) {
    res.status(409).json({
      error: { code: error.code, message: error.message, analysis: error.analysis },
    });
    return;
  }
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
  const { syncEngine, mediaService } = options;
  const maxImageBytes = mediaService?.getMaxImageBytes() ?? DEFAULT_MAX_IMAGE_BYTES;
  const jsonBodyLimit = Math.max(2 * 1024 * 1024, Math.ceil(maxImageBytes * 1.4) + 512 * 1024);
  const rawImageParser = express.raw({
    type: ['image/jpeg', 'image/png', 'application/octet-stream'],
    limit: maxImageBytes,
  });
  const auth =
    options.authManager ?? new SessionAuthManager(options.authToken ?? null);
  const extraOrigins = options.allowedOrigins ?? [];
  const externalWatcher =
    options.externalChangeWatcher ??
    (options.externalChangeSource
      ? new ExternalChangeWatcher(options.externalChangeSource, service.eventBus, {
          pollIntervalMs: options.externalChangePollIntervalMs,
          onError: (err) => {
            console.error('[ariadeck-mcp] External DB watch error:', err);
          },
        })
      : null);
  let activeSseClients = 0;

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
  app.use(express.json({ limit: jsonBodyLimit }));

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

    activeSseClients += 1;
    if (activeSseClients === 1 && externalWatcher) {
      externalWatcher.start({ syncCursorFirst: true });
    }

    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`);

    const unsubscribe = service.eventBus.subscribe((event) => {
      res.write(`event: graph\ndata: ${JSON.stringify(event)}\n\n`);
    });

    const keepAliveTimer = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 25000);

    let closed = false;
    req.on('close', () => {
      if (closed) return;
      closed = true;
      clearInterval(keepAliveTimer);
      unsubscribe();
      activeSseClients = Math.max(0, activeSseClients - 1);
      if (activeSseClients === 0 && externalWatcher) {
        externalWatcher.stop();
      }
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
      const { title, description, boardType } = req.body ?? {};
      if (typeof title !== 'string') {
        throw new ValidationError('Field "title" is required and must be a string.');
      }
      if (boardType !== undefined && boardType !== 'flow' && boardType !== 'flat') {
        throw new ValidationError('Field "boardType" must be "flow" or "flat".');
      }
      const board = await service.createBoard(
        {
          title,
          description: typeof description === 'string' ? description : '',
          ...(boardType !== undefined ? { boardType: boardType as BoardType } : {}),
        },
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
    '/api/boards/:id/convert-type',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      if (body.targetType !== 'flow' && body.targetType !== 'flat') {
        throw new ValidationError('Field "targetType" must be "flow" or "flat".');
      }
      if (body.dryRun === true) {
        const analysis = await service.analyzeBoardTypeConversion(
          paramId(req),
          body.targetType
        );
        res.json({ analysis });
        return;
      }
      const strategy =
        body.strategy === 'demote_incompatible' ? 'demote_incompatible' : 'abort';
      const result = await service.convertBoardType(
        paramId(req),
        body.targetType,
        strategy,
        getMutationContext(req)
      );
      res.json(result);
    })
  );

  app.post(
    '/api/boards/:id/timeline/compute',
    asyncHandler(async (req, res) => {
      const applyToCards =
        req.body && typeof req.body.applyToCards === 'boolean'
          ? req.body.applyToCards
          : true;
      const result = await service.computeTimelineLayout(
        paramId(req),
        getMutationContext(req),
        { applyToCards }
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
          displayMode: body.displayMode,
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
      const result = await service.splitCard(
        {
          targetCardId: paramId(req),
          subCards: body.subCards,
          ...(body.linkMode !== undefined ? { linkMode: body.linkMode } : {}),
          ...(body.edgeInheritance !== undefined
            ? { edgeInheritance: body.edgeInheritance }
            : {}),
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
        {
          ...(body.direction !== undefined ? { direction: body.direction } : {}),
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.styleVariant !== undefined ? { styleVariant: body.styleVariant } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
        },
        getMutationContext(req)
      );
      res.status(201).json({ edge });
    })
  );

  app.patch(
    '/api/edges/:id',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const edge = await service.updateEdge(
        paramId(req),
        {
          ...(body.relationType !== undefined ? { relationType: body.relationType } : {}),
          ...(body.direction !== undefined ? { direction: body.direction } : {}),
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.styleVariant !== undefined ? { styleVariant: body.styleVariant } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
        },
        getMutationContext(req)
      );
      res.json({ edge });
    })
  );

  app.delete(
    '/api/edges/:id',
    asyncHandler(async (req, res) => {
      await service.disconnectCards(paramId(req), getMutationContext(req));
      res.status(204).send();
    })
  );

  // Media & Image Attachments (Phase 3)
  const requireMediaService = (res: Response): MediaService | null => {
    if (!mediaService) {
      res.status(501).json({
        error: {
          code: 'MEDIA_NOT_CONFIGURED',
          message: 'Media storage is not configured on this server.',
        },
      });
      return null;
    }
    return mediaService;
  };

  const queryString = (req: Request, key: string): string | undefined => {
    const raw = req.query[key];
    return typeof raw === 'string' ? raw : undefined;
  };

  const queryNumber = (req: Request, key: string): number | undefined => {
    const raw = queryString(req, key);
    if (raw === undefined || raw.trim() === '') return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  app.post(
    '/api/cards/image',
    rawImageParser,
    asyncHandler(async (req, res) => {
      const media = requireMediaService(res);
      if (!media) return;

      if (Buffer.isBuffer(req.body)) {
        const boardId = queryString(req, 'boardId');
        const title = queryString(req, 'title');
        if (!boardId || !title) {
          throw new ValidationError(
            'Query parameters "boardId" and "title" are required for binary image card uploads.'
          );
        }
        const bytes = new Uint8Array(req.body.buffer, req.body.byteOffset, req.body.byteLength);
        const result = await media.createImageCard(
          {
            boardId,
            title,
            bytes,
            content: queryString(req, 'content'),
            caption: queryString(req, 'caption'),
            cardType: queryString(req, 'cardType') as CardType | undefined,
            displayMode: queryString(req, 'displayMode') as CardDisplayMode | undefined,
            posX: queryNumber(req, 'posX'),
            posY: queryNumber(req, 'posY'),
          },
          getMutationContext(req)
        );
        res.status(201).json(result);
        return;
      }

      const body = req.body ?? {};
      if (
        typeof body.boardId !== 'string' ||
        typeof body.title !== 'string' ||
        typeof body.data !== 'string' ||
        (body.mimeType !== 'image/jpeg' && body.mimeType !== 'image/png')
      ) {
        throw new ValidationError(
          'Fields "boardId", "title", "data" (base64), and "mimeType" (image/jpeg | image/png) are required.'
        );
      }
      const { bytes, expectedMimeType } = await resolveImageSourceBytes(
        {
          type: 'base64',
          data: body.data,
          mimeType: body.mimeType as SupportedImageMimeType,
        },
        { maxImageBytes: media.getMaxImageBytes() }
      );
      const result = await media.createImageCard(
        {
          boardId: body.boardId,
          title: body.title,
          bytes,
          expectedMimeType,
          content: body.content,
          caption: body.caption,
          cardType: body.cardType,
          tags: body.tags,
          displayMode: body.displayMode,
          posX: body.posX,
          posY: body.posY,
        },
        getMutationContext(req)
      );
      res.status(201).json(result);
    })
  );

  app.post(
    '/api/cards/:id/attachments/image',
    rawImageParser,
    asyncHandler(async (req, res) => {
      const media = requireMediaService(res);
      if (!media) return;
      const cardId = paramId(req);

      if (Buffer.isBuffer(req.body)) {
        const bytes = new Uint8Array(req.body.buffer, req.body.byteOffset, req.body.byteLength);
        const setAsCoverParam = queryString(req, 'setAsCover');
        const setAsCover =
          setAsCoverParam === undefined ? undefined : setAsCoverParam !== 'false';
        const result = await media.attachImageToCard(
          {
            cardId,
            bytes,
            caption: queryString(req, 'caption'),
            setAsCover,
            displayMode: queryString(req, 'displayMode') as CardDisplayMode | undefined,
          },
          getMutationContext(req)
        );
        res.status(201).json(result);
        return;
      }

      const body = req.body ?? {};
      if (
        typeof body.data !== 'string' ||
        (body.mimeType !== 'image/jpeg' && body.mimeType !== 'image/png')
      ) {
        throw new ValidationError(
          'Fields "data" (base64) and "mimeType" (image/jpeg | image/png) are required.'
        );
      }
      const { bytes, expectedMimeType } = await resolveImageSourceBytes(
        {
          type: 'base64',
          data: body.data,
          mimeType: body.mimeType as SupportedImageMimeType,
        },
        { maxImageBytes: media.getMaxImageBytes() }
      );
      const result = await media.attachImageToCard(
        {
          cardId,
          bytes,
          expectedMimeType,
          caption: body.caption,
          setAsCover: typeof body.setAsCover === 'boolean' ? body.setAsCover : undefined,
          displayMode: body.displayMode,
        },
        getMutationContext(req)
      );
      res.status(201).json(result);
    })
  );

  app.patch(
    '/api/attachments/:id',
    asyncHandler(async (req, res) => {
      const media = requireMediaService(res);
      if (!media) return;
      const body = req.body ?? {};
      const attachment = await media.updateAttachment(
        paramId(req),
        {
          ...(body.caption !== undefined ? { caption: body.caption } : {}),
          ...(body.transcript !== undefined ? { transcript: body.transcript } : {}),
          ...(body.isCover !== undefined ? { isCover: Boolean(body.isCover) } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) } : {}),
        },
        getMutationContext(req)
      );
      res.json({ attachment });
    })
  );

  app.put(
    '/api/cards/:id/attachments/reorder',
    asyncHandler(async (req, res) => {
      const media = requireMediaService(res);
      if (!media) return;
      const body = req.body ?? {};
      if (!Array.isArray(body.attachmentIds)) {
        throw new ValidationError('Field "attachmentIds" must be an array of attachment IDs.');
      }
      const attachments = await media.reorderCardAttachments(
        paramId(req),
        body.attachmentIds.map(String),
        getMutationContext(req)
      );
      res.json({ attachments });
    })
  );

  app.delete(
    '/api/attachments/:id',
    asyncHandler(async (req, res) => {
      const media = requireMediaService(res);
      if (!media) return;
      await media.removeAttachment(paramId(req), getMutationContext(req));
      res.status(204).send();
    })
  );

  app.get(
    '/api/media/attachments/:id/thumb',
    asyncHandler(async (req, res) => {
      const media = requireMediaService(res);
      if (!media) return;
      const { bytes, mimeType } = await media.readAttachmentThumbnail(paramId(req));
      res.setHeader('Content-Type', mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.send(Buffer.from(bytes));
    })
  );

  app.get(
    '/api/media/attachments/:id/original',
    asyncHandler(async (req, res) => {
      const media = requireMediaService(res);
      if (!media) return;
      const { attachment, bytes } = await media.readAttachmentOriginal(paramId(req));
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.send(Buffer.from(bytes));
    })
  );

  app.post(
    '/api/media/gc',
    asyncHandler(async (req, res) => {
      const media = requireMediaService(res);
      if (!media) return;
      const retentionDays =
        typeof req.body?.retentionDays === 'number' ? req.body.retentionDays : 30;
      const result = await media.runMediaGarbageCollection(retentionDays);
      res.json(result);
    })
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const maybeErr = err as { type?: string; status?: number; message?: string };
    if (maybeErr?.type === 'entity.too.large') {
      res.status(413).json({
        error: {
          code: 'ERR_IMAGE_TOO_LARGE',
          message: `Request payload exceeds maximum allowed size (${maxImageBytes} bytes).`,
        },
      });
      return;
    }
    sendDomainError(res, err);
  });

  return app;
}
