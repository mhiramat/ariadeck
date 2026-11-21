import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardGraphService } from '../service/BoardGraphService.js';
import { InMemoryStorageAdapter } from '../storage/InMemoryStorageAdapter.js';
import { SqliteStorageAdapter } from '../storage/SqliteStorageAdapter.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import { CyclicDependencyError, NotFoundError, ValidationError } from '../errors.js';

describe.each([
  { name: 'InMemoryStorageAdapter', create: () => new InMemoryStorageAdapter() },
  { name: 'SqliteStorageAdapter', create: () => new SqliteStorageAdapter(':memory:') },
])('BoardGraphService Transformations ($name)', ({ create }) => {
  let storage: StorageAdapter;
  let service: BoardGraphService;

  beforeEach(async () => {
    storage = create();
    await storage.initialize();
    service = new BoardGraphService(storage, { deviceId: 'ariadeck-test' });
  });

  afterEach(async () => {
    await storage.close();
  });

  it('splits a card sequentially, preserving incoming/outgoing edges and lineage', async () => {
    const board = await service.createBoard({ title: 'Sequential Split' });
    const upstream = await service.createCard({ boardId: board.id, title: 'Upstream', posX: 0, posY: 0 });
    const target = await service.createCard({
      boardId: board.id,
      title: 'Big Task',
      cardType: 'task',
      tags: ['backend'],
      posX: 200,
      posY: 100,
    });
    const downstream = await service.createCard({
      boardId: board.id,
      title: 'Downstream',
      posX: 600,
      posY: 100,
    });

    await service.connectCards(board.id, upstream.id, target.id, 'blocks');
    await service.connectCards(board.id, target.id, downstream.id, 'causes');

    const result = await service.splitCard({
      targetCardId: target.id,
      linkMode: 'sequential',
      subCards: [
        { title: 'Step 1', content: 'First step' },
        { title: 'Step 2', content: 'Second step' },
        { title: 'Step 3', content: 'Third step' },
      ],
    });

    expect(result.createdCards).toHaveLength(3);
    expect(result.parentCard.deletedAt).not.toBeNull();
    expect(result.parentCard.replacedByCardIds).toEqual(result.createdCards.map((c) => c.id));
    for (const child of result.createdCards) {
      expect(child.splitFromCardId).toBe(target.id);
      expect(child.tags).toEqual(['backend']);
    }

    const graph = await service.getBoardGraph(board.id);
    expect(graph.cards.map((c) => c.title).sort()).toEqual([
      'Downstream',
      'Step 1',
      'Step 2',
      'Step 3',
      'Upstream',
    ]);

    const [s1, s2, s3] = result.createdCards;
    const edgePairs = graph.edges.map((e) => [e.sourceCardId, e.targetCardId, e.relationType]);
    expect(edgePairs).toContainEqual([upstream.id, s1!.id, 'blocks']);
    expect(edgePairs).toContainEqual([s1!.id, s2!.id, 'blocks']);
    expect(edgePairs).toContainEqual([s2!.id, s3!.id, 'blocks']);
    expect(edgePairs).toContainEqual([s3!.id, downstream.id, 'causes']);
    expect(graph.edges).toHaveLength(4);
  });

  it('splits a card in parallel, replicating incoming and outgoing edges to all children', async () => {
    const board = await service.createBoard({ title: 'Parallel Split' });
    const upstream = await service.createCard({ boardId: board.id, title: 'Spec' });
    const target = await service.createCard({ boardId: board.id, title: 'Implement All' });
    const downstream = await service.createCard({ boardId: board.id, title: 'Release' });

    await service.connectCards(board.id, upstream.id, target.id, 'blocks');
    await service.connectCards(board.id, target.id, downstream.id, 'blocks');

    const result = await service.splitCard({
      targetCardId: target.id,
      linkMode: 'parallel',
      subCards: [
        { title: 'Frontend', content: 'Build UI' },
        { title: 'Backend', content: 'Build API' },
      ],
    });

    const [fe, be] = result.createdCards;
    const graph = await service.getBoardGraph(board.id);
    const edgePairs = graph.edges.map((e) => [e.sourceCardId, e.targetCardId]);

    expect(edgePairs).toContainEqual([upstream.id, fe!.id]);
    expect(edgePairs).toContainEqual([upstream.id, be!.id]);
    expect(edgePairs).toContainEqual([fe!.id, downstream.id]);
    expect(edgePairs).toContainEqual([be!.id, downstream.id]);
    // Parallel children must not be linked to each other.
    expect(edgePairs).not.toContainEqual([fe!.id, be!.id]);
    expect(graph.edges).toHaveLength(4);
  });

  it('merges multiple cards, computes centroid, deduplicates edges, and records lineage', async () => {
    const board = await service.createBoard({ title: 'Merge Test' });
    const pre = await service.createCard({ boardId: board.id, title: 'Prerequisite' });
    const a = await service.createCard({
      boardId: board.id,
      title: 'Draft A',
      tags: ['alpha'],
      posX: 100,
      posY: 200,
    });
    const b = await service.createCard({
      boardId: board.id,
      title: 'Draft B',
      tags: ['beta'],
      posX: 300,
      posY: 400,
    });
    const post = await service.createCard({ boardId: board.id, title: 'Publish' });

    await service.connectCards(board.id, pre.id, a.id, 'blocks');
    await service.connectCards(board.id, pre.id, b.id, 'blocks');
    await service.connectCards(board.id, a.id, b.id, 'blocks');
    await service.connectCards(board.id, a.id, post.id, 'blocks');
    await service.connectCards(board.id, b.id, post.id, 'blocks');

    const merged = await service.mergeCards({
      targetCardIds: [a.id, b.id],
      mergedCard: {
        title: 'Unified Draft',
        content: 'Combined draft notes',
      },
    });

    expect(merged.posX).toBe(200);
    expect(merged.posY).toBe(300);
    expect(merged.mergedFromCardIds).toEqual([a.id, b.id]);
    expect(merged.tags.sort()).toEqual(['alpha', 'beta']);

    const graph = await service.getBoardGraph(board.id);
    expect(graph.cards.map((c) => c.id).sort()).toEqual([merged.id, post.id, pre.id].sort());
    // Duplicate incoming and outgoing edges should be deduplicated, and internal edge removed.
    expect(graph.edges).toHaveLength(2);
    const pairs = graph.edges.map((e) => [e.sourceCardId, e.targetCardId]);
    expect(pairs).toContainEqual([pre.id, merged.id]);
    expect(pairs).toContainEqual([merged.id, post.id]);

    const archivedA = await storage.getCard(a.id, true);
    const archivedB = await storage.getCard(b.id, true);
    expect(archivedA?.replacedByCardIds).toEqual([merged.id]);
    expect(archivedB?.replacedByCardIds).toEqual([merged.id]);
    expect(archivedA?.deletedAt).not.toBeNull();
    expect(archivedB?.deletedAt).not.toBeNull();
  });

  it('rejects mergeCards if re-wiring external dependencies would introduce a cycle', async () => {
    const board = await service.createBoard({ title: 'Merge Cycle Test' });
    const a = await service.createCard({ boardId: board.id, title: 'A' });
    const mid = await service.createCard({ boardId: board.id, title: 'Mid' });
    const c = await service.createCard({ boardId: board.id, title: 'C' });

    // A -> Mid -> C: merging A and C would create M -> Mid -> M.
    await service.connectCards(board.id, a.id, mid.id, 'blocks');
    await service.connectCards(board.id, mid.id, c.id, 'blocks');

    await expect(
      service.mergeCards({
        targetCardIds: [a.id, c.id],
        mergedCard: { title: 'AC', content: '' },
      })
    ).rejects.toThrow(CyclicDependencyError);

    // Transaction rollback must keep all original cards active.
    const graph = await service.getBoardGraph(board.id);
    expect(graph.cards).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
  });

  it('inserts an intermediate card between two connected cards at their midpoint', async () => {
    const board = await service.createBoard({ title: 'Insert Intermediate' });
    const a = await service.createCard({ boardId: board.id, title: 'A', posX: 0, posY: 0 });
    const b = await service.createCard({ boardId: board.id, title: 'B', posX: 400, posY: 200 });
    await service.connectCards(board.id, a.id, b.id, 'causes');

    const mid = await service.insertIntermediateCard(a.id, b.id, {
      title: 'Bridge',
      content: 'Missing link',
    });

    expect(mid.posX).toBe(200);
    expect(mid.posY).toBe(100);

    const graph = await service.getBoardGraph(board.id);
    expect(graph.cards).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    const pairs = graph.edges.map((e) => [e.sourceCardId, e.targetCardId, e.relationType]);
    expect(pairs).toContainEqual([a.id, mid.id, 'causes']);
    expect(pairs).toContainEqual([mid.id, b.id, 'causes']);
  });

  it('validates splitCard, mergeCards, and insertIntermediateCard error cases', async () => {
    const board = await service.createBoard({ title: 'Validation' });
    const a = await service.createCard({ boardId: board.id, title: 'A' });
    const b = await service.createCard({ boardId: board.id, title: 'B' });

    await expect(
      service.splitCard({
        targetCardId: a.id,
        linkMode: 'sequential',
        subCards: [{ title: 'Only One', content: '' }],
      })
    ).rejects.toThrow(ValidationError);

    await expect(
      service.mergeCards({
        targetCardIds: [a.id],
        mergedCard: { title: 'Single', content: '' },
      })
    ).rejects.toThrow(ValidationError);

    await expect(
      service.insertIntermediateCard(a.id, b.id, { title: 'Missing Edge' })
    ).rejects.toThrow(NotFoundError);
  });
});
