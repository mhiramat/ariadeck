import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardGraphService } from '../service/BoardGraphService.js';
import { InMemoryStorageAdapter } from '../storage/InMemoryStorageAdapter.js';
import { SqliteStorageAdapter } from '../storage/SqliteStorageAdapter.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import { detectTimelineViolations } from '../timeline/timelineLayout.js';

describe.each([
  { name: 'InMemoryStorageAdapter', create: () => new InMemoryStorageAdapter() },
  { name: 'SqliteStorageAdapter', create: () => new SqliteStorageAdapter(':memory:') },
])('Timeline Auto-Sorting ($name)', ({ create }) => {
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

  it('computes longest-path topological layers and persists timelineOrder', async () => {
    const board = await service.createBoard({ title: 'Release Roadmap' });
    const a = await service.createCard({ boardId: board.id, title: 'A (Root)' });
    const b = await service.createCard({ boardId: board.id, title: 'B (Short Branch)' });
    const c = await service.createCard({ boardId: board.id, title: 'C (Long Branch 1)' });
    const d = await service.createCard({ boardId: board.id, title: 'D (Long Branch 2)' });
    const e = await service.createCard({ boardId: board.id, title: 'E (Terminal)' });

    // A -> B -> E (length 2) and A -> C -> D -> E (length 3)
    // Longest-path layering must place E at Step 3.
    await service.connectCards(board.id, a.id, b.id, 'blocks');
    await service.connectCards(board.id, b.id, e.id, 'blocks');
    await service.connectCards(board.id, a.id, c.id, 'causes');
    await service.connectCards(board.id, c.id, d.id, 'blocks');
    await service.connectCards(board.id, d.id, e.id, 'blocks');

    const result = await service.computeTimelineLayout(board.id);

    expect(result.violations).toEqual([]);
    expect(result.steps.map((s) => s.step)).toEqual([0, 1, 2, 3]);
    expect(result.steps[0]?.cards.map((card) => card.id)).toEqual([a.id]);
    expect(result.steps[1]?.cards.map((card) => card.id).sort()).toEqual([b.id, c.id].sort());
    expect(result.steps[2]?.cards.map((card) => card.id)).toEqual([d.id]);
    expect(result.steps[3]?.cards.map((card) => card.id)).toEqual([e.id]);

    // Verify persisted timelineOrder in storage
    const graph = await service.getBoardGraph(board.id);
    const byId = new Map(graph.cards.map((card) => [card.id, card]));
    expect(byId.get(a.id)?.timelineOrder).toBe(0);
    expect(byId.get(b.id)?.timelineOrder).toBe(1);
    expect(byId.get(c.id)?.timelineOrder).toBe(1);
    expect(byId.get(d.id)?.timelineOrder).toBe(2);
    expect(byId.get(e.id)?.timelineOrder).toBe(3);
  });

  it('ignores conflicted edges and relates_to edges during topological sort', async () => {
    const board = await service.createBoard({ title: 'Conflicted Graph' });
    const a = await service.createCard({ boardId: board.id, title: 'A' });
    const b = await service.createCard({ boardId: board.id, title: 'B' });

    await service.connectCards(board.id, a.id, b.id, 'blocks');
    // Non-ordering relates_to edge in reverse direction should not block sorting
    await service.connectCards(board.id, b.id, a.id, 'relates_to');

    // Simulate a conflicted cyclic edge introduced during offline sync
    await storage.saveEdge({
      id: 'edge-conflicted',
      boardId: board.id,
      sourceCardId: b.id,
      targetCardId: a.id,
      relationType: 'blocks',
      isConflicted: true,
      conflictReason: 'cyclic_dependency',
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      updatedByDeviceId: 'ariadeck-sync',
      version: 1,
      deletedAt: null,
    });

    const result = await service.computeTimelineLayout(board.id);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.cards.map((c) => c.id)).toEqual([a.id]);
    expect(result.steps[1]?.cards.map((c) => c.id)).toEqual([b.id]);
    expect(result.violations).toEqual([]);
  });

  it('detects dependency violations when a card is manually moved ahead of its prerequisite', async () => {
    const board = await service.createBoard({ title: 'Violation Check' });
    const pre = await service.createCard({ boardId: board.id, title: 'Write Spec' });
    const dep = await service.createCard({ boardId: board.id, title: 'Implement Feature' });
    const edge = await service.connectCards(board.id, pre.id, dep.id, 'blocks');

    await service.computeTimelineLayout(board.id);

    // Manually move prerequisite after dependent
    await service.updateCard(pre.id, { timelineOrder: 2 });
    await service.updateCard(dep.id, { timelineOrder: 1 });

    const graph = await service.getBoardGraph(board.id);
    const violations = detectTimelineViolations(graph.cards, graph.edges);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      edgeId: edge.id,
      sourceCardId: pre.id,
      targetCardId: dep.id,
      sourceStep: 2,
      targetStep: 1,
    });
    expect(violations[0]?.reason).toContain('Write Spec');
    expect(violations[0]?.reason).toContain('Implement Feature');
  });

  it('orders cards within the same step by explicit startAt timestamp first', async () => {
    const board = await service.createBoard({ title: 'Timestamp Tiebreaker' });
    const later = await service.createCard({
      boardId: board.id,
      title: 'Later Event',
      startAt: '2026-06-15T10:00:00.000Z',
    });
    const earlier = await service.createCard({
      boardId: board.id,
      title: 'Earlier Event',
      startAt: '2026-06-01T10:00:00.000Z',
    });

    const result = await service.computeTimelineLayout(board.id);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.cards.map((c) => c.id)).toEqual([earlier.id, later.id]);
  });
});
