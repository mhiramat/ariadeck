import { describe, it, expect } from 'vitest';
import type { Card, Edge } from '@ariadeck/core';
import { computeAutoGraphLayout } from '../autoLayout.ts';

const NOW = '2026-06-01T00:00:00.000Z';

function makeCard(id: string, title: string, createdOffset = 0): Card {
  return {
    id,
    boardId: 'b1',
    title,
    content: '',
    cardType: 'task',
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
    createdAt: `2026-06-01T00:00:0${createdOffset}.000Z`,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  };
}

function makeEdge(id: string, sourceCardId: string, targetCardId: string): Edge {
  return {
    id,
    boardId: 'b1',
    sourceCardId,
    targetCardId,
    relationType: 'blocks',
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
});
