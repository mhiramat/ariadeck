import type {
  Card,
  Edge,
  TimelineStepGroup,
  TimelineViolation,
} from '../types/models.js';

function isOrderingEdge(edge: Edge): boolean {
  return (
    edge.deletedAt === null &&
    !edge.isConflicted &&
    (edge.relationType === 'blocks' || edge.relationType === 'causes')
  );
}

function compareCardsWithinStep(a: Card, b: Card): number {
  if (a.startAt && b.startAt) {
    const cmp = a.startAt.localeCompare(b.startAt);
    if (cmp !== 0) return cmp;
  } else if (a.startAt && !b.startAt) {
    return -1;
  } else if (!a.startAt && b.startAt) {
    return 1;
  }
  const createdCmp = a.createdAt.localeCompare(b.createdAt);
  if (createdCmp !== 0) return createdCmp;
  return a.title.localeCompare(b.title);
}

/**
 * Computes longest-path timeline step indices using Kahn's topological sort.
 * Conflicted edges and non-ordering 'relates_to' edges are ignored so cycles
 * never cause infinite loops.
 */
export function computeTopologicalSteps(
  cards: Card[],
  edges: Edge[]
): Map<string, number> {
  const activeCards = cards.filter((c) => c.deletedAt === null);
  const cardIds = new Set(activeCards.map((c) => c.id));

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const stepById = new Map<string, number>();

  for (const card of activeCards) {
    inDegree.set(card.id, 0);
    adjacency.set(card.id, []);
    stepById.set(card.id, 0);
  }

  for (const edge of edges) {
    if (!isOrderingEdge(edge)) continue;
    if (!cardIds.has(edge.sourceCardId) || !cardIds.has(edge.targetCardId)) continue;
    if (edge.sourceCardId === edge.targetCardId) continue;

    adjacency.get(edge.sourceCardId)!.push(edge.targetCardId);
    inDegree.set(edge.targetCardId, (inDegree.get(edge.targetCardId) ?? 0) + 1);
  }

  // Kahn's algorithm queue seeded with all root nodes (in-degree 0 -> Step 0)
  const queue: string[] = [];
  for (const card of activeCards) {
    if (inDegree.get(card.id) === 0) {
      queue.push(card.id);
    }
  }

  const visited = new Set<string>();
  let head = 0;

  while (head < queue.length) {
    const currentId = queue[head++]!;
    visited.add(currentId);
    const currentStep = stepById.get(currentId) ?? 0;

    for (const neighborId of adjacency.get(currentId) ?? []) {
      const nextStep = Math.max(stepById.get(neighborId) ?? 0, currentStep + 1);
      stepById.set(neighborId, nextStep);

      const remaining = (inDegree.get(neighborId) ?? 1) - 1;
      inDegree.set(neighborId, remaining);
      if (remaining === 0) {
        queue.push(neighborId);
      }
    }
  }

  // Fallback for any unvisited nodes (e.g., if legacy/unflagged cyclic data exists)
  if (visited.size < activeCards.length) {
    let maxStep = 0;
    for (const step of stepById.values()) {
      if (step > maxStep) maxStep = step;
    }
    for (const card of activeCards) {
      if (!visited.has(card.id)) {
        stepById.set(card.id, maxStep + 1);
      }
    }
  }

  return stepById;
}

/**
 * Groups cards into ordered timeline step columns using each card's timelineOrder.
 */
export function groupCardsByTimelineStep(cards: Card[]): TimelineStepGroup[] {
  const byStep = new Map<number, Card[]>();
  for (const card of cards) {
    if (card.deletedAt !== null) continue;
    const step = card.timelineOrder ?? 0;
    const bucket = byStep.get(step);
    if (bucket) {
      bucket.push(card);
    } else {
      byStep.set(step, [card]);
    }
  }

  return Array.from(byStep.entries())
    .sort(([a], [b]) => a - b)
    .map(([step, groupCards]) => ({
      step,
      cards: [...groupCards].sort(compareCardsWithinStep),
    }));
}

/**
 * Detects real-time dependency ordering violations where a dependent card is
 * positioned at or before its prerequisite card in the timeline.
 */
export function detectTimelineViolations(
  cards: Card[],
  edges: Edge[]
): TimelineViolation[] {
  const cardById = new Map<string, Card>();
  for (const card of cards) {
    if (card.deletedAt === null) {
      cardById.set(card.id, card);
    }
  }

  const violations: TimelineViolation[] = [];
  for (const edge of edges) {
    if (!isOrderingEdge(edge)) continue;
    const source = cardById.get(edge.sourceCardId);
    const target = cardById.get(edge.targetCardId);
    if (!source || !target) continue;
    if (source.timelineOrder === null || target.timelineOrder === null) continue;

    if (source.timelineOrder >= target.timelineOrder) {
      violations.push({
        edgeId: edge.id,
        sourceCardId: source.id,
        targetCardId: target.id,
        sourceStep: source.timelineOrder,
        targetStep: target.timelineOrder,
        reason: `"${source.title}" (Step ${source.timelineOrder}) must precede "${target.title}" (Step ${target.timelineOrder}).`,
      });
    }
  }

  return violations;
}
