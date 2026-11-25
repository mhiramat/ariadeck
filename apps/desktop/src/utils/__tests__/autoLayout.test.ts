import { describe, it, expect } from 'vitest';
import type { Card, Edge, RelationType } from '@ariadeck/core';
import {
  computeAutoGraphLayout,
  computeForceDirectedLayout,
  doesEdgeOccludeCard,
  type CardDimensions,
} from '../autoLayout.ts';

const NOW = '2026-06-01T00:00:00.000Z';

function makeCard(id: string, title: string, createdOffset = 0, content = ''): Card {
  return {
    id,
    boardId: 'b1',
    title,
    content,
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

  it('staggers cards vertically so neither strong nor relates_to Bezier edges are occluded', () => {
    // Models an 11-step story plot with skip-layer causes and relates_to edges
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

    // Verify ZERO edges (both causes and relates_to) are occluded by any intermediate card
    const occluded: string[] = [];
    for (const edge of edges) {
      const src = byId.get(edge.sourceCardId)!;
      const tgt = byId.get(edge.targetCardId)!;
      for (const card of cards) {
        if (card.id === edge.sourceCardId || card.id === edge.targetCardId) continue;
        const obs = byId.get(card.id)!;
        if (doesEdgeOccludeCard(src, tgt, obs, { relationType: edge.relationType })) {
          occluded.push(
            `${edge.relationType} ${edge.sourceCardId}(${src.posX},${src.posY})->${edge.targetCardId}(${tgt.posX},${tgt.posY}) occluded by ${card.id}(${obs.posX},${obs.posY})`
          );
        }
      }
    }
    expect(occluded).toEqual([]);
  });

  it('respects measured tall card heights without card-card overlap or edge occlusion', () => {
    const cards = Array.from({ length: 6 }, (_, i) =>
      makeCard(`n${i + 1}`, `Tall Card ${i + 1}`, i, 'Long markdown description with multiple lines')
    );
    const edges: Edge[] = [
      makeEdge('e1', 'n1', 'n2', 'blocks'),
      makeEdge('e2', 'n2', 'n3', 'blocks'),
      makeEdge('e3', 'n3', 'n4', 'blocks'),
      makeEdge('e4', 'n1', 'n4', 'causes'),
      makeEdge('e5', 'n2', 'n5', 'blocks'),
      makeEdge('e6', 'n4', 'n6', 'blocks'),
      makeEdge('e7', 'n5', 'n6', 'blocks'),
      makeEdge('e8', 'n1', 'n6', 'relates_to'),
    ];

    const dims = new Map<string, CardDimensions>(
      cards.map((c) => [c.id, { width: 256, height: 210 }])
    );

    const positions = computeAutoGraphLayout(cards, edges, dims);
    const byId = new Map(positions.map((p) => [p.cardId, p]));

    // Ensure no two cards overlap
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        const overlapX = a.posX < b.posX + 256 && b.posX < a.posX + 256;
        const overlapY = a.posY < b.posY + 210 && b.posY < a.posY + 210;
        expect(overlapX && overlapY).toBe(false);
      }
    }

    // Ensure zero Bezier edge occlusions with the tall 210px card boxes
    const occluded: string[] = [];
    for (const edge of edges) {
      const src = byId.get(edge.sourceCardId)!;
      const tgt = byId.get(edge.targetCardId)!;
      for (const card of cards) {
        if (card.id === edge.sourceCardId || card.id === edge.targetCardId) continue;
        const obs = byId.get(card.id)!;
        if (
          doesEdgeOccludeCard(src, tgt, obs, {
            relationType: edge.relationType,
            sourceSize: dims.get(edge.sourceCardId),
            targetSize: dims.get(edge.targetCardId),
            obstacleSize: dims.get(card.id),
          })
        ) {
          occluded.push(`${edge.id} occluded by ${card.id}`);
        }
      }
    }
    expect(occluded).toEqual([]);
  });

  it('detects Bezier S-curve occlusion accurately even when a straight line would miss', () => {
    const src = { cardId: 's', posX: 0, posY: 0 };
    const tgt = { cardId: 't', posX: 900, posY: 360 };
    // Obstacle sits near sourceX at sourceY=0; a straight line from (256,64) to (900,424)
    // is already down at y~190..260 here, while the cubic Bezier S-curve stays near y~80..120.
    const obs = { cardId: 'o', posX: 330, posY: 0 };

    expect(doesEdgeOccludeCard(src, tgt, obs, { relationType: 'blocks' })).toBe(true);
  });

  it('arranges cyclic flat boards with force-directed layout without card overlap', () => {
    const cards = Array.from({ length: 5 }, (_, i) => makeCard(`f${i + 1}`, `Entity ${i + 1}`, i));
    const edges: Edge[] = [
      makeEdge('e1', 'f1', 'f2', 'relates_to'),
      makeEdge('e2', 'f2', 'f3', 'relates_to'),
      makeEdge('e3', 'f3', 'f4', 'relates_to'),
      makeEdge('e4', 'f4', 'f5', 'relates_to'),
      makeEdge('e5', 'f5', 'f1', 'relates_to'),
      makeEdge('e6', 'f1', 'f3', 'custom'),
    ];

    const positions = computeForceDirectedLayout(cards, edges);
    expect(positions).toHaveLength(5);

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        const overlapX = a.posX < b.posX + 256 && b.posX < a.posX + 256;
        const overlapY = a.posY < b.posY + 128 && b.posY < a.posY + 128;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it('scales board spacing smoothly for 28-card Flow and Flat boards with zero card overlap', () => {
    const cards = Array.from({ length: 28 }, (_, i) => makeCard(`big-${i + 1}`, `Node ${i + 1}`, i));
    const flowEdges: Edge[] = [];
    for (let i = 0; i < 27; i++) {
      flowEdges.push(makeEdge(`fe-${i}`, `big-${Math.floor(i / 3) + 1}`, `big-${i + 2}`, 'blocks'));
    }

    const flowPos = computeAutoGraphLayout(cards, flowEdges);
    expect(flowPos).toHaveLength(28);
    for (let i = 0; i < flowPos.length; i++) {
      for (let j = i + 1; j < flowPos.length; j++) {
        const a = flowPos[i]!;
        const b = flowPos[j]!;
        const overlapX = a.posX < b.posX + 256 && b.posX < a.posX + 256;
        const overlapY = a.posY < b.posY + 128 && b.posY < a.posY + 128;
        expect(overlapX && overlapY).toBe(false);
      }
    }

    const flatEdges: Edge[] = [];
    for (let i = 0; i < 28; i++) {
      flatEdges.push(makeEdge(`re-${i}`, `big-${i + 1}`, `big-${((i + 1) % 28) + 1}`, 'relates_to'));
      if (i % 3 === 0) {
        flatEdges.push(makeEdge(`re-c-${i}`, `big-${i + 1}`, `big-${((i + 7) % 28) + 1}`, 'custom'));
      }
    }

    const flatPos = computeForceDirectedLayout(cards, flatEdges);
    expect(flatPos).toHaveLength(28);
    for (let i = 0; i < flatPos.length; i++) {
      for (let j = i + 1; j < flatPos.length; j++) {
        const a = flatPos[i]!;
        const b = flatPos[j]!;
        const overlapX = a.posX < b.posX + 256 && b.posX < a.posX + 256;
        const overlapY = a.posY < b.posY + 128 && b.posY < a.posY + 128;
        expect(overlapX && overlapY).toBe(false);
      }
    }

    // Verify large flat board actually expands to a spacious canvas area
    const xs = flatPos.map((p) => p.posX);
    const ys = flatPos.map((p) => p.posY);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1400);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(900);
  });
});
