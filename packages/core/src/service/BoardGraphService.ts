import {
  BoardConversionError,
  CyclicDependencyError,
  NotFoundError,
  ValidationError,
} from '../errors.js';
import { GraphEventBus, type GraphEventType } from '../events/GraphEventBus.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import {
  canonicalizeEdgeEndpoints,
  computeTopologicalSteps,
  detectJumpBackWarnings,
  detectTimelineViolations,
  groupCardsByTimelineStep,
  hasTemporalCycle,
} from '../timeline/timelineLayout.js';
import {
  renderBoardGraphToMarkdown,
  type MarkdownExportOptions,
  type MarkdownExportResult,
} from '../export/markdownExport.js';
import {
  parseAndValidateBoardJson,
  renderBoardGraphToJson,
  type BoardJsonExport,
  type ImportBoardOptions,
  type JsonExportResult,
} from '../export/jsonExportImport.js';
import type {
  Board,
  BoardConversionAnalysis,
  BoardConversionStrategy,
  BoardGraph,
  BoardType,
  Card,
  CardAttachment,
  CardDisplayMode,
  ConnectCardsOptions,
  CreateAttachmentInput,
  CreateBoardInput,
  CreateCardInput,
  Edge,
  EdgeDirection,
  EdgeStyleVariant,
  InsertIntermediateCardInput,
  MergeCardsParams,
  MutationContext,
  RelationType,
  SplitCardParams,
  SplitCardResult,
  SplitEdgeInheritance,
  SyncOutboxEntityType,
  SyncOutboxOperation,
  TimelineSortResult,
  UpdateBoardInput,
  UpdateCardInput,
  UpdateEdgeInput,
} from '../types/models.js';

export interface BoardGraphServiceOptions {
  deviceId?: string;
  eventBus?: GraphEventBus;
  now?: () => string;
  generateId?: () => string;
}

const DEFAULT_CARD_WIDTH = 280;
const DEFAULT_CARD_HEIGHT = 160;
const GRID_COLUMNS = 4;

function defaultGenerateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Central domain service managing Ariadeck boards, cards, directed edges,
 * DAG invariants, sync outbox logging, and reactive graph events.
 */
export class BoardGraphService {
  public readonly eventBus: GraphEventBus;
  protected readonly storage: StorageAdapter;
  protected readonly defaultDeviceId: string;
  protected readonly now: () => string;
  protected readonly generateId: () => string;

  constructor(storage: StorageAdapter, options: BoardGraphServiceOptions = {}) {
    this.storage = storage;
    this.defaultDeviceId = options.deviceId ?? 'ariadeck-core-local';
    this.eventBus = options.eventBus ?? new GraphEventBus();
    this.now = options.now ?? (() => new Date().toISOString());
    this.generateId = options.generateId ?? defaultGenerateId;
  }

  protected resolveDeviceId(ctx?: MutationContext): string {
    return ctx?.deviceId ?? this.defaultDeviceId;
  }

  protected async recordOutbox(
    entityType: SyncOutboxEntityType,
    entityId: string,
    boardId: string,
    operation: SyncOutboxOperation,
    payload: unknown,
    timestamp: string
  ): Promise<void> {
    await this.storage.appendOutbox({
      entityType,
      entityId,
      boardId,
      operation,
      payloadJson: JSON.stringify(payload),
      createdAt: timestamp,
      syncedAt: null,
    });
  }

  protected emitEvent(
    type: GraphEventType,
    boardId: string,
    entityIds: string[],
    deviceId: string,
    timestamp: string
  ): void {
    this.eventBus.emit({
      type,
      boardId,
      entityIds,
      deviceId,
      timestamp,
    });
  }

  // ---------------------------------------------------------------------------
  // Board operations
  // ---------------------------------------------------------------------------

  async listBoards(): Promise<Board[]> {
    return this.storage.listBoards(false);
  }

  async getBoard(boardId: string): Promise<Board> {
    const board = await this.storage.getBoard(boardId, false);
    if (!board) {
      throw new NotFoundError('Board', boardId);
    }
    return board;
  }

  async createBoard(input: CreateBoardInput, ctx?: MutationContext): Promise<Board> {
    const title = input.title.trim();
    if (!title) {
      throw new ValidationError('Board title must not be empty.');
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const board: Board = {
      id: input.id ?? this.generateId(),
      title,
      description: input.description ?? '',
      boardType: input.boardType ?? 'flow',
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: 1,
      deletedAt: null,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveBoard(board);
      await this.recordOutbox('board', board.id, board.id, 'create', board, timestamp);
    });

    this.emitEvent('board:created', board.id, [board.id], deviceId, timestamp);
    return board;
  }

  async updateBoard(
    boardId: string,
    patch: UpdateBoardInput,
    ctx?: MutationContext
  ): Promise<Board> {
    const existing = await this.getBoard(boardId);
    const nextTitle = patch.title !== undefined ? patch.title.trim() : existing.title;
    if (!nextTitle) {
      throw new ValidationError('Board title must not be empty.');
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const updated: Board = {
      ...existing,
      title: nextTitle,
      description: patch.description ?? existing.description,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: existing.version + 1,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveBoard(updated);
      await this.recordOutbox('board', updated.id, updated.id, 'update', updated, timestamp);
    });

    this.emitEvent('board:updated', updated.id, [updated.id], deviceId, timestamp);
    return updated;
  }

  async deleteBoard(boardId: string, ctx?: MutationContext): Promise<void> {
    const existing = await this.getBoard(boardId);
    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);

