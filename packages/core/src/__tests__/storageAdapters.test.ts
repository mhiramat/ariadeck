import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStorageAdapter } from '../storage/InMemoryStorageAdapter.js';
import { SqliteStorageAdapter } from '../storage/SqliteStorageAdapter.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import type { Board, Card, Edge, CardAttachment } from '../types/models.js';

const NOW = '2026-01-01T00:00:00.000Z';

function makeBoard(id = 'board-1'): Board {
  return {
    id,
    title: 'Project Alpha',
    description: 'Initial board',
    boardType: 'flow',
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  };
}

function makeCard(id: string, boardId = 'board-1'): Card {
  return {
    id,
    boardId,
    title: `Card ${id}`,
    content: 'Markdown body',
    cardType: 'task',
    status: 'todo',
    tags: ['phase1'],
    posX: 100,
    posY: 200,
    timelineOrder: null,
    startAt: null,
    endAt: null,
    splitFromCardId: null,
    mergedFromCardIds: null,
    replacedByCardIds: null,
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  };
}

function makeEdge(id: string, sourceCardId: string, targetCardId: string, boardId = 'board-1'): Edge {
  return {
    id,
    boardId,
    sourceCardId,
    targetCardId,
    relationType: 'blocks',
    direction: 'directed',
    label: 'must finish first',
    styleVariant: 'solid',
    color: null,
    isConflicted: false,
    conflictReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  };
}

function makeAttachment(id: string, cardId: string, boardId = 'board-1'): CardAttachment {
  return {
    id,
    cardId,
    boardId,
    kind: 'audio',
    localUri: 'media/note.m4a',
    remoteFileId: null,
    mimeType: 'audio/mp4',
    fileSize: 1024,
    durationMs: 4200,
    transcript: 'Spoken idea summary',
    syncStatus: 'local_only',
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  };
}

describe.each([
  { name: 'InMemoryStorageAdapter', create: () => new InMemoryStorageAdapter() },
  { name: 'SqliteStorageAdapter', create: () => new SqliteStorageAdapter(':memory:') },
])('$name', ({ create }) => {
  let adapter: StorageAdapter;

  beforeEach(async () => {
    adapter = create();
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('persists and queries boards, cards, edges, and attachments', async () => {
    const board = makeBoard();
    await adapter.saveBoard(board);
    expect(await adapter.getBoard(board.id)).toEqual(board);
    expect(await adapter.listBoards()).toEqual([board]);

    const cardA = makeCard('card-a');
    const cardB = makeCard('card-b');
    await adapter.saveCard(cardA);
    await adapter.saveCard(cardB);
    expect(await adapter.listCardsByBoard(board.id)).toHaveLength(2);

    const edge = makeEdge('edge-1', 'card-a', 'card-b');
    await adapter.saveEdge(edge);
    expect(await adapter.listEdgesByBoard(board.id)).toEqual([edge]);

    const attachment = makeAttachment('att-1', 'card-a');
    await adapter.saveAttachment(attachment);
    expect(await adapter.listAttachmentsByCard('card-a')).toEqual([attachment]);
    expect(await adapter.listAttachmentsByBoard(board.id)).toEqual([attachment]);
  });

  it('filters soft-deleted records unless includeDeleted is true', async () => {
    const board = makeBoard();
    await adapter.saveBoard(board);

    const card = makeCard('card-1');
    await adapter.saveCard(card);
    await adapter.saveCard({ ...card, deletedAt: NOW, version: 2 });

    expect(await adapter.getCard('card-1')).toBeNull();
    expect(await adapter.listCardsByBoard(board.id)).toHaveLength(0);
    expect(await adapter.getCard('card-1', true)).not.toBeNull();
    expect(await adapter.listCardsByBoard(board.id, true)).toHaveLength(1);
  });

  it('rolls back changes when a transaction throws', async () => {
    const board = makeBoard();
    await adapter.saveBoard(board);

    await expect(
      adapter.runInTransaction(async () => {
        await adapter.saveCard(makeCard('card-rolled-back'));
        throw new Error('Simulated failure');
      })
    ).rejects.toThrow('Simulated failure');

    expect(await adapter.getCard('card-rolled-back')).toBeNull();
  });

  it('appends and marks sync_outbox entries as synced', async () => {
    const entry = await adapter.appendOutbox({
      entityType: 'card',
      entityId: 'card-1',
      boardId: 'board-1',
      operation: 'create',
      payloadJson: '{"id":"card-1"}',
      createdAt: NOW,
      syncedAt: null,
    });
    expect(entry.seq).toBeGreaterThan(0);

    const unsynced = await adapter.listUnsyncedOutbox('board-1');
    expect(unsynced).toHaveLength(1);

    await adapter.markOutboxSynced([entry.seq], NOW);
    expect(await adapter.listUnsyncedOutbox('board-1')).toHaveLength(0);
  });
});
