import { computeTopologicalSteps, type Card, type Edge } from '@ariadeck/core';

export interface CardLayoutPosition {
  cardId: string;
  posX: number;
  posY: number;
}

const COLUMN_SPACING = 340;
const ROW_SPACING = 190;
const START_X = 80;
const START_Y = 80;

/**
 * Computes a clean left-to-right layered DAG layout using Kahn's topological
 * layering combined with a barycenter pass to minimize edge crossings.
 */
export function computeAutoGraphLayout(
  cards: Card[],
  edges: Edge[]
): CardLayoutPosition[] {
  const activeCards = cards.filter((c) => c.deletedAt === null);
  if (activeCards.length === 0) return [];

  const stepMap = computeTopologicalSteps(activeCards, edges);

  // Build incoming predecessor lookup for barycenter ordering
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.deletedAt !== null || edge.isConflicted) continue;
    if (edge.relationType !== 'blocks' && edge.relationType !== 'causes') continue;
    const list = predecessors.get(edge.targetCardId);
    if (list) list.push(edge.sourceCardId);
    else predecessors.set(edge.targetCardId, [edge.sourceCardId]);
  }

  // Group cards by topological step
  const layers = new Map<number, Card[]>();
  let maxLayerSize = 1;
  for (const card of activeCards) {
    const step = stepMap.get(card.id) ?? 0;
    const bucket = layers.get(step);
    if (bucket) {
      bucket.push(card);
    } else {
      layers.set(step, [card]);
    }
  }

  for (const bucket of layers.values()) {
    if (bucket.length > maxLayerSize) {
      maxLayerSize = bucket.length;
    }
  }

  const sortedSteps = Array.from(layers.keys()).sort((a, b) => a - b);
  const assignedY = new Map<string, number>();
  const positions: CardLayoutPosition[] = [];
  const totalHeight = (maxLayerSize - 1) * ROW_SPACING;

  for (const step of sortedSteps) {
    const layerCards = layers.get(step)!;

    // Order nodes in this layer by average Y of their predecessors (barycenter heuristic)
    layerCards.sort((a, b) => {
      const avgY = (card: Card): number => {
        const preds = (predecessors.get(card.id) ?? [])
          .map((id) => assignedY.get(id))
          .filter((y): y is number => y !== undefined);
        if (preds.length === 0) return Number.POSITIVE_INFINITY;
        return preds.reduce((sum, y) => sum + y, 0) / preds.length;
      };
      const ya = avgY(a);
      const yb = avgY(b);
      if (ya !== yb) return ya - yb;
      return a.createdAt.localeCompare(b.createdAt);
    });

    const layerHeight = (layerCards.length - 1) * ROW_SPACING;
    const verticalOffset = START_Y + (totalHeight - layerHeight) / 2;

    for (let row = 0; row < layerCards.length; row++) {
      const card = layerCards[row]!;
      const posX = Math.round(START_X + step * COLUMN_SPACING);
      const posY = Math.round(verticalOffset + row * ROW_SPACING);
      assignedY.set(card.id, posY);
      positions.push({ cardId: card.id, posX, posY });
    }
  }

  return positions;
}
