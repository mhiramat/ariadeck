import { NotFoundError, ValidationError } from '../errors.js';
import type { GraphEventBus } from '../events/GraphEventBus.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import { canonicalizeEdgeEndpoints } from '../timeline/timelineLayout.js';
import type {
  Board,
  Card,
  CardAttachment,
  ConflictRecord,
  Edge,
  SyncMetadata,
} from '../types/models.js';
import type { BoardSyncSnapshot, RemoteSyncAdapter } from './RemoteSyncAdapter.js';

export interface BoardSyncEngineOptions {
  deviceId: string;
  eventBus?: GraphEventBus;
  now?: () => string;
  generateId?: () => string;
}

export interface SyncBoardResult {
  boardId: string;
  syncedAt: string;
  mergedCardsCount: number;
  mergedEdgesCount: number;
  newConflicts: ConflictRecord[];
  reroutedEdgeIds: string[];
  flaggedCyclicEdgeIds: string[];
}

export type ConflictResolutionAction =
  | { strategy: 'keep_local' }
  | { strategy: 'keep_remote' }
  | { strategy: 'custom_merge'; title: string; content: string }
  | { strategy: 'delete_edge' }
  | { strategy: 'keep_edge' };

function defaultGenerateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `sync-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Deterministic Last-Write-Wins (LWW) comparator:
 * compares ISO 8601 updatedAt first, breaking ties lexicographically by updatedByDeviceId.
 * Returns > 0 if `a` wins over `b`, < 0 if `b` wins over `a`, 0 if identical.
 */
export function compareSyncMetadata(a: SyncMetadata, b: SyncMetadata): number {
  const timeCmp = a.updatedAt.localeCompare(b.updatedAt);
  if (timeCmp !== 0) return timeCmp;
  return a.updatedByDeviceId.localeCompare(b.updatedByDeviceId);
}

/**
 * Bidirectional offline-first synchronization engine implementing all 5
 * conflict-resolution rules defined in DESIGN_SPEC.md Section 5.2.
 */
export class BoardSyncEngine {
  private readonly storage: StorageAdapter;
  private readonly remote: RemoteSyncAdapter;
  private readonly deviceId: string;
  private readonly eventBus?: GraphEventBus;
  private readonly now: () => string;
  private readonly generateId: () => string;

  constructor(
    storage: StorageAdapter,
    remote: RemoteSyncAdapter,
    options: BoardSyncEngineOptions
  ) {
    this.storage = storage;
    this.remote = remote;
    this.deviceId = options.deviceId;
    this.eventBus = options.eventBus;
    this.now = options.now ?? (() => new Date().toISOString());
    this.generateId = options.generateId ?? defaultGenerateId;
  }

  async listConflicts(boardId: string, includeResolved = false): Promise<ConflictRecord[]> {
    return this.storage.listConflicts(boardId, includeResolved);
  }

  async syncBoard(boardId: string): Promise<SyncBoardResult> {
    const localBoard = await this.storage.getBoard(boardId, true);
    const remoteSnapshot = await this.remote.fetchBoardSnapshot(boardId);

    if (!localBoard && !remoteSnapshot) {
      throw new NotFoundError('Board', boardId);
    }

    const syncedAt = this.now();
    const newConflicts: ConflictRecord[] = [];
    const reroutedEdgeIds: string[] = [];
    const flaggedCyclicEdgeIds: string[] = [];

    const [localCards, localEdges, localAttachments, unsyncedOutbox] = await Promise.all([
      this.storage.listCardsByBoard(boardId, true),
      this.storage.listEdgesByBoard(boardId, true),
      this.storage.listAttachmentsByBoard(boardId, true),
      this.storage.listUnsyncedOutbox(boardId),
    ]);

    const locallyEditedCardIds = new Set(
      unsyncedOutbox
        .filter((entry) => entry.entityType === 'card')
        .map((entry) => entry.entityId)
    );

    // 1. Merge Board metadata via LWW
    const mergedBoard: Board =
      localBoard && remoteSnapshot
        ? compareSyncMetadata(localBoard, remoteSnapshot.board) >= 0
          ? localBoard
          : remoteSnapshot.board
        : (localBoard ?? remoteSnapshot!.board);

    // 2. Merge Cards via LWW + detect content_collision & deleted_target_edit
    const localCardMap = new Map(localCards.map((c) => [c.id, c]));
    const remoteCardMap = new Map((remoteSnapshot?.cards ?? []).map((c) => [c.id, c]));
    const allCardIds = new Set([...localCardMap.keys(), ...remoteCardMap.keys()]);
    const mergedCardMap = new Map<string, Card>();

    for (const cardId of allCardIds) {
      const localCard = localCardMap.get(cardId);
      const remoteCard = remoteCardMap.get(cardId);

      if (localCard && !remoteCard) {
        mergedCardMap.set(cardId, localCard);
        continue;
      }
      if (!localCard && remoteCard) {
        mergedCardMap.set(cardId, remoteCard);
        continue;
      }

      const l = localCard!;
      const r = remoteCard!;

      const textDiffers = l.title !== r.title || l.content !== r.content;
      const localSplitOrMerged = l.deletedAt !== null && Boolean(l.replacedByCardIds?.length);
      const remoteSplitOrMerged = r.deletedAt !== null && Boolean(r.replacedByCardIds?.length);

      // Rule 2: Split/Merge vs Remote Edit -> preserve lineage replacement and log deleted_target_edit
      if (localSplitOrMerged && r.deletedAt === null && textDiffers) {
        mergedCardMap.set(cardId, l);
        newConflicts.push({
          id: this.generateId(),
          boardId,
          entityType: 'card',
          entityId: cardId,
          conflictType: 'deleted_target_edit',
          localSnapshotJson: JSON.stringify(l),
          remoteSnapshotJson: JSON.stringify(r),
          resolvedAt: null,
          createdAt: syncedAt,
        });
        continue;
      }

      if (remoteSplitOrMerged && l.deletedAt === null && textDiffers) {
        mergedCardMap.set(cardId, r);
        newConflicts.push({
          id: this.generateId(),
          boardId,
          entityType: 'card',
          entityId: cardId,
          conflictType: 'deleted_target_edit',
          localSnapshotJson: JSON.stringify(l),
          remoteSnapshotJson: JSON.stringify(r),
          resolvedAt: null,
          createdAt: syncedAt,
        });
        continue;
      }

      // Rule 1: Concurrent text/attribute edits -> LWW winner + content_collision record
      const winner = compareSyncMetadata(l, r) >= 0 ? l : r;
      mergedCardMap.set(cardId, winner);

      const bothActive = l.deletedAt === null && r.deletedAt === null;
      const remoteDifferentEdit =
        r.updatedAt !== l.updatedAt || r.updatedByDeviceId !== l.updatedByDeviceId;

      if (bothActive && textDiffers && locallyEditedCardIds.has(cardId) && remoteDifferentEdit) {
        newConflicts.push({
          id: this.generateId(),
          boardId,
          entityType: 'card',
          entityId: cardId,
          conflictType: 'content_collision',
          localSnapshotJson: JSON.stringify(l),
          remoteSnapshotJson: JSON.stringify(r),
          resolvedAt: null,
          createdAt: syncedAt,
        });
      }
    }

    // 3. Merge Edges via LWW, canonicalizing symmetric endpoints and applying
    //    Lineage Re-routing (Rule 2) & Tombstone cleanup (Rule 4)
    const canonicalize = (e: Edge): Edge => {
      const dir = e.direction ?? 'directed';
      const endpoints = canonicalizeEdgeEndpoints(e.sourceCardId, e.targetCardId, dir);
      if (endpoints.sourceCardId === e.sourceCardId && endpoints.targetCardId === e.targetCardId) {
        return e;
      }
      return { ...e, sourceCardId: endpoints.sourceCardId, targetCardId: endpoints.targetCardId };
    };

    const localEdgeMap = new Map(localEdges.map((e) => [e.id, canonicalize(e)]));
    const remoteEdgeMap = new Map((remoteSnapshot?.edges ?? []).map((e) => [e.id, canonicalize(e)]));
    const allEdgeIds = new Set([...localEdgeMap.keys(), ...remoteEdgeMap.keys()]);
    const mergedEdgeMap = new Map<string, Edge>();
    const activeTupleWinner = new Map<string, Edge>();
    const effectiveBoardType = mergedBoard.boardType ?? 'flow';

    for (const edgeId of allEdgeIds) {
      const l = localEdgeMap.get(edgeId);
      const r = remoteEdgeMap.get(edgeId);
      let edge: Edge;
      if (l && !r) edge = l;
      else if (!l && r) edge = r;
      else edge = compareSyncMetadata(l!, r!) >= 0 ? l! : r!;

      if (edge.deletedAt === null) {
        const resolvedSource = this.resolveLineageTarget(
          edge.sourceCardId,
          'outgoing',
          mergedCardMap
        );
        const resolvedTarget = this.resolveLineageTarget(
          edge.targetCardId,
          'incoming',
          mergedCardMap
        );

        const sourceCard = resolvedSource ? mergedCardMap.get(resolvedSource) : undefined;
        const targetCard = resolvedTarget ? mergedCardMap.get(resolvedTarget) : undefined;
        const allowsSelfLoop =
          edge.relationType === 'jump_back' ||
          (effectiveBoardType === 'flat' &&
            (edge.relationType === 'relates_to' || edge.relationType === 'custom'));

        // Rule 4: Edge referencing a deleted card with no active lineage replacement -> soft-delete
        if (
          !sourceCard ||
          !targetCard ||
          sourceCard.deletedAt !== null ||
          targetCard.deletedAt !== null ||
          (resolvedSource === resolvedTarget && !allowsSelfLoop)
        ) {
          edge = {
            ...edge,
            deletedAt: syncedAt,
            updatedAt: syncedAt,
            updatedByDeviceId: this.deviceId,
            version: edge.version + 1,
          };
        } else {
          const dir = edge.direction ?? 'directed';
          const nextEndpoints = canonicalizeEdgeEndpoints(resolvedSource!, resolvedTarget!, dir);
          if (
            nextEndpoints.sourceCardId !== edge.sourceCardId ||
            nextEndpoints.targetCardId !== edge.targetCardId
          ) {
            // Rule 2: Re-route edge to split/merged replacement card
            edge = {
              ...edge,
              sourceCardId: nextEndpoints.sourceCardId,
              targetCardId: nextEndpoints.targetCardId,
              updatedAt: syncedAt,
              updatedByDeviceId: this.deviceId,
              version: edge.version + 1,
            };
            reroutedEdgeIds.push(edge.id);
          }

          // Board-type conflict demotion: if winning board is 'flow', demote flat-only edges
          if (effectiveBoardType === 'flow') {
            const currentDir = edge.direction ?? 'directed';
            if (currentDir !== 'directed' || edge.relationType === 'custom') {
              edge = {
                ...edge,
                direction: 'directed',
                relationType: 'relates_to',
                updatedAt: syncedAt,
                updatedByDeviceId: this.deviceId,
                version: edge.version + 1,
              };
            }
          }

          // Deduplicate canonicalized symmetric/identical edges created offline on different devices
          const tupleKey = `${edge.sourceCardId}::${edge.targetCardId}::${edge.relationType}::${edge.direction ?? 'directed'}`;
          const prevWinner = activeTupleWinner.get(tupleKey);
          if (prevWinner && prevWinner.id !== edge.id) {
            if (compareSyncMetadata(edge, prevWinner) > 0) {
              mergedEdgeMap.set(prevWinner.id, {
                ...prevWinner,
                deletedAt: syncedAt,
                updatedAt: syncedAt,
                updatedByDeviceId: this.deviceId,
                version: prevWinner.version + 1,
              });
              activeTupleWinner.set(tupleKey, edge);
            } else {
              edge = {
                ...edge,
                deletedAt: syncedAt,
                updatedAt: syncedAt,
                updatedByDeviceId: this.deviceId,
                version: edge.version + 1,
              };
            }
          } else {
            activeTupleWinner.set(tupleKey, edge);
          }
        }
      }

      mergedEdgeMap.set(edge.id, edge);
    }

    // 4. Rule 3: Post-merge DAG cycle check (flow boards only, temporal edges only)
    if (effectiveBoardType === 'flow') {
      const cycleEdgeIds = this.detectAndFlagCycles(mergedEdgeMap, syncedAt, boardId, newConflicts);
      flaggedCyclicEdgeIds.push(...cycleEdgeIds);
    }

    // 5. Rule 5: Merge CardAttachments via LWW (syncing transcripts even while binary is local_only)
    const localAttMap = new Map(localAttachments.map((a) => [a.id, a]));
    const remoteAttMap = new Map((remoteSnapshot?.attachments ?? []).map((a) => [a.id, a]));
    const allAttIds = new Set([...localAttMap.keys(), ...remoteAttMap.keys()]);
    const mergedAttachments: CardAttachment[] = [];

    for (const attId of allAttIds) {
      const l = localAttMap.get(attId);
      const r = remoteAttMap.get(attId);
      if (l && !r) mergedAttachments.push(l);
      else if (!l && r) mergedAttachments.push(r);
      else mergedAttachments.push(compareSyncMetadata(l!, r!) >= 0 ? l! : r!);
    }

    const mergedCards = Array.from(mergedCardMap.values());
    const mergedEdges = Array.from(mergedEdgeMap.values());

    // Persist merged state + conflicts + mark outbox synced transactionally
    await this.storage.runInTransaction(async () => {
      await this.storage.saveBoard(mergedBoard);
      for (const card of mergedCards) {
        await this.storage.saveCard(card);
      }
      for (const edge of mergedEdges) {
        await this.storage.saveEdge(edge);
      }
      for (const att of mergedAttachments) {
        await this.storage.saveAttachment(att);
      }
      for (const conflict of newConflicts) {
        await this.storage.saveConflict(conflict);
      }
      if (unsyncedOutbox.length > 0) {
        await this.storage.markOutboxSynced(
          unsyncedOutbox.map((entry) => entry.seq),
          syncedAt
        );
      }
    });

    // Upload merged snapshot to remote
    const uploadedSnapshot: BoardSyncSnapshot = {
      schemaVersion: 1,
      board: mergedBoard,
      cards: mergedCards,
      edges: mergedEdges,
      attachments: mergedAttachments,
      exportedAt: syncedAt,
      deviceId: this.deviceId,
    };
    await this.remote.uploadBoardSnapshot(uploadedSnapshot);

    this.eventBus?.emit({
      type: 'board:updated',
      boardId,
      entityIds: [boardId],
      deviceId: this.deviceId,
      timestamp: syncedAt,
    });

    return {
      boardId,
      syncedAt,
      mergedCardsCount: mergedCards.length,
      mergedEdgesCount: mergedEdges.length,
      newConflicts,
      reroutedEdgeIds,
      flaggedCyclicEdgeIds,
    };
  }

  async resolveConflict(
    boardId: string,
    conflictId: string,
    action: ConflictResolutionAction
  ): Promise<ConflictRecord> {
    const conflicts = await this.storage.listConflicts(boardId, true);
    const conflict = conflicts.find((c) => c.id === conflictId);
    if (!conflict) {
      throw new NotFoundError('Conflict', conflictId);
    }

    const resolvedAt = this.now();

    await this.storage.runInTransaction(async () => {
      if (conflict.entityType === 'card') {
        const localSnap = JSON.parse(conflict.localSnapshotJson) as Card;
        const remoteSnap = JSON.parse(conflict.remoteSnapshotJson) as Card;
        const current = await this.storage.getCard(conflict.entityId, true);
        if (!current) {
          throw new NotFoundError('Card', conflict.entityId);
        }

        if (action.strategy === 'keep_local') {
          await this.storage.saveCard({
            ...current,
            title: localSnap.title,
            content: localSnap.content,
            deletedAt: localSnap.deletedAt,
            updatedAt: resolvedAt,
            updatedByDeviceId: this.deviceId,
            version: current.version + 1,
          });
        } else if (action.strategy === 'keep_remote') {
          await this.storage.saveCard({
            ...current,
            title: remoteSnap.title,
            content: remoteSnap.content,
            deletedAt: remoteSnap.deletedAt,
            updatedAt: resolvedAt,
            updatedByDeviceId: this.deviceId,
            version: current.version + 1,
          });
        } else if (action.strategy === 'custom_merge') {
          if (!action.title.trim()) {
            throw new ValidationError('Merged title must not be empty.');
          }
          await this.storage.saveCard({
            ...current,
            title: action.title.trim(),
            content: action.content,
            deletedAt: null,
            updatedAt: resolvedAt,
            updatedByDeviceId: this.deviceId,
            version: current.version + 1,
          });
        } else {
          throw new ValidationError(
            `Resolution strategy "${action.strategy}" is not valid for card conflicts.`
          );
        }
      } else if (conflict.entityType === 'edge') {
        const currentEdge = await this.storage.getEdge(conflict.entityId, true);
        if (!currentEdge) {
          throw new NotFoundError('Edge', conflict.entityId);
        }

        if (action.strategy === 'delete_edge') {
          await this.storage.saveEdge({
            ...currentEdge,
            isConflicted: false,
            conflictReason: null,
            deletedAt: resolvedAt,
            updatedAt: resolvedAt,
            updatedByDeviceId: this.deviceId,
            version: currentEdge.version + 1,
          });
        } else if (action.strategy === 'keep_edge') {
          await this.storage.saveEdge({
            ...currentEdge,
            isConflicted: false,
            conflictReason: null,
            updatedAt: resolvedAt,
            updatedByDeviceId: this.deviceId,
            version: currentEdge.version + 1,
          });
        } else {
          throw new ValidationError(
            `Resolution strategy "${action.strategy}" is not valid for edge conflicts.`
          );
        }
      }

      const resolvedRecord: ConflictRecord = {
        ...conflict,
        resolvedAt,
      };
      await this.storage.saveConflict(resolvedRecord);
    });

    this.eventBus?.emit({
      type: 'board:updated',
      boardId,
      entityIds: [conflict.entityId],
      deviceId: this.deviceId,
      timestamp: resolvedAt,
    });

    return { ...conflict, resolvedAt };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private resolveLineageTarget(
    cardId: string,
    direction: 'incoming' | 'outgoing',
    cardMap: Map<string, Card>
  ): string | null {
    const visited = new Set<string>();
    let currentId = cardId;

    while (!visited.has(currentId)) {
      visited.add(currentId);
      const card = cardMap.get(currentId);
      if (!card) return null;
      if (card.deletedAt === null) return currentId;

      const replacements = card.replacedByCardIds;
      if (!replacements || replacements.length === 0) {
        return null;
      }

      currentId =
        replacements.length === 1
          ? replacements[0]!
          : direction === 'incoming'
            ? replacements[0]!
            : replacements[replacements.length - 1]!;
    }

    return null;
  }

  private detectAndFlagCycles(
    edgeMap: Map<string, Edge>,
    syncedAt: string,
    boardId: string,
    newConflicts: ConflictRecord[]
  ): string[] {
    const flaggedIds: string[] = [];

    while (true) {
      const cycleEdges = this.findOneCycleEdges(edgeMap);
      if (!cycleEdges || cycleEdges.length === 0) {
        break;
      }

      // Flag the newest edge in the cycle as conflicted
      let newest = cycleEdges[0]!;
      for (const candidate of cycleEdges.slice(1)) {
        if (compareSyncMetadata(candidate, newest) > 0) {
          newest = candidate;
        }
      }

      const flagged: Edge = {
        ...newest,
        isConflicted: true,
        conflictReason: 'cyclic_dependency',
        updatedAt: syncedAt,
        updatedByDeviceId: this.deviceId,
        version: newest.version + 1,
      };
      edgeMap.set(flagged.id, flagged);
      flaggedIds.push(flagged.id);

      newConflicts.push({
        id: this.generateId(),
        boardId,
        entityType: 'edge',
        entityId: flagged.id,
        conflictType: 'cyclic_edge',
        localSnapshotJson: JSON.stringify(flagged),
        remoteSnapshotJson: JSON.stringify(cycleEdges),
        resolvedAt: null,
        createdAt: syncedAt,
      });
    }

    return flaggedIds;
  }

  private findOneCycleEdges(edgeMap: Map<string, Edge>): Edge[] | null {
    const adjacency = new Map<string, Edge[]>();
    const nodes = new Set<string>();

    for (const edge of edgeMap.values()) {
      if (edge.deletedAt !== null || edge.isConflicted) continue;
      if (edge.relationType !== 'blocks' && edge.relationType !== 'causes') continue;

      nodes.add(edge.sourceCardId);
      nodes.add(edge.targetCardId);
      const list = adjacency.get(edge.sourceCardId);
      if (list) list.push(edge);
      else adjacency.set(edge.sourceCardId, [edge]);
    }

    const state = new Map<string, 'visiting' | 'visited'>();
    const edgeStack: Edge[] = [];
    const nodeStack: string[] = [];

    const dfs = (nodeId: string): Edge[] | null => {
      state.set(nodeId, 'visiting');
      nodeStack.push(nodeId);

      for (const edge of adjacency.get(nodeId) ?? []) {
        const next = edge.targetCardId;
        const nextState = state.get(next);
        if (nextState === 'visiting') {
          const cycleStartIdx = nodeStack.indexOf(next);
          return [...edgeStack.slice(cycleStartIdx), edge];
        }
        if (!nextState) {
          edgeStack.push(edge);
          const found = dfs(next);
          edgeStack.pop();
          if (found) return found;
        }
      }

      nodeStack.pop();
      state.set(nodeId, 'visited');
      return null;
    };

    for (const node of nodes) {
      if (!state.has(node)) {
        const cycle = dfs(node);
        if (cycle) return cycle;
      }
    }

    return null;
  }
}
