import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BoardGraphService, InMemoryStorageAdapter } from '@ariadeck/core';
import { createHttpApp } from '../httpServer.js';

describe('HTTP REST & SSE Bridge', () => {
  let service: BoardGraphService;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.initialize();
    service = new BoardGraphService(storage, { deviceId: 'ariadeck-test' });
    const app = createHttpApp(service);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('serves health check and board/card/edge REST lifecycle', async () => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toMatchObject({ status: 'ok', service: 'ariadeck-mcp' });

    const createBoardRes = await fetch(`${baseUrl}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Demo Board', description: 'Test board' }),
    });
    expect(createBoardRes.status).toBe(201);
    const { board } = (await createBoardRes.json()) as { board: { id: string } };

    const c1Res = await fetch(`${baseUrl}/api/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: board.id, title: 'Card 1', cardType: 'task' }),
    });
    const { card: c1 } = (await c1Res.json()) as { card: { id: string } };

    const c2Res = await fetch(`${baseUrl}/api/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: board.id, title: 'Card 2', cardType: 'idea' }),
    });
    const { card: c2 } = (await c2Res.json()) as { card: { id: string } };

    const edgeRes = await fetch(`${baseUrl}/api/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boardId: board.id,
        sourceCardId: c1.id,
        targetCardId: c2.id,
        relationType: 'blocks',
      }),
    });
    expect(edgeRes.status).toBe(201);

    // Cyclic edge returns 409 Conflict
    const cyclicRes = await fetch(`${baseUrl}/api/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boardId: board.id,
        sourceCardId: c2.id,
        targetCardId: c1.id,
        relationType: 'blocks',
      }),
    });
    expect(cyclicRes.status).toBe(409);

    // Split card via REST
    const splitRes = await fetch(`${baseUrl}/api/cards/${c1.id}/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkMode: 'sequential',
        subCards: [
          { title: 'Sub 1', content: 'Part 1' },
          { title: 'Sub 2', content: 'Part 2' },
        ],
      }),
    });
    expect(splitRes.status).toBe(201);

    const graphRes = await fetch(`${baseUrl}/api/boards/${board.id}/graph`);
    const graph = (await graphRes.json()) as { cards: unknown[]; edges: unknown[] };
    expect(graph.cards).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
  });

  it('broadcasts GraphEventBus updates over SSE /api/events', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read initial connected event
    const firstChunk = await reader.read();
    expect(decoder.decode(firstChunk.value)).toContain('event: connected');

    // Trigger a mutation through BoardGraphService
    const board = await service.createBoard({ title: 'SSE Board' });

    const eventChunk = await reader.read();
    const text = decoder.decode(eventChunk.value);
    expect(text).toContain('event: graph');
    expect(text).toContain(board.id);

    controller.abort();
    await reader.cancel().catch(() => undefined);
  });
});
