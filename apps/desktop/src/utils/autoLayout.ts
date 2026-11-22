import { computeTopologicalSteps, type Card, type Edge } from '@ariadeck/core';

export interface CardLayoutPosition {
  cardId: string;
  posX: number;
  posY: number;
}

const CARD_WIDTH = 256;
const CARD_HEIGHT = 128;
const COLUMN_SPACING = 340;
const REAL_NODE_GAP = 175;
const DUMMY_LANE_GAP = 85;
const START_X = 80;
const BASELINE_Y = 80;

interface LayoutNode {
  id: string;
  isDummy: boolean;
  step: number;
  targetStep: number; // Used as tie-breaker so shorter edges sit cleanly above/beside longer chords
  order: number;
  y: number;
}

interface DirectedLink {
  source: string;
  target: string;
}

/**
 * Checks whether the straight corridor connecting two cards (right-center of source
 * to left-center of target) passes through the padded bounding box of an intermediate card.
 */
export function doesEdgeOccludeCard(
  source: CardLayoutPosition,
  target: CardLayoutPosition,
  obstacle: CardLayoutPosition,
  padding = 14
): boolean {
  const x1 = source.posX + CARD_WIDTH;
  const y1 = source.posY + CARD_HEIGHT / 2;
  const x2 = target.posX;
  const y2 = target.posY + CARD_HEIGHT / 2;

  const minX = obstacle.posX - padding;
  const maxX = obstacle.posX + CARD_WIDTH + padding;
  const minY = obstacle.posY - padding;
  const maxY = obstacle.posY + CARD_HEIGHT + padding;

  // Obstacle must lie horizontally between source and target
  if (maxX <= Math.min(x1, x2) || minX >= Math.max(x1, x2)) {
    return false;
  }

  const dx = x2 - x1;
  if (Math.abs(dx) < 1e-6) {
    return false;
  }

  // Evaluate Y at the left and right edges of the obstacle bounding box
  const tLeft = Math.max(0, Math.min(1, (minX - x1) / dx));
  const tRight = Math.max(0, Math.min(1, (maxX - x1) / dx));
  const yAtLeft = y1 + (y2 - y1) * tLeft;
  const yAtRight = y1 + (y2 - y1) * tRight;

  const segMinY = Math.min(yAtLeft, yAtRight);
  const segMaxY = Math.max(yAtLeft, yAtRight);

  return segMaxY >= minY && segMinY <= maxY;
}

/**
 * Computes a Sugiyama-style left-to-right layered DAG layout that inserts
 * virtual dummy corridor nodes for long-span edges (including relates_to chords),
 * minimizes crossings with barycenter sweeps, and verifies that no skip-layer
 * edge is occluded behind an intermediate card.
 */
