export type CardType = 'task' | 'idea' | 'plot_event' | 'note';
export type CardStatus = 'todo' | 'in_progress' | 'done' | 'archived';
export type RelationType = 'blocks' | 'causes' | 'relates_to';
export type AttachmentKind = 'image' | 'audio';
export type AssetSyncStatus = 'local_only' | 'uploading' | 'synced' | 'missing_remote';

export type SyncOutboxEntityType = 'board' | 'card' | 'edge' | 'attachment';
export type SyncOutboxOperation = 'create' | 'update' | 'delete' | 'split' | 'merge';
export type ConflictType = 'content_collision' | 'cyclic_edge' | 'deleted_target_edit';

/**
 * Shared synchronization and conflict-resolution metadata embedded on every
 * primary domain entity.
 */
export interface SyncMetadata {
  createdAt: string;
  updatedAt: string;
  updatedByDeviceId: string;
  version: number;
  deletedAt: string | null;
}

/**
 * Workspace representing a project, task board, or story plot.
 */
export interface Board extends SyncMetadata {
  id: string;
  title: string;
  description: string;
}

/**
 * Card node within a board's dependency graph.
 */
export interface Card extends SyncMetadata {
  id: string;
  boardId: string;
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

  splitFromCardId: string | null;
  mergedFromCardIds: string[] | null;
  replacedByCardIds: string[] | null;
}

/**
 * Directed dependency relation between two cards (sourceCardId -> targetCardId).
 */
export interface Edge extends SyncMetadata {
  id: string;
  boardId: string;
  sourceCardId: string;
  targetCardId: string;
  relationType: RelationType;
  label?: string;

  isConflicted?: boolean;
  conflictReason?: string | null;
}

/**
 * Media attachment metadata for images and audio recordings associated with a card.
 */
export interface CardAttachment extends SyncMetadata {
  id: string;
  cardId: string;
  boardId: string;
  kind: AttachmentKind;
  localUri: string;
  remoteFileId: string | null;
  mimeType: string;
  fileSize: number;
  durationMs: number | null;
  transcript: string | null;
  syncStatus: AssetSyncStatus;
}

/**
 * Complete active snapshot of a board's graph.
 */
export interface BoardGraph {
  board: Board;
  cards: Card[];
  edges: Edge[];
  attachments: CardAttachment[];
}

/**
 * Outbox entry recording a local mutation for synchronization and conflict detection.
 */
export interface SyncOutboxEntry {
  seq: number;
  entityType: SyncOutboxEntityType;
  entityId: string;
  boardId: string;
  operation: SyncOutboxOperation;
  payloadJson: string;
  createdAt: string;
  syncedAt: string | null;
}

/**
 * Record of a synchronization conflict requiring user review and resolution.
 */
export interface ConflictRecord {
  id: string;
  boardId: string;
  entityType: SyncOutboxEntityType;
  entityId: string;
  conflictType: ConflictType;
  localSnapshotJson: string;
  remoteSnapshotJson: string;
  resolvedAt: string | null;
  createdAt: string;
}

/**
 * Optional per-operation context overriding the default device identifier.
 */
export interface MutationContext {
  deviceId?: string;
}

export interface CreateBoardInput {
  id?: string;
  title: string;
  description?: string;
}

export interface UpdateBoardInput {
  title?: string;
  description?: string;
}

export interface CreateCardInput {
  id?: string;
  boardId: string;
  title: string;
  content?: string;
  cardType?: CardType;
  status?: CardStatus;
  tags?: string[];
  posX?: number;
  posY?: number;
  timelineOrder?: number | null;
  startAt?: string | null;
  endAt?: string | null;
}

export interface UpdateCardInput {
  title?: string;
  content?: string;
  cardType?: CardType;
  status?: CardStatus;
  tags?: string[];
  posX?: number;
  posY?: number;
  timelineOrder?: number | null;
  startAt?: string | null;
  endAt?: string | null;
}

export interface CreateAttachmentInput {
  id?: string;
  cardId: string;
  boardId: string;
  kind: AttachmentKind;
  localUri: string;
  remoteFileId?: string | null;
  mimeType: string;
  fileSize?: number;
  durationMs?: number | null;
  transcript?: string | null;
  syncStatus?: AssetSyncStatus;
}

export interface SplitSubCardInput {
  title: string;
  content: string;
  cardType?: CardType;
  tags?: string[];
}

export interface SplitCardParams {
  targetCardId: string;
  subCards: SplitSubCardInput[];
  linkMode: 'sequential' | 'parallel';
}

export interface SplitCardResult {
  parentCard: Card;
  createdCards: Card[];
  createdEdges: Edge[];
  removedEdgeIds: string[];
}

export interface MergeCardsParams {
  targetCardIds: string[];
  mergedCard: {
    title: string;
    content: string;
    cardType?: CardType;
    tags?: string[];
  };
}

export interface InsertIntermediateCardInput {
  title: string;
  content?: string;
  cardType?: CardType;
  status?: CardStatus;
  tags?: string[];
}

/**
 * Represents a single column (layer) in the computed timeline layout.
 */
export interface TimelineStepGroup {
  step: number;
  cards: Card[];
}

/**
 * Represents a dependency ordering violation where a dependent card is placed
 * at or before its prerequisite card in the timeline.
 */
export interface TimelineViolation {
  edgeId: string;
  sourceCardId: string;
  targetCardId: string;
  sourceStep: number;
  targetStep: number;
  reason: string;
}

/**
 * Result returned by BoardGraphService.computeTimelineLayout.
 */
export interface TimelineSortResult {
  boardId: string;
  steps: TimelineStepGroup[];
  violations: TimelineViolation[];
}