    const deleted: Board = {
      ...existing,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: existing.version + 1,
      deletedAt: timestamp,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveBoard(deleted);
      await this.recordOutbox('board', deleted.id, deleted.id, 'delete', deleted, timestamp);
    });

    this.emitEvent('board:deleted', deleted.id, [deleted.id], deviceId, timestamp);
  }

  async getBoardGraph(boardId: string): Promise<BoardGraph> {
    const board = await this.getBoard(boardId);
    const [cards, edges, attachments] = await Promise.all([
      this.storage.listCardsByBoard(boardId, false),
      this.storage.listEdgesByBoard(boardId, false),
      this.storage.listAttachmentsByBoard(boardId, false),
    ]);
    return { board, cards, edges, attachments };
  }

  // ---------------------------------------------------------------------------
  // Card CRUD operations
  // ---------------------------------------------------------------------------

  async createCard(input: CreateCardInput, ctx?: MutationContext): Promise<Card> {
    await this.getBoard(input.boardId);
    const title = input.title.trim();
    if (!title) {
      throw new ValidationError('Card title must not be empty.');
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);

    let posX = input.posX;
    let posY = input.posY;
    if (posX === undefined || posY === undefined) {
      const existingCards = await this.storage.listCardsByBoard(input.boardId, false);
      const computed = this.computeDefaultPosition(existingCards);
      posX = posX ?? computed.posX;
      posY = posY ?? computed.posY;
    }

    const card: Card = {
      id: input.id ?? this.generateId(),
      boardId: input.boardId,
      title,
      content: input.content ?? '',
      cardType: input.cardType ?? 'idea',
      displayMode: input.displayMode ?? 'standard',
      status: input.status ?? 'todo',
      tags: input.tags ? [...input.tags] : [],
      posX,
      posY,
      timelineOrder: input.timelineOrder ?? null,
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      splitFromCardId: null,
      mergedFromCardIds: null,
      replacedByCardIds: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: 1,
      deletedAt: null,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveCard(card);
      await this.recordOutbox('card', card.id, card.boardId, 'create', card, timestamp);
    });

    this.emitEvent('card:created', card.boardId, [card.id], deviceId, timestamp);
    return card;
  }

  async updateCard(
    cardId: string,
    patch: UpdateCardInput,
    ctx?: MutationContext
  ): Promise<Card> {
    const existing = await this.storage.getCard(cardId, false);
    if (!existing) {
      throw new NotFoundError('Card', cardId);
    }

    const nextTitle = patch.title !== undefined ? patch.title.trim() : existing.title;
    if (!nextTitle) {
      throw new ValidationError('Card title must not be empty.');
    }
    if (
      patch.displayMode !== undefined &&
      patch.displayMode !== 'standard' &&
      patch.displayMode !== 'image_cover' &&
      patch.displayMode !== 'image_only'
    ) {
      throw new ValidationError(
        `Invalid displayMode "${String(patch.displayMode)}". Expected "standard", "image_cover", or "image_only".`
      );
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const updated: Card = {
      ...existing,
      title: nextTitle,
      content: patch.content ?? existing.content,
      cardType: patch.cardType ?? existing.cardType,
      displayMode: (patch.displayMode ?? existing.displayMode ?? 'standard') as CardDisplayMode,
      status: patch.status ?? existing.status,
      tags: patch.tags !== undefined ? [...patch.tags] : existing.tags,
      posX: patch.posX ?? existing.posX,
      posY: patch.posY ?? existing.posY,
      timelineOrder:
        patch.timelineOrder !== undefined ? patch.timelineOrder : existing.timelineOrder,
      startAt: patch.startAt !== undefined ? patch.startAt : existing.startAt,
      endAt: patch.endAt !== undefined ? patch.endAt : existing.endAt,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: existing.version + 1,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveCard(updated);
      await this.recordOutbox('card', updated.id, updated.boardId, 'update', updated, timestamp);
    });

    this.emitEvent('card:updated', updated.boardId, [updated.id], deviceId, timestamp);
    return updated;
  }

  async deleteCard(cardId: string, ctx?: MutationContext): Promise<void> {
    const existing = await this.storage.getCard(cardId, false);
    if (!existing) {
      throw new NotFoundError('Card', cardId);
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const deletedCard: Card = {
      ...existing,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: existing.version + 1,
      deletedAt: timestamp,
    };

    const affectedIds: string[] = [deletedCard.id];

    await this.storage.runInTransaction(async () => {
      await this.storage.saveCard(deletedCard);
      await this.recordOutbox(
        'card',
        deletedCard.id,
        deletedCard.boardId,
        'delete',
        deletedCard,
        timestamp
      );

      const boardEdges = await this.storage.listEdgesByBoard(existing.boardId, false);
      for (const edge of boardEdges) {
        if (edge.sourceCardId === cardId || edge.targetCardId === cardId) {
          const deletedEdge: Edge = {
            ...edge,
            updatedAt: timestamp,
            updatedByDeviceId: deviceId,
            version: edge.version + 1,
            deletedAt: timestamp,
          };
          await this.storage.saveEdge(deletedEdge);
          await this.recordOutbox(
            'edge',
            deletedEdge.id,
            deletedEdge.boardId,
            'delete',
            deletedEdge,
            timestamp
          );
          affectedIds.push(deletedEdge.id);
        }
      }

      const attachments = await this.storage.listAttachmentsByCard(cardId, false);
      for (const attachment of attachments) {
        const deletedAttachment = {
          ...attachment,
          updatedAt: timestamp,
          updatedByDeviceId: deviceId,
          version: attachment.version + 1,
          deletedAt: timestamp,
        };
        await this.storage.saveAttachment(deletedAttachment);
        await this.recordOutbox(
          'attachment',
          deletedAttachment.id,
          deletedAttachment.boardId,
          'delete',
          deletedAttachment,
          timestamp
        );
      }
    });

    this.emitEvent('card:deleted', existing.boardId, affectedIds, deviceId, timestamp);
  }

  // ---------------------------------------------------------------------------
  // Edge operations & DAG validation
  // ---------------------------------------------------------------------------

  async connectCards(
    boardId: string,
    sourceId: string,
    targetId: string,
    relationType: RelationType = 'blocks',
    labelOrOptions?: string | ConnectCardsOptions,
    ctx?: MutationContext
  ): Promise<Edge> {
    const opts: ConnectCardsOptions =
      typeof labelOrOptions === 'string'
        ? { label: labelOrOptions }
        : (labelOrOptions ?? {});
    const direction: EdgeDirection = opts.direction ?? 'directed';
    const styleVariant: EdgeStyleVariant =
      opts.styleVariant ?? (relationType === 'jump_back' ? 'dashed' : 'solid');
    const color = opts.color ?? null;

    const board = await this.getBoard(boardId);
    const boardType: BoardType = board.boardType ?? 'flow';

    this.validateEdgeForBoardType(boardType, sourceId, targetId, relationType, direction);

    const [sourceCard, targetCard] = await Promise.all([
      this.storage.getCard(sourceId, false),
      this.storage.getCard(targetId, false),
    ]);

    if (!sourceCard || sourceCard.boardId !== boardId) {
      throw new NotFoundError('Card', sourceId);
    }
    if (!targetCard || targetCard.boardId !== boardId) {
      throw new NotFoundError('Card', targetId);
    }

    const canonical = canonicalizeEdgeEndpoints(sourceId, targetId, direction);
    const existingEdges = await this.storage.listEdgesByBoard(boardId, false);

    // Deduplicate identical (sourceId, targetId, relationType, direction) tuples.
    const duplicate = existingEdges.find(
      (e) =>
        e.sourceCardId === canonical.sourceCardId &&
        e.targetCardId === canonical.targetCardId &&
        e.relationType === relationType &&
        (e.direction ?? 'directed') === direction
    );
    if (duplicate) {
      return duplicate;
    }

    if (
      boardType === 'flow' &&
      direction === 'directed' &&
      (relationType === 'blocks' || relationType === 'causes')
    ) {
      if (this.hasDirectedPath(existingEdges, targetId, sourceId)) {
        throw new CyclicDependencyError(
          sourceId,
          targetId,
          undefined,
          'ERR_TEMPORAL_CYCLE_DETECTED'
        );
      }
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const trimmedLabel = opts.label?.trim();
    const edge: Edge = {
      id: this.generateId(),
      boardId,
      sourceCardId: canonical.sourceCardId,
      targetCardId: canonical.targetCardId,
      relationType,
      direction,
      ...(trimmedLabel ? { label: trimmedLabel } : {}),
      styleVariant,
      color,
      isConflicted: false,
      conflictReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: 1,
      deletedAt: null,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveEdge(edge);
      await this.recordOutbox('edge', edge.id, edge.boardId, 'create', edge, timestamp);
    });

    this.emitEvent('edge:created', boardId, [edge.id], deviceId, timestamp);
    return edge;
  }

  async updateEdge(
    edgeId: string,
    patch: UpdateEdgeInput,
    ctx?: MutationContext
  ): Promise<Edge> {
    const existing = await this.storage.getEdge(edgeId, false);
    if (!existing) {
      throw new NotFoundError('Edge', edgeId);
    }

    const board = await this.getBoard(existing.boardId);
    const boardType: BoardType = board.boardType ?? 'flow';
    const nextRelationType = patch.relationType ?? existing.relationType;
    const nextDirection: EdgeDirection = patch.direction ?? existing.direction ?? 'directed';
    const nextStyleVariant: EdgeStyleVariant =
      patch.styleVariant ??
      existing.styleVariant ??
      (nextRelationType === 'jump_back' ? 'dashed' : 'solid');
    const nextColor = patch.color !== undefined ? patch.color : (existing.color ?? null);

    this.validateEdgeForBoardType(
      boardType,
      existing.sourceCardId,
      existing.targetCardId,
      nextRelationType,
      nextDirection
    );

    const canonical = canonicalizeEdgeEndpoints(
      existing.sourceCardId,
      existing.targetCardId,
      nextDirection
    );
    const otherEdges = (await this.storage.listEdgesByBoard(existing.boardId, false)).filter(
      (e) => e.id !== edgeId
    );

    const tupleChanged =
      canonical.sourceCardId !== existing.sourceCardId ||
      canonical.targetCardId !== existing.targetCardId ||
      nextRelationType !== existing.relationType ||
      nextDirection !== (existing.direction ?? 'directed');

    if (tupleChanged) {
      const duplicate = otherEdges.find(
        (e) =>
          e.sourceCardId === canonical.sourceCardId &&
          e.targetCardId === canonical.targetCardId &&
          e.relationType === nextRelationType &&
          (e.direction ?? 'directed') === nextDirection
      );
      if (duplicate) {
        throw new ValidationError(
          `An edge with relationType "${nextRelationType}" and direction "${nextDirection}" already exists between these cards.`
        );
      }

      if (
        boardType === 'flow' &&
        nextDirection === 'directed' &&
        (nextRelationType === 'blocks' || nextRelationType === 'causes')
      ) {
        if (this.hasDirectedPath(otherEdges, canonical.targetCardId, canonical.sourceCardId)) {
          throw new CyclicDependencyError(canonical.sourceCardId, canonical.targetCardId);
        }
      }
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const updated: Edge = {
      ...existing,
      sourceCardId: canonical.sourceCardId,
      targetCardId: canonical.targetCardId,
      relationType: nextRelationType,
      direction: nextDirection,
      styleVariant: nextStyleVariant,
      color: nextColor,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: existing.version + 1,
    };

    if (patch.label !== undefined) {
      const trimmed = patch.label === null ? '' : patch.label.trim();
      if (trimmed) {
        updated.label = trimmed;
      } else {
        delete updated.label;
      }
    }

    await this.storage.runInTransaction(async () => {
      await this.storage.saveEdge(updated);
      await this.recordOutbox('edge', updated.id, updated.boardId, 'update', updated, timestamp);
    });

    this.emitEvent('board:updated', updated.boardId, [updated.id], deviceId, timestamp);
    return updated;
  }

  async disconnectCards(edgeId: string, ctx?: MutationContext): Promise<void> {
    const existing = await this.storage.getEdge(edgeId, false);
    if (!existing) {
      throw new NotFoundError('Edge', edgeId);
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const deletedEdge: Edge = {
      ...existing,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: existing.version + 1,
      deletedAt: timestamp,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveEdge(deletedEdge);
      await this.recordOutbox(
        'edge',
        deletedEdge.id,
        deletedEdge.boardId,
        'delete',
        deletedEdge,
        timestamp
      );
    });

    this.emitEvent('edge:deleted', existing.boardId, [deletedEdge.id], deviceId, timestamp);
  }

  // ---------------------------------------------------------------------------
  // Atomic graph transformations (Split, Merge, Insert Intermediate)
  // ---------------------------------------------------------------------------

  async splitCard(
    params: SplitCardParams,
    ctx?: MutationContext
  ): Promise<SplitCardResult> {
    if (params.subCards.length < 2) {
      throw new ValidationError('splitCard requires at least 2 subCards.');
    }
    for (const sub of params.subCards) {
      if (!sub.title.trim()) {
        throw new ValidationError('Every subCard must have a non-empty title.');
      }
    }

    const parent = await this.storage.getCard(params.targetCardId, false);
    if (!parent) {
      throw new NotFoundError('Card', params.targetCardId);
    }
    const board = await this.getBoard(parent.boardId);
    const boardType: BoardType = board.boardType ?? 'flow';
    const inheritance: SplitEdgeInheritance =
      params.edgeInheritance ??
      (params.linkMode === 'parallel'
        ? 'broadcast'
        : params.linkMode === 'sequential'
          ? 'sequential'
          : boardType === 'flat'
            ? 'broadcast'
            : 'sequential');

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const createdCards: Card[] = [];
    const createdEdges: Edge[] = [];
    const removedEdgeIds: string[] = [];
    let updatedParent!: Card;

    await this.storage.runInTransaction(async () => {
      const boardEdges = await this.storage.listEdgesByBoard(parent.boardId, false);
      const incomingEdges = boardEdges.filter(
        (e) => e.targetCardId === parent.id && e.sourceCardId !== parent.id
      );
      const outgoingEdges = boardEdges.filter(
        (e) => e.sourceCardId === parent.id && e.targetCardId !== parent.id
      );
      const selfLoopEdges = boardEdges.filter(
        (e) => e.sourceCardId === parent.id && e.targetCardId === parent.id
      );

      const count = params.subCards.length;
      for (let i = 0; i < count; i++) {
        const sub = params.subCards[i]!;
        const posX =
          inheritance === 'sequential'
            ? parent.posX + i * DEFAULT_CARD_WIDTH
            : parent.posX;
        const posY =
          inheritance === 'sequential'
            ? parent.posY
            : parent.posY + (i - (count - 1) / 2) * DEFAULT_CARD_HEIGHT;

        const child: Card = {
          id: this.generateId(),
          boardId: parent.boardId,
          title: sub.title.trim(),
          content: sub.content,
          cardType: sub.cardType ?? parent.cardType,
          status: parent.status,
          tags: sub.tags ? [...sub.tags] : [...parent.tags],
          posX,
          posY,
          timelineOrder: null,
          startAt: null,
          endAt: null,
          splitFromCardId: parent.id,
          mergedFromCardIds: null,
          replacedByCardIds: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          updatedByDeviceId: deviceId,
          version: 1,
          deletedAt: null,
        };
        await this.storage.saveCard(child);
        await this.recordOutbox('card', child.id, child.boardId, 'create', child, timestamp);
        createdCards.push(child);
      }

      const seenNewKeys = new Set<string>();
      const saveNewEdge = async (
        sourceCardId: string,
        targetCardId: string,
        relationType: RelationType,
        opts?: {
          direction?: EdgeDirection;
          label?: string;
          styleVariant?: EdgeStyleVariant;
          color?: string | null;
        }
      ): Promise<void> => {
        const direction = opts?.direction ?? 'directed';
        const canonical = canonicalizeEdgeEndpoints(sourceCardId, targetCardId, direction);
        const key = `${canonical.sourceCardId}::${canonical.targetCardId}::${relationType}::${direction}`;
        if (seenNewKeys.has(key)) return;
        seenNewKeys.add(key);

        const edge: Edge = {
          id: this.generateId(),
          boardId: parent.boardId,
          sourceCardId: canonical.sourceCardId,
          targetCardId: canonical.targetCardId,
          relationType,
          direction,
          ...(opts?.label !== undefined ? { label: opts.label } : {}),
          styleVariant: opts?.styleVariant ?? (relationType === 'jump_back' ? 'dashed' : 'solid'),
          color: opts?.color ?? null,
          isConflicted: false,
          conflictReason: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          updatedByDeviceId: deviceId,
          version: 1,
          deletedAt: null,
        };
        await this.storage.saveEdge(edge);
        await this.recordOutbox('edge', edge.id, edge.boardId, 'create', edge, timestamp);
        createdEdges.push(edge);
      };

      if (inheritance === 'sequential') {
        for (let i = 0; i < createdCards.length - 1; i++) {
          await saveNewEdge(createdCards[i]!.id, createdCards[i + 1]!.id, 'blocks');
        }
        const firstChild = createdCards[0]!;
        const lastChild = createdCards[createdCards.length - 1]!;
        for (const inc of incomingEdges) {
          const target = inc.relationType === 'jump_back' ? lastChild.id : firstChild.id;
          await saveNewEdge(inc.sourceCardId, target, inc.relationType, {
            direction: inc.direction,
            label: inc.label,
            styleVariant: inc.styleVariant,
            color: inc.color,
          });
        }
        for (const out of outgoingEdges) {
          const source = out.relationType === 'jump_back' ? firstChild.id : lastChild.id;
          await saveNewEdge(source, out.targetCardId, out.relationType, {
            direction: out.direction,
            label: out.label,
            styleVariant: out.styleVariant,
            color: out.color,
          });
        }
        for (const loop of selfLoopEdges) {
          await saveNewEdge(lastChild.id, firstChild.id, loop.relationType, {
            direction: loop.direction,
            label: loop.label,
            styleVariant: loop.styleVariant,
            color: loop.color,
          });
        }
      } else if (inheritance === 'broadcast') {
        for (const child of createdCards) {
          for (const inc of incomingEdges) {
            await saveNewEdge(inc.sourceCardId, child.id, inc.relationType, {
              direction: inc.direction,
              label: inc.label,
              styleVariant: inc.styleVariant,
              color: inc.color,
            });
          }
          for (const out of outgoingEdges) {
            await saveNewEdge(child.id, out.targetCardId, out.relationType, {
              direction: out.direction,
              label: out.label,
              styleVariant: out.styleVariant,
              color: out.color,
            });
          }
        }
      }

      for (const oldEdge of [...incomingEdges, ...outgoingEdges, ...selfLoopEdges]) {
        const deletedEdge: Edge = {
          ...oldEdge,
          updatedAt: timestamp,
          updatedByDeviceId: deviceId,
          version: oldEdge.version + 1,
          deletedAt: timestamp,
        };
        await this.storage.saveEdge(deletedEdge);
        await this.recordOutbox(
          'edge',
          deletedEdge.id,
          deletedEdge.boardId,
          'delete',
          deletedEdge,
          timestamp
        );
        removedEdgeIds.push(deletedEdge.id);
      }

      updatedParent = {
        ...parent,
        replacedByCardIds: createdCards.map((c) => c.id),
        updatedAt: timestamp,
        updatedByDeviceId: deviceId,
        version: parent.version + 1,
        deletedAt: timestamp,
      };
      await this.storage.saveCard(updatedParent);
      await this.recordOutbox(
        'card',
        updatedParent.id,
        updatedParent.boardId,
        'split',
        {
          parentCardId: updatedParent.id,
          replacedByCardIds: updatedParent.replacedByCardIds,
          linkMode: params.linkMode ?? (inheritance === 'sequential' ? 'sequential' : 'parallel'),
          edgeInheritance: inheritance,
        },
        timestamp
      );
    });

    this.emitEvent(
      'card:split',
      parent.boardId,
      [parent.id, ...createdCards.map((c) => c.id)],
      deviceId,
      timestamp
    );

    return {
      parentCard: updatedParent,
      createdCards,
      createdEdges,
      removedEdgeIds,
    };
  }

  async mergeCards(
    params: MergeCardsParams,
    ctx?: MutationContext
  ): Promise<Card> {
    const uniqueIds = Array.from(new Set(params.targetCardIds));
    if (uniqueIds.length < 2) {
      throw new ValidationError('mergeCards requires at least 2 distinct targetCardIds.');
    }

    const title = params.mergedCard.title.trim();
    if (!title) {
      throw new ValidationError('Merged card title must not be empty.');
    }

    const sourceCards: Card[] = [];
    for (const id of uniqueIds) {
      const card = await this.storage.getCard(id, false);
      if (!card) {
        throw new NotFoundError('Card', id);
      }
      sourceCards.push(card);
    }

    const boardId = sourceCards[0]!.boardId;
    if (sourceCards.some((c) => c.boardId !== boardId)) {
      throw new ValidationError('All cards being merged must belong to the same board.');
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const targetSet = new Set(uniqueIds);

    const avgPosX =
      sourceCards.reduce((sum, c) => sum + c.posX, 0) / sourceCards.length;
    const avgPosY =
      sourceCards.reduce((sum, c) => sum + c.posY, 0) / sourceCards.length;

    const mergedTags =
      params.mergedCard.tags !== undefined
        ? [...params.mergedCard.tags]
        : Array.from(new Set(sourceCards.flatMap((c) => c.tags)));

    const merged: Card = {
      id: this.generateId(),
      boardId,
      title,
      content: params.mergedCard.content,
      cardType: params.mergedCard.cardType ?? sourceCards[0]!.cardType,
      status: sourceCards[0]!.status,
      tags: mergedTags,
      posX: avgPosX,
      posY: avgPosY,
      timelineOrder: null,
      startAt: null,
      endAt: null,
      splitFromCardId: null,
      mergedFromCardIds: uniqueIds,
      replacedByCardIds: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: 1,
      deletedAt: null,
    };

    const board = await this.getBoard(boardId);
    const boardType: BoardType = board.boardType ?? 'flow';

    await this.storage.runInTransaction(async () => {
      const boardEdges = await this.storage.listEdgesByBoard(boardId, false);
      const externalIncoming: Edge[] = [];
      const externalOutgoing: Edge[] = [];
      const internalEdges: Edge[] = [];
      const untouchedEdges: Edge[] = [];

      for (const edge of boardEdges) {
        const srcIn = targetSet.has(edge.sourceCardId);
        const tgtIn = targetSet.has(edge.targetCardId);
        if (srcIn && tgtIn) {
          internalEdges.push(edge);
        } else if (!srcIn && tgtIn) {
          externalIncoming.push(edge);
        } else if (srcIn && !tgtIn) {
          externalOutgoing.push(edge);
        } else {
          untouchedEdges.push(edge);
        }
      }

      await this.storage.saveCard(merged);
      await this.recordOutbox('card', merged.id, boardId, 'create', merged, timestamp);

      const seenTuples = new Set<string>();
      const newEdges: Edge[] = [];

      const queueRewiredEdge = (
        sourceCardId: string,
        targetCardId: string,
        edgeTemplate: Edge
      ): void => {
        const direction = edgeTemplate.direction ?? 'directed';
        const canonical = canonicalizeEdgeEndpoints(sourceCardId, targetCardId, direction);
        const key = `${canonical.sourceCardId}::${canonical.targetCardId}::${edgeTemplate.relationType}::${direction}`;
        if (seenTuples.has(key)) {
          return;
        }
        seenTuples.add(key);
        newEdges.push({
          id: this.generateId(),
          boardId,
          sourceCardId: canonical.sourceCardId,
          targetCardId: canonical.targetCardId,
          relationType: edgeTemplate.relationType,
          direction,
          ...(edgeTemplate.label !== undefined ? { label: edgeTemplate.label } : {}),
          styleVariant: edgeTemplate.styleVariant ?? 'solid',
          color: edgeTemplate.color ?? null,
          isConflicted: false,
          conflictReason: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          updatedByDeviceId: deviceId,
          version: 1,
          deletedAt: null,
        });
      };

      for (const inc of externalIncoming) {
        queueRewiredEdge(inc.sourceCardId, merged.id, inc);
      }
      for (const out of externalOutgoing) {
        queueRewiredEdge(merged.id, out.targetCardId, out);
      }

      // Verify that merging does not introduce a temporal cycle on flow boards.
      if (boardType === 'flow') {
        const candidateEdges = [...untouchedEdges, ...newEdges];
        for (const edge of newEdges) {
          if (
            (edge.direction ?? 'directed') === 'directed' &&
            (edge.relationType === 'blocks' || edge.relationType === 'causes')
          ) {
            const withoutSelf = candidateEdges.filter((e) => e.id !== edge.id);
            if (this.hasDirectedPath(withoutSelf, edge.targetCardId, edge.sourceCardId)) {
              throw new CyclicDependencyError(
                edge.sourceCardId,
                edge.targetCardId,
                'Cannot merge the selected cards because re-wiring their external dependencies would introduce a cycle in the board DAG.'
              );
            }
          }
        }
      }

      for (const edge of newEdges) {
        await this.storage.saveEdge(edge);
        await this.recordOutbox('edge', edge.id, boardId, 'create', edge, timestamp);
      }

      for (const oldEdge of [...internalEdges, ...externalIncoming, ...externalOutgoing]) {
        const deletedEdge: Edge = {
          ...oldEdge,
          updatedAt: timestamp,
          updatedByDeviceId: deviceId,
          version: oldEdge.version + 1,
          deletedAt: timestamp,
        };
        await this.storage.saveEdge(deletedEdge);
        await this.recordOutbox('edge', deletedEdge.id, boardId, 'delete', deletedEdge, timestamp);
      }

      for (const sourceCard of sourceCards) {
        const replaced: Card = {
          ...sourceCard,
          replacedByCardIds: [merged.id],
          updatedAt: timestamp,
          updatedByDeviceId: deviceId,
          version: sourceCard.version + 1,
          deletedAt: timestamp,
        };
        await this.storage.saveCard(replaced);
        await this.recordOutbox(
          'card',
          replaced.id,
          boardId,
          'merge',
          { sourceCardId: replaced.id, replacedByCardIds: [merged.id] },
          timestamp
        );
      }
    });

    this.emitEvent('card:merged', boardId, [merged.id, ...uniqueIds], deviceId, timestamp);
    return merged;
  }

  async insertIntermediateCard(
    sourceId: string,
    targetId: string,
    cardData: InsertIntermediateCardInput,
    ctx?: MutationContext
  ): Promise<Card> {
    const title = cardData.title.trim();
    if (!title) {
      throw new ValidationError('Intermediate card title must not be empty.');
    }

    const [sourceCard, targetCard] = await Promise.all([
      this.storage.getCard(sourceId, false),
      this.storage.getCard(targetId, false),
    ]);
    if (!sourceCard) {
      throw new NotFoundError('Card', sourceId);
    }
    if (!targetCard) {
      throw new NotFoundError('Card', targetId);
    }
    if (sourceCard.boardId !== targetCard.boardId) {
      throw new ValidationError('Source and target cards must belong to the same board.');
    }

    const boardId = sourceCard.boardId;
    const boardEdges = await this.storage.listEdgesByBoard(boardId, false);
    const existingEdge = boardEdges.find(
      (e) => e.sourceCardId === sourceId && e.targetCardId === targetId
    );
    if (!existingEdge) {
      throw new NotFoundError('Edge', `${sourceId} -> ${targetId}`);
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);

    const intermediate: Card = {
      id: this.generateId(),
      boardId,
      title,
      content: cardData.content ?? '',
      cardType: cardData.cardType ?? sourceCard.cardType,
      status: cardData.status ?? 'todo',
      tags: cardData.tags ? [...cardData.tags] : [],
      posX: (sourceCard.posX + targetCard.posX) / 2,
      posY: (sourceCard.posY + targetCard.posY) / 2,
      timelineOrder: null,
      startAt: null,
      endAt: null,
      splitFromCardId: null,
      mergedFromCardIds: null,
      replacedByCardIds: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: 1,
      deletedAt: null,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveCard(intermediate);
      await this.recordOutbox('card', intermediate.id, boardId, 'create', intermediate, timestamp);

      const deletedEdge: Edge = {
        ...existingEdge,
        updatedAt: timestamp,
        updatedByDeviceId: deviceId,
        version: existingEdge.version + 1,
        deletedAt: timestamp,
      };
      await this.storage.saveEdge(deletedEdge);
      await this.recordOutbox('edge', deletedEdge.id, boardId, 'delete', deletedEdge, timestamp);

      const firstHalf: Edge = {
        id: this.generateId(),
        boardId,
        sourceCardId: sourceId,
        targetCardId: intermediate.id,
        relationType: existingEdge.relationType,
        ...(existingEdge.label !== undefined ? { label: existingEdge.label } : {}),
        isConflicted: false,
        conflictReason: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedByDeviceId: deviceId,
        version: 1,
        deletedAt: null,
      };

      const secondHalf: Edge = {
        id: this.generateId(),
        boardId,
        sourceCardId: intermediate.id,
        targetCardId: targetId,
        relationType: existingEdge.relationType,
        ...(existingEdge.label !== undefined ? { label: existingEdge.label } : {}),
        isConflicted: false,
        conflictReason: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedByDeviceId: deviceId,
        version: 1,
        deletedAt: null,
      };

      await this.storage.saveEdge(firstHalf);
      await this.recordOutbox('edge', firstHalf.id, boardId, 'create', firstHalf, timestamp);
      await this.storage.saveEdge(secondHalf);
      await this.recordOutbox('edge', secondHalf.id, boardId, 'create', secondHalf, timestamp);
    });

    this.emitEvent('card:created', boardId, [intermediate.id], deviceId, timestamp);
    return intermediate;
  }

  // ---------------------------------------------------------------------------
  // Timeline Auto-Sorting (Phase 2)
  // ---------------------------------------------------------------------------

  async computeTimelineLayout(
    boardId: string,
    ctx?: MutationContext,
    options?: { applyToCards?: boolean }
  ): Promise<TimelineSortResult> {
    const board = await this.getBoard(boardId);
    if ((board.boardType ?? 'flow') === 'flat') {
      throw new ValidationError(
        'Timeline computation is only supported on flow boards.',
        'ERR_TIMELINE_NOT_SUPPORTED_ON_FLAT_BOARD'
      );
    }

    const [cards, edges] = await Promise.all([
      this.storage.listCardsByBoard(boardId, false),
      this.storage.listEdgesByBoard(boardId, false),
    ]);

    const applyToCards = options?.applyToCards !== false;
    const stepMap = computeTopologicalSteps(cards, edges);
    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const updatedCards: Card[] = [];
    const changedCardIds: string[] = [];

    if (applyToCards) {
      await this.storage.runInTransaction(async () => {
        for (const card of cards) {
          const computedStep = stepMap.get(card.id) ?? 0;
          if (card.timelineOrder !== computedStep) {
            const updated: Card = {
              ...card,
              timelineOrder: computedStep,
              updatedAt: timestamp,
              updatedByDeviceId: deviceId,
              version: card.version + 1,
            };
            await this.storage.saveCard(updated);
            await this.recordOutbox('card', updated.id, boardId, 'update', updated, timestamp);
            updatedCards.push(updated);
            changedCardIds.push(updated.id);
          } else {
            updatedCards.push(card);
          }
        }
      });

      if (changedCardIds.length > 0) {
        this.emitEvent('board:updated', boardId, changedCardIds, deviceId, timestamp);
      }
    } else {
      for (const card of cards) {
        updatedCards.push({
          ...card,
          timelineOrder: card.timelineOrder ?? stepMap.get(card.id) ?? 0,
        });
      }
    }

    const jumpBackEdges = edges.filter(
      (e) => e.deletedAt === null && e.relationType === 'jump_back'
    );

    return {
      boardId,
      steps: groupCardsByTimelineStep(updatedCards),
      violations: detectTimelineViolations(updatedCards, edges),
      jumpBackEdges,
      warnings: detectJumpBackWarnings(updatedCards, edges),
      hasTemporalCycle: hasTemporalCycle(updatedCards, edges),
    };
  }

  // ---------------------------------------------------------------------------
  // Board Type Conversion (Phase 2: flow <-> flat)
  // ---------------------------------------------------------------------------

  async analyzeBoardTypeConversion(
    boardId: string,
    targetType: BoardType
  ): Promise<BoardConversionAnalysis> {
    const board = await this.getBoard(boardId);
    const currentType: BoardType = board.boardType ?? 'flow';

    if (currentType === targetType || targetType === 'flat') {
      return {
        boardId,
        currentType,
        targetType,
        canConvertCleanly: true,
        symmetricEdgeIds: [],
        customRelationEdgeIds: [],
        cycleEdgeIds: [],
      };
    }

    // flat -> flow analysis
    const edges = await this.storage.listEdgesByBoard(boardId, false);
    const symmetricEdgeIds: string[] = [];
    const customRelationEdgeIds: string[] = [];
    const directedTemporalEdges: Edge[] = [];

    for (const edge of edges) {
      const dir = edge.direction ?? 'directed';
      if (dir === 'undirected' || dir === 'bidirectional') {
        symmetricEdgeIds.push(edge.id);
      }
      if (edge.relationType === 'custom') {
        customRelationEdgeIds.push(edge.id);
      }
      if (
        dir === 'directed' &&
        (edge.relationType === 'blocks' || edge.relationType === 'causes')
      ) {
        directedTemporalEdges.push(edge);
      }
    }

    // Find cycle-breaking edges among directed temporal edges
    const cycleEdgeIds: string[] = [];
    const accepted: Edge[] = [];
    for (const edge of directedTemporalEdges) {
      if (
        edge.sourceCardId === edge.targetCardId ||
        this.hasDirectedPath(accepted, edge.targetCardId, edge.sourceCardId)
      ) {
        cycleEdgeIds.push(edge.id);
      } else {
        accepted.push(edge);
      }
    }

    return {
      boardId,
      currentType,
      targetType,
      canConvertCleanly:
        symmetricEdgeIds.length === 0 &&
        customRelationEdgeIds.length === 0 &&
        cycleEdgeIds.length === 0,
      symmetricEdgeIds,
      customRelationEdgeIds,
      cycleEdgeIds,
    };
  }

  async convertBoardType(
    boardId: string,
    targetType: BoardType,
    strategy: BoardConversionStrategy = 'abort',
    ctx?: MutationContext
  ): Promise<{ board: Board; analysis: BoardConversionAnalysis }> {
    const board = await this.getBoard(boardId);
    const analysis = await this.analyzeBoardTypeConversion(boardId, targetType);

    if (analysis.currentType === targetType) {
      return { board, analysis };
    }

    if (!analysis.canConvertCleanly && strategy === 'abort') {
      throw new BoardConversionError(analysis);
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const edges = await this.storage.listEdgesByBoard(boardId, false);
    const cycleEdgeSet = new Set(analysis.cycleEdgeIds);
    const updatedBoard: Board = {
      ...board,
      boardType: targetType,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: board.version + 1,
    };

    const touchedIds: string[] = [updatedBoard.id];

    await this.storage.runInTransaction(async () => {
      if (targetType === 'flat') {
        // flow -> flat: convert jump_back edges to dashed relates_to so no link is lost
        for (const edge of edges) {
          if (edge.relationType === 'jump_back') {
            const converted: Edge = {
              ...edge,
              relationType: 'relates_to',
              styleVariant: 'dashed',
              updatedAt: timestamp,
              updatedByDeviceId: deviceId,
              version: edge.version + 1,
            };
            await this.storage.saveEdge(converted);
            await this.recordOutbox('edge', converted.id, boardId, 'update', converted, timestamp);
            touchedIds.push(converted.id);
          }
        }
      } else {
        // flat -> flow (strategy === 'demote_incompatible' or clean)
        for (const edge of edges) {
          const dir = edge.direction ?? 'directed';
          let nextEdge: Edge | null = null;

          if (dir !== 'directed') {
            nextEdge = {
              ...edge,
              direction: 'directed',
              relationType: 'relates_to',
              updatedAt: timestamp,
              updatedByDeviceId: deviceId,
              version: edge.version + 1,
            };
          } else if (edge.relationType === 'custom') {
            nextEdge = {
              ...edge,
              relationType: 'relates_to',
              updatedAt: timestamp,
              updatedByDeviceId: deviceId,
              version: edge.version + 1,
            };
          } else if (cycleEdgeSet.has(edge.id)) {
            nextEdge = {
              ...edge,
              relationType: 'jump_back',
              styleVariant: 'dashed',
              updatedAt: timestamp,
              updatedByDeviceId: deviceId,
              version: edge.version + 1,
            };
          }

          if (nextEdge) {
            await this.storage.saveEdge(nextEdge);
            await this.recordOutbox('edge', nextEdge.id, boardId, 'update', nextEdge, timestamp);
            touchedIds.push(nextEdge.id);
          }
        }
      }

      await this.storage.saveBoard(updatedBoard);
      await this.recordOutbox('board', updatedBoard.id, boardId, 'update', updatedBoard, timestamp);
    });

    this.emitEvent('board:updated', boardId, touchedIds, deviceId, timestamp);
    return { board: updatedBoard, analysis };
  }

  // ---------------------------------------------------------------------------
  // Single-File Markdown Export (Phase 3)
  // ---------------------------------------------------------------------------

  async exportBoardToMarkdown(
    boardId: string,
    options?: MarkdownExportOptions
  ): Promise<MarkdownExportResult> {
    const graph = await this.getBoardGraph(boardId);
    return renderBoardGraphToMarkdown(graph, {
      exportedAt: this.now(),
      ...options,
    });
  }

  // ---------------------------------------------------------------------------
  // Structured JSON Board Export & Import
  // ---------------------------------------------------------------------------

  async exportBoardToJson(boardId: string): Promise<JsonExportResult> {
    const graph = await this.getBoardGraph(boardId);
    return renderBoardGraphToJson(graph, this.now());
  }

  /**
   * Validates and imports a versioned ariadeck-board v1 JSON payload as a new
   * board with freshly remapped UUIDs inside a single atomic transaction.
   */
  async importBoardFromJson(
    input: string | BoardJsonExport | unknown,
    options: ImportBoardOptions = {},
    ctx?: MutationContext
  ): Promise<BoardGraph> {
    const validated = parseAndValidateBoardJson(input);
    const title = (options.titleOverride ?? validated.board.title).trim();
    if (!title) {
      throw new ValidationError('Imported board title must not be empty.');
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const newBoardId = this.generateId();

    const board: Board = {
      id: newBoardId,
      title,
      description: validated.board.description,
      boardType: validated.board.boardType ?? 'flow',
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: 1,
      deletedAt: null,
    };

    const cardIdMap = new Map<string, string>();
    const createdCards: Card[] = validated.cards.map((src) => {
      const newCardId = this.generateId();
      cardIdMap.set(src.id, newCardId);
      return {
        id: newCardId,
        boardId: newBoardId,
        title: src.title,
        content: src.content,
        cardType: src.cardType,
        displayMode: src.displayMode ?? 'standard',
        status: src.status,
        tags: [...src.tags],
        posX: src.posX,
        posY: src.posY,
        timelineOrder: src.timelineOrder,
        startAt: src.startAt,
        endAt: src.endAt,
        splitFromCardId: null,
        mergedFromCardIds: null,
        replacedByCardIds: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedByDeviceId: deviceId,
        version: 1,
        deletedAt: null,
      };
    });

    const createdEdges: Edge[] = validated.edges.map((src) => {
      const direction = src.direction ?? 'directed';
      const canonical = canonicalizeEdgeEndpoints(
        cardIdMap.get(src.sourceCardId)!,
        cardIdMap.get(src.targetCardId)!,
        direction
      );
      return {
        id: this.generateId(),
        boardId: newBoardId,
        sourceCardId: canonical.sourceCardId,
        targetCardId: canonical.targetCardId,
        relationType: src.relationType,
        direction,
        ...(src.label !== undefined ? { label: src.label } : {}),
        styleVariant:
          src.styleVariant ?? (src.relationType === 'jump_back' ? 'dashed' : 'solid'),
        color: src.color ?? null,
        isConflicted: false,
        conflictReason: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedByDeviceId: deviceId,
        version: 1,
        deletedAt: null,
      };
    });

    const createdAttachments: CardAttachment[] = validated.attachments.map((src) => ({
      id: this.generateId(),
      cardId: cardIdMap.get(src.cardId)!,
      boardId: newBoardId,
      kind: src.kind,
      localUri: src.localUri,
      remoteFileId: null,
      mimeType: src.mimeType,
      fileSize: src.fileSize,
      durationMs: src.durationMs,
      transcript: src.transcript,
      syncStatus: 'local_only',
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: 1,
      deletedAt: null,
    }));

    await this.storage.runInTransaction(async () => {
      await this.storage.saveBoard(board);
      await this.recordOutbox('board', board.id, board.id, 'create', board, timestamp);

      for (const card of createdCards) {
        await this.storage.saveCard(card);
        await this.recordOutbox('card', card.id, board.id, 'create', card, timestamp);
      }

      for (const edge of createdEdges) {
        await this.storage.saveEdge(edge);
        await this.recordOutbox('edge', edge.id, board.id, 'create', edge, timestamp);
      }

      for (const attachment of createdAttachments) {
        await this.storage.saveAttachment(attachment);
        await this.recordOutbox(
          'attachment',
          attachment.id,
          board.id,
          'create',
          attachment,
          timestamp
        );
      }
    });

    this.emitEvent('board:created', board.id, [board.id], deviceId, timestamp);

    return {
      board,
      cards: createdCards,
      edges: createdEdges,
      attachments: createdAttachments,
    };
  }

  // ---------------------------------------------------------------------------
  // Multimodal Attachments & Full-Text Search (Phase 4)
  // ---------------------------------------------------------------------------

  async addAttachment(
    input: CreateAttachmentInput,
    ctx?: MutationContext
  ): Promise<CardAttachment> {
    const card = await this.storage.getCard(input.cardId, false);
    if (!card || card.boardId !== input.boardId) {
      throw new NotFoundError('Card', input.cardId);
    }
    if (!input.localUri.trim()) {
      throw new ValidationError('Attachment localUri must not be empty.');
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const attachment: CardAttachment = {
      id: input.id ?? this.generateId(),
      cardId: input.cardId,
      boardId: input.boardId,
      kind: input.kind,
      localUri: input.localUri,
      remoteFileId: input.remoteFileId ?? null,
      mimeType: input.mimeType,
      fileSize: input.fileSize ?? 0,
      sha256: input.sha256 ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      thumbnailUri: input.thumbnailUri ?? null,
      caption: input.caption ?? null,
      isCover: input.isCover ?? false,
      sortOrder: input.sortOrder ?? 0,
      durationMs: input.durationMs ?? null,
      transcript: input.transcript ?? null,
      syncStatus: input.syncStatus ?? 'local_only',
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: 1,
      deletedAt: null,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveAttachment(attachment);
      await this.recordOutbox(
        'attachment',
        attachment.id,
        attachment.boardId,
        'create',
        attachment,
        timestamp
      );
    });

    this.emitEvent('card:updated', attachment.boardId, [attachment.cardId], deviceId, timestamp);
    return attachment;
  }

  async updateAttachmentTranscript(
    attachmentId: string,
    transcript: string | null,
    ctx?: MutationContext
  ): Promise<CardAttachment> {
    const existing = await this.storage.getAttachment(attachmentId, false);
    if (!existing) {
      throw new NotFoundError('Attachment', attachmentId);
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const updated: CardAttachment = {
      ...existing,
      transcript,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: existing.version + 1,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveAttachment(updated);
      await this.recordOutbox(
        'attachment',
        updated.id,
        updated.boardId,
        'update',
        updated,
        timestamp
      );
    });

    this.emitEvent('card:updated', updated.boardId, [updated.cardId], deviceId, timestamp);
    return updated;
  }

  async deleteAttachment(attachmentId: string, ctx?: MutationContext): Promise<void> {
    const existing = await this.storage.getAttachment(attachmentId, false);
    if (!existing) {
      throw new NotFoundError('Attachment', attachmentId);
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const deleted: CardAttachment = {
      ...existing,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: existing.version + 1,
      deletedAt: timestamp,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveAttachment(deleted);
      await this.recordOutbox(
        'attachment',
        deleted.id,
        deleted.boardId,
        'delete',
        deleted,
        timestamp
      );
    });

    this.emitEvent('card:updated', existing.boardId, [existing.cardId], deviceId, timestamp);
  }

  /**
   * Searches active cards on a board across titles, Markdown bodies, tags,
   * and attachment transcripts/captions (case-insensitive).
   */
  async searchCards(boardId: string, query: string): Promise<Card[]> {
    const graph = await this.getBoardGraph(boardId);
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return graph.cards;
    }

    const transcriptsByCard = new Map<string, string[]>();
    for (const att of graph.attachments) {
      const texts: string[] = [];
      if (att.transcript) texts.push(att.transcript);
      if (att.caption) texts.push(att.caption);
      if (texts.length > 0) {
        const list = transcriptsByCard.get(att.cardId);
        if (list) list.push(...texts);
        else transcriptsByCard.set(att.cardId, texts);
      }
    }

    return graph.cards.filter((card) => {
      if (card.title.toLowerCase().includes(normalized)) return true;
      if (card.content.toLowerCase().includes(normalized)) return true;
      if (card.tags.some((t) => t.toLowerCase().includes(normalized))) return true;
      const transcripts = transcriptsByCard.get(card.id) ?? [];
      return transcripts.some((tr) => tr.toLowerCase().includes(normalized));
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  protected validateEdgeForBoardType(
    boardType: BoardType,
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    direction: EdgeDirection
  ): void {
    if (boardType === 'flow') {
      if (direction !== 'directed') {
        throw new ValidationError(
          `Edge direction "${direction}" is only allowed on flat boards.`,
          'ERR_INVALID_EDGE_FOR_BOARD_TYPE'
        );
      }
      if (relationType === 'custom') {
        throw new ValidationError(
          'Relation type "custom" is only allowed on flat boards.',
          'ERR_INVALID_EDGE_FOR_BOARD_TYPE'
        );
      }
      if (sourceId === targetId && relationType !== 'jump_back') {
        throw new CyclicDependencyError(
          sourceId,
          targetId,
          `Self-loops are not allowed for "${relationType}" edges on flow boards.`,
          'ERR_SELF_LOOP_NOT_ALLOWED'
        );
      }
    } else {
      if (relationType === 'jump_back') {
        throw new ValidationError(
          'Relation type "jump_back" is only allowed on flow boards.',
          'ERR_INVALID_EDGE_FOR_BOARD_TYPE'
        );
      }
      if (sourceId === targetId && (relationType === 'blocks' || relationType === 'causes')) {
        throw new CyclicDependencyError(
          sourceId,
          targetId,
          `Self-loops are not allowed for "${relationType}" edges.`,
          'ERR_SELF_LOOP_NOT_ALLOWED'
        );
      }
    }
  }

  protected hasDirectedPath(edges: Edge[], startId: string, goalId: string): boolean {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.deletedAt !== null || edge.isConflicted) {
        continue;
      }
      if ((edge.direction ?? 'directed') !== 'directed') {
        continue;
      }
      if (edge.relationType !== 'blocks' && edge.relationType !== 'causes') {
        continue;
      }
      const neighbors = adjacency.get(edge.sourceCardId);
      if (neighbors) {
        neighbors.push(edge.targetCardId);
      } else {
        adjacency.set(edge.sourceCardId, [edge.targetCardId]);
      }
    }

    const visited = new Set<string>();
    const stack: string[] = [startId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === goalId) {
        return true;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const nextNodes = adjacency.get(current);
      if (nextNodes) {
        for (const next of nextNodes) {
          if (!visited.has(next)) {
            stack.push(next);
          }
        }
      }
    }
    return false;
  }

  protected computeDefaultPosition(existingCards: Card[]): { posX: number; posY: number } {
    for (let index = 0; index <= existingCards.length; index++) {
      const col = index % GRID_COLUMNS;
      const row = Math.floor(index / GRID_COLUMNS);
      const candidateX = 80 + col * DEFAULT_CARD_WIDTH;
      const candidateY = 80 + row * DEFAULT_CARD_HEIGHT;

      const overlaps = existingCards.some(
        (card) =>
          Math.abs(card.posX - candidateX) < DEFAULT_CARD_WIDTH * 0.6 &&
          Math.abs(card.posY - candidateY) < DEFAULT_CARD_HEIGHT * 0.6
      );
      if (!overlaps) {
        return { posX: candidateX, posY: candidateY };
      }
    }
    return {
      posX: 80 + existingCards.length * 40,
      posY: 80 + existingCards.length * 40,
    };
  }
}