export function computeAutoGraphLayout(
  cards: Card[],
  edges: Edge[]
): CardLayoutPosition[] {
  const activeCards = cards.filter((c) => c.deletedAt === null);
  if (activeCards.length === 0) return [];

  const cardById = new Map(activeCards.map((c) => [c.id, c]));
  const stepMap = computeTopologicalSteps(activeCards, edges);
  // Only strong ordering edges (blocks / causes) govern horizontal left-to-right layout.
  // Weak relates_to edges attach via top/bottom handles and do not distort horizontal flow.
  const activeEdges = edges.filter(
    (e) =>
      e.deletedAt === null &&
      !e.isConflicted &&
      (e.relationType === 'blocks' || e.relationType === 'causes') &&
      cardById.has(e.sourceCardId) &&
      cardById.has(e.targetCardId) &&
      e.sourceCardId !== e.targetCardId
  );

  // 1. Build layout nodes (real cards + virtual dummy corridor nodes for edges spanning > 1 step)
  const layoutNodes = new Map<string, LayoutNode>();
  const layers = new Map<number, LayoutNode[]>();

  const addNodeToLayer = (node: LayoutNode) => {
    layoutNodes.set(node.id, node);
    const bucket = layers.get(node.step);
    if (bucket) bucket.push(node);
    else layers.set(node.step, [node]);
  };

  for (const card of activeCards) {
    const step = stepMap.get(card.id) ?? 0;
    addNodeToLayer({
      id: card.id,
      isDummy: false,
      step,
      targetStep: step,
      order: 0,
      y: BASELINE_Y,
    });
  }

  const expandedLinks: DirectedLink[] = [];
  let dummySeq = 0;

  for (const edge of activeEdges) {
    const sStep = stepMap.get(edge.sourceCardId) ?? 0;
    const tStep = stepMap.get(edge.targetCardId) ?? 0;

    // Orient left-to-right for corridor allocation
    const leftId = sStep <= tStep ? edge.sourceCardId : edge.targetCardId;
    const rightId = sStep <= tStep ? edge.targetCardId : edge.sourceCardId;
    const leftStep = Math.min(sStep, tStep);
    const rightStep = Math.max(sStep, tStep);

    if (rightStep - leftStep <= 1) {
      expandedLinks.push({ source: leftId, target: rightId });
      continue;
    }

    // Insert a virtual corridor node at every intermediate step strictly between leftStep and rightStep
    let prevId = leftId;
    for (let step = leftStep + 1; step < rightStep; step++) {
      const dummyId = `__dummy_${dummySeq++}`;
      addNodeToLayer({
        id: dummyId,
        isDummy: true,
        step,
        targetStep: rightStep,
        order: 0,
        y: BASELINE_Y,
      });
      expandedLinks.push({ source: prevId, target: dummyId });
      prevId = dummyId;
    }
    expandedLinks.push({ source: prevId, target: rightId });
  }

  // Build adjacency for barycenter sweeps
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const link of expandedLinks) {
    const p = preds.get(link.target);
    if (p) p.push(link.source);
    else preds.set(link.target, [link.source]);

    const s = succs.get(link.source);
    if (s) s.push(link.target);
    else succs.set(link.source, [link.target]);
  }

  const sortedSteps = Array.from(layers.keys()).sort((a, b) => a - b);

  // Initial deterministic ordering within each layer:
  // real cards first (or sorted by targetStep so shorter spans fan cleanly from longer chords)
  for (const step of sortedSteps) {
    const bucket = layers.get(step)!;
    bucket.sort((a, b) => {
      if (a.targetStep !== b.targetStep) return a.targetStep - b.targetStep;
      if (a.isDummy !== b.isDummy) return a.isDummy ? 1 : -1;
      return a.id.localeCompare(b.id);
    });
    bucket.forEach((node, idx) => {
      node.order = idx;
    });
  }

  // 2. Barycenter crossing-minimization sweeps (forward and backward)
  const barycenter = (nodeId: string, neighbors: Map<string, string[]>): number | null => {
    const list = neighbors.get(nodeId);
    if (!list || list.length === 0) return null;
    let sum = 0;
    let count = 0;
    for (const nId of list) {
      const n = layoutNodes.get(nId);
      if (n) {
        sum += n.order;
        count += 1;
      }
    }
    return count > 0 ? sum / count : null;
  };

  for (let pass = 0; pass < 4; pass++) {
    // Forward sweep
    for (let i = 1; i < sortedSteps.length; i++) {
      const bucket = layers.get(sortedSteps[i]!)!;
      bucket.sort((a, b) => {
        const ba = barycenter(a.id, preds) ?? a.order;
        const bb = barycenter(b.id, preds) ?? b.order;
        if (Math.abs(ba - bb) > 1e-6) return ba - bb;
        if (a.targetStep !== b.targetStep) return a.targetStep - b.targetStep;
        return a.order - b.order;
      });
      bucket.forEach((node, idx) => {
        node.order = idx;
      });
    }

    // Backward sweep
    for (let i = sortedSteps.length - 2; i >= 0; i--) {
      const bucket = layers.get(sortedSteps[i]!)!;
      bucket.sort((a, b) => {
        const ba = barycenter(a.id, succs) ?? a.order;
        const bb = barycenter(b.id, succs) ?? b.order;
        if (Math.abs(ba - bb) > 1e-6) return ba - bb;
        if (a.targetStep !== b.targetStep) return a.targetStep - b.targetStep;
        return a.order - b.order;
      });
      bucket.forEach((node, idx) => {
        node.order = idx;
      });
    }
  }

  // 3. Assign Y coordinates per layer, centering each layer around BASELINE_Y
  for (const step of sortedSteps) {
    const bucket = layers.get(step)!;
    const offsets: number[] = [0];
    for (let i = 1; i < bucket.length; i++) {
      const prev = bucket[i - 1]!;
      const curr = bucket[i]!;
      const gap = !prev.isDummy && !curr.isDummy
        ? REAL_NODE_GAP
        : prev.isDummy && curr.isDummy
          ? DUMMY_LANE_GAP
          : (REAL_NODE_GAP + DUMMY_LANE_GAP) / 2;
      offsets.push(offsets[i - 1]! + gap);
    }
    const span = offsets[offsets.length - 1] ?? 0;
    for (let i = 0; i < bucket.length; i++) {
      bucket[i]!.y = Math.round(BASELINE_Y + offsets[i]! - span / 2);
    }
  }

  // Extract real card positions
  const posById = new Map<string, CardLayoutPosition>();
  for (const card of activeCards) {
    const node = layoutNodes.get(card.id)!;
    posById.set(card.id, {
      cardId: card.id,
      posX: Math.round(START_X + node.step * COLUMN_SPACING),
      posY: node.y,
    });
  }

  // 4. Geometric occlusion-avoidance pass:
  // Ensure no skip-layer edge passes behind an intermediate card's bounding box.
  const longEdges = activeEdges.filter((e) => {
    const s = stepMap.get(e.sourceCardId) ?? 0;
    const t = stepMap.get(e.targetCardId) ?? 0;
    return Math.abs(t - s) > 1;
  });

  const measureOcclusions = (): { count: number; overlapPx: number } => {
    let count = 0;
    let overlapPx = 0;
    const PADDING = 14;
    for (const edge of longEdges) {
      const src = posById.get(edge.sourceCardId)!;
      const tgt = posById.get(edge.targetCardId)!;
      const left = src.posX <= tgt.posX ? src : tgt;
      const right = src.posX <= tgt.posX ? tgt : src;
      const x1 = left.posX + CARD_WIDTH;
      const y1 = left.posY + CARD_HEIGHT / 2;
      const x2 = right.posX;
      const y2 = right.posY + CARD_HEIGHT / 2;
      const dx = Math.max(1, x2 - x1);

      for (const card of activeCards) {
        if (card.id === edge.sourceCardId || card.id === edge.targetCardId) continue;
        const obs = posById.get(card.id)!;
        if (doesEdgeOccludeCard(left, right, obs)) {
          count += 1;
          const tLeft = Math.max(0, Math.min(1, (obs.posX - PADDING - x1) / dx));
          const tRight = Math.max(0, Math.min(1, (obs.posX + CARD_WIDTH + PADDING - x1) / dx));
          const yL = y1 + (y2 - y1) * tLeft;
          const yR = y1 + (y2 - y1) * tRight;
          const segMin = Math.min(yL, yR);
          const segMax = Math.max(yL, yR);
          const boxMin = obs.posY - PADDING;
          const boxMax = obs.posY + CARD_HEIGHT + PADDING;
          overlapPx += Math.max(0, Math.min(segMax, boxMax) - Math.max(segMin, boxMin));
        }
      }
    }
    return { count, overlapPx };
  };

  if (longEdges.length > 0) {
    const PADDING = 20;

    type MoveCandidate = {
      pos: CardLayoutPosition;
      y: number;
      count: number;
      overlapPx: number;
      dist: number;
    };

    const tryCandidate = (
      targetPos: CardLayoutPosition,
      candidateY: number,
      best: MoveCandidate | null
    ): MoveCandidate => {
      const prevY = targetPos.posY;
      targetPos.posY = candidateY;
      const { count, overlapPx } = measureOcclusions();
      targetPos.posY = prevY;
      const dist = Math.abs(candidateY - prevY);
      if (
        !best ||
        count < best.count ||
        (count === best.count && overlapPx < best.overlapPx - 1) ||
        (count === best.count &&
          Math.abs(overlapPx - best.overlapPx) <= 1 &&
          dist < best.dist)
      ) {
        return { pos: targetPos, y: candidateY, count, overlapPx, dist };
      }
      return best;
    };

    for (let iter = 0; iter < 32; iter++) {
      const current = measureOcclusions();
      if (current.count === 0) break;

      let bestMove: MoveCandidate | null = null;

      for (const edge of longEdges) {
        const srcPos = posById.get(edge.sourceCardId)!;
        const tgtPos = posById.get(edge.targetCardId)!;
        const leftPos = srcPos.posX <= tgtPos.posX ? srcPos : tgtPos;
        const rightPos = srcPos.posX <= tgtPos.posX ? tgtPos : srcPos;

        for (const card of activeCards) {
          if (card.id === edge.sourceCardId || card.id === edge.targetCardId) continue;
          const obsPos = posById.get(card.id)!;
          if (!doesEdgeOccludeCard(leftPos, rightPos, obsPos)) continue;

          // Compute exact min/max Y of the edge segment across the obstacle's horizontal span
          const x1 = leftPos.posX + CARD_WIDTH;
          const y1 = leftPos.posY + CARD_HEIGHT / 2;
          const x2 = rightPos.posX;
          const y2 = rightPos.posY + CARD_HEIGHT / 2;
          const dx = Math.max(1, x2 - x1);
          const tLeft = Math.max(0, Math.min(1, (obsPos.posX - PADDING - x1) / dx));
          const tRight = Math.max(0, Math.min(1, (obsPos.posX + CARD_WIDTH + PADDING - x1) / dx));
          const yAtLeft = y1 + (y2 - y1) * tLeft;
          const yAtRight = y1 + (y2 - y1) * tRight;
          const segMinY = Math.min(yAtLeft, yAtRight);
          const segMaxY = Math.max(yAtLeft, yAtRight);

          // Move the intermediate obstacle completely below or above the edge
          bestMove = tryCandidate(obsPos, Math.ceil(segMaxY + PADDING), bestMove);
          bestMove = tryCandidate(obsPos, Math.floor(segMinY - PADDING - CARD_HEIGHT), bestMove);

          // Also evaluate lifting/lowering either endpoint to open a clear chord corridor
          for (const delta of [-REAL_NODE_GAP, REAL_NODE_GAP, -REAL_NODE_GAP * 1.5, REAL_NODE_GAP * 1.5]) {
            bestMove = tryCandidate(rightPos, Math.round(rightPos.posY + delta), bestMove);
            bestMove = tryCandidate(leftPos, Math.round(leftPos.posY + delta), bestMove);
          }
        }
      }

      const improved =
        bestMove !== null &&
        (bestMove.count < current.count ||
          (bestMove.count === current.count && bestMove.overlapPx < current.overlapPx - 1));

      if (!improved || !bestMove) {
        break;
      }

      bestMove.pos.posY = bestMove.y;

      // Resolve any same-column overlaps created by nudging
      for (const step of sortedSteps) {
        const colCards = activeCards
          .filter((c) => (stepMap.get(c.id) ?? 0) === step)
          .map((c) => posById.get(c.id)!)
          .sort((a, b) => a.posY - b.posY);

        for (let i = 1; i < colCards.length; i++) {
          const prev = colCards[i - 1]!;
          const curr = colCards[i]!;
          if (curr.posY - prev.posY < REAL_NODE_GAP) {
            curr.posY = prev.posY + REAL_NODE_GAP;
          }
        }
      }
    }
  }

  return activeCards.map((c) => posById.get(c.id)!);
}
