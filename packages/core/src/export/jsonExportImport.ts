import { CyclicDependencyError, ValidationError } from '../errors.js';
import { canonicalizeEdgeEndpoints } from '../timeline/timelineLayout.js';
import type {
  AttachmentKind,
  BoardGraph,
  BoardType,
  CardStatus,
  CardType,
  EdgeDirection,
  EdgeStyleVariant,
  RelationType,
} from '../types/models.js';

export const BOARD_JSON_FORMAT = 'ariadeck-board' as const;
export const BOARD_JSON_SCHEMA_VERSION = 1 as const;

const VALID_BOARD_TYPES = new Set<BoardType>(['flow', 'flat']);
const VALID_CARD_TYPES = new Set<CardType>(['task', 'idea', 'plot_event', 'note']);
const VALID_CARD_STATUSES = new Set<CardStatus>(['todo', 'in_progress', 'done', 'archived']);
const VALID_RELATION_TYPES = new Set<RelationType>([
  'blocks',
  'causes',
  'relates_to',
  'jump_back',
  'custom',
]);
const VALID_EDGE_DIRECTIONS = new Set<EdgeDirection>([
  'directed',
  'bidirectional',
  'undirected',
]);
const VALID_EDGE_STYLES = new Set<EdgeStyleVariant>(['solid', 'dashed', 'dotted']);
const VALID_ATTACHMENT_KINDS = new Set<AttachmentKind>(['image', 'audio']);

export interface BoardJsonCard {
  id: string;
  title: string;
  content: string;
  cardType: CardType;
  status: CardStatus;
  tags: string[];
  posX: number;
  posY: number;
  timelineOrder: number | null;
  startAt: string | null;
  endAt: string | null;
}

export interface BoardJsonEdge {
  sourceCardId: string;
  targetCardId: string;
  relationType: RelationType;
  direction?: EdgeDirection;
  label?: string;
  styleVariant?: EdgeStyleVariant;
  color?: string | null;
}

export interface BoardJsonAttachment {
  cardId: string;
  kind: AttachmentKind;
  localUri: string;
  mimeType: string;
  fileSize: number;
  durationMs: number | null;
  transcript: string | null;
}

export interface BoardJsonExport {
  format: typeof BOARD_JSON_FORMAT;
  schemaVersion: typeof BOARD_JSON_SCHEMA_VERSION;
  exportedAt: string;
  board: {
    title: string;
    description: string;
    boardType?: BoardType;
  };
  cards: BoardJsonCard[];
  edges: BoardJsonEdge[];
  attachments: BoardJsonAttachment[];
}

export interface JsonExportResult {
  filename: string;
  payload: BoardJsonExport;
  json: string;
}

export interface ImportBoardOptions {
  titleOverride?: string;
}

/**
 * Generates a URL-safe JSON export filename: ariadeck-{board_slug}.json
 */
export function buildJsonExportFilename(boardTitle: string): string {
  const slug = boardTitle
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `ariadeck-${slug || 'board'}.json`;
}

/**
 * Serializes an active BoardGraph into the versioned ariadeck-board v1 JSON format.
 */
