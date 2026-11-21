import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardGraphService } from '../service/BoardGraphService.js';
import { InMemoryStorageAdapter } from '../storage/InMemoryStorageAdapter.js';
import { SqliteStorageAdapter } from '../storage/SqliteStorageAdapter.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import { CyclicDependencyError, NotFoundError, ValidationError } from '../errors.js';
import type { GraphEvent } from '../events/GraphEventBus.js';

describe.each([
  { name: 'InMemoryStorageAdapter', create: () => new InMemoryStorageAdapter() },
  { name: 'SqliteStorageAdapter', create: () => new SqliteStorageAdapter(':memory:') },
])('BoardGraphService CRUD & DAG Validation ($name)', ({ create }) => {
  let storage: StorageAdapter;
  let service: BoardGraphService;

  beforeEach(async () => {
    storage = create();
    await storage.initialize();
    service = new BoardGraphService(storage, { deviceId: 'ariadeck-test-device' });
  });

  afterEach(async () => {
    await storage.close();
  });

  it('creates, updates, lists, and fetches a board graph', async () => {
    const board = await service.createBoard({ title: 'Story Plot', description: 'Act 1' });
    expect(board.version).toBe(1);
    expect(board.updatedByDeviceId).toBe('ariadeck-test-device');

    const updated = await service.updateBoard(board.id, { title: 'Story Plot v2' });
    expect(updated.title).toBe('Story Plot v2');
    expect(updated.version).toBe(2);

    const boards = await service.listBoards();
    expect(boards).toHaveLength(1);

    const graph = await service.getBoardGraph(board.id);
    expect(graph.board.title).toBe('Story Plot v2');
    expect(graph.cards).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it('creates cards with non-overlapping default positions and increments version on update', async () => {
    const board = await service.createBoard({ title: 'Tasks' });
    const c1 = await service.createCard({ boardId: board.id, title: 'Task 1' });
    const c2 = await service.createCard({ boardId: board.id, title: 'Task 2' });

    expect(c1.posX !== c2.posX || c1.posY !== c2.posY).toBe(true);

    const updated = await service.updateCard(
      c1.id,
      { title: 'Task 1 Revised', status: 'in_progress', tags: ['urgent'] },
      { deviceId: 'ariadeck-mcp-server' }
    );
    expect(updated.version).toBe(2);
    expect(updated.status).toBe('in_progress');
    expect(updated.tags).toEqual(['urgent']);
    expect(updated.updatedByDeviceId).toBe('ariadeck-mcp-server');

    const outbox = await storage.listUnsyncedOutbox(board.id);
    expect(outbox.length).toBeGreaterThanOrEqual(4);
  });

  it('cascades soft-deletion to incident edges and attachments when deleting a card', async () => {
    const board = await service.createBoard({ title: 'Cascade Test' });
    const c1 = await service.createCard({ boardId: board.id, title: 'Card 1' });
    const c2 = await service.createCard({ boardId: board.id, title: 'Card 2' });
    const edge = await service.connectCards(board.id, c1.id, c2.id, 'blocks');

    await storage.saveAttachment({
      id: 'att-1',
      cardId: c1.id,
      boardId: board.id,
      kind: 'image',
      localUri: 'media/sketch.webp',
      remoteFileId: null,
      mimeType: 'image/webp',
      fileSize: 512,
      durationMs: null,
      transcript: 'Whiteboard diagram',
      syncStatus: 'local_only',
      createdAt: c1.createdAt,
      updatedAt: c1.updatedAt,
      updatedByDeviceId: 'ariadeck-test-device',
      version: 1,
      deletedAt: null,
    });

    await service.deleteCard(c1.id);

    const graph = await service.getBoardGraph(board.id);
    expect(graph.cards.map((c) => c.id)).toEqual([c2.id]);
    expect(graph.edges).toEqual([]);
    expect(graph.attachments).toEqual([]);

    const deletedEdge = await storage.getEdge(edge.id, true);
    expect(deletedEdge?.deletedAt).not.toBeNull();
  });

  it('rejects self-loops and transitive cycles for blocks/causes edges', async () => {
    const board = await service.createBoard({ title: 'DAG Validation' });
    const a = await service.createCard({ boardId: board.id, title: 'A' });
    const b = await service.createCard({ boardId: board.id, title: 'B' });
    const c = await service.createCard({ boardId: board.id, title: 'C' });

    await expect(service.connectCards(board.id, a.id, a.id, 'blocks')).rejects.toThrow(
      CyclicDependencyError
    );

    await service.connectCards(board.id, a.id, b.id, 'blocks');
    await service.connectCards(board.id, b.id, c.id, 'causes');

    // Closing the cycle C -> A must fail for blocks and causes.
    await expect(service.connectCards(board.id, c.id, a.id, 'blocks')).rejects.toThrow(
      CyclicDependencyError
    );
    await expect(service.connectCards(board.id, c.id, a.id, 'causes')).rejects.toThrow(
      CyclicDependencyError
    );

    // Non-blocking 'relates_to' association is permitted even if a path exists.
    const relatesEdge = await service.connectCards(board.id, c.id, a.id, 'relates_to');
    expect(relatesEdge.relationType).toBe('relates_to');
  });

  it('deduplicates identical edges and emits events on mutations', async () => {
    const events: GraphEvent[] = [];
    service.eventBus.subscribe((event) => events.push(event));

    const board = await service.createBoard({ title: 'Events' });
    const a = await service.createCard({ boardId: board.id, title: 'A' });
    const b = await service.createCard({ boardId: board.id, title: 'B' });

    const edge1 = await service.connectCards(board.id, a.id, b.id, 'blocks');
    const edge2 = await service.connectCards(board.id, a.id, b.id, 'blocks');
    expect(edge1.id).toBe(edge2.id);

    await service.disconnectCards(edge1.id);
    const graph = await service.getBoardGraph(board.id);
    expect(graph.edges).toHaveLength(0);

    expect(events.map((e) => e.type)).toEqual([
      'board:created',
      'card:created',
      'card:created',
      'edge:created',
      'edge:deleted',
    ]);
  });

  it('throws NotFoundError and ValidationError for invalid inputs', async () => {
    await expect(service.createBoard({ title: '   ' })).rejects.toThrow(ValidationError);
    await expect(service.getBoard('missing-board')).rejects.toThrow(NotFoundError);
    await expect(service.updateCard('missing-card', { title: 'New' })).rejects.toThrow(
      NotFoundError
    );
  });
});
