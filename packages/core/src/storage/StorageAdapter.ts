import type {
  Board,
  Card,
  CardAttachment,
  ConflictRecord,
  Edge,
  SyncOutboxEntry,
} from '../types/models.js';

export type NewSyncOutboxEntry = Omit<SyncOutboxEntry, 'seq'>;

/**
 * Pluggable persistence interface implemented by SQLite (Node/Desktop/Android)
 * and in-memory (tests/browser previews) storage backends.
 */
export interface StorageAdapter {
  /**
   * Initializes storage and applies idempotent schema migrations.
   */
  initialize(): Promise<void>;

  /**
   * Releases underlying database connections or resources.
   */
  close(): Promise<void>;

  /**
   * Executes an operation atomically inside a transaction, rolling back on error.
   */
  runInTransaction<T>(fn: () => Promise<T>): Promise<T>;

  // Boards
  listBoards(includeDeleted?: boolean): Promise<Board[]>;
  getBoard(boardId: string, includeDeleted?: boolean): Promise<Board | null>;
  saveBoard(board: Board): Promise<void>;

  // Cards
  listCardsByBoard(boardId: string, includeDeleted?: boolean): Promise<Card[]>;
  getCard(cardId: string, includeDeleted?: boolean): Promise<Card | null>;
  saveCard(card: Card): Promise<void>;

  // Edges
  listEdgesByBoard(boardId: string, includeDeleted?: boolean): Promise<Edge[]>;
  getEdge(edgeId: string, includeDeleted?: boolean): Promise<Edge | null>;
  saveEdge(edge: Edge): Promise<void>;

  // Attachments
  listAllAttachments(includeDeleted?: boolean): Promise<CardAttachment[]>;
  listAttachmentsByBoard(boardId: string, includeDeleted?: boolean): Promise<CardAttachment[]>;
  listAttachmentsByCard(cardId: string, includeDeleted?: boolean): Promise<CardAttachment[]>;
  getAttachment(attachmentId: string, includeDeleted?: boolean): Promise<CardAttachment | null>;
  saveAttachment(attachment: CardAttachment): Promise<void>;

  // Sync outbox
  appendOutbox(entry: NewSyncOutboxEntry): Promise<SyncOutboxEntry>;
  listUnsyncedOutbox(boardId: string): Promise<SyncOutboxEntry[]>;
  markOutboxSynced(seqIds: number[], syncedAt: string): Promise<void>;

  // Conflicts
  listConflicts(boardId: string, includeResolved?: boolean): Promise<ConflictRecord[]>;
  saveConflict(conflict: ConflictRecord): Promise<void>;
}
