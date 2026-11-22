import { computeTopologicalSteps, type Card, type Edge, type RelationType } from '@ariadeck/core';

export interface CardLayoutPosition {
  cardId: string;
  posX: number;
  posY: number;
}

export interface CardDimensions {
  width: number;
  height: number;
}

export type HandleSide = 'left' | 'right' | 'top' | 'bottom';

export interface EdgeHandlePair {
  sourceHandle: HandleSide;
  targetHandle: HandleSide;
}

export interface EdgeOcclusionOptions {
  relationType?: RelationType;
  sourceSize?: CardDimensions;
  targetSize?: CardDimensions;
  obstacleSize?: CardDimensions;
  padding?: number;
}

const DEFAULT_CARD_WIDTH = 256;
const DEFAULT_CARD_HEIGHT = 128;
const COLUMN_GAP = 96;
const MIN_VERTICAL_GAP = 48;
const DUMMY_LANE_GAP = 88;
const START_X = 80;
const BASELINE_Y = 80;
const OCCLUSION_PADDING = 14;
const CLEARANCE_PADDING = 22;
const BEZIER_CURVATURE = 0.25;
const BEZIER_SAMPLES = 24;

interface LayoutNode {
  id: string;
  isDummy: boolean;
  step: number;
  targetStep: number; // Used as tie-breaker so shorter edges sit cleanly above/beside longer chords
  order: number;
  height: number;
  y: number;
}

interface DirectedLink {
  source: string;
  target: string;
}

interface CubicBezier {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface BezierOcclusionHit {
  occluded: boolean;
  penetrationPx: number;
  curveMinY: number;
  curveMaxY: number;
}

/**
 * Selects the handle sides used to render an edge between two cards.
 * Shared between GraphCanvas rendering and auto-layout occlusion analysis so
 * layout geometry matches the rendered Bezier curves.
 */
export function resolveEdgeHandles(
  relationType: RelationType,
  srcPos: { x: number; y: number } | undefined,
  tgtPos: { x: number; y: number } | undefined
): EdgeHandlePair {
  if (relationType !== 'relates_to') {
    return { sourceHandle: 'right', targetHandle: 'left' };
  }
  if (!srcPos || !tgtPos) {
    return { sourceHandle: 'bottom', targetHandle: 'top' };
  }
  if (srcPos.y + 40 < tgtPos.y) {
    return { sourceHandle: 'bottom', targetHandle: 'top' };
  }
  if (srcPos.y > tgtPos.y + 40) {
    return { sourceHandle: 'top', targetHandle: 'bottom' };
  }
  return { sourceHandle: 'top', targetHandle: 'top' };
}

function estimateCardDimensions(
  card: Card,
  nodeDimensions?: ReadonlyMap<string, CardDimensions>
): CardDimensions {
  const measured = nodeDimensions?.get(card.id);
  if (measured && measured.width > 0 && measured.height > 0) {
    return {
      width: Math.ceil(measured.width),
      height: Math.ceil(measured.height),
    };
  }
  let height = DEFAULT_CARD_HEIGHT;
  if (card.content.trim().length > 0) {
    height += 48;
  }
  if (card.tags.length > 0) {
    height += 24;
  }
  return { width: DEFAULT_CARD_WIDTH, height };
}

function getHandleAnchor(
  pos: CardLayoutPosition,
  size: CardDimensions,
  side: HandleSide
): [number, number] {
  switch (side) {
    case 'left':
      return [pos.posX, pos.posY + size.height / 2];
    case 'right':
      return [pos.posX + size.width, pos.posY + size.height / 2];
    case 'top':
      return [pos.posX + size.width / 2, pos.posY];
    case 'bottom':
      return [pos.posX + size.width / 2, pos.posY + size.height];
  }
}

/**
 * Matches @xyflow/system's calculateControlOffset / getControlWithCurvature
 * so occlusion detection tracks the exact cubic Bezier curve rendered on screen.
 */
function calculateControlOffset(distance: number, curvature: number): number {
  if (distance >= 0) {
    return 0.5 * distance;
  }
  return curvature * 25 * Math.sqrt(-distance);
}

function getControlWithCurvature(
  side: HandleSide,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  c = BEZIER_CURVATURE
): [number, number] {
  switch (side) {
    case 'left':
      return [x1 - calculateControlOffset(x1 - x2, c), y1];
    case 'right':
      return [x1 + calculateControlOffset(x2 - x1, c), y1];
    case 'top':
      return [x1, y1 - calculateControlOffset(y1 - y2, c)];
    case 'bottom':
      return [x1, y1 + calculateControlOffset(y2 - y1, c)];
  }
}

function buildEdgeBezier(
  source: CardLayoutPosition,
  target: CardLayoutPosition,
  relationType: RelationType,
  sourceSize: CardDimensions,
  targetSize: CardDimensions
): CubicBezier {
  const { sourceHandle, targetHandle } = resolveEdgeHandles(
    relationType,
    { x: source.posX, y: source.posY },
    { x: target.posX, y: target.posY }
  );
  const [x0, y0] = getHandleAnchor(source, sourceSize, sourceHandle);
  const [x3, y3] = getHandleAnchor(target, targetSize, targetHandle);
  const [x1, y1] = getControlWithCurvature(sourceHandle, x0, y0, x3, y3);
  const [x2, y2] = getControlWithCurvature(targetHandle, x3, y3, x0, y0);

  return {
    x0,
    y0,
    x1,
    y1,
    x2,
    y2,
    x3,
    y3,
    minX: Math.min(x0, x1, x2, x3),
    maxX: Math.max(x0, x1, x2, x3),
    minY: Math.min(y0, y1, y2, y3),
    maxY: Math.max(y0, y1, y2, y3),
  };
}

function evalCubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/**
 * Computes the clipped segment length inside an axis-aligned rectangle using
 * Liang-Barsky clipping. Returns 0 if the segment does not intersect the box.
 */
function segmentBoxOverlapLength(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;

  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    !clip(-dx, ax - minX) ||
    !clip(dx, maxX - ax) ||
    !clip(-dy, ay - minY) ||
    !clip(dy, maxY - ay)
  ) {
    return 0;
  }