export function renderBoardGraphToJson(
  graph: BoardGraph,
  exportedAt = new Date().toISOString()
): JsonExportResult {
  const payload: BoardJsonExport = {
    format: BOARD_JSON_FORMAT,
    schemaVersion: BOARD_JSON_SCHEMA_VERSION,
    exportedAt,
    board: {
      title: graph.board.title,
      description: graph.board.description,
      boardType: graph.board.boardType ?? 'flow',
    },
    cards: graph.cards.map((c) => ({
      id: c.id,
      title: c.title,
      content: c.content,
      cardType: c.cardType,
      status: c.status,
      tags: [...c.tags],
      posX: c.posX,
      posY: c.posY,
      timelineOrder: c.timelineOrder,
      startAt: c.startAt,
      endAt: c.endAt,
    })),
    edges: graph.edges.map((e) => ({
      sourceCardId: e.sourceCardId,
      targetCardId: e.targetCardId,
      relationType: e.relationType,
      ...(e.direction && e.direction !== 'directed' ? { direction: e.direction } : {}),
      ...(e.label !== undefined ? { label: e.label } : {}),
      ...(e.styleVariant && e.styleVariant !== 'solid' ? { styleVariant: e.styleVariant } : {}),
      ...(e.color !== undefined && e.color !== null ? { color: e.color } : {}),
    })),
    attachments: graph.attachments.map((a) => ({
      cardId: a.cardId,
      kind: a.kind,
      localUri: a.localUri,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      durationMs: a.durationMs,
      transcript: a.transcript,
    })),
  };

  return {
    filename: buildJsonExportFilename(graph.board.title),
    payload,
    json: JSON.stringify(payload, null, 2),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strictly parses and validates an ariadeck-board v1 JSON string or object.
 * Validates envelope, field types, enums, referential integrity, and DAG acyclicity.
 */
export function parseAndValidateBoardJson(input: string | unknown): BoardJsonExport {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Syntax error';
      throw new ValidationError(`Invalid JSON syntax: ${detail}`);
    }
  }

  if (!isPlainObject(raw)) {
    throw new ValidationError('Root value must be a JSON object.');
  }

  const errors: string[] = [];

  if (raw.format !== BOARD_JSON_FORMAT) {
    errors.push(`format: expected "${BOARD_JSON_FORMAT}".`);
  }
  if (raw.schemaVersion !== BOARD_JSON_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion: expected ${BOARD_JSON_SCHEMA_VERSION}, received ${String(raw.schemaVersion)}.`
    );
  }

  let boardTitle = '';
  let boardDescription = '';
  let boardType: BoardType = 'flow';
  if (!isPlainObject(raw.board)) {
    errors.push('board: must be an object.');
  } else {
    if (typeof raw.board.title !== 'string' || !raw.board.title.trim()) {
      errors.push('board.title: must be a non-empty string.');
    } else {
      boardTitle = raw.board.title.trim();
    }
    if (raw.board.description !== undefined && typeof raw.board.description !== 'string') {
      errors.push('board.description: must be a string.');
    } else {
      boardDescription = (raw.board.description as string | undefined) ?? '';
    }
    if (raw.board.boardType !== undefined) {
      if (
        typeof raw.board.boardType !== 'string' ||
        !VALID_BOARD_TYPES.has(raw.board.boardType as BoardType)
      ) {
        errors.push(`board.boardType: invalid value "${String(raw.board.boardType)}".`);
      } else {
        boardType = raw.board.boardType as BoardType;
      }
    }
  }

  const cards: BoardJsonCard[] = [];
  const cardIdSet = new Set<string>();

  if (!Array.isArray(raw.cards)) {
    errors.push('cards: must be an array.');
  } else {
    raw.cards.forEach((item, idx) => {
      const prefix = `cards[${idx}]`;
      if (!isPlainObject(item)) {
        errors.push(`${prefix}: must be an object.`);
        return;
      }
      if (typeof item.id !== 'string' || !item.id.trim()) {
        errors.push(`${prefix}.id: must be a non-empty string.`);
        return;
      }
      const id = item.id.trim();
      if (cardIdSet.has(id)) {
        errors.push(`${prefix}.id: duplicate card id "${id}".`);
        return;
      }

      if (typeof item.title !== 'string' || !item.title.trim()) {
        errors.push(`${prefix}.title: must be a non-empty string.`);
        return;
      }

      const content = item.content === undefined ? '' : item.content;
      if (typeof content !== 'string') {
        errors.push(`${prefix}.content: must be a string.`);
        return;
      }

      const cardType = (item.cardType ?? 'idea') as CardType;
      if (!VALID_CARD_TYPES.has(cardType)) {
        errors.push(`${prefix}.cardType: invalid value "${String(item.cardType)}".`);
        return;
      }

      const status = (item.status ?? 'todo') as CardStatus;
      if (!VALID_CARD_STATUSES.has(status)) {
        errors.push(`${prefix}.status: invalid value "${String(item.status)}".`);
        return;
      }

      const tagsRaw = item.tags ?? [];
      if (!Array.isArray(tagsRaw) || !tagsRaw.every((t) => typeof t === 'string')) {
        errors.push(`${prefix}.tags: must be an array of strings.`);
        return;
      }

      const posX = item.posX === undefined ? 80 + (idx % 4) * 280 : item.posX;
      const posY = item.posY === undefined ? 80 + Math.floor(idx / 4) * 160 : item.posY;
      if (typeof posX !== 'number' || !Number.isFinite(posX)) {
        errors.push(`${prefix}.posX: must be a finite number.`);
        return;
      }
      if (typeof posY !== 'number' || !Number.isFinite(posY)) {
        errors.push(`${prefix}.posY: must be a finite number.`);
        return;
      }

      const timelineOrder = item.timelineOrder ?? null;
      if (
        timelineOrder !== null &&
        (typeof timelineOrder !== 'number' || !Number.isInteger(timelineOrder) || timelineOrder < 0)
      ) {
        errors.push(`${prefix}.timelineOrder: must be a non-negative integer or null.`);
        return;
      }

      const startAt = item.startAt ?? null;
      if (startAt !== null && typeof startAt !== 'string') {
        errors.push(`${prefix}.startAt: must be a string or null.`);
        return;
      }

      const endAt = item.endAt ?? null;
      if (endAt !== null && typeof endAt !== 'string') {
        errors.push(`${prefix}.endAt: must be a string or null.`);
        return;
      }

      cardIdSet.add(id);
      cards.push({
        id,
        title: item.title.trim(),
        content,
        cardType,
        status,
        tags: [...tagsRaw],
        posX,
        posY,
        timelineOrder,
        startAt,
        endAt,
      });
    });
  }

  const edges: BoardJsonEdge[] = [];
  const seenEdgeTriples = new Set<string>();
  const edgesRaw = raw.edges ?? [];

  if (!Array.isArray(edgesRaw)) {
    errors.push('edges: must be an array.');
  } else {
    edgesRaw.forEach((item, idx) => {
      const prefix = `edges[${idx}]`;
      if (!isPlainObject(item)) {
        errors.push(`${prefix}: must be an object.`);
        return;
      }
      if (typeof item.sourceCardId !== 'string' || !item.sourceCardId.trim()) {
        errors.push(`${prefix}.sourceCardId: must be a non-empty string.`);
        return;
      }
      if (typeof item.targetCardId !== 'string' || !item.targetCardId.trim()) {
        errors.push(`${prefix}.targetCardId: must be a non-empty string.`);
        return;
      }
      const sourceCardId = item.sourceCardId.trim();
      const targetCardId = item.targetCardId.trim();

      if (!cardIdSet.has(sourceCardId)) {
        errors.push(`${prefix}.sourceCardId: references unknown card "${sourceCardId}".`);
        return;
      }
      if (!cardIdSet.has(targetCardId)) {
        errors.push(`${prefix}.targetCardId: references unknown card "${targetCardId}".`);
        return;
      }
      const relationType = (item.relationType ?? 'blocks') as RelationType;
      if (!VALID_RELATION_TYPES.has(relationType)) {
        errors.push(`${prefix}.relationType: invalid value "${String(item.relationType)}".`);
        return;
      }

      const direction = (item.direction ?? 'directed') as EdgeDirection;
      if (!VALID_EDGE_DIRECTIONS.has(direction)) {
        errors.push(`${prefix}.direction: invalid value "${String(item.direction)}".`);
        return;
      }

      const styleVariant = (
        item.styleVariant ?? (relationType === 'jump_back' ? 'dashed' : 'solid')
      ) as EdgeStyleVariant;
      if (!VALID_EDGE_STYLES.has(styleVariant)) {
        errors.push(`${prefix}.styleVariant: invalid value "${String(item.styleVariant)}".`);
        return;
      }

      if (item.color !== undefined && item.color !== null && typeof item.color !== 'string') {
        errors.push(`${prefix}.color: must be a string or null.`);
        return;
      }

      const allowsSelfLoop =
        (boardType === 'flow' && relationType === 'jump_back') ||
        (boardType === 'flat' && (relationType === 'relates_to' || relationType === 'custom'));
      if (sourceCardId === targetCardId && !allowsSelfLoop) {
        errors.push(`${prefix}: self-loop on card "${sourceCardId}" is not allowed.`);
        return;
      }

      if (boardType === 'flow' && (direction !== 'directed' || relationType === 'custom')) {
        errors.push(
          `${prefix}: direction "${direction}" with relationType "${relationType}" is not allowed on flow boards.`
        );
        return;
      }
      if (boardType === 'flat' && relationType === 'jump_back') {
        errors.push(`${prefix}: relationType "jump_back" is only allowed on flow boards.`);
        return;
      }

      if (item.label !== undefined && typeof item.label !== 'string') {
        errors.push(`${prefix}.label: must be a string.`);
        return;
      }

      const canonical = canonicalizeEdgeEndpoints(sourceCardId, targetCardId, direction);
      const tupleKey = `${canonical.sourceCardId}::${canonical.targetCardId}::${relationType}::${direction}`;
      if (seenEdgeTriples.has(tupleKey)) {
        return; // Deduplicate identical edges cleanly
      }
      seenEdgeTriples.add(tupleKey);

      edges.push({
        sourceCardId: canonical.sourceCardId,
        targetCardId: canonical.targetCardId,
        relationType,
        direction,
        styleVariant,
        ...(item.color !== undefined ? { color: item.color as string | null } : {}),
        ...(item.label !== undefined ? { label: item.label } : {}),
      });
    });
  }

  const attachments: BoardJsonAttachment[] = [];
  const attachmentsRaw = raw.attachments ?? [];

  if (!Array.isArray(attachmentsRaw)) {
    errors.push('attachments: must be an array.');
  } else {
    attachmentsRaw.forEach((item, idx) => {
      const prefix = `attachments[${idx}]`;
      if (!isPlainObject(item)) {
        errors.push(`${prefix}: must be an object.`);
        return;
      }
      if (typeof item.cardId !== 'string' || !cardIdSet.has(item.cardId.trim())) {
        errors.push(`${prefix}.cardId: references unknown card "${String(item.cardId)}".`);
        return;
      }
      const kind = item.kind as AttachmentKind;
      if (!VALID_ATTACHMENT_KINDS.has(kind)) {
        errors.push(`${prefix}.kind: invalid value "${String(item.kind)}".`);
        return;
      }
      if (typeof item.localUri !== 'string' || !item.localUri.trim()) {
        errors.push(`${prefix}.localUri: must be a non-empty string.`);
        return;
      }
      if (typeof item.mimeType !== 'string' || !item.mimeType.trim()) {
        errors.push(`${prefix}.mimeType: must be a non-empty string.`);
        return;
      }
      const fileSize = item.fileSize ?? 0;
      if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize < 0) {
        errors.push(`${prefix}.fileSize: must be a non-negative number.`);
        return;
      }
      const durationMs = item.durationMs ?? null;
      if (durationMs !== null && (typeof durationMs !== 'number' || !Number.isFinite(durationMs))) {
        errors.push(`${prefix}.durationMs: must be a finite number or null.`);
        return;
      }
      const transcript = item.transcript ?? null;
      if (transcript !== null && typeof transcript !== 'string') {
        errors.push(`${prefix}.transcript: must be a string or null.`);
        return;
      }

      attachments.push({
        cardId: item.cardId.trim(),
        kind,
        localUri: item.localUri,
        mimeType: item.mimeType,
        fileSize,
        durationMs,
        transcript,
      });
    });
  }

  if (errors.length > 0) {
    throw new ValidationError(`Invalid Ariadeck board JSON:\n- ${errors.join('\n- ')}`);
  }

  // Validate DAG acyclicity across directed blocks/causes edges on flow boards only
  if (boardType === 'flow') {
    verifyEdgesAcyclic(edges);
  }

  return {
    format: BOARD_JSON_FORMAT,
    schemaVersion: BOARD_JSON_SCHEMA_VERSION,
    exportedAt:
      typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
    board: {
      title: boardTitle,
      description: boardDescription,
      boardType,
    },
    cards,
    edges,
    attachments,
  };
}

function verifyEdgesAcyclic(edges: BoardJsonEdge[]): void {
  const adjacency = new Map<string, string[]>();
  const nodes = new Set<string>();

  for (const edge of edges) {
    if (edge.relationType !== 'blocks' && edge.relationType !== 'causes') continue;
    nodes.add(edge.sourceCardId);
    nodes.add(edge.targetCardId);
    const list = adjacency.get(edge.sourceCardId);
    if (list) list.push(edge.targetCardId);
    else adjacency.set(edge.sourceCardId, [edge.targetCardId]);
  }

  const state = new Map<string, 'visiting' | 'visited'>();

  const dfs = (nodeId: string): void => {
    state.set(nodeId, 'visiting');
    for (const next of adjacency.get(nodeId) ?? []) {
      const nextState = state.get(next);
      if (nextState === 'visiting') {
        throw new CyclicDependencyError(
          nodeId,
          next,
          `Imported board contains a cyclic dependency involving "${nodeId}" -> "${next}".`
        );
      }
      if (!nextState) {
        dfs(next);
      }
    }
    state.set(nodeId, 'visited');
  };

  for (const node of nodes) {
    if (!state.has(node)) {
      dfs(node);
    }
  }
}
