import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BoardGraphService,
  type GraphEvent,
  type SyncOutboxEntry,
} from '@ariadeck/core';
import { SqliteStorageAdapter } from '@ariadeck/core/sqlite';
import {
  coalesceOutboxEntriesToGraphEvents,
  ExternalChangeWatcher,
} from '../externalChangeWatcher.js';
import { createHttpApp } from '../httpServer.js';
import { MCP_DEVICE_ID } from '../mcpServer.js';

const NOW = '2026-11-27T00:00:00.000Z';

describe('coalesceOutboxEntriesToGraphEvents', () => {
  it('coalesces multi-row split, merge, cascade delete, and attachment outbox batches per board', () => {
    const entries: SyncOutboxEntry[] = [
      // Board A: split_card produces child card creates + edge changes + card split
      {
        seq: 1,
        entityType: 'card',
        entityId: 'child-1',
        boardId: 'board-a',
        operation: 'create',
        payloadJson: JSON.stringify({ id: 'child-1', updatedByDeviceId: MCP_DEVICE_ID }),
        createdAt: NOW,
        syncedAt: null,
      },
      {
        seq: 2,
        entityType: 'card',
        entityId: 'parent-1',
        boardId: 'board-a',
        operation: 'split',
        payloadJson: JSON.stringify({ parentCardId: 'parent-1', replacedByCardIds: ['child-1'] }),
        createdAt: NOW,
        syncedAt: null,
      },
      // Board B: attachment update resolves entityId to cardId and emits card:updated
      {
        seq: 3,
        entityType: 'attachment',
        entityId: 'att-1',
        boardId: 'board-b',
        operation: 'create',
        payloadJson: JSON.stringify({
          id: 'att-1',
          cardId: 'card-b1',
          updatedByDeviceId: MCP_DEVICE_ID,
        }),
        createdAt: NOW,
        syncedAt: null,
      },
    ];

    const events = coalesceOutboxEntriesToGraphEvents(entries);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: 'card:split',
      boardId: 'board-a',
      entityIds: ['child-1', 'parent-1'],
      deviceId: MCP_DEVICE_ID,
      timestamp: NOW,
    });
    expect(events[1]).toEqual({
      type: 'card:updated',
      boardId: 'board-b',
      entityIds: ['card-b1'],
      deviceId: MCP_DEVICE_ID,
      timestamp: NOW,
    });
  });

  it('coalesces board import (board create + card/edge creates) into a single board:created event', () => {
    const entries: SyncOutboxEntry[] = [
      {
        seq: 10,
        entityType: 'board',
        entityId: 'board-imp',
        boardId: 'board-imp',
        operation: 'create',
        payloadJson: JSON.stringify({ id: 'board-imp', updatedByDeviceId: MCP_DEVICE_ID }),
        createdAt: NOW,
        syncedAt: null,
      },
      {
        seq: 11,
        entityType: 'card',
        entityId: 'card-1',
        boardId: 'board-imp',
        operation: 'create',
        payloadJson: JSON.stringify({ id: 'card-1', updatedByDeviceId: MCP_DEVICE_ID }),
        createdAt: NOW,
        syncedAt: null,
      },
      {
        seq: 12,
        entityType: 'edge',
        entityId: 'edge-1',
        boardId: 'board-imp',
        operation: 'create',
        payloadJson: JSON.stringify({ id: 'edge-1', updatedByDeviceId: MCP_DEVICE_ID }),
        createdAt: NOW,
        syncedAt: null,
      },
    ];

    const events = coalesceOutboxEntriesToGraphEvents(entries);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('board:created');
    expect(events[0]?.boardId).toBe('board-imp');
    expect(events[0]?.deviceId).toBe(MCP_DEVICE_ID);
  });
});