  if (t1 < t0) return 0;
  const segLen = Math.hypot(dx, dy);
  return Math.max(1e-3, (t1 - t0) * segLen);
}

function inspectBezierOcclusion(
  bezier: CubicBezier,
  obstacle: CardLayoutPosition,
  obstacleSize: CardDimensions,
  padding = OCCLUSION_PADDING
): BezierOcclusionHit {
  const minX = obstacle.posX - padding;
  const maxX = obstacle.posX + obstacleSize.width + padding;
  const minY = obstacle.posY - padding;
  const maxY = obstacle.posY + obstacleSize.height + padding;

  // Fast convex-hull AABB rejection
  if (
    bezier.maxX < minX ||
    bezier.minX > maxX ||
    bezier.maxY < minY ||
    bezier.minY > maxY
  ) {
    return {
      occluded: false,
      penetrationPx: 0,
      curveMinY: Number.POSITIVE_INFINITY,
      curveMaxY: Number.NEGATIVE_INFINITY,
    };
  }

  let penetrationPx = 0;
  let curveMinY = Number.POSITIVE_INFINITY;
  let curveMaxY = Number.NEGATIVE_INFINITY;

  let prevX = bezier.x0;
  let prevY = bezier.y0;

  for (let i = 1; i <= BEZIER_SAMPLES; i++) {
    const t = i / BEZIER_SAMPLES;
    const currX = evalCubic(bezier.x0, bezier.x1, bezier.x2, bezier.x3, t);
    const currY = evalCubic(bezier.y0, bezier.y1, bezier.y2, bezier.y3, t);

    const segMinX = Math.min(prevX, currX);
    const segMaxX = Math.max(prevX, currX);
    if (segMaxX >= minX && segMinX <= maxX) {
      curveMinY = Math.min(curveMinY, prevY, currY);
      curveMaxY = Math.max(curveMaxY, prevY, currY);

      const overlap = segmentBoxOverlapLength(
        prevX,
        prevY,
        currX,
        currY,
        minX,
        maxX,
        minY,
        maxY
      );
      if (overlap > 0) {
        penetrationPx += overlap;
      }
    }

    prevX = currX;
    prevY = currY;
  }

  return {
    occluded: penetrationPx > 0,
    penetrationPx,
    curveMinY,
    curveMaxY,
  };
}

