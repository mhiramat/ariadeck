import { describe, it, expect } from 'vitest';
import type { Card, Edge, RelationType } from '@ariadeck/core';
import { computeAutoGraphLayout, doesEdgeOccludeCard } from '../autoLayout.ts';

const NOW = '2026-06-01T00:00:00.000Z';

function makeCard(id: string, title: string, createdOffset = 0): Card {
  return {
    id,
    boardId: 'b1',
    title,
    content: '',
    cardType: 'plot_event',
    status: 'todo',
    tags: [],
    posX: 0,
    posY: 0,
    timelineOrder: null,
    startAt: null,
    endAt: null,
    splitFromCardId: null,
    mergedFromCardIds: null,
    replacedByCardIds: null,
    createdAt: `2026-06-01T00:00:${String(createdOffset).padStart(2, '0')}.000Z`,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  };
}

function makeEdge(
  id: string,
  sourceCardId: string,
  targetCardId: string,
  relationType: RelationType = 'blocks'
): Edge {
  return {
    id,
    boardId: 'b1',
    sourceCardId,
    targetCardId,
    relationType,
    isConflicted: false,
    conflictReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  };
}

describe('computeAutoGraphLayout', () => {
  it('places prerequisite cards strictly to the left of dependents without overlap', () => {
    const a = makeCard('a', 'Root', 1);
    const b = makeCard('b', 'Branch 1', 2);
    const c = makeCard('c', 'Branch 2', 3);
    const d = makeCard('d', 'Terminal', 4);

    const edges = [
      makeEdge('e1', 'a', 'b'),
      makeEdge('e2', 'a', 'c'),
      makeEdge('e3', 'b', 'd'),
      makeEdge('e4', 'c', 'd'),
    ];

    const positions = computeAutoGraphLayout([a, b, c, d], edges);
    const byId = new Map(positions.map((p) => [p.cardId, p]));

    expect(byId.get('a')!.posX).toBeLessThan(byId.get('b')!.posX);
    expect(byId.get('b')!.posX).toBe(byId.get('c')!.posX);
    expect(byId.get('b')!.posY).not.toBe(byId.get('c')!.posY);
    expect(byId.get('b')!.posX).toBeLessThan(byId.get('d')!.posX);
  });

  it('staggers cards with skip-layer edges so no link is occluded behind intermediate cards', () => {
    // Models a 11-step story plot with skip-layer causes and relates_to edges
    const cards = Array.from({ length: 11 }, (_, i) => makeCard(`c${i + 1}`, `Beat ${i + 1}`, i));
    const edges: Edge[] = [
      makeEdge('e1', 'c1', 'c2', 'causes'),
      makeEdge('e2', 'c2', 'c3', 'causes'),
      makeEdge('e3', 'c3', 'c4', 'causes'),
      makeEdge('e4', 'c4', 'c5', 'causes'),
      makeEdge('e5', 'c5', 'c6', 'causes'),
      makeEdge('e6', 'c4', 'c6', 'causes'),
      makeEdge('e7', 'c6', 'c7', 'causes'),
      makeEdge('e8', 'c4', 'c7', 'causes'),
      makeEdge('e9', 'c7', 'c8', 'causes'),
      makeEdge('e10', 'c8', 'c9', 'causes'),
      makeEdge('e11', 'c5', 'c9', 'relates_to'),
      makeEdge('e12', 'c6', 'c9', 'relates_to'),
      makeEdge('e13', 'c7', 'c9', 'relates_to'),
      makeEdge('e14', 'c9', 'c10', 'causes'),
      makeEdge('e15', 'c10', 'c11', 'causes'),
    ];

    const positions = computeAutoGraphLayout(cards, edges);
    const byId = new Map(positions.map((p) => [p.cardId, p]));

    // Must not collapse all 11 cards onto a single horizontal Y line
    const distinctYs = new Set(positions.map((p) => p.posY));
    expect(distinctYs.size).toBeGreaterThanOrEqual(3);

    // Verify ZERO strong ordering edges (blocks/causes) are occluded by intermediate cards
    const occluded: string[] = [];
    for (const edge of edges) {
      if (edge.relationType === 'relates_to') continue;
      const src = byId.get(edge.sourceCardId)!;
      const tgt = byId.get(edge.targetCardId)!;
      for (const card of cards) {
        if (card.id === edge.sourceCardId || card.id === edge.targetCardId) continue;
        const obs = byId.get(card.id)!;
        if (doesEdgeOccludeCard(src, tgt, obs)) {
          occluded.push(
            `${edge.sourceCardId}(${src.posX},${src.posY})->${edge.targetCardId}(${tgt.posX},${tgt.posY}) occluded by ${card.id}(${obs.posX},${obs.posY})`
          );
        }
      }
    }
    expect(occluded).toEqual([]);
  });
});