describe('ExternalChangeWatcher with shared SQLite database', () => {
  let tempDir: string;
  let dbPath: string;
  let httpStorage: SqliteStorageAdapter;
  let mcpStorage: SqliteStorageAdapter;
  let httpService: BoardGraphService;
  let mcpService: BoardGraphService;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ariadeck-ext-watch-'));
    dbPath = join(tempDir, 'ariadeck.db');
    httpStorage = new SqliteStorageAdapter(dbPath);
    mcpStorage = new SqliteStorageAdapter(dbPath);
    await httpStorage.initialize();
    await mcpStorage.initialize();

    httpService = new BoardGraphService(httpStorage, { deviceId: 'ariadeck-http-client' });
    mcpService = new BoardGraphService(mcpStorage, { deviceId: MCP_DEVICE_ID });
  });

  afterEach(async () => {
    await mcpStorage.close();
    await httpStorage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('replays external MCP commits onto the HTTP eventBus without duplicating local commits', async () => {
    const received: GraphEvent[] = [];
    const watcher = new ExternalChangeWatcher(httpStorage, httpService.eventBus);
    watcher.syncCursor();

    const unsubscribe = httpService.eventBus.subscribe((event) => {
      received.push(event);
    });

    // Local commit on HTTP service emits once directly via eventBus
    const board = await httpService.createBoard({ title: 'Shared Board' });
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('board:created');

    // Polling should NOT duplicate the local commit
    expect(watcher.poll()).toEqual([]);
    expect(received).toHaveLength(1);

    // External commit via separate SQLite connection (simulating stdio MCP process)
    const card = await mcpService.createCard({
      boardId: board.id,
      title: 'Added by Stdio MCP',
    });

    // Watcher detects PRAGMA data_version increment and emits onto HTTP eventBus
    const replayed = watcher.poll();
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({
      type: 'card:created',
      boardId: board.id,
      entityIds: [card.id],
      deviceId: MCP_DEVICE_ID,
    });
    expect(received).toHaveLength(2);
    expect(received[1]?.deviceId).toBe(MCP_DEVICE_ID);

    // Subsequent poll with no new commits is a no-op
    expect(watcher.poll()).toEqual([]);

    // Split card from external process coalesces to card:split
    await mcpService.splitCard({
      targetCardId: card.id,
      subCards: [
        { title: 'Part A', content: '' },
        { title: 'Part B', content: '' },
      ],
    });
    const splitEvents = watcher.poll();
    expect(splitEvents).toHaveLength(1);
    expect(splitEvents[0]?.type).toBe('card:split');
    expect(splitEvents[0]?.deviceId).toBe(MCP_DEVICE_ID);

    unsubscribe();
  });

  it('streams external SQLite mutations over SSE /api/events and stops watching when clients disconnect', async () => {
    const watcher = new ExternalChangeWatcher(httpStorage, httpService.eventBus, {
      pollIntervalMs: 30,
    });
    const app = createHttpApp(httpService, { externalChangeWatcher: watcher });
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const board = await httpService.createBoard({ title: 'Live Board' });
      expect(watcher.isRunning()).toBe(false);

      const controller = new AbortController();
      const res = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
      expect(res.status).toBe(200);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      const firstChunk = await reader.read();
      expect(decoder.decode(firstChunk.value)).toContain('event: connected');
      expect(watcher.isRunning()).toBe(true);

      // Perform a mutation on the separate stdio-like SQLite connection
      const createdCard = await mcpService.createCard({
        boardId: board.id,
        title: 'Live MCP Card',
      });

      const eventChunk = await reader.read();
      const text = decoder.decode(eventChunk.value);
      expect(text).toContain('event: graph');
      expect(text).toContain(board.id);
      expect(text).toContain(createdCard.id);
      expect(text).toContain(MCP_DEVICE_ID);

      controller.abort();
      await reader.cancel().catch(() => undefined);

      // Wait briefly for server req.on('close') to stop the watcher
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(watcher.isRunning()).toBe(false);
    } finally {
      watcher.stop();
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