/**
 * Checks whether the rendered cubic Bezier edge connecting two cards passes
 * through the padded bounding box of an intermediate/neighboring card.
 */
export function doesEdgeOccludeCard(
  source: CardLayoutPosition,
  target: CardLayoutPosition,
  obstacle: CardLayoutPosition,
  paddingOrOptions: number | EdgeOcclusionOptions = OCCLUSION_PADDING
): boolean {
  const opts: EdgeOcclusionOptions =
    typeof paddingOrOptions === 'number'
      ? { padding: paddingOrOptions }
      : paddingOrOptions;

  const defaultSize: CardDimensions = {
    width: DEFAULT_CARD_WIDTH,
    height: DEFAULT_CARD_HEIGHT,
  };
  const bezier = buildEdgeBezier(
    source,
    target,
    opts.relationType ?? 'blocks',
    opts.sourceSize ?? defaultSize,
    opts.targetSize ?? defaultSize
  );
  return inspectBezierOcclusion(
    bezier,
    obstacle,
    opts.obstacleSize ?? defaultSize,
    opts.padding ?? OCCLUSION_PADDING
  ).occluded;
}

/**
 * Computes a Sugiyama-style left-to-right layered DAG layout and then optimizes
 * vertical card positions so rendered cubic Bezier edges (both strong ordering
 * edges and vertical relates_to edges) avoid passing behind cards.
 */
export function computeAutoGraphLayout(
  cards: Card[],
  edges: Edge[],
  nodeDimensions?: ReadonlyMap<string, CardDimensions>
): CardLayoutPosition[] {
  const activeCards = cards.filter((c) => c.deletedAt === null);
  if (activeCards.length === 0) return [];

  const cardById = new Map(activeCards.map((c) => [c.id, c]));
  const dimsById = new Map<string, CardDimensions>();
  let maxCardWidth = DEFAULT_CARD_WIDTH;
  for (const card of activeCards) {
    const dims = estimateCardDimensions(card, nodeDimensions);
    dimsById.set(card.id, dims);
    if (dims.width > maxCardWidth) maxCardWidth = dims.width;
  }
  const columnSpacing = maxCardWidth + COLUMN_GAP;

  const stepMap = computeTopologicalSteps(activeCards, edges);

  const allActiveEdges = edges.filter(
    (e) =>
      e.deletedAt === null &&
      !e.isConflicted &&
      cardById.has(e.sourceCardId) &&
      cardById.has(e.targetCardId) &&
      e.sourceCardId !== e.targetCardId
  );

  // Only strong ordering edges (blocks / causes) govern horizontal left-to-right columns
  // and Sugiyama dummy corridor lanes. Weak relates_to edges attach via top/bottom handles
  // and are optimized vertically in the occlusion-avoidance pass.
  const strongEdges = allActiveEdges.filter(
    (e) => e.relationType === 'blocks' || e.relationType === 'causes'
  );

  // 1. Build layout nodes (real cards + virtual dummy corridor nodes for strong skip-layer edges)
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
      height: dimsById.get(card.id)!.height,
      y: BASELINE_Y,
    });
  }

  const expandedLinks: DirectedLink[] = [];
  let dummySeq = 0;

  for (const edge of strongEdges) {
    const sStep = stepMap.get(edge.sourceCardId) ?? 0;
    const tStep = stepMap.get(edge.targetCardId) ?? 0;

    const leftId = sStep <= tStep ? edge.sourceCardId : edge.targetCardId;
    const rightId = sStep <= tStep ? edge.targetCardId : edge.sourceCardId;
    const leftStep = Math.min(sStep, tStep);
    const rightStep = Math.max(sStep, tStep);

    if (rightStep - leftStep <= 1) {
      expandedLinks.push({ source: leftId, target: rightId });
      continue;
    }

    let prevId = leftId;
    for (let step = leftStep + 1; step < rightStep; step++) {
      const dummyId = `__dummy_${dummySeq++}`;
      addNodeToLayer({
        id: dummyId,
        isDummy: true,
        step,
        targetStep: rightStep,
        order: 0,
        height: 24,
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

  // 3. Assign initial Y coordinates per layer using actual card heights
  for (const step of sortedSteps) {
    const bucket = layers.get(step)!;
    const offsets: number[] = [0];
    for (let i = 1; i < bucket.length; i++) {
      const prev = bucket[i - 1]!;
      const curr = bucket[i]!;
      const gap = !prev.isDummy && !curr.isDummy
        ? prev.height + MIN_VERTICAL_GAP
        : prev.isDummy && curr.isDummy
          ? DUMMY_LANE_GAP
          : prev.isDummy
            ? DUMMY_LANE_GAP
            : prev.height + DUMMY_LANE_GAP / 2;
      offsets.push(offsets[i - 1]! + gap);
    }
    const lastNode = bucket[bucket.length - 1]!;
    const totalHeight = offsets[offsets.length - 1]! + lastNode.height;
    for (let i = 0; i < bucket.length; i++) {
      bucket[i]!.y = Math.round(BASELINE_Y + offsets[i]! - totalHeight / 2);
    }
  }

  // Extract real card positions and column index
  const posById = new Map<string, CardLayoutPosition>();
  const columnCardsByStep = new Map<number, CardLayoutPosition[]>();
  for (const card of activeCards) {
    const node = layoutNodes.get(card.id)!;
    const pos: CardLayoutPosition = {
      cardId: card.id,
      posX: Math.round(START_X + node.step * columnSpacing),
      posY: node.y,
    };
    posById.set(card.id, pos);
    const col = columnCardsByStep.get(node.step);
    if (col) col.push(pos);
    else columnCardsByStep.set(node.step, [pos]);
  }

  // 4. Bezier occlusion-avoidance pass via vertical card shifting
  // Evaluates every active edge (both strong horizontal and vertical relates_to)
  // against every other card using the exact rendered cubic Bezier curve.
  interface OcclusionEvent {
    edge: Edge;
    obstacleId: string;
    curveMinY: number;
    curveMaxY: number;
    penetrationPx: number;
  }

  interface LayoutScore {
    totalOcclusions: number;
    strongOcclusions: number;
    penetrationPx: number;
    compactnessCost: number;
  }

  const evaluateLayout = (collectEvents = false): { score: LayoutScore; events: OcclusionEvent[] } => {
    let totalOcclusions = 0;
    let strongOcclusions = 0;
    let penetrationPx = 0;
    const events: OcclusionEvent[] = [];

    for (const edge of allActiveEdges) {
      const srcPos = posById.get(edge.sourceCardId)!;
      const tgtPos = posById.get(edge.targetCardId)!;
      const bezier = buildEdgeBezier(
        srcPos,
        tgtPos,
        edge.relationType,
        dimsById.get(edge.sourceCardId)!,
        dimsById.get(edge.targetCardId)!
      );

      for (const card of activeCards) {
        if (card.id === edge.sourceCardId || card.id === edge.targetCardId) continue;
        const obsPos = posById.get(card.id)!;
        const hit = inspectBezierOcclusion(
          bezier,
          obsPos,
          dimsById.get(card.id)!,
          OCCLUSION_PADDING
        );
        if (hit.occluded) {
          totalOcclusions += 1;
          if (edge.relationType !== 'relates_to') {
            strongOcclusions += 1;
          }
          penetrationPx += hit.penetrationPx;
          if (collectEvents) {
            events.push({
              edge,
              obstacleId: card.id,
              curveMinY: hit.curveMinY,
              curveMaxY: hit.curveMaxY,
              penetrationPx: hit.penetrationPx,
            });
          }
        }
      }
    }

    // Light compactness tie-breaker: prefer smaller vertical spread and shorter vertical jumps
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const card of activeCards) {
      const p = posById.get(card.id)!;
      const h = dimsById.get(card.id)!.height;
      if (p.posY < minY) minY = p.posY;
      if (p.posY + h > maxY) maxY = p.posY + h;
    }
    let edgeVerticalSpan = 0;
    for (const edge of allActiveEdges) {
      const srcPos = posById.get(edge.sourceCardId)!;
      const tgtPos = posById.get(edge.targetCardId)!;
      edgeVerticalSpan += Math.abs(srcPos.posY - tgtPos.posY);
    }
    const compactnessCost =
      (maxY - minY) + edgeVerticalSpan / Math.max(1, allActiveEdges.length);

    return {
      score: {
        totalOcclusions,
        strongOcclusions,
        penetrationPx,
        compactnessCost,
      },
      events,
    };
  };

  const isScoreBetter = (a: LayoutScore, b: LayoutScore): boolean => {
    if (a.totalOcclusions !== b.totalOcclusions) {
      return a.totalOcclusions < b.totalOcclusions;
    }
    if (a.strongOcclusions !== b.strongOcclusions) {
      return a.strongOcclusions < b.strongOcclusions;
    }
    if (Math.abs(a.penetrationPx - b.penetrationPx) > 1) {
      return a.penetrationPx < b.penetrationPx;
    }
    return a.compactnessCost < b.compactnessCost - 1;
  };

  /**
   * Moves `movedCardId` to `targetY` and resolves any vertical overlaps within
   * its column by pushing cards above it upward and cards below it downward.
   * Returns a rollback array of `[pos, previousY]` pairs.
   */
  const applyColumnSafeShift = (
    movedCardId: string,
    targetY: number
  ): Array<[CardLayoutPosition, number]> => {
    const step = stepMap.get(movedCardId) ?? 0;
    const col = columnCardsByStep.get(step)!;
    const snapshot: Array<[CardLayoutPosition, number]> = col.map((p) => [p, p.posY]);

    const movedPos = posById.get(movedCardId)!;
    movedPos.posY = Math.round(targetY);

    if (col.length > 1) {
      const sorted = [...col].sort((a, b) => {
        if (a.posY !== b.posY) return a.posY - b.posY;
        if (a.cardId === movedCardId) return -1;
        if (b.cardId === movedCardId) return 1;
        return a.cardId.localeCompare(b.cardId);
      });
      const movedIdx = sorted.findIndex((p) => p.cardId === movedCardId);

      // Push cards above movedCard upward if they overlap
      for (let i = movedIdx - 1; i >= 0; i--) {
        const curr = sorted[i]!;
        const below = sorted[i + 1]!;
        const currHeight = dimsById.get(curr.cardId)!.height;
        const maxAllowedY = below.posY - currHeight - MIN_VERTICAL_GAP;
        if (curr.posY > maxAllowedY) {
          curr.posY = Math.round(maxAllowedY);
        }
      }

      // Push cards below movedCard downward if they overlap
      for (let i = movedIdx + 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const curr = sorted[i]!;
        const prevHeight = dimsById.get(prev.cardId)!.height;
        const minAllowedY = prev.posY + prevHeight + MIN_VERTICAL_GAP;
        if (curr.posY < minAllowedY) {
          curr.posY = Math.round(minAllowedY);
        }
      }
    }

    return snapshot;
  };

  const restoreSnapshot = (snapshot: Array<[CardLayoutPosition, number]>) => {
    for (const [pos, prevY] of snapshot) {
      pos.posY = prevY;
    }
  };

  if (allActiveEdges.length > 0) {
    type MoveCandidate = {
      cardId: string;
      y: number;
      score: LayoutScore;
    };

    const tryCandidate = (
      cardId: string,
      candidateY: number,
      best: MoveCandidate | null
    ): MoveCandidate | null => {
      const roundedY = Math.round(candidateY);
      const snapshot = applyColumnSafeShift(cardId, roundedY);
      const { score } = evaluateLayout(false);
      restoreSnapshot(snapshot);

      if (!best || isScoreBetter(score, best.score)) {
        return { cardId, y: roundedY, score };
      }
      return best;
    };

    for (let iter = 0; iter < 48; iter++) {
      const { score: currentScore, events } = evaluateLayout(true);
      if (currentScore.totalOcclusions === 0) break;

      let bestMove: MoveCandidate | null = null;
      const involvedCards = new Set<string>();

      for (const ev of events) {
        const obsPos = posById.get(ev.obstacleId)!;
        const obsH = dimsById.get(ev.obstacleId)!.height;
        const srcPos = posById.get(ev.edge.sourceCardId)!;
        const srcH = dimsById.get(ev.edge.sourceCardId)!.height;
        const tgtPos = posById.get(ev.edge.targetCardId)!;
        const tgtH = dimsById.get(ev.edge.targetCardId)!.height;

        involvedCards.add(ev.obstacleId);
        involvedCards.add(ev.edge.sourceCardId);
        involvedCards.add(ev.edge.targetCardId);

        // 1. Shift the occluded intermediate card completely below or above the Bezier curve
        if (Number.isFinite(ev.curveMaxY)) {
          bestMove = tryCandidate(ev.obstacleId, Math.ceil(ev.curveMaxY + CLEARANCE_PADDING), bestMove);
        }
        if (Number.isFinite(ev.curveMinY)) {
          bestMove = tryCandidate(
            ev.obstacleId,
            Math.floor(ev.curveMinY - CLEARANCE_PADDING - obsH),
            bestMove
          );
        }

        // 2. Shift source or target card vertically to steer the Bezier curve around the obstacle
        const srcTargets = [
          obsPos.posY - CLEARANCE_PADDING - srcH,
          obsPos.posY + obsH + CLEARANCE_PADDING,
          srcPos.posY - (obsH + CLEARANCE_PADDING * 2),
          srcPos.posY + (obsH + CLEARANCE_PADDING * 2),
        ];
        for (const y of srcTargets) {
          bestMove = tryCandidate(ev.edge.sourceCardId, y, bestMove);
        }

        const tgtTargets = [
          obsPos.posY - CLEARANCE_PADDING - tgtH,
          obsPos.posY + obsH + CLEARANCE_PADDING,
          tgtPos.posY - (obsH + CLEARANCE_PADDING * 2),
          tgtPos.posY + (obsH + CLEARANCE_PADDING * 2),
        ];
        for (const y of tgtTargets) {
          bestMove = tryCandidate(ev.edge.targetCardId, y, bestMove);
        }
      }

      // 3. If targeted local shifts cannot reduce occlusions further, scan vertical lanes
      // for every card involved in an occlusion to find a clean open corridor.
      if (
        !bestMove ||
        (bestMove.score.totalOcclusions >= currentScore.totalOcclusions &&
          bestMove.score.penetrationPx >= currentScore.penetrationPx - 1)
      ) {
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const p of posById.values()) {
          const h = dimsById.get(p.cardId)!.height;
          if (p.posY < minY) minY = p.posY;
          if (p.posY + h > maxY) maxY = p.posY + h;
        }
        const scanStart = Math.floor((minY - 220) / 60) * 60;
        const scanEnd = Math.ceil((maxY + 220) / 60) * 60;

        for (const cardId of involvedCards) {
          for (let y = scanStart; y <= scanEnd; y += 60) {
            bestMove = tryCandidate(cardId, y, bestMove);
          }
        }
      }

      if (!bestMove || !isScoreBetter(bestMove.score, currentScore)) {
        break;
      }

      applyColumnSafeShift(bestMove.cardId, bestMove.y);
    }
  }

  // 5. Normalize vertical origin so the topmost card starts cleanly at BASELINE_Y
  let minFinalY = Number.POSITIVE_INFINITY;
  for (const pos of posById.values()) {
    if (pos.posY < minFinalY) minFinalY = pos.posY;
  }
  if (Number.isFinite(minFinalY)) {
    const shiftY = BASELINE_Y - minFinalY;
    for (const pos of posById.values()) {
      pos.posY = Math.round(pos.posY + shiftY);
    }
  }

  return activeCards.map((c) => posById.get(c.id)!);
}
